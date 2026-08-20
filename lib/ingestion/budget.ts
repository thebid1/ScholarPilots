/**
 * Firecrawl credit accounting.
 *
 * The allowance is a fixed lifetime pool (10,000 credits by default), not a
 * monthly one, so spend has to be durable: an in-process counter resets on every
 * Render redeploy and the cap silently stops existing. `ingestion_runs` in
 * Postgres is the ledger.
 *
 * Runs *reserve* their per-run cap up front and reconcile to actual spend when
 * they finish. A run killed mid-flight — deploy, timeout, OOM — therefore still
 * counts its reservation against the pool instead of handing budget back that it
 * may well have spent. The cost of that is slight over-counting on crashes,
 * which is the right direction to be wrong in when the pool never refills.
 */

import { queryDb } from '@/lib/db';
import { integerSetting } from './util';

/** Firecrawl pricing: scrape and map are 1 credit per page, search is 2 per 10 results. */
export const CREDITS_PER_SCRAPE = 1;

export function lifetimeBudget(): number {
  return integerSetting('FIRECRAWL_LIFETIME_CREDIT_BUDGET', 10_000, 0, 10_000_000);
}

export function runBudget(): number {
  return integerSetting('FIRECRAWL_RUN_CREDIT_BUDGET', 28, 1, 5_000);
}

/** How long a run may take before it stops itself, comfortably inside the cron's own timeout. */
export function runDeadlineMs(): number {
  return integerSetting('INGESTION_DEADLINE_MS', 720_000, 30_000, 3_000_000);
}

/**
 * Credits consumed by every run so far. A run still marked `running` is counted
 * at whichever is larger, its reservation or its recorded spend — see the note
 * above about crashed runs.
 */
export async function lifetimeSpend(): Promise<number> {
  const result = await queryDb<{ total: string | null }>(
    `SELECT COALESCE(SUM(
       CASE WHEN status = 'running' THEN GREATEST(credits_spent, credits_reserved)
            ELSE credits_spent END
     ), 0)::TEXT AS total
     FROM ingestion_runs`
  );
  return Number(result.rows[0]?.total ?? 0);
}

/**
 * Whether a run is already in flight, so pressing "Run ingestion now" while the
 * cron is working cannot reserve the same credits twice. A 900-second request is
 * long enough that a reload looks idle, which is exactly when a second run gets
 * started by hand.
 *
 * Bounded by the run deadline plus a margin: a row left `running` by a killed
 * process must not block the pipeline forever. It still counts against the
 * lifetime pool — see `lifetimeSpend`.
 */
export async function runInFlight(): Promise<boolean> {
  const graceMs = runDeadlineMs() + 120_000;
  const result = await queryDb<{ id: string }>(
    `SELECT id FROM ingestion_runs
     WHERE status = 'running'
       AND started_at > NOW() - make_interval(secs => $1)
     LIMIT 1`,
    [Math.ceil(graceMs / 1000)]
  );
  return result.rows.length > 0;
}

/**
 * What a run did. A run no longer writes to `scholarships` — it files submissions
 * for review — so the tallies count proposals rather than catalog changes.
 * `inserted`, `updated` and `deactivated` are consequently no longer counted here
 * at all; their columns survive for the historical rows that do have them.
 *
 * `duplicates` is run-scoped diagnostics and is deliberately not persisted: it
 * says how much of the queue was already known, which is useful while watching a
 * run and meaningless a week later.
 */
export interface RunTotals {
  listings: number;
  candidates: number;
  resolved: number;
  verified: number;
  /** Submissions filed for review, flagged or not. */
  submitted: number;
  /** Of those, how many need a human to supply something before approval. */
  flagged: number;
  /** Refresh submissions proposing changes to an existing row. */
  refreshed: number;
  /** Retire submissions proposing a row be hidden. */
  retired: number;
  duplicates: number;
}

const EMPTY_TOTALS: RunTotals = {
  listings: 0, candidates: 0, resolved: 0, verified: 0,
  submitted: 0, flagged: 0, refreshed: 0, retired: 0, duplicates: 0,
};

/**
 * A single run's budget and tally. Every Firecrawl call goes through `spend()`,
 * which is also the only place that can refuse one — so the cap cannot be
 * bypassed by adding a new call site that forgets to check.
 */
export class RunLedger {
  readonly runId: string | null;
  readonly reserved: number;
  private spent = 0;
  private readonly deadline: number;
  private readonly dryRun: boolean;
  readonly totals: RunTotals = { ...EMPTY_TOTALS };

  private constructor(runId: string | null, reserved: number, deadlineMs: number, dryRun: boolean) {
    this.runId = runId;
    this.reserved = reserved;
    this.deadline = Date.now() + deadlineMs;
    this.dryRun = dryRun;
  }

  /**
   * Open a run, refusing to start if the lifetime pool is exhausted. The
   * reservation is trimmed to whatever remains, so the last run spends the
   * remainder rather than overshooting.
   */
  static async open(options: { dryRun?: boolean; maxCredits?: number } = {}): Promise<RunLedger> {
    const lifetime = lifetimeBudget();
    const spentSoFar = await lifetimeSpend();
    const remaining = lifetime - spentSoFar;
    if (remaining <= 0) {
      throw new Error(
        `Firecrawl lifetime budget exhausted: ${spentSoFar}/${lifetime} credits used. `
        + 'Raise FIRECRAWL_LIFETIME_CREDIT_BUDGET to continue.'
      );
    }

    const requested = options.maxCredits ?? runBudget();
    const reserved = Math.max(1, Math.min(requested, remaining));
    const deadlineMs = runDeadlineMs();

    if (options.dryRun) return new RunLedger(null, reserved, deadlineMs, true);

    const result = await queryDb<{ id: string }>(
      `INSERT INTO ingestion_runs (credits_reserved) VALUES ($1) RETURNING id`,
      [reserved]
    );
    return new RunLedger(result.rows[0].id, reserved, deadlineMs, false);
  }

  get creditsSpent(): number {
    return this.spent;
  }

  get creditsRemaining(): number {
    return Math.max(0, this.reserved - this.spent);
  }

  /** Wall-clock guard. The cron's own timeout is hard; this one stops us cleanly first. */
  get outOfTime(): boolean {
    return Date.now() >= this.deadline;
  }

  get msRemaining(): number {
    return Math.max(0, this.deadline - Date.now());
  }

  /** True when the run should stop doing paid work for either reason. */
  exhausted(cost = CREDITS_PER_SCRAPE): boolean {
    return this.outOfTime || this.creditsRemaining < cost;
  }

  /**
   * Claim credits for one billable call. Returns false when the run cannot
   * afford it, in which case the caller must skip the work — not proceed.
   */
  spend(cost = CREDITS_PER_SCRAPE): boolean {
    if (this.exhausted(cost)) return false;
    this.spent += cost;
    return true;
  }

  count<K extends keyof RunTotals>(key: K, by = 1): void {
    this.totals[key] += by;
  }

  /** Reconcile the reservation to real spend and record the outcome. */
  async close(status: 'completed' | 'deadline' | 'failed', error?: string): Promise<void> {
    if (this.dryRun || !this.runId) return;
    await queryDb(
      `UPDATE ingestion_runs SET
         finished_at = NOW(), credits_spent = $2, status = $3, error = $4,
         listings = $5, candidates = $6, resolved = $7, verified = $8,
         submitted = $9, flagged = $10, refreshed = $11, retired = $12
       WHERE id = $1`,
      [
        this.runId, this.spent, status, error?.slice(0, 500) ?? null,
        this.totals.listings, this.totals.candidates, this.totals.resolved,
        this.totals.verified, this.totals.submitted, this.totals.flagged,
        this.totals.refreshed, this.totals.retired,
      ]
    );
  }
}
