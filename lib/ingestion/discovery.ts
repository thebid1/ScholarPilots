/**
 * Discovery: what scholarships exist at all.
 *
 * Listing sites are good at this and bad at everything else. A category page on
 * an aggregator is a maintained index of awards currently worth applying for —
 * far better coverage than any hand-curated list — so this stage harvests the
 * article links and stops there. Nothing discovered here is trusted as a source;
 * it is all just leads for `resolve.ts` to trace back to the funder.
 *
 * Two inputs: the configured listing pages, and optional Brave queries. Brave
 * costs no Firecrawl credits, so the queries widen coverage for free.
 */

import { webSearch } from '@/app/lib/web-search';
import type { RunLedger } from './budget';
import { loadDocument } from './fetch';
import { CandidateInput, enqueueCandidates } from './candidates';
import { checkStructuralSource, isAggregatorUrl, isBlockedUrl, listingUrls, pagesPerSource, searchQueries } from './sources';
import { canonicalUrl, isHttpUrl, ownerDomain } from './util';

/**
 * Paths that are indexes rather than articles. Aggregators are almost all
 * WordPress, so these patterns cover most of them.
 */
const INDEX_PATH = /\/(category|categories|tag|tags|author|page|feed|search|wp-|comments|about|contact|privacy|terms|advertise|submit)(\/|$|\?)/i;

/** An article title is a sentence; navigation labels are one or two words. */
const MIN_TITLE_WORDS = 3;

/** Words that mark a link as a scholarship article rather than site furniture. */
const OPPORTUNITY_HINTS = /\b(scholarship|scholarships|fellowship|fellowships|grant|grants|bursary|bursaries|award|awards|funded|funding|programme|program)\b/i;

/**
 * Pick the article permalinks out of a listing index page.
 *
 * Articles live on the listing site's own domain — that is the one place
 * same-domain links are wanted, since the article is the thing we need to read
 * next. Off-site links on an index page are ads and partner sites.
 */
function articleLinksFromListing(
  listingUrl: string,
  links: Array<{ url: string; text: string }>
): Array<{ url: string; title: string }> {
  const listingOwner = ownerDomain(listingUrl);
  const listingKey = canonicalUrl(listingUrl);
  const seen = new Set<string>();
  const articles: Array<{ url: string; title: string }> = [];

  for (const link of links) {
    if (!isHttpUrl(link.url) || isBlockedUrl(link.url)) continue;
    if (ownerDomain(link.url) !== listingOwner) continue;

    let path: string;
    try {
      path = new URL(link.url).pathname;
    } catch {
      continue;
    }
    if (path === '/' || INDEX_PATH.test(path)) continue;

    const key = canonicalUrl(link.url);
    if (key === listingKey || seen.has(key)) continue;

    const title = link.text.replace(/\s+/g, ' ').trim();
    const words = title.split(' ').filter(Boolean).length;
    // Require either a sentence-like anchor or an opportunity word in the slug,
    // so pagination and sidebar widgets do not become candidates.
    if (words < MIN_TITLE_WORDS && !OPPORTUNITY_HINTS.test(path)) continue;

    seen.add(key);
    articles.push({ url: link.url, title });
  }

  return articles;
}

/**
 * Crawl the configured listing pages and queue every new article they link to.
 *
 * Listing pages go through the free HTTP path first: aggregators are mostly
 * server-rendered WordPress, so this usually costs nothing at all and Firecrawl
 * is only billed when a site really does need a browser.
 */
export async function discoverFromListings(ledger: RunLedger): Promise<number> {
  const listings = listingUrls();
  if (listings.length === 0) return 0;

  const perSource = pagesPerSource();
  let queued = 0;

  for (const listingUrl of listings) {
    if (ledger.outOfTime) {
      console.warn('[ingestion] Out of time during listing discovery.');
      break;
    }

    const document = await loadDocument(listingUrl, ledger, { allowFreeFetch: true });
    if (!document) {
      console.warn(`[ingestion] Could not load listing page ${listingUrl}`);
      continue;
    }
    ledger.count('listings');

    const articles = articleLinksFromListing(listingUrl, document.links).slice(0, perSource);
    const added = await enqueueCandidates(
      articles.map<CandidateInput>((article) => ({
        listingUrl,
        articleUrl: article.url,
        title: article.title,
      }))
    );
    queued += added;
    console.log(
      `[ingestion] ${listingUrl}: ${articles.length} articles seen, ${added} new (via ${document.via})`
    );
  }

  return queued;
}

/**
 * Widen discovery with Brave queries. Free quota, no Firecrawl credits.
 *
 * Results split two ways. An aggregator hit is queued as an ordinary article to
 * be traced later. A hit that is already on a non-aggregator domain is queued
 * with its official URL pre-filled, so the pipeline skips resolution and goes
 * straight to verifying it — the cheapest possible path to a catalog row.
 */
export async function discoverFromSearch(ledger: RunLedger): Promise<number> {
  const queries = searchQueries();
  if (queries.length === 0) return 0;

  let queued = 0;
  for (const query of queries) {
    if (ledger.outOfTime) break;

    const results = await webSearch(query, 10);
    const candidates: CandidateInput[] = [];

    for (const result of results) {
      if (!isHttpUrl(result.url) || isBlockedUrl(result.url)) continue;

      if (isAggregatorUrl(result.url)) {
        candidates.push({
          listingUrl: `search:${query}`,
          articleUrl: result.url,
          title: result.title,
        });
      } else if (checkStructuralSource(result.url).ok) {
        candidates.push({
          listingUrl: `search:${query}`,
          articleUrl: result.url,
          title: result.title,
          officialUrl: result.url,
        });
      }
    }

    const added = await enqueueCandidates(candidates);
    queued += added;
    console.log(`[ingestion] search "${query}": ${results.length} results, ${added} new candidates`);
  }

  return queued;
}
