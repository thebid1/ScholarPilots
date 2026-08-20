/**
 * Getting page content, cheapest source first.
 *
 * Firecrawl credits are a finite lifetime pool, so this module's job is to spend
 * as few of them as possible. A plain HTTP fetch costs nothing and works on a
 * large share of listing articles; Firecrawl's headless browser is reserved for
 * pages that actually need it — bot walls, JS-rendered content, and the official
 * funder pages where extraction accuracy is worth a credit.
 *
 * Links are carried alongside the text because the resolver needs them: the
 * outbound "official website" link in a listing article is how we get from an
 * aggregator to the funder.
 */

import { CREDITS_PER_SCRAPE, RunLedger } from './budget';
import { asString, integerSetting, isHttpUrl } from './util';

const FIRECRAWL_DEFAULT_BASE_URL = 'https://api.firecrawl.dev/v2';

/** Some funder sites 403 an obviously non-browser agent. */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

export interface PageLink {
  url: string;
  /** Anchor text, when the source preserved it. Often the strongest signal. */
  text: string;
}

export interface CrawledDocument {
  url: string;
  title: string;
  markdown: string;
  links: PageLink[];
  /** Which path produced this — reported so a run's credit use is explainable. */
  via: 'http' | 'firecrawl';
}

interface FirecrawlResponse {
  success?: boolean;
  data?: unknown;
}

function firecrawlBaseUrl(): string {
  return (process.env.FIRECRAWL_BASE_URL || FIRECRAWL_DEFAULT_BASE_URL).replace(/\/$/, '');
}

export function firecrawlConcurrency(): number {
  return integerSetting('FIRECRAWL_CONCURRENCY', 1, 1, 5);
}

function firecrawlTimeoutMs(): number {
  // 60s, down from 120s: a run has a wall-clock deadline and ~28 sequential
  // scrapes at two minutes each would blow through it.
  return integerSetting('FIRECRAWL_REQUEST_TIMEOUT_MS', 60_000, 15_000, 300_000);
}

function absoluteUrl(href: string, base: string): string | null {
  try {
    const resolved = new URL(href, base).toString();
    return isHttpUrl(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function dedupeLinks(links: PageLink[]): PageLink[] {
  const byUrl = new Map<string, PageLink>();
  for (const link of links) {
    const existing = byUrl.get(link.url);
    // Prefer the copy that carries anchor text.
    if (!existing || (!existing.text && link.text)) byUrl.set(link.url, link);
  }
  return Array.from(byUrl.values());
}

/** Pull `[text](url)` pairs out of markdown. Firecrawl's link list has no anchor text. */
function linksFromMarkdown(markdown: string, base: string): PageLink[] {
  const links: PageLink[] = [];
  const pattern = /\[([^\]]{0,200})\]\(\s*<?([^)\s>]+)>?[^)]*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    const url = absoluteUrl(match[2], base);
    if (url) links.push({ url, text: match[1].replace(/[*_`]/g, '').trim() });
  }
  return links;
}

function linksFromHtml(html: string, base: string): PageLink[] {
  const links: PageLink[] = [];
  const pattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const url = absoluteUrl(match[1], base);
    if (!url) continue;
    const text = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    links.push({ url, text: text.slice(0, 200) });
  }
  return links;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&pound;/g, '£')
    .replace(/&euro;/g, '€')
    .replace(/&#8211;|&ndash;/g, '-')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function titleFromHtml(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlToText(match[1]).slice(0, 300) : '';
}

/**
 * The minimum readable text for a page to count as successfully fetched. Below
 * this a page is almost certainly JS-rendered or behind a wall, and is worth
 * retrying through Firecrawl.
 */
const MIN_USABLE_CHARS = 600;

/**
 * Free path: one plain HTTP GET, no credits. Returns null on anything that looks
 * like a bot wall, a non-HTML response, or a near-empty JS shell, which is the
 * signal to fall back to Firecrawl.
 */
async function httpFetchDocument(url: string): Promise<CrawledDocument | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('html') && !contentType.includes('text')) return null;

    const html = await response.text();
    const markdown = htmlToText(html);
    if (markdown.length < MIN_USABLE_CHARS) return null;

    return {
      url: response.url || url,
      title: titleFromHtml(html),
      markdown,
      links: dedupeLinks(linksFromHtml(html, response.url || url)),
      via: 'http',
    };
  } catch {
    return null;
  }
}

async function firecrawlRequest(
  path: string,
  body: Record<string, unknown>
): Promise<FirecrawlResponse> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error('FIRECRAWL_API_KEY is not configured.');

  const response = await fetch(`${firecrawlBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(firecrawlTimeoutMs()),
  });
  if (!response.ok) {
    throw new Error(`Firecrawl ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as FirecrawlResponse;
}

function documentFromResult(result: unknown, fallbackUrl: string): CrawledDocument | null {
  if (!result || typeof result !== 'object') return null;
  const item = result as Record<string, unknown>;
  const metadata = item.metadata as Record<string, unknown> | undefined;
  const url = asString(item.url)
    || asString(metadata?.sourceURL)
    || asString(metadata?.url)
    || fallbackUrl;
  const markdown = asString(item.markdown);
  if (!isHttpUrl(url) || !markdown) return null;

  const listed = Array.isArray(item.links)
    ? (item.links as unknown[]).flatMap((entry) => {
      // v2 returns plain URL strings; tolerate an object shape too.
      const href = typeof entry === 'string' ? entry : asString((entry as Record<string, unknown>)?.url);
      const absolute = href ? absoluteUrl(href, url) : null;
      return absolute ? [{ url: absolute, text: '' }] : [];
    })
    : [];

  return {
    url,
    title: asString(item.title) || asString(metadata?.title),
    markdown,
    // Markdown first: it is the only source of anchor text.
    links: dedupeLinks([...linksFromMarkdown(markdown, url), ...listed]),
    via: 'firecrawl',
  };
}

/**
 * Paid path. Claims a credit from the ledger *before* the call, and returns null
 * without spending if the run has no budget or time left.
 */
async function firecrawlDocument(url: string, ledger: RunLedger): Promise<CrawledDocument | null> {
  if (!ledger.spend(CREDITS_PER_SCRAPE)) {
    console.warn(`[ingestion] Out of budget before scraping ${url}`);
    return null;
  }
  try {
    const response = await firecrawlRequest('/scrape', {
      url,
      formats: ['markdown', 'links'],
      onlyMainContent: true,
      // `onlyMainContent` alone left an entire funder page's first 600 characters
      // as "Skip to main content" and social icons, which is 600 characters of the
      // extraction window spent on nothing. `form` and `header` are deliberately
      // absent: application instructions and deadlines live in forms, and a page
      // heading is often where the award is named.
      excludeTags: ['nav', 'footer', 'script', 'style', 'noscript', 'iframe', 'svg'],
    });
    const document = documentFromResult(response.data, url);
    if (!document) throw new Error('Firecrawl returned no markdown.');
    return document;
  } catch (error) {
    // The credit is not refunded: Firecrawl does not bill failures, but assuming
    // a refund we cannot verify would let a failing source drain the pool.
    console.warn(`[ingestion] Firecrawl scrape failed for ${url}:`, error);
    return null;
  }
}

export interface LoadOptions {
  /**
   * Try the free HTTP fetch first. Right for listing pages and articles, where
   * we only need titles and outbound links. Official funder pages skip it —
   * Firecrawl's markdown is materially better for field extraction, and a wrong
   * deadline is the one error that costs a student something.
   */
  allowFreeFetch?: boolean;
}

/** Load a page, preferring the free path when the caller allows it. */
export async function loadDocument(
  url: string,
  ledger: RunLedger,
  options: LoadOptions = {}
): Promise<CrawledDocument | null> {
  if (!isHttpUrl(url)) return null;

  if (options.allowFreeFetch) {
    const free = await httpFetchDocument(url);
    if (free) return free;
  }
  return firecrawlDocument(url, ledger);
}
