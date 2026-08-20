/**
 * Where discovery starts, and what can never be treated as a funding source.
 *
 * The rule this file exists to enforce: a listing site may tell us that a
 * scholarship exists, but it can never be the `source_url` we store. Only the
 * page hosted by the university, funder, or government that owns the award
 * qualifies. Everything below is the deterministic half of that check — the AI
 * verification in `verify.ts` runs behind these gates, never instead of them.
 */

import { configuredList, integerSetting, isHttpUrl, ownerDomain, identityText } from './util';

/** Used when `FIRECRAWL_LISTING_URLS` is unset. Both are barred as sources by `AGGREGATOR_HOSTS`. */
const DEFAULT_LISTING_URLS = [
  'https://www.opportunitiesforafricans.com/category/scholarships/',
  'https://brightscholarship.com/',
];

/**
 * Scholarship directories, aggregators, and application middlemen. These are
 * useful discovery inputs and invalid funding sources — the whole point of the
 * pipeline is to get from one of these to the funder's own page. A URL whose
 * registrable domain is on this list can never be stored.
 */
const AGGREGATOR_HOSTS = [
  'opportunitiesforafricans.com',
  'brightscholarship.com',
  'globalsouthopportunities.com',
  'afterschoolafrica.com',
  'scholarshipregion.com',
  'opportunitydesk.org',
  'scholars4dev.com',
  'scholarshiproar.com',
  'scholarshipsads.com',
  'scholarshipdb.net',
  'scholarship-positions.com',
  'scholarshipunion.com',
  'scholarshiptab.com',
  'scholarships.com',
  'scholarshipportal.com',
  'studyportals.com',
  'mastersportal.com',
  'bachelorsportal.com',
  'phdportal.com',
  'findaphd.com',
  'findamasters.com',
  'buddy4study.com',
  'wemakescholars.com',
  'fastweb.com',
  'unigo.com',
  'niche.com',
  'chegg.com',
  'studyabroad.com',
  'topuniversities.com',
  'timeshighereducation.com',
  'idp.com',
  'shiksha.com',
  'leverageedu.com',
  'yocket.com',
  'unicaf.org',
  'edarabia.com',
  'youthop.com',
  'youthopportunitieshub.com',
  'oyaop.com',
  'armacad.info',
  'mladiinfo.eu',
  'medium.com',
  'wordpress.com',
  'blogspot.com',
  'wikipedia.org',
];

/**
 * Social, chat, and video platforms. A scholarship's "official page" is never
 * one of these, and following them wastes credits on login walls.
 */
const BLOCKED_HOSTS = [
  'facebook.com', 'instagram.com','pinterest.com', 'reddit.com',
  'tiktok.com', 'twitter.com', 'x.com', 'youtube.com', 'youtu.be', 't.me',
  'telegram.me', 'wa.me', 'whatsapp.com', 'discord.com', 'discord.gg',
  'threads.net', 'snapchat.com', 'quora.com', 'tumblr.com', 'vk.com',
];

/**
 * Suffixes only issued to accredited institutions and governments. A match here
 * is strong enough on its own to believe the page belongs to the awarding body.
 */
const INSTITUTIONAL_SUFFIXES = [
  '.edu', '.gov', '.mil', '.int',
  '.ac.uk', '.gov.uk', '.sch.uk',
  '.edu.au', '.gov.au', '.edu.ng', '.gov.ng', '.ac.za', '.gov.za',
  '.edu.gh', '.gov.gh', '.ac.ke', '.go.ke', '.ac.tz', '.go.tz',
  '.ac.in', '.edu.in', '.gov.in', '.ac.jp', '.go.jp', '.edu.cn', '.gov.cn',
  '.edu.br', '.gov.br', '.edu.eg', '.gov.eg', '.ac.nz', '.govt.nz',
  '.gouv.fr', '.gc.ca',
];

/** Extensions Firecrawl cannot turn into readable text. PDFs are fine and stay. */
const UNREADABLE_EXTENSIONS = /\.(zip|rar|7z|tar|gz|docx?|xlsx?|pptx?|jpe?g|png|gif|svg|webp|mp4|mp3|ics)$/i;

const MAX_LISTING_URLS = 20;
const MAX_SEARCH_QUERIES = 5;

function hostMatches(url: string, hosts: string[]): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return true; // Unparseable is treated as blocked, never as official.
  }
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

/** Discovery inputs. Reads the new name first, then the name it replaced. */
export function listingUrls(): string[] {
  const configured = [
    ...configuredList('FIRECRAWL_LISTING_URLS'),
    ...configuredList('FIRECRAWL_SOURCE_URLS'),
  ].filter(isHttpUrl);
  const unique = Array.from(new Set(configured.map((url) => url.trim())));
  return (unique.length ? unique : DEFAULT_LISTING_URLS).slice(0, MAX_LISTING_URLS);
}

/** Optional Brave queries used to find listing pages beyond the configured set. */
export function searchQueries(): string[] {
  return configuredList('FIRECRAWL_SEARCH_QUERIES').slice(0, MAX_SEARCH_QUERIES);
}

export function pagesPerSource(): number {
  return integerSetting('FIRECRAWL_PAGES_PER_SOURCE', 10, 1, 50);
}

export function isBlockedUrl(url: string): boolean {
  return hostMatches(url, BLOCKED_HOSTS);
}

/**
 * True for known directories and aggregators, including every host configured as
 * a discovery input. Configured listing sites are added dynamically so pointing
 * the crawler at a new aggregator automatically bars it from being stored as a
 * source — you cannot accidentally make a listing site look official by
 * crawling it.
 */
export function isAggregatorUrl(url: string): boolean {
  const configuredHosts = listingUrls()
    .map((listing) => ownerDomain(listing))
    .filter(Boolean);
  return hostMatches(url, [...AGGREGATOR_HOSTS, ...configuredHosts]);
}

/** A `.edu` / `.gov` / `.ac.uk`-class domain: institutional by registration. */
export function hasInstitutionalSuffix(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return INSTITUTIONAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

/**
 * Words that appear in half the scholarship names on the internet and therefore
 * prove nothing about who owns a domain.
 *
 * Without this filter the check compares against whatever tokens a title happens
 * to contain, and a directory called `globalsouthopportunities.com` matches the
 * funder "Brand South Africa" on the word `south`. That actually happened, and it
 * cost a credit scraping a listing site. Every token here is one that a real
 * funder's domain might legitimately contain — which is exactly why matching on it
 * alone means nothing.
 */
const GENERIC_TOKENS = new Set([
  'south', 'north', 'east', 'west', 'africa', 'african', 'asia', 'asian',
  'europe', 'european', 'america', 'american', 'global', 'world', 'international',
  'national', 'youth', 'young', 'women', 'woman', 'student', 'students',
  'scholar', 'scholars', 'scholarship', 'scholarships', 'fellowship',
  'fellowships', 'bursary', 'bursaries', 'grant', 'grants', 'program',
  'programme', 'programs', 'programmes', 'foundation', 'university',
  'universities', 'college', 'institute', 'institution', 'education',
  'educational', 'academy', 'academic', 'opportunity', 'opportunities',
  'funded', 'funding', 'fund', 'award', 'awards', 'study', 'studies',
  'master', 'masters', 'doctoral', 'undergraduate', 'postgraduate',
  'developing', 'countries', 'country', 'centre', 'center', 'trust',
]);

/**
 * Whether the domain plausibly belongs to the named award or funder.
 *
 * Matches the domain's own label against the funder and title tokens, so
 * "Mastercard Foundation" matches `mastercardfdn` and "Chevening Scholarships"
 * matches `chevening`. Initialisms are matched too, for the DAADs of the world.
 * Advisory only: the result travels as `weakDomain` and rejects nothing.
 */
export function domainMatchesFunder(url: string, funder: string, title: string): boolean {
  const domain = ownerDomain(url);
  if (!domain) return false;
  const label = domain.split('.')[0].replace(/[^a-z0-9]/g, '');
  if (label.length < 3) return false;

  const tokens = Array.from(
    new Set([...identityText(funder).split(' '), ...identityText(title).split(' ')])
  ).filter((token) => token.length >= 4 && !GENERIC_TOKENS.has(token));

  if (tokens.some((token) => label.includes(token) || token.includes(label))) return true;

  // "DAAD" for Deutscher Akademischer Austauschdienst: initials of the name.
  // Built from the funder's full name, generic words included — they are part of
  // the initialism even when they are useless on their own.
  const initials = identityText(funder)
    .split(' ')
    .filter((word) => word.length > 2)
    .map((word) => word[0])
    .join('');
  return initials.length >= 3 && label.startsWith(initials);
}

export interface SourceRejection {
  ok: false;
  reason: string;
}

export interface SourceAcceptance {
  ok: true;
  /**
   * The domain gave no sign of belonging to this funder. Information, never a
   * veto — see `checkOfficialSource`.
   */
  weakDomain?: boolean;
}

export type SourceVerdict = SourceAcceptance | SourceRejection;

/**
 * The structural half of the gate: everything decidable from the URL alone.
 *
 * Separate from the funder check because it runs at a different time — outbound
 * links are shortlisted before the AI has told us who the funder is, so only
 * these checks are available then.
 */
export function checkStructuralSource(
  url: string,
  options: { listingUrl?: string } = {}
): SourceVerdict {
  if (!isHttpUrl(url)) return { ok: false, reason: 'not an http(s) URL' };
  if (UNREADABLE_EXTENSIONS.test(new URL(url).pathname)) {
    return { ok: false, reason: 'file type cannot be read as text' };
  }
  if (isBlockedUrl(url)) return { ok: false, reason: 'social or chat platform' };
  if (isAggregatorUrl(url)) return { ok: false, reason: 'scholarship directory or aggregator' };

  if (options.listingUrl) {
    const listingOwner = ownerDomain(options.listingUrl);
    if (listingOwner && ownerDomain(url) === listingOwner) {
      return { ok: false, reason: 'same domain as the listing site' };
    }
  }

  return { ok: true };
}


/**
 * Structural checks, plus a `weakDomain` note when the domain shows no tie to the
 * funder. The note is carried for the review card and never rejects a URL; page
 * content is judged in `verify.ts`.
 */
export function checkOfficialSource(
  url: string,
  options: { listingUrl?: string; funder?: string; title?: string } = {}
): SourceVerdict {
  const structural = checkStructuralSource(url, options);
  if (!structural.ok) return structural;

  const weakDomain = !hasInstitutionalSuffix(url)
    && !domainMatchesFunder(url, options.funder ?? '', options.title ?? '');

  return { ok: true, weakDomain };
}
