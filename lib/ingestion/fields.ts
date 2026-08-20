/**
 * The editable catalog field set: how a JSON body becomes fields, and what a
 * field set must satisfy before it is written.
 *
 * Approving a submission, adding a scholarship by hand, and editing one already
 * in the catalog all pass through `checkFields`, so a source URL typed by a human
 * meets the same aggregator gate the resolver does.
 */

import { checkStructuralSource } from './sources';
import { asNumberOrNull, asString, asStringArray, isHttpUrl, isOpenDeadline } from './util';
import type { ExtractedScholarship, SourceType } from './verify';

export const AMOUNT_TYPES = ['full', 'partial', 'stipend', 'unknown'] as const;
export const SOURCE_TYPES = ['university', 'funder', 'government'] as const;

/** Every catalog column a reviewer or admin sets. */
export interface ScholarshipFields {
  title: string;
  funder: string;
  country: string;
  amountCurrency: string;
  amountValue: number | null;
  amountType: string;
  deadline: string | null;
  degreeLevels: string[];
  fieldsOfStudy: string[];
  eligibleNationalities: string[];
  minGpa: number | null;
  requirements: string;
  eligibility: string[];
  description: string;
  sourceUrl: string | null;
  sourceType: string;
  requiredDocs: string[];
  benefits: string[];
}

/** The starting point for a record with no stored row behind it. */
export const BLANK_FIELDS: ScholarshipFields = {
  title: '',
  funder: '',
  country: '',
  amountCurrency: '',
  amountValue: null,
  amountType: '',
  deadline: null,
  degreeLevels: [],
  fieldsOfStudy: [],
  eligibleNationalities: [],
  minGpa: null,
  requirements: '',
  eligibility: [],
  description: '',
  sourceUrl: null,
  sourceType: '',
  requiredDocs: [],
  benefits: [],
};

/** The edits a form posts. Every field optional. */
export interface SubmissionEdits {
  title?: string;
  funder?: string;
  country?: string;
  amountCurrency?: string;
  amountValue?: number | null;
  amountType?: string;
  deadline?: string | null;
  degreeLevels?: string[];
  fieldsOfStudy?: string[];
  eligibleNationalities?: string[];
  minGpa?: number | null;
  requirements?: string;
  eligibility?: string[];
  description?: string;
  sourceUrl?: string | null;
  sourceType?: string;
  requiredDocs?: string[];
  benefits?: string[];
}

function nullIfEmpty(value: string): string | null {
  return value.trim() === '' ? null : value.trim();
}

/**
 * Coerce a JSON request body into edits, keeping only the fields it actually
 * carries. An absent key means "leave as filed"; a present key with an empty
 * value means "clear it", which is a distinction the reviewer relies on.
 */
export function parseEdits(raw: unknown): SubmissionEdits {
  if (!raw || typeof raw !== 'object') return {};
  const body = raw as Record<string, unknown>;
  const edits: SubmissionEdits = {};

  const str = (key: keyof SubmissionEdits, value: unknown) => {
    if (value !== undefined) (edits as Record<string, unknown>)[key] = asString(value);
  };
  const arr = (key: keyof SubmissionEdits, value: unknown) => {
    if (value !== undefined) (edits as Record<string, unknown>)[key] = asStringArray(value);
  };
  const num = (key: keyof SubmissionEdits, value: unknown) => {
    if (value !== undefined) (edits as Record<string, unknown>)[key] = asNumberOrNull(value);
  };

  str('title', body.title);
  str('funder', body.funder);
  str('country', body.country);
  str('amountCurrency', body.amountCurrency);
  str('amountType', body.amountType);
  str('requirements', body.requirements);
  str('description', body.description);
  str('sourceType', body.sourceType);
  if (body.deadline !== undefined) edits.deadline = nullIfEmpty(asString(body.deadline));
  if (body.sourceUrl !== undefined) edits.sourceUrl = nullIfEmpty(asString(body.sourceUrl));
  num('amountValue', body.amountValue);
  num('minGpa', body.minGpa);
  arr('degreeLevels', body.degreeLevels);
  arr('fieldsOfStudy', body.fieldsOfStudy);
  arr('eligibleNationalities', body.eligibleNationalities);
  arr('eligibility', body.eligibility);
  arr('requiredDocs', body.requiredDocs);
  arr('benefits', body.benefits);

  return edits;
}

/** Edits laid over a base field set, key by key. */
export function applyEdits(base: ScholarshipFields, edits: SubmissionEdits): ScholarshipFields {
  const pick = <T>(edit: T | undefined, stored: T): T => (edit === undefined ? stored : edit);
  return {
    title: asString(pick(edits.title, base.title)),
    funder: asString(pick(edits.funder, base.funder)),
    country: asString(pick(edits.country, base.country)),
    amountCurrency: asString(pick(edits.amountCurrency, base.amountCurrency)),
    amountValue: pick(edits.amountValue, base.amountValue),
    amountType: asString(pick(edits.amountType, base.amountType)),
    deadline: pick(edits.deadline, base.deadline),
    degreeLevels: pick(edits.degreeLevels, base.degreeLevels),
    fieldsOfStudy: pick(edits.fieldsOfStudy, base.fieldsOfStudy),
    eligibleNationalities: pick(edits.eligibleNationalities, base.eligibleNationalities),
    minGpa: pick(edits.minGpa, base.minGpa),
    requirements: asString(pick(edits.requirements, base.requirements)),
    eligibility: pick(edits.eligibility, base.eligibility),
    description: asString(pick(edits.description, base.description)),
    sourceUrl: pick(edits.sourceUrl, base.sourceUrl),
    sourceType: asString(pick(edits.sourceType, base.sourceType)).toLowerCase(),
    requiredDocs: pick(edits.requiredDocs, base.requiredDocs),
    benefits: pick(edits.benefits, base.benefits),
  };
}

/** A complete field set built from a request body alone. */
export function fieldsFrom(raw: unknown): ScholarshipFields {
  return applyEdits(BLANK_FIELDS, parseEdits(raw));
}

export type FieldCheck =
  | { ok: true; scholarship: ExtractedScholarship }
  | { ok: false; error: string };

/**
 * Check a field set against the catalog's invariants and return the record to
 * store: a title, an http(s) source URL that is not a listing site, an exact
 * deadline that has not passed, and a known source type.
 */
export function checkFields(fields: ScholarshipFields): FieldCheck {
  if (!fields.title.trim()) return { ok: false, error: 'A title is required.' };

  if (!fields.sourceUrl || !isHttpUrl(fields.sourceUrl)) {
    return { ok: false, error: 'A source URL on the funder\'s own site is required.' };
  }
  // The one absolute rule, re-applied to human input. `checkStructuralSource`
  // rather than the full `checkOfficialSource`: the reviewer has seen the page, so
  // the funder-token heuristic has nothing to add. What it cannot override is the
  // aggregator list.
  const verdict = checkStructuralSource(fields.sourceUrl);
  if (!verdict.ok) {
    return { ok: false, error: `That source URL is not usable: ${verdict.reason}.` };
  }

  if (!fields.deadline || !isOpenDeadline(fields.deadline)) {
    return { ok: false, error: 'An exact deadline (YYYY-MM-DD) that has not passed is required.' };
  }

  if (!SOURCE_TYPES.includes(fields.sourceType as SourceType)) {
    return { ok: false, error: 'Source type must be university, funder, or government.' };
  }

  return {
    ok: true,
    scholarship: {
      sourceType: fields.sourceType as SourceType,
      title: fields.title.trim(),
      funder: fields.funder || 'Unknown',
      country: fields.country || 'International',
      amountCurrency: fields.amountCurrency || 'USD',
      amountValue: fields.amountValue,
      amountType: (AMOUNT_TYPES as readonly string[]).includes(fields.amountType)
        ? (fields.amountType as ExtractedScholarship['amountType'])
        : 'unknown',
      deadline: fields.deadline,
      degreeLevels: fields.degreeLevels,
      fieldsOfStudy: fields.fieldsOfStudy,
      eligibleNationalities: fields.eligibleNationalities,
      minGpa: fields.minGpa,
      requirements: fields.requirements,
      eligibility: fields.eligibility,
      description: fields.description,
      sourceUrl: fields.sourceUrl,
      requiredDocs: fields.requiredDocs,
      benefits: fields.benefits,
    },
  };
}
