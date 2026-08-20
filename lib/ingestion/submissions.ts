/**
 * The review queue: filing what the pipeline extracted, and writing it to the
 * catalog once a reviewer has approved it.
 *
 * [lib/db.ts](lib/db.ts) exposes no transactions, so approval writes in the order
 * catalog → submission → candidate. Interrupted halfway, pressing Approve again
 * converges rather than duplicating: `saveScholarship` is an idempotent upsert.
 */

import { queryDb } from '@/lib/db';
import { markCandidateStored } from './candidates';
import {
  applyEdits, checkFields, SOURCE_TYPES, type ScholarshipFields, type SubmissionEdits,
} from './fields';
import {
  CatalogIndex, clearFilterCache, deactivateScholarship, saveScholarship,
} from './store';
import type { SourceType } from './verify';

export type SubmissionKind = 'new' | 'refresh' | 'retire';
export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

/** What the reviewer has to resolve before the submission can be approved. */
export type SubmissionFlag =
  | 'no-deadline'
  | 'no-source-url'
  | 'no-source-type'
  | 'source-unverified';

export interface SubmissionDraft {
  kind: SubmissionKind;
  identityKey: string;
  candidateKey?: string | null;
  articleUrl?: string | null;
  /** The catalog row this targets (refresh/retire). */
  externalId?: string | null;
  sourceType: SourceType | null;
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
  requiredDocs: string[];
  benefits: string[];
  flags: SubmissionFlag[];
  /** Why it is flagged, in a sentence the reviewer can act on. */
  notes?: string;
  /** The targeted row's current values, so a refresh reads as a diff. */
  previous?: unknown;
  /** The resolver's shortlist, its pick, and the gate's objection. */
  candidateLinks?: unknown;
  /** The model's unmodified reply. */
  rawExtraction?: unknown;
}

/**
 * A submission as stored. Deliberately snake_case: it goes to the browser as-is,
 * and inventing a second casing for the same fields would mean maintaining a
 * mapping in two directions for no gain.
 */
export interface SubmissionRow {
  id: string;
  kind: SubmissionKind;
  status: SubmissionStatus;
  identity_key: string;
  candidate_key: string | null;
  article_url: string | null;
  external_id: string | null;
  source_type: string | null;
  title: string;
  funder: string | null;
  country: string | null;
  amount_currency: string | null;
  amount_value: number | null;
  amount_type: string | null;
  deadline: string | null;
  degree_levels: string[];
  fields_of_study: string[];
  eligible_nationalities: string[];
  min_gpa: number | null;
  requirements: string | null;
  eligibility: string[];
  description: string | null;
  source_url: string | null;
  required_docs: string[];
  benefits: string[];
  flags: string[];
  notes: string | null;
  previous: Record<string, unknown> | null;
  candidate_links: Record<string, unknown> | null;
  raw_extraction: Record<string, unknown> | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

// `deadline` is formatted in SQL and numerics cast to float8 for the same reason
// as in store.ts: a DATE arrives as local midnight and a NUMERIC as a string.
const SELECT_COLUMNS = `id, kind, status, identity_key, candidate_key, article_url, external_id,
       source_type, title, funder, country, amount_currency,
       amount_value::float8 AS amount_value, amount_type,
       TO_CHAR(deadline, 'YYYY-MM-DD') AS deadline,
       degree_levels, fields_of_study, eligible_nationalities,
       min_gpa::float8 AS min_gpa, requirements, eligibility, description,
       source_url, required_docs, benefits, flags, notes,
       previous, candidate_links, raw_extraction,
       reviewed_at, reviewed_by, review_note, created_at, updated_at`;

function jsonOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/**
 * File a draft for review.
 *
 * Returns `'duplicate'` when the award already has a submission waiting, which
 * the partial unique index enforces rather than a read-then-write check — two
 * runs overlapping cannot slip a second copy past it.
 */
export async function fileSubmission(draft: SubmissionDraft): Promise<'filed' | 'duplicate'> {
  const result = await queryDb<{ id: string }>(
    `INSERT INTO scholarship_submissions (
       kind, identity_key, candidate_key, article_url, external_id, source_type,
       title, funder, country, amount_currency, amount_value, amount_type, deadline,
       degree_levels, fields_of_study, eligible_nationalities, min_gpa, requirements,
       eligibility, description, source_url, required_docs, benefits,
       flags, notes, previous, candidate_links, raw_extraction
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
       $24,$25,$26::jsonb,$27::jsonb,$28::jsonb
     )
     ON CONFLICT (identity_key) WHERE status = 'pending' DO NOTHING
     RETURNING id`,
    [
      draft.kind,
      draft.identityKey,
      draft.candidateKey ?? null,
      draft.articleUrl ?? null,
      draft.externalId ?? null,
      draft.sourceType,
      draft.title.slice(0, 500),
      draft.funder,
      draft.country,
      draft.amountCurrency,
      draft.amountValue,
      draft.amountType,
      draft.deadline,
      draft.degreeLevels,
      draft.fieldsOfStudy,
      draft.eligibleNationalities,
      draft.minGpa,
      draft.requirements,
      draft.eligibility,
      draft.description,
      draft.sourceUrl,
      draft.requiredDocs,
      draft.benefits,
      draft.flags,
      draft.notes ?? null,
      jsonOrNull(draft.previous),
      jsonOrNull(draft.candidateLinks),
      jsonOrNull(draft.rawExtraction),
    ]
  );
  return result.rows.length > 0 ? 'filed' : 'duplicate';
}

export async function pendingSubmissions(
  status: SubmissionStatus = 'pending',
  limit = 100
): Promise<SubmissionRow[]> {
  const result = await queryDb<SubmissionRow>(
    `SELECT ${SELECT_COLUMNS} FROM scholarship_submissions
     WHERE status = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [status, Math.max(1, Math.min(limit, 500))]
  );
  return result.rows;
}

export async function submissionById(id: string): Promise<SubmissionRow | null> {
  const result = await queryDb<SubmissionRow>(
    `SELECT ${SELECT_COLUMNS} FROM scholarship_submissions WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export interface SubmissionCounts {
  pending: number;
  approved: number;
  rejected: number;
}

export async function submissionCounts(): Promise<SubmissionCounts> {
  const result = await queryDb<{ status: SubmissionStatus; total: string }>(
    `SELECT status, COUNT(*)::TEXT AS total FROM scholarship_submissions GROUP BY status`
  );
  const counts: SubmissionCounts = { pending: 0, approved: 0, rejected: 0 };
  for (const row of result.rows) counts[row.status] = Number(row.total);
  return counts;
}

/** A submission's stored values as an editable field set. */
function rowFields(row: SubmissionRow): ScholarshipFields {
  return {
    title: row.title ?? '',
    funder: row.funder ?? '',
    country: row.country ?? '',
    amountCurrency: row.amount_currency ?? '',
    amountValue: row.amount_value,
    amountType: row.amount_type ?? '',
    deadline: row.deadline,
    degreeLevels: row.degree_levels ?? [],
    fieldsOfStudy: row.fields_of_study ?? [],
    eligibleNationalities: row.eligible_nationalities ?? [],
    minGpa: row.min_gpa,
    requirements: row.requirements ?? '',
    eligibility: row.eligibility ?? [],
    description: row.description ?? '',
    sourceUrl: row.source_url,
    sourceType: row.source_type ?? '',
    requiredDocs: row.required_docs ?? [],
    benefits: row.benefits ?? [],
  };
}

/** The submission's values with the reviewer's edits applied over them. */
function merged(row: SubmissionRow, edits: SubmissionEdits): ScholarshipFields {
  return applyEdits(rowFields(row), edits);
}

export type ApprovalResult =
  | { ok: true; externalId: string; action: 'inserted' | 'updated' | 'retired' }
  | { ok: false; error: string };

/**
 * Approve a submission and write it to the catalog.
 *
 * The reviewer's edits go through `checkFields`, so the invariants the automated
 * path enforced before it stopped writing apply to whatever was typed here. A
 * human fills the gaps; the gaps do not stop mattering.
 */
export async function approveSubmission(
  id: string,
  edits: SubmissionEdits,
  reviewer: string,
  note = ''
): Promise<ApprovalResult> {
  const row = await submissionById(id);
  if (!row) return { ok: false, error: 'Submission not found.' };
  if (row.status !== 'pending') return { ok: false, error: `Submission is already ${row.status}.` };

  // Retiring a row needs none of the field validation — it removes data rather
  // than publishing it, and the only thing that must be true is that the row exists.
  if (row.kind === 'retire') {
    if (!row.external_id) return { ok: false, error: 'Retirement has no catalog row to act on.' };
    await deactivateScholarship(row.external_id);
    await markReviewed(row.id, 'approved', reviewer, note, row.external_id, merged(row, edits));
    await clearFilterCache();
    return { ok: true, externalId: row.external_id, action: 'retired' };
  }

  const fields = merged(row, edits);
  const checked = checkFields(fields);
  if (!checked.ok) return checked;
  const scholarship = checked.scholarship;

  const index = await CatalogIndex.load();
  // A refresh must update the row it targets, not whatever the edited title now
  // matches — editing a title would otherwise fork the award into a second row.
  const saved = await saveScholarship(scholarship, index, {
    externalId: row.kind === 'refresh' ? row.external_id ?? undefined : undefined,
  });

  await markReviewed(row.id, 'approved', reviewer, note, saved.externalId, fields);
  if (row.candidate_key) {
    await markCandidateStored(row.candidate_key, scholarship.sourceUrl, scholarship.title, scholarship.funder);
  }
  await clearFilterCache();

  return { ok: true, externalId: saved.externalId, action: saved.action };
}

export async function rejectSubmission(
  id: string,
  reviewer: string,
  note = ''
): Promise<ApprovalResult> {
  const row = await submissionById(id);
  if (!row) return { ok: false, error: 'Submission not found.' };
  if (row.status !== 'pending') return { ok: false, error: `Submission is already ${row.status}.` };

  await queryDb(
    `UPDATE scholarship_submissions
     SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $2, review_note = $3, updated_at = NOW()
     WHERE id = $1`,
    [id, reviewer, note.slice(0, 1000)]
  );
  return { ok: true, externalId: row.external_id ?? '', action: 'updated' };
}

/**
 * Close out a submission, storing the values that were actually approved rather
 * than the ones that were filed. Without that the record would show the AI's
 * original extraction and give no account of what a reviewer corrected.
 */
async function markReviewed(
  id: string,
  status: SubmissionStatus,
  reviewer: string,
  note: string,
  externalId: string | null,
  fields: ReturnType<typeof merged>
): Promise<void> {
  await queryDb(
    `UPDATE scholarship_submissions SET
       status = $2, reviewed_at = NOW(), reviewed_by = $3, review_note = $4, external_id = $5,
       title = $6, funder = $7, country = $8, amount_currency = $9, amount_value = $10,
       amount_type = $11, deadline = $12, degree_levels = $13, fields_of_study = $14,
       eligible_nationalities = $15, min_gpa = $16, requirements = $17, eligibility = $18,
       description = $19, source_url = $20, required_docs = $21, benefits = $22,
       source_type = $23, updated_at = NOW()
     WHERE id = $1`,
    [
      id, status, reviewer, note.slice(0, 1000), externalId,
      fields.title.slice(0, 500), fields.funder, fields.country, fields.amountCurrency,
      fields.amountValue, fields.amountType || null, fields.deadline, fields.degreeLevels,
      fields.fieldsOfStudy, fields.eligibleNationalities, fields.minGpa, fields.requirements,
      fields.eligibility, fields.description, fields.sourceUrl, fields.requiredDocs,
      fields.benefits, SOURCE_TYPES.includes(fields.sourceType as SourceType) ? fields.sourceType : null,
    ]
  );
}
