/**
 * The verification step: is this page really the funder's own, and what does it
 * actually say?
 *
 * Runs on the *official* page only — never on the listing article. By the time a
 * document reaches here, `checkOfficialSource()` has already ruled out
 * aggregators, social platforms, and domains unconnected to the award. This step
 * is the semantic half: a page can sit on a perfectly respectable domain and
 * still be a blog post, a news item, or a third-party application service.
 *
 * There are three outcomes rather than two, and the middle one matters. A page
 * can verify as unambiguously the funder's, describe an open award, and simply
 * not print an exact date — funders do this constantly, deferring the deadline to
 * a partner or a downloadable form. Treating that as a rejection cost us real,
 * open scholarships. It is now `incomplete`: the extraction is carried forward
 * for a human to finish. A date is still never guessed or inferred, which was the
 * point of the strict rule; the difference is who supplies the missing one.
 */

import { callFeatherless } from './featherless';
import { hasInstitutionalSuffix } from './sources';
import {
  asNumberOrNull, asString, asStringArray, isHttpUrl, isOpenDeadline,
  ownerDomain, titleSimilarity,
} from './util';
import type { CrawledDocument } from './fetch';

const MAX_DOCUMENT_CHARS = 14_000;

/**
 * How much the official page's title must overlap the title the listing
 * advertised. Lenient by design: listings pad titles with years, countries, and
 * "fully funded", so an exact match would reject good records. The AI's own
 * `describesScholarship` check is the sharper instrument; this only catches a
 * resolver that landed on a completely unrelated page.
 */
const TITLE_MATCH_FLOOR = 0.35;

export type SourceType = 'university' | 'funder' | 'government';

export interface ExtractedScholarship {
  sourceType: SourceType;
  title: string;
  funder: string;
  country: string;
  amountCurrency: string;
  amountValue: number | null;
  amountType: 'full' | 'partial' | 'stipend' | 'unknown';
  deadline: string;
  degreeLevels: string[];
  fieldsOfStudy: string[];
  eligibleNationalities: string[];
  minGpa: number | null;
  requirements: string;
  eligibility: string[];
  description: string;
  sourceUrl: string;
  requiredDocs: string[];
  /** What the award pays for. Kept apart from `requiredDocs` on purpose — see the prompt. */
  benefits: string[];
}

/**
 * An extraction that passed every source check but lacks a field the catalog
 * requires. Only the two fields a reviewer can supply from the page are widened;
 * everything else is already known by this point.
 */
export type PartialScholarship = Omit<ExtractedScholarship, 'deadline' | 'sourceType'> & {
  deadline: string | null;
  sourceType: SourceType | null;
};

function normaliseAmountType(value: unknown): ExtractedScholarship['amountType'] {
  const type = asString(value).toLowerCase();
  return type === 'full' || type === 'partial' || type === 'stipend' ? type : 'unknown';
}

function isSourceType(value: string): value is SourceType {
  return value === 'university' || value === 'funder' || value === 'government';
}

/**
 * Coerce the model's JSON into the stored shape. Returns null only when the page
 * yielded nothing identifiable at all.
 *
 * `sourceUrl` is bound by the server to the page actually scraped — the model
 * never gets to nominate it, which is what guarantees a listing URL cannot end up
 * in the catalog through a hallucinated field.
 */
function readFields(raw: unknown, scrapedUrl: string): PartialScholarship | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  const title = asString(value.title);
  if (!title || !isHttpUrl(scrapedUrl)) return null;

  const deadline = asString(value.deadline);
  const sourceType = asString(value.officialSourceType).toLowerCase();

  return {
    sourceType: isSourceType(sourceType) ? sourceType : null,
    title,
    funder: asString(value.funder) || 'Unknown',
    country: asString(value.country) || 'International',
    amountCurrency: asString(value.amountCurrency) || 'USD',
    amountValue: asNumberOrNull(value.amountValue),
    amountType: normaliseAmountType(value.amountType),
    // Anything not an exact, open date is absent rather than approximated.
    deadline: isOpenDeadline(deadline) ? deadline : null,
    degreeLevels: asStringArray(value.degreeLevels),
    fieldsOfStudy: asStringArray(value.fieldsOfStudy),
    eligibleNationalities: asStringArray(value.eligibleNationalities),
    minGpa: asNumberOrNull(value.minGpa),
    requirements: asString(value.requirements),
    eligibility: asStringArray(value.eligibility),
    description: asString(value.description),
    sourceUrl: scrapedUrl,
    requiredDocs: asStringArray(value.requiredDocs),
    benefits: asStringArray(value.benefits),
  };
}

/** Promote a partial to a storable record, or null if a required field is still absent. */
function promote(partial: PartialScholarship): ExtractedScholarship | null {
  const { deadline, sourceType } = partial;
  if (!deadline || !sourceType) return null;
  return { ...partial, deadline, sourceType };
}

function verificationPrompt(document: CrawledDocument, expectedTitle: string): string {
  const domain = ownerDomain(document.url);
  const expectation = expectedTitle
    ? `\nA scholarship listing described this page as: "${expectedTitle}". Confirm the page really covers that award. If it covers a different award, set describesScholarship to false.`
    : '';

  return `You are auditing whether a web page is the official source for a scholarship, then extracting its details.

PAGE URL: ${document.url}
PAGE DOMAIN: ${domain}
PAGE TITLE: ${document.title}${expectation}

Return ONLY a JSON object with these fields:
- isOfficialSource: true only if this page is published by the university, funding organisation, foundation, or government body that actually awards this scholarship. False for scholarship directories, aggregators, blogs, news articles, SEO listings, reposts, student forums, education agents, and paid application services — even when their facts are correct.
- domainBelongsToFunder: true only if ${domain} is plausibly owned by the awarding organisation named in "funder", or by a partner institution hosting the application on its behalf.
- describesScholarship: true only if the page describes a specific, currently open funding opportunity that students can apply for — not a general programme overview, an alumni page, or a past cycle.
- officialSourceType: exactly "university", "funder", or "government". Use "" if none applies.
- title: the scholarship's name as the official page gives it.
- funder: the organisation providing the funding.
- country: the country where the student would study. If the page does not say outright, use the country of the host university or institution named on it. "" only if no country can be determined.
- amountCurrency: ISO code such as USD, GBP, EUR. "" if not stated.
- amountValue: number only, or null.
- amountType: "full", "partial", "stipend", or "unknown".
- deadline: the application submission deadline as YYYY-MM-DD.
- degreeLevels: array, e.g. ["masters","phd"].
- fieldsOfStudy: array.
- eligibleNationalities: array of the nationalities, countries, or country groups eligible to apply.
- minGpa: number or null.
- requirements: one paragraph of application requirements.
- eligibility: array of eligibility criteria.
- description: 2-3 sentence summary.
- requiredDocs: array of documents the applicant must prepare and submit — transcripts, reference letters, essays, a CV, proof of admission, a passport copy.
- benefits: array of what the award itself provides — tuition coverage, monthly stipend, airfare, health insurance, accommodation.

Rules:
- Use ONLY facts stated on this page. Never fill gaps from prior knowledge about the programme.
- deadline must be an exact YYYY-MM-DD date stated on the page. If the page gives a partial date ("March 2027"), a rolling or ongoing deadline, or no deadline at all, return "" — never invent or infer a day. Returning "" is expected and useful; a guessed date is not.
- requiredDocs and benefits are different things. What the applicant hands over goes in requiredDocs; what the award pays for goes in benefits. Never put funding coverage in requiredDocs.
- eligibleNationalities: use ["all"] ONLY if the page explicitly says the award is open to any nationality. If it restricts applicants to a region, a member-country group, or a list of countries, name them as the page does — never widen a restricted award to ["all"].
- Unknown strings are "". Unknown arrays are []. Unknown numbers are null.
- Judge the source honestly. A page that merely links to the funder is not the funder's page.

PAGE CONTENT:
${document.markdown.slice(0, MAX_DOCUMENT_CHARS)}`;
}

/**
 * - `accepted`  — verified and complete; storable as-is.
 * - `incomplete`— the funder's page for an open award, with a required field
 *                 absent. `partial` carries what was read.
 * - `unverified`— an open award was read, but the page may not be the funder's
 *                 own. `partial` carries the extraction; `missing` lists
 *                 `sourceUrl`, so a reviewer supplies the link.
 * - `rejected`  — not an award, or an award whose deadline has passed.
 */
export type VerificationOutcome = 'accepted' | 'incomplete' | 'unverified' | 'rejected';

export interface VerificationResult {
  outcome: VerificationOutcome;
  /** Set only when `accepted`. */
  scholarship: ExtractedScholarship | null;
  /** Set when `incomplete` or `unverified`. */
  partial: PartialScholarship | null;
  /** Field names a reviewer has to supply, e.g. `['deadline']`. */
  missing: string[];
  /** Why it was not accepted, for the candidate queue and the reviewer. */
  reason: string;
  /**
   * The model's unmodified JSON. Carried for inspection only — nothing in the
   * pipeline reads it, but when an extraction looks wrong this is the difference
   * between diagnosing the prompt and guessing at it.
   */
  raw?: Record<string, unknown>;
}

/**
 * Verify and extract a single official page.
 *
 * Rejects pages that do not describe an open award and pages whose stated
 * deadline has passed. Doubt about whether the page belongs to the funder returns
 * `unverified` with the extraction intact, leaving the URL for a reviewer to
 * confirm.
 */
export async function verifyOfficialPage(
  document: CrawledDocument,
  expected: { title?: string } = {}
): Promise<VerificationResult> {
  const fail = (reason: string, raw?: Record<string, unknown>): VerificationResult =>
    ({ outcome: 'rejected', scholarship: null, partial: null, missing: [], reason, raw });

  let parsed: Record<string, unknown> | null;
  try {
    parsed = await callFeatherless(verificationPrompt(document, expected.title ?? ''), 2_500);
  } catch (error) {
    return fail(`verification call failed: ${String(error).slice(0, 120)}`);
  }
  if (!parsed) return fail('verification returned unparseable JSON');

  const raw = parsed;
  const reject = (reason: string) => fail(reason, raw);

  // Fields are read first so an unverifiable page still carries its extraction.
  const partial = readFields(parsed, document.url);
  if (!partial) return reject('incomplete extraction (no title on the page)');

  if (parsed.describesScholarship !== true) {
    return reject('page does not describe an open, specific award');
  }

  // A date that is stated but past means the cycle has closed — that is a
  // rejection, not a gap a reviewer could fill in.
  const stated = asString(parsed.deadline);
  if (stated && !isOpenDeadline(stated)) {
    return reject(`deadline ${stated} is past or malformed`);
  }

  const gaps = [
    ...(partial.deadline ? [] : ['deadline']),
    ...(partial.sourceType ? [] : ['sourceType']),
  ];

  // Doubts about the URL, none of which discard the award.
  const doubts: string[] = [];
  if (parsed.isOfficialSource !== true) {
    doubts.push('the AI did not judge this the funder\'s own page');
  }
  if (parsed.domainBelongsToFunder !== true && !hasInstitutionalSuffix(document.url)) {
    doubts.push(`${ownerDomain(document.url)} is not confirmably the funder's domain`);
  }
  if (expected.title && titleSimilarity(expected.title, partial.title) < TITLE_MATCH_FLOOR) {
    doubts.push(`the page is about "${partial.title}", not "${expected.title}"`);
  }

  if (doubts.length > 0) {
    return {
      outcome: 'unverified',
      scholarship: null,
      partial,
      missing: ['sourceUrl', ...gaps],
      reason: `${doubts.join('; ')} — confirm the link yourself`,
      raw,
    };
  }

  const scholarship = promote(partial);
  if (scholarship) {
    return { outcome: 'accepted', scholarship, partial: null, missing: [], reason: '', raw };
  }

  return {
    outcome: 'incomplete',
    scholarship: null,
    partial,
    missing: gaps,
    reason: gaps.includes('deadline')
      ? 'no exact deadline stated on the page'
      : 'page did not classify as university, funder, or government',
    raw,
  };
}
