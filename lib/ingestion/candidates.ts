/**
 * The candidate queue: scholarships we know exist but have not yet traced to a
 * funder's own page.
 *
 * It does two jobs at once. As a dedupe index it guarantees a listing article is
 * fetched once ever, however many mornings it reappears on the category page. As
 * a retry queue it keeps the ones that failed — no outbound official link today,
 * a bot wall, a deadline not yet published — so a later run can try again
 * without paying to rediscover them.
 *
 * That second job is what makes a partial run harmless. The pipeline has a
 * wall-clock deadline and a hard credit cap, so runs routinely stop mid-queue;
 * because the queue is durable, stopping early defers work rather than losing it.
 */

import { queryDb } from '@/lib/db';
import { canonicalUrl, integerSetting } from './util';

export type CandidateStatus = 'pending' | 'stored' | 'rejected';

export interface CandidateInput {
  /** Where this candidate was discovered: a listing page URL, or `search:<query>`. */
  listingUrl: string;
  articleUrl: string;
  title: string;
  /** Set when discovery already landed on an official page and resolution can be skipped. */
  officialUrl?: string;
}

export interface CandidateRow {
  candidate_key: string;
  listing_url: string;
  article_url: string;
  title: string;
  funder: string;
  official_url: string | null;
  attempts: number;
}

function maxAttempts(): number {
  return integerSetting('INGESTION_MAX_CANDIDATE_ATTEMPTS', 3, 1, 10);
}

/**
 * Add newly discovered candidates, ignoring any we have seen before. Returns how
 * many were genuinely new — the number that matters when judging whether a
 * listing site is still worth crawling.
 */
export async function enqueueCandidates(candidates: CandidateInput[]): Promise<number> {
  let added = 0;
  for (const candidate of candidates) {
    const result = await queryDb<{ candidate_key: string }>(
      `INSERT INTO ingestion_candidates (candidate_key, listing_url, article_url, title, official_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (candidate_key) DO NOTHING
       RETURNING candidate_key`,
      [
        canonicalUrl(candidate.articleUrl),
        candidate.listingUrl,
        candidate.articleUrl,
        candidate.title.slice(0, 500),
        candidate.officialUrl ?? null,
      ]
    );
    if (result.rows.length > 0) added += 1;
  }
  return added;
}

/**
 * Take the next candidates due for an attempt, oldest and least-tried first.
 *
 * Backoff is 1 day after the first failure, 3 after the second, 7 after the
 * third. A candidate that keeps failing therefore stops competing for budget
 * with fresh discoveries long before it hits the attempt ceiling.
 */
export async function claimCandidates(limit: number): Promise<CandidateRow[]> {
  if (limit <= 0) return [];
  const result = await queryDb<CandidateRow>(
    `SELECT candidate_key, listing_url, article_url, title, funder, official_url, attempts
     FROM ingestion_candidates
     WHERE status = 'pending'
       AND attempts < $2
       AND (last_attempt_at IS NULL OR last_attempt_at < NOW() - (
         CASE attempts
           WHEN 0 THEN INTERVAL '0 days'
           WHEN 1 THEN INTERVAL '1 day'
           WHEN 2 THEN INTERVAL '3 days'
           ELSE INTERVAL '7 days'
         END))
     ORDER BY attempts ASC, last_attempt_at ASC NULLS FIRST, created_at ASC
     LIMIT $1`,
    [limit, maxAttempts()]
  );
  return result.rows;
}

/** Record a successful trace to the catalog. The candidate is never retried again. */
export async function markCandidateStored(
  candidateKey: string,
  officialUrl: string,
  title: string,
  funder: string
): Promise<void> {
  await queryDb(
    `UPDATE ingestion_candidates SET
       status = 'stored', official_url = $2, title = $3, funder = $4,
       attempts = attempts + 1, last_attempt_at = NOW(), last_error = NULL, updated_at = NOW()
     WHERE candidate_key = $1`,
    [candidateKey, officialUrl, title.slice(0, 500), funder.slice(0, 300)]
  );
}

/**
 * Record a failed attempt. Once a candidate has used up its attempts it is
 * rejected permanently — some listing articles simply never link anywhere
 * official, and retrying them forever would slowly crowd out real discoveries.
 */
export async function markCandidateFailure(
  candidateKey: string,
  reason: string,
  context: { title?: string; funder?: string; officialUrl?: string } = {}
): Promise<CandidateStatus> {
  const result = await queryDb<{ status: CandidateStatus }>(
    `UPDATE ingestion_candidates SET
       attempts = attempts + 1,
       last_attempt_at = NOW(),
       last_error = $2,
       title = COALESCE(NULLIF($3, ''), title),
       funder = COALESCE(NULLIF($4, ''), funder),
       official_url = COALESCE(NULLIF($5, ''), official_url),
       status = CASE WHEN attempts + 1 >= $6 THEN 'rejected' ELSE status END,
       updated_at = NOW()
     WHERE candidate_key = $1
     RETURNING status`,
    [
      candidateKey,
      reason.slice(0, 500),
      context.title?.slice(0, 500) ?? '',
      context.funder?.slice(0, 300) ?? '',
      context.officialUrl ?? '',
      maxAttempts(),
    ]
  );
  return result.rows[0]?.status ?? 'pending';
}

export interface QueueSnapshot {
  pending: number;
  due: number;
  stored: number;
  rejected: number;
}

/** Queue counts, for the run summary and the dry-run report. */
export async function queueSnapshot(): Promise<QueueSnapshot> {
  const result = await queryDb<{ status: CandidateStatus; total: string; due: string }>(
    `SELECT status,
            COUNT(*)::TEXT AS total,
            COUNT(*) FILTER (
              WHERE status = 'pending' AND attempts < $1 AND (
                last_attempt_at IS NULL OR last_attempt_at < NOW() - (
                  CASE attempts
                    WHEN 0 THEN INTERVAL '0 days'
                    WHEN 1 THEN INTERVAL '1 day'
                    WHEN 2 THEN INTERVAL '3 days'
                    ELSE INTERVAL '7 days'
                  END))
            )::TEXT AS due
     FROM ingestion_candidates
     GROUP BY status`,
    [maxAttempts()]
  );

  const snapshot: QueueSnapshot = { pending: 0, due: 0, stored: 0, rejected: 0 };
  for (const row of result.rows) {
    const total = Number(row.total);
    if (row.status === 'pending') {
      snapshot.pending = total;
      snapshot.due = Number(row.due);
    } else if (row.status === 'stored') snapshot.stored = total;
    else if (row.status === 'rejected') snapshot.rejected = total;
  }
  return snapshot;
}
