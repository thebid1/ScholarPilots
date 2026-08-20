/**
 * The step that makes the whole pipeline worth building: getting from a listing
 * article to the funder's own page.
 *
 * A listing article about, say, the Mastercard Foundation Scholars Program is a
 * perfectly good pointer and a useless source. Somewhere in it there is an
 * outbound link to the university or foundation running the award — and that is
 * the only URL allowed into the catalog.
 *
 * Two routes, cheapest first:
 *   1. Outbound links on the article. Free — we already have the page.
 *   2. Brave web search. Also free (separate quota from Firecrawl), used only
 *      when the article links nowhere official.
 *
 * The model picks from a fixed list it is given and cannot invent a URL; every
 * pick is then re-checked by `checkOfficialSource()` before a credit is spent
 * scraping it.
 */

import { webSearch } from '@/app/lib/web-search';
import { callFeatherless } from './featherless';
import { checkOfficialSource, checkStructuralSource } from './sources';
import { asString, canonicalUrl, identityText, integerSetting, ownerDomain } from './util';
import type { CrawledDocument, PageLink } from './fetch';

/** Links offered to the model. Enough to cover a long article, few enough to stay readable. */
const MAX_LINK_CANDIDATES = 30;
const MAX_ARTICLE_CHARS = 8_000;

/** Anchor text that usually marks the outbound link to the funder. */
const OFFICIAL_LINK_HINTS = [
  'official', 'apply', 'application', 'more information', 'further information',
  'visit', 'website', 'scholarship page', 'read more', 'details', 'link',
];

/**
 * Paths that carry the thing we are actually after: the deadline and how to
 * apply. A programme's front door and its application page are both on the
 * funder's domain, so the gate cannot tell them apart — but only one of them
 * prints a date, and picking the other one is what lost a real open award to a
 * "no exact deadline" rejection.
 */
const APPLY_PATH = /(apply|application|admission|entry-requirements|how[-_]?to|scholarship|bursary|fellowship|grant|funding)/i;

/** Paths that are about the organisation rather than the award. */
const CORPORATE_PATH = /(\/about|about-us|\/careers|\/jobs|\/news|\/press|\/media|\/contact|\/privacy|\/terms|\/blog|\/events)/i;

export interface ResolvedCandidate {
  officialUrl: string;
  title: string;
  funder: string;
}

export interface ResolutionResult {
  resolved: ResolvedCandidate | null;
  /** Why resolution failed, recorded on the candidate so retries are explainable. */
  reason: string;
  /**
   * How the choice was reached. Carried for inspection only — nothing in the
   * pipeline reads it, but a resolver that picks the wrong link is impossible to
   * debug from the outcome alone.
   */
  trace?: {
    shortlist: PageLink[];
    pickedNumber: number | null;
    pickedUrl: string;
    /** The gate's objection when a picked link was thrown out. */
    pickRejectedBecause: string;
    modelTitle: string;
    modelFunder: string;
    modelReason: string;
    /** Set when Brave was consulted, whether or not it found anything. */
    searchedFor: string;
  };
}

/**
 * Rank the article's outbound links by how likely they are to be the funder's
 * page, then keep the plausible ones. Ordering matters twice over: the list is
 * truncated, so an "Official Website" link buried under fifty navigation links
 * would never reach the model — and the model tends to pick from the top when
 * several links look equally official.
 *
 * The path signals carry most of the weight. A funder's domain hosts both the
 * programme overview and the application page; the gate cannot tell them apart
 * and only one of them prints a deadline.
 */
function shortlistLinks(document: CrawledDocument, listingUrl: string): PageLink[] {
  const listingOwner = ownerDomain(listingUrl);
  const seen = new Set<string>();
  const scored: Array<{ link: PageLink; score: number }> = [];

  // The article headline names the award, which is the only description of it
  // available before the model has read anything.
  const awardTokens = identityText(document.title)
    .split(' ')
    .filter((token) => token.length >= 5);

  for (const link of document.links) {
    const owner = ownerDomain(link.url);
    if (!owner || owner === listingOwner) continue;

    // Structural checks only: whether the domain belongs to the funder cannot be
    // judged until the model has told us who the funder is.
    if (!checkStructuralSource(link.url, { listingUrl }).ok) continue;

    const key = canonicalUrl(link.url);
    if (seen.has(key)) continue;
    seen.add(key);

    let path = '';
    try {
      path = new URL(link.url).pathname;
    } catch {
      continue;
    }

    const text = link.text.toLowerCase();
    let score = 0;
    if (OFFICIAL_LINK_HINTS.some((hint) => text.includes(hint))) score += 3;
    if (/\.(edu|gov|int)(\.|\/|$)/.test(link.url) || /\.(ac|gov|edu)\.[a-z]{2}/.test(link.url)) score += 2;
    if (link.text) score += 1;
    if (APPLY_PATH.test(path)) score += 3;
    if (awardTokens.some((token) => path.toLowerCase().includes(token))) score += 2;
    // Never excluded outright — a corporate page can still be the only official
    // link an article offers — but it should lose to anything about the award.
    if (CORPORATE_PATH.test(path)) score -= 4;

    scored.push({ link, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LINK_CANDIDATES)
    .map((entry) => entry.link);
}

function selectionPrompt(document: CrawledDocument, links: PageLink[]): string {
  const numbered = links
    .map((link, index) => `${index + 1}. ${link.url}${link.text ? `  — link text: "${link.text}"` : ''}`)
    .join('\n');

  return `A scholarship listing site published the article below. Identify the scholarship it covers and pick the outbound link that leads to the OFFICIAL page run by the organisation that awards it.

Return ONLY a JSON object:
- title: the scholarship's name.
- funder: the university, foundation, organisation, or government body providing the funding.
- linkNumber: the number of the ONE link that is the official page of that funder — its scholarship, programme, or application page. Use null if none of the links qualify.
- reason: a short explanation of the choice.

Rules:
- linkNumber must be one of the numbers listed. Never write a URL of your own.
- Choose the awarding organisation's own site: the university, foundation, ministry, or agency. Never another scholarship directory, blog, news site, aggregator, education agent, or application-service reseller.
- Among that organisation's own links, pick the one that carries the application deadline and instructions on how to apply. A page describing the programme in general is worth less than the page a student would actually apply from. Prefer the specific scholarship or application page over a departmental page, and either over the organisation's home page — though a home page is acceptable when it is the only official link.
- If the article only links to other listing sites or to social media, return null. A wrong choice is worse than none.

ARTICLE URL: ${document.url}
ARTICLE TITLE: ${document.title}

LINKS FOUND IN THE ARTICLE:
${numbered}

ARTICLE CONTENT:
${document.markdown.slice(0, MAX_ARTICLE_CHARS)}`;
}

function searchQueryFor(title: string, funder: string): string {
  return `${title} ${funder} official scholarship application`.trim();
}

/** Ask Brave for the funder's page by name. Free quota, so no ledger involvement. */
async function searchForOfficialPage(
  title: string,
  funder: string,
  listingUrl: string
): Promise<string> {
  const results = await webSearch(searchQueryFor(title, funder), 8);

  for (const result of results) {
    if (checkOfficialSource(result.url, { listingUrl, funder, title }).ok) return result.url;
  }
  return '';
}

function searchFallbackLimit(): number {
  return integerSetting('INGESTION_SEARCH_FALLBACKS_PER_RUN', 10, 0, 100);
}

/**
 * Resolve one listing article to an official URL.
 *
 * `searchesUsed` is passed in and returned so the caller can bound how many
 * Brave queries a single run makes, without this module owning run state.
 */
export async function resolveOfficialUrl(
  document: CrawledDocument,
  listingUrl: string,
  searchesUsed: number
): Promise<ResolutionResult & { searchesUsed: number }> {
  const links = shortlistLinks(document, listingUrl);
  const trace: NonNullable<ResolutionResult['trace']> = {
    shortlist: links,
    pickedNumber: null,
    pickedUrl: '',
    pickRejectedBecause: '',
    modelTitle: '',
    modelFunder: '',
    modelReason: '',
    searchedFor: '',
  };

  let parsed: Record<string, unknown> | null = null;
  if (links.length > 0) {
    try {
      parsed = await callFeatherless(selectionPrompt(document, links), 600);
    } catch (error) {
      return {
        resolved: null,
        reason: `link selection call failed: ${String(error).slice(0, 120)}`,
        searchesUsed,
        trace,
      };
    }
  }

  const title = asString(parsed?.title) || document.title;
  const funder = asString(parsed?.funder);
  trace.modelTitle = asString(parsed?.title);
  trace.modelFunder = funder;
  trace.modelReason = asString(parsed?.reason);

  if (!title) {
    return { resolved: null, reason: 'could not determine a scholarship title', searchesUsed, trace };
  }

  // Route 1: the model's pick from the supplied links.
  const linkNumber = Number(parsed?.linkNumber);
  if (Number.isInteger(linkNumber) && linkNumber >= 1 && linkNumber <= links.length) {
    const picked = links[linkNumber - 1].url;
    trace.pickedNumber = linkNumber;
    trace.pickedUrl = picked;

    const verdict = checkOfficialSource(picked, { listingUrl, funder, title });
    if (verdict.ok) {
      return { resolved: { officialUrl: picked, title, funder }, reason: '', searchesUsed, trace };
    }
    trace.pickRejectedBecause = verdict.reason;
    console.warn(`[ingestion] Rejected selected link ${picked}: ${verdict.reason}`);
  }

  // Route 2: search by name.
  if (searchesUsed >= searchFallbackLimit()) {
    return {
      resolved: null,
      reason: 'no official outbound link, and the run is out of search fallbacks',
      searchesUsed,
      trace,
    };
  }

  trace.searchedFor = searchQueryFor(title, funder);
  const found = await searchForOfficialPage(title, funder, listingUrl);
  const nextSearchesUsed = searchesUsed + 1;
  if (found) {
    return {
      resolved: { officialUrl: found, title, funder },
      reason: '',
      searchesUsed: nextSearchesUsed,
      trace,
    };
  }

  return {
    resolved: null,
    reason: 'no official funder page found in article links or web search',
    searchesUsed: nextSearchesUsed,
    trace,
  };
}
