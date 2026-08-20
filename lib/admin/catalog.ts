/**
 * Reading and editing the catalog directly, for the reviewer desk.
 *
 * The ingestion pipeline reaches `scholarships` only through
 * [approveSubmission](lib/ingestion/submissions.ts). This module is the other
 * door: an admin adding an award by hand, correcting one already published, or
 * removing it. Both doors share `checkFields`, so neither can store a listing
 * site as a source or a deadline that has passed.
 */

import { queryDb } from '@/lib/db';
import { applyEdits, checkFields, type ScholarshipFields } from '@/lib/ingestion/fields';
import {
  CatalogIndex, clearFilterCache, saveScholarship, type SaveResult,
} from '@/lib/ingestion/store';

/**
 * One catalog row as the admin list shows it. snake_case because it goes to the
 * browser as-is.
 *
 * `deadline` is formatted in SQL and the numerics cast: `pg` hands back a DATE as
 * local midnight, so `toISOString()` would shift the day backwards east of UTC,
 * and NUMERIC arrives as a string.
 */
export interface CatalogRow {
  external_id: string;
  identity_key: string | null;
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
  is_active: boolean;
  verified_at: string | null;
  updated_at: string | null;
  /** True for rows this pipeline created, false for the hand-seeded catalog. */
  automated: boolean;
  /** True once the deadline is behind us — the row students can no longer see. */
  expired: boolean;
}

const ROW_COLUMNS = `external_id, identity_key, source_type, title, funder, country,
  amount_currency, amount_value::float8 AS amount_value, amount_type,
  TO_CHAR(deadline, 'YYYY-MM-DD') AS deadline,
  degree_levels, fields_of_study, eligible_nationalities,
  min_gpa::float8 AS min_gpa, requirements, eligibility, description,
  source_url, required_docs, benefits, COALESCE(is_active, false) AS is_active,
  verified_at, updated_at,
  (identity_key IS NOT NULL) AS automated,
  (deadline IS NOT NULL AND deadline < CURRENT_DATE) AS expired`;

export interface CatalogCounts {
  total: number;
  active: number;
  expired: number;
}

export async function catalogCounts(): Promise<CatalogCounts> {
  const result = await queryDb<{ total: string; active: string; expired: string }>(
    `SELECT COUNT(*)::TEXT AS total,
            COUNT(*) FILTER (WHERE is_active)::TEXT AS active,
            COUNT(*) FILTER (WHERE deadline < CURRENT_DATE)::TEXT AS expired
     FROM scholarships`
  );
  const row = result.rows[0];
  return {
    total: Number(row?.total ?? 0),
    active: Number(row?.active ?? 0),
    expired: Number(row?.expired ?? 0),
  };
}

/**
 * The catalog, soonest deadline first with undated rows last.
 *
 * Everything is listed, expired and hidden rows included — the point of the
 * screen is to see and fix what students cannot. `search` matches title, funder
 * and country.
 */
export async function listCatalog(
  options: { search?: string; limit?: number } = {}
): Promise<CatalogRow[]> {
  const search = (options.search ?? '').trim();
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const filter = search
    ? `WHERE title ILIKE $2 OR funder ILIKE $2 OR country ILIKE $2`
    : '';
  const params: unknown[] = search ? [limit, `%${search}%`] : [limit];

  const result = await queryDb<CatalogRow>(
    `SELECT ${ROW_COLUMNS} FROM scholarships
     ${filter}
     ORDER BY deadline ASC NULLS LAST, updated_at DESC
     LIMIT $1`,
    params
  );
  return result.rows;
}

/** One row as an editable field set, or null when it is not there. */
export async function catalogFields(externalId: string): Promise<ScholarshipFields | null> {
  const result = await queryDb<CatalogRow>(
    `SELECT ${ROW_COLUMNS} FROM scholarships WHERE external_id = $1`,
    [externalId]
  );
  const row = result.rows[0];
  if (!row) return null;
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

export type CatalogWrite =
  | { ok: true; row: CatalogRow; action: SaveResult['action'] }
  | { ok: false; error: string };

/**
 * Validate a field set and write it.
 *
 * `externalId` pins which row is written, which an edit needs: dedupe would
 * otherwise re-derive the target from the fields, and correcting a title would
 * fork the award into a second row.
 */
export async function saveCatalogFields(
  fields: ScholarshipFields,
  options: { externalId?: string } = {}
): Promise<CatalogWrite> {
  const checked = checkFields(fields);
  if (!checked.ok) return checked;

  const index = await CatalogIndex.load();
  const saved = await saveScholarship(checked.scholarship, index, options);
  await clearFilterCache();

  const result = await queryDb<CatalogRow>(
    `SELECT ${ROW_COLUMNS} FROM scholarships WHERE external_id = $1`,
    [saved.externalId]
  );
  const row = result.rows[0];
  if (!row) return { ok: false, error: 'The row was written but could not be read back.' };
  return { ok: true, row, action: saved.action };
}

/** Apply edits to an existing row. Absent keys keep their stored value. */
export async function updateCatalogRow(
  externalId: string,
  edits: Parameters<typeof applyEdits>[1]
): Promise<CatalogWrite> {
  const stored = await catalogFields(externalId);
  if (!stored) return { ok: false, error: 'That scholarship is not in the catalog.' };
  return saveCatalogFields(applyEdits(stored, edits), { externalId });
}

/**
 * Remove a row for good.
 *
 * A hard delete, unlike the retire path's `deactivateScholarship`: this is the
 * admin saying the award does not belong in the catalog at all. Applications
 * students have already tracked keep their own snapshot in Firestore, so nothing
 * of theirs breaks. Discovery may find the award again on a later run — it
 * arrives as a submission to reject, not as a row.
 */
export async function deleteCatalogRow(externalId: string): Promise<boolean> {
  const result = await queryDb<{ external_id: string }>(
    `DELETE FROM scholarships WHERE external_id = $1 RETURNING external_id`,
    [externalId]
  );
  if (result.rows.length === 0) return false;
  await clearFilterCache();
  return true;
}
