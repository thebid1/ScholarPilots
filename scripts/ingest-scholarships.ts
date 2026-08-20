import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });

import { planIngestion, runIngestion } from '../lib/ingestion';

/**
 * Manual driver for the catalog ingestion pipeline.
 *
 * Exists because the Firecrawl allowance is a fixed lifetime pool: testing this
 * by repeatedly hitting the deployed cron endpoint would spend real budget on
 * every iteration. `--dry-run` reports exactly what a run would do without making
 * a single billable call, and `--max-credits` meters a cautious first run.
 *
 *   npm run ingest:scholarships -- --dry-run
 *   npm run ingest:scholarships -- --max-credits=6
 */

function flagValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const rawMax = flagValue('max-credits');
  const parsedMax = rawMax === undefined ? undefined : Number(rawMax);

  if (parsedMax !== undefined && (!Number.isInteger(parsedMax) || parsedMax < 1)) {
    throw new Error(`--max-credits must be a positive integer, got "${rawMax}"`);
  }

  if (dryRun) {
    const plan = await planIngestion({ maxCredits: parsedMax });
    console.log('\nIngestion plan (no requests made)\n');
    console.log(`  Lifetime credits : ${plan.credits.lifetimeSpent} spent / ${plan.credits.lifetimeBudget} budget`
      + ` (${plan.credits.lifetimeRemaining} left)`);
    console.log(`  This run would reserve : ${plan.credits.runBudget} credits`);
    console.log(`    → discovery + candidates : ${plan.allocation.discoveryAndCandidates}`);
    console.log(`    → stale-row refresh      : ${plan.allocation.refreshReserve}`);
    console.log(`    → candidates per run     : ${plan.allocation.newCandidatesPerRun}`);
    console.log(`\n  Listing sources (${plan.listingUrls.length}), ${plan.pagesPerSource} articles each:`);
    for (const url of plan.listingUrls) console.log(`    - ${url}`);
    if (plan.searchQueries.length > 0) {
      console.log('\n  Brave discovery queries (no Firecrawl cost):');
      for (const query of plan.searchQueries) console.log(`    - ${query}`);
    }
    console.log(`\n  Candidate queue : ${plan.queue.pending} pending (${plan.queue.due} due now),`
      + ` ${plan.queue.stored} stored, ${plan.queue.rejected} rejected\n`);
    return;
  }

  const result = await runIngestion({ maxCredits: parsedMax });
  console.log('\nIngestion run\n');
  console.log(`  Status    : ${result.status} in ${Math.round(result.durationMs / 1000)}s`);
  console.log(`  Credits   : ${result.credits.spent} spent of ${result.credits.reserved} reserved`
    + ` — lifetime ${result.credits.lifetimeSpent}/${result.credits.lifetimeBudget}`);
  console.log(`  Discovery : ${result.discovery.listingsCrawled} listings crawled,`
    + ` ${result.discovery.candidatesQueued} new candidates queued`);
  console.log(`  Candidates: ${result.candidates.processed} processed,`
    + ` ${result.candidates.resolved} resolved to a funder page,`
    + ` ${result.candidates.verified} verified`);
  console.log(`  Review    : ${result.review.submitted} filed for approval`
    + ` (${result.review.flagged} needing a field filled in),`
    + ` ${result.review.refreshed} changes, ${result.review.retired} retirements,`
    + ` ${result.review.duplicates} already known`);
  console.log(`  Queue     : ${result.candidates.queue.pending} pending`
    + ` (${result.candidates.queue.due} due now), ${result.candidates.queue.stored} stored,`
    + ` ${result.candidates.queue.rejected} rejected`);
  console.log('\n  Nothing was written to the catalog. Approve at /admin.\n');
}

main().catch((error) => {
  console.error('\nIngestion failed:', error instanceof Error ? error.message : error, '\n');
  process.exit(1);
});
