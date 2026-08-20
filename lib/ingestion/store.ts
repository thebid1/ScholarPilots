/**
 * Writing verified scholarships to the catalog, and deciding when two records are
 * the same award.
 *
 * Deduplication is the hard part. The same scholarship legitimately arrives from
 * several directions — two listing sites, a search hit, and next year's cycle of
 * an annual award — and each may word the title differently or link to a
 * different page on the funder's site. Getting this wrong shows the student the
 * same opportunity three times.
 */

import { createHash } from 'node:crypto';
import { queryDb } from '@/lib/db';
import { canonicalUrl, identityText, isHttpUrl, ownerDomain, titleSimilarity } from './util';
import type { ExtractedScholarship } from './verify';

/**
 * Just enough of a record to decide whether it is an award we already have.
 * Widened from the full extraction so the dedupe check also works on a partial
 * one — an award with no confirmed source URL still needs to not be proposed
 * twice.
 */
export type IdentifyingFields = Pick<ExtractedScholarship, 'title' | 'funder' | 'sourceUrl'>;

/**
 * A stable identity for an award: its title, stripped of years and cycle words,
 * plus whoever funds it. Falls back to the official domain when the funder name
 * is unknown, so two records from the same university still collide.
 */
export function identityKey(scholarship: IdentifyingFields): string {
  const funder = identityText(scholarship.funder);
  const owner = funder && funder !== 'unknown' ? funder : ownerDomain(scholarship.sourceUrl);
  return createHash('sha256')
    .update(`${identityText(scholarship.title)}\n${owner}`)
    .digest('hex');
}

interface CatalogRow {
  external_id: string;
  title: string;
  funder: string | null;
  source_url: string | null;
  identity_key: string | null;
}

/**
 * The dedupe index, loaded once per run.
 *
 * The obvious implementation — query the catalog for each scholarship as it is
 * saved — costs a full table scan per record, since the comparisons are fuzzy and
 * cannot be pushed into a WHERE clause. Loading the identifying columns once and
 * matching in memory is the same logic at a fraction of the cost, and the catalog
 * is small enough that this stays true for a long time.
 */
export class CatalogIndex {
  private rows: CatalogRow[] = [];

  static async load(): Promise<CatalogIndex> {
    const index = new CatalogIndex();
    const result = await queryDb<CatalogRow>(
      `SELECT external_id, title, funder, source_url, identity_key FROM scholarships`
    );
    index.rows = result.rows;
    return index;
  }

  /**
   * Find the existing row this scholarship should update, if any.
   *
   * An exact identity match settles it. Otherwise three fuzzy routes, each
   * pairing a strong signal with a high title-similarity bar so that "Chevening
   * Scholarship" and "Chevening Fellowship" — different awards, same funder — do
   * not merge:
   *   - the same canonical URL with a similar title (the page moved or gained a
   *     tracking parameter),
   *   - the same funder with a near-identical title (a second official page for
   *     one award),
   *   - the same owning domain with a near-identical title (a university that
   *     lists an award under two URLs).
   */
  match(scholarship: IdentifyingFields, key: string): string | null {
    const incomingFunder = identityText(scholarship.funder);
    const funderComparable = incomingFunder !== '' && incomingFunder !== 'unknown';

    const found = this.rows.find((row) => {
      if (row.identity_key === key) return true;
      if (!row.source_url || !isHttpUrl(row.source_url)) return false;

      const titleScore = titleSimilarity(row.title, scholarship.title);
      const rowFunder = identityText(row.funder ?? '');

      if (canonicalUrl(row.source_url) === canonicalUrl(scholarship.sourceUrl) && titleScore >= 0.8) {
        return true;
      }
      if (titleScore < 0.9) return false;
      if (funderComparable && rowFunder !== '' && rowFunder !== 'unknown'
        && titleSimilarity(row.funder ?? '', scholarship.funder) >= 0.75) {
        return true;
      }
      return ownerDomain(row.source_url) === ownerDomain(scholarship.sourceUrl);
    });

    return found?.external_id ?? null;
  }

  /** Keep the in-memory index true as the run writes rows. */
  remember(scholarship: IdentifyingFields, externalId: string, key: string): void {
    const existing = this.rows.find((row) => row.external_id === externalId);
    const next: CatalogRow = {
      external_id: externalId,
      title: scholarship.title,
      funder: scholarship.funder,
      source_url: scholarship.sourceUrl,
      identity_key: key,
    };
    if (existing) Object.assign(existing, next);
    else this.rows.push(next);
  }
}

const UPSERT_COLUMNS = `
  identity_key = EXCLUDED.identity_key, source_type = EXCLUDED.source_type,
  title = EXCLUDED.title, funder = EXCLUDED.funder, country = EXCLUDED.country,
  amount_currency = EXCLUDED.amount_currency, amount_value = EXCLUDED.amount_value,
  amount_type = EXCLUDED.amount_type, deadline = EXCLUDED.deadline,
  degree_levels = EXCLUDED.degree_levels, fields_of_study = EXCLUDED.fields_of_study,
  eligible_nationalities = EXCLUDED.eligible_nationalities, min_gpa = EXCLUDED.min_gpa,
  requirements = EXCLUDED.requirements, eligibility = EXCLUDED.eligibility,
  description = EXCLUDED.description, source_url = EXCLUDED.source_url,
  required_docs = EXCLUDED.required_docs, benefits = EXCLUDED.benefits, is_active = true,
  verified_at = NOW(), last_crawled_at = NOW(), updated_at = NOW()`;

function upsertParams(scholarship: ExtractedScholarship, externalId: string, key: string): unknown[] {
  return [
    externalId, key, scholarship.sourceType, scholarship.title, scholarship.funder,
    scholarship.country, scholarship.amountCurrency, scholarship.amountValue,
    scholarship.amountType, scholarship.deadline, scholarship.degreeLevels,
    scholarship.fieldsOfStudy, scholarship.eligibleNationalities, scholarship.minGpa,
    scholarship.requirements, scholarship.eligibility, scholarship.description,
    scholarship.sourceUrl, scholarship.requiredDocs, scholarship.benefits,
  ];
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { code?: string }).code === '23505';
}

export interface SaveResult {
  action: 'inserted' | 'updated';
  externalId: string;
}

/**
 * Insert or update one verified scholarship.
 *
 * The conflict handling needs both unique keys. `external_id` is the primary
 * route, but `identity_key` has its own unique index, and a hand-seeded row that
 * later acquires an identity key will have a different `external_id` — so the
 * insert can violate the identity index while the ON CONFLICT clause is watching
 * the other one. That case is caught and retried as an update keyed on identity.
 *
 * `options.externalId` pins which row is written. An approved refresh needs that:
 * dedupe would otherwise re-derive the target from the record's own fields, and a
 * reviewer who corrected the title would silently fork the award into a second row
 * instead of updating the one they were looking at.
 */
export async function saveScholarship(
  scholarship: ExtractedScholarship,
  index: CatalogIndex,
  options: { externalId?: string } = {}
): Promise<SaveResult> {
  const key = identityKey(scholarship);
  const externalId = options.externalId ?? index.match(scholarship, key) ?? key;

  try {
    const result = await queryDb<{ is_insert: boolean }>(
      `INSERT INTO scholarships (
         external_id, identity_key, source_type, title, funder, country,
         amount_currency, amount_value, amount_type, deadline, degree_levels,
         fields_of_study, eligible_nationalities, min_gpa, requirements,
         eligibility, description, source_url, required_docs, benefits,
         is_active, verified_at, last_crawled_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true,NOW(),NOW())
       ON CONFLICT (external_id) DO UPDATE SET ${UPSERT_COLUMNS}
       RETURNING (xmax = 0) AS is_insert`,
      upsertParams(scholarship, externalId, key)
    );
    index.remember(scholarship, externalId, key);
    return { action: result.rows[0]?.is_insert ? 'inserted' : 'updated', externalId };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    await queryDb(
      `UPDATE scholarships SET
         source_type = $2, title = $3, funder = $4, country = $5,
         amount_currency = $6, amount_value = $7, amount_type = $8, deadline = $9,
         degree_levels = $10, fields_of_study = $11, eligible_nationalities = $12,
         min_gpa = $13, requirements = $14, eligibility = $15, description = $16,
         source_url = $17, required_docs = $18, benefits = $19, is_active = true,
         verified_at = NOW(), last_crawled_at = NOW(), updated_at = NOW()
       WHERE identity_key = $1`,
      [key, ...upsertParams(scholarship, externalId, key).slice(2)]
    );
    index.remember(scholarship, externalId, key);
    return { action: 'updated', externalId };
  }
}

/**
 * A catalog row due a re-check, with every field a refresh submission needs to
 * show as a before-and-after.
 *
 * `deadline` is formatted in SQL rather than converted from a `Date` in JS: `pg`
 * hands back a DATE as local midnight, so `toISOString()` shifts the day
 * backwards anywhere east of UTC. Numerics are cast to float8 for the same class
 * of reason — they arrive as strings otherwise, and `'5000' !== 5000` would make
 * every refresh look like a change.
 */
export interface StaleRow {
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
  source_url: string;
  required_docs: string[];
  benefits: string[];
}

const STALE_COLUMNS = `external_id, identity_key, source_type, title, funder, country,
       amount_currency, amount_value::float8 AS amount_value, amount_type,
       TO_CHAR(deadline, 'YYYY-MM-DD') AS deadline,
       degree_levels, fields_of_study, eligible_nationalities,
       min_gpa::float8 AS min_gpa, requirements, eligibility, description,
       source_url, required_docs, benefits`;

/**
 * Catalog rows due a re-check, oldest crawl first.
 *
 * Restricted to `identity_key IS NOT NULL`, which is precisely the set this
 * pipeline created. The hand-seeded catalog is deliberately out of scope:
 * automation that can deactivate rows it never verified in the first place would
 * quietly erode curated data.
 *
 * Rows already awaiting review are skipped. Re-scraping one would spend a credit
 * to propose a change that is queued behind a change nobody has looked at yet,
 * and the pending-identity index would reject the second submission anyway.
 */
export async function staleScholarships(limit: number): Promise<StaleRow[]> {
  if (limit <= 0) return [];
  const result = await queryDb<StaleRow>(
    `SELECT ${STALE_COLUMNS}
     FROM scholarships s
     WHERE identity_key IS NOT NULL
       AND is_active = true
       AND deadline >= CURRENT_DATE
       AND source_url IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM scholarship_submissions sub
         WHERE sub.status = 'pending'
           AND (sub.identity_key = s.identity_key OR sub.external_id = s.external_id)
       )
     ORDER BY last_crawled_at ASC NULLS FIRST
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

/**
 * Hide a row that no longer verifies — the page moved, the cycle closed, the
 * deadline changed. Deactivated rather than deleted: only the weekly cleanup
 * cron removes rows, and a tracked application keeps its own snapshot regardless.
 */
export async function deactivateScholarship(externalId: string): Promise<void> {
  await queryDb(
    `UPDATE scholarships SET is_active = false, last_crawled_at = NOW(), updated_at = NOW()
     WHERE external_id = $1`,
    [externalId]
  );
}

/** Mark a row as re-checked without changing it, so refresh moves on to the next. */
export async function touchScholarship(externalId: string): Promise<void> {
  await queryDb(
    `UPDATE scholarships SET last_crawled_at = NOW() WHERE external_id = $1`,
    [externalId]
  );
}

/**
 * Drop the discipline-filter cache. Its keys cover profile fields, not catalog
 * contents, so a changed catalog would otherwise keep serving the old result set
 * for up to 12 hours.
 */
export async function clearFilterCache(): Promise<void> {
  await queryDb('DELETE FROM filter_cache');
}
