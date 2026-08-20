import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });

import { writeFileSync } from 'fs';
import { resolve as resolvePath } from 'path';

import { RunLedger, lifetimeBudget, lifetimeSpend } from '../lib/ingestion/budget';
import { claimCandidates, queueSnapshot } from '../lib/ingestion/candidates';
import { discoverFromListings, discoverFromSearch } from '../lib/ingestion/discovery';
import { loadDocument } from '../lib/ingestion/fetch';
import { flagsFor } from '../lib/ingestion';
import { resolveOfficialUrl } from '../lib/ingestion/resolve';
import { checkOfficialSource, listingUrls, pagesPerSource, searchQueries } from '../lib/ingestion/sources';
import { ownerDomain } from '../lib/ingestion/util';
import { verifyOfficialPage, type VerificationOutcome } from '../lib/ingestion/verify';

/**
 * Watch the ingestion pipeline run for real, without letting it near the catalog
 * or the review queue.
 *
 * This exercises the actual stages — discovery, resolution, Firecrawl, Qwen
 * verification — and writes everything it saw to a JSON file for inspection.
 * What it deliberately does not do is file submissions, write to `scholarships`,
 * or mark candidates terminal. Each candidate's report ends with the submission a
 * real run *would* have filed, flags included, which is the thing worth checking
 * before spending a day's credits.
 *
 * Candidates are therefore left `pending` with their attempt count untouched, so
 * the real run can still process them later. The `ingestion_runs` row *is*
 * written: it is the credit ledger, and spend that goes unrecorded makes the
 * lifetime cap meaningless.
 *
 *   npm run preview:ingestion -- --listing-only          # free: what gets discovered
 *   npm run preview:ingestion -- --max-credits=6 --candidates=3
 */

const DEFAULT_OUT = 'ingestion-preview.json';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function flagValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function positiveInt(name: string, fallback: number): number {
  const raw = flagValue(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

interface StageReport {
  articleUrl: string;
  listingUrl: string;
  listingTitle: string;
  attempts: number;
  article?: { via: string; chars: number; linksFound: number };
  resolution?: {
    officialUrl: string;
    title: string;
    funder: string;
    reason: string;
    trace?: unknown;
  };
  gate?: { ok: boolean; reason: string; ownerDomain: string };
  officialPage?: { url: string; via: string; chars: number; excerpt: string };
  verification?: {
    outcome: VerificationOutcome;
    reason: string;
    /** Fields the page did not state — what the flags are derived from. */
    missing: string[];
    raw?: unknown;
    scholarship?: unknown;
  };
  /**
   * The submission a real run would have filed. Absent means the candidate would
   * have stayed in the queue for a later retry instead.
   */
  submission?: {
    kind: 'new';
    flags: string[];
    title: string;
    funder: string;
    deadline: string | null;
    sourceUrl: string | null;
  };
  /** Where this candidate stopped, in one phrase. */
  outcome: string;
  creditsAfter: number;
}

async function main() {
  const listingOnly = flag('listing-only');
  const withSearch = flag('search');
  const maxCredits = positiveInt('max-credits', 6);
  const candidateLimit = positiveInt('candidates', 3);
  const outPath = resolvePath(process.cwd(), flagValue('out') ?? DEFAULT_OUT);

  if (!process.env.FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY is not configured.');
  if (!process.env.FEATHERLESS_API_KEY) throw new Error('FEATHERLESS_API_KEY is not configured.');

  const startedAt = Date.now();
  const ledger = await RunLedger.open({ maxCredits });

  console.log('\nIngestion preview — nothing will be written to `scholarships`\n');
  console.log(`  Credit cap    : ${ledger.reserved}`);
  console.log(`  Listing pages : ${listingUrls().join(', ') || '(none configured)'}`);
  console.log(`  Articles/page : ${pagesPerSource()}`);
  console.log(`  Brave queries : ${withSearch ? searchQueries().join(' | ') || '(none)' : 'skipped (pass --search)'}`);
  console.log(`  Candidates    : ${listingOnly ? '0 (--listing-only)' : candidateLimit}\n`);

  const reports: StageReport[] = [];
  let queuedFromListings = 0;
  let queuedFromSearch = 0;

  try {
    console.log('— Discovery —');
    queuedFromListings = await discoverFromListings(ledger);
    if (withSearch) queuedFromSearch = await discoverFromSearch(ledger);
    console.log(`  ${queuedFromListings + queuedFromSearch} new candidates queued`
      + ` (${ledger.creditsSpent} credits spent so far)\n`);

    if (!listingOnly) {
      const candidates = await claimCandidates(candidateLimit);
      console.log(`— Tracing ${candidates.length} candidate(s) —\n`);

      let searchesUsed = 0;

      for (const candidate of candidates) {
        const report: StageReport = {
          articleUrl: candidate.article_url,
          listingUrl: candidate.listing_url,
          listingTitle: candidate.title,
          attempts: candidate.attempts,
          outcome: '',
          creditsAfter: ledger.creditsSpent,
        };
        reports.push(report);
        console.log(`  ▸ ${candidate.title || candidate.article_url}`);
        console.log(`    article: ${candidate.article_url}`);

        if (ledger.exhausted()) {
          report.outcome = 'skipped — out of credits or time';
          console.log('    ⏹ out of credits or time\n');
          break;
        }

        let officialUrl = candidate.official_url ?? '';
        let title = candidate.title;
        let funder = candidate.funder;

        // Discovery sometimes lands on an official page directly; those skip resolution.
        if (!officialUrl) {
          const article = await loadDocument(candidate.article_url, ledger, { allowFreeFetch: true });
          if (!article) {
            report.outcome = 'article could not be fetched';
            report.creditsAfter = ledger.creditsSpent;
            console.log('    ✗ article could not be fetched\n');
            continue;
          }
          report.article = {
            via: article.via,
            chars: article.markdown.length,
            linksFound: article.links.length,
          };
          console.log(`    fetched via ${article.via} — ${article.markdown.length} chars,`
            + ` ${article.links.length} links`);

          const resolution = await resolveOfficialUrl(article, candidate.listing_url, searchesUsed);
          searchesUsed = resolution.searchesUsed;
          report.resolution = {
            officialUrl: resolution.resolved?.officialUrl ?? '',
            title: resolution.resolved?.title ?? '',
            funder: resolution.resolved?.funder ?? '',
            reason: resolution.reason,
            trace: resolution.trace,
          };

          if (!resolution.resolved) {
            // A named lead is no longer thrown away: it becomes a submission with
            // no source URL and every link that was considered attached.
            const leadTitle = (resolution.trace?.modelTitle || title || '').trim();
            report.creditsAfter = ledger.creditsSpent;
            if (leadTitle) {
              report.submission = {
                kind: 'new',
                flags: ['no-source-url'],
                title: leadTitle,
                funder: resolution.trace?.modelFunder || funder,
                deadline: null,
                sourceUrl: null,
              };
              report.outcome = `would be filed flagged no-source-url — ${resolution.reason}`;
              console.log(`    ⚑ would be filed for review without a link: ${resolution.reason}\n`);
            } else {
              report.outcome = `unresolved — ${resolution.reason}`;
              console.log(`    ✗ unresolved: ${resolution.reason}\n`);
            }
            continue;
          }

          officialUrl = resolution.resolved.officialUrl;
          title = resolution.resolved.title || title;
          funder = resolution.resolved.funder || funder;
          console.log(`    resolved → ${officialUrl}`);
          console.log(`    funder: ${funder || '(none named)'}`);
        } else {
          console.log(`    official URL pre-filled → ${officialUrl}`);
        }

        const verdict = checkOfficialSource(officialUrl, {
          listingUrl: candidate.listing_url,
          funder,
          title,
        });
        report.gate = {
          ok: verdict.ok,
          reason: verdict.ok ? '' : verdict.reason,
          ownerDomain: ownerDomain(officialUrl),
        };
        if (!verdict.ok) {
          report.creditsAfter = ledger.creditsSpent;
          if (title.trim()) {
            report.submission = {
              kind: 'new',
              flags: ['no-source-url'],
              title: title.trim(),
              funder,
              deadline: null,
              sourceUrl: null,
            };
            report.outcome = `would be filed flagged no-source-url — gate rejected ${verdict.reason}`;
            console.log(`    ⚑ source gate rejected (${verdict.reason}) — would be filed`
              + ' for review without a link\n');
          } else {
            report.outcome = `source gate rejected — ${verdict.reason}`;
            console.log(`    ✗ source gate: ${verdict.reason}\n`);
          }
          continue;
        }

        const official = await loadDocument(officialUrl, ledger, { allowFreeFetch: false });
        report.creditsAfter = ledger.creditsSpent;
        if (!official) {
          report.outcome = 'official page could not be scraped';
          console.log('    ✗ official page could not be scraped\n');
          continue;
        }
        report.officialPage = {
          url: official.url,
          via: official.via,
          chars: official.markdown.length,
          excerpt: official.markdown.slice(0, 600),
        };
        console.log(`    scraped via ${official.via} — ${official.markdown.length} chars`
          + ` (${ledger.creditsSpent}/${ledger.reserved} credits)`);

        const result = await verifyOfficialPage(official, { title });
        const extracted = result.scholarship ?? result.partial;
        report.verification = {
          outcome: result.outcome,
          reason: result.reason,
          missing: result.missing,
          raw: result.raw,
          scholarship: extracted ?? undefined,
        };

        if (result.outcome === 'rejected' || !extracted) {
          // Wrong page, or the right page for a closed cycle. Nothing to review.
          report.outcome = `verification rejected — ${result.reason}`;
          console.log(`    ✗ verification: ${result.reason}\n`);
          continue;
        }

        const flags = flagsFor(result.missing);
        report.submission = {
          kind: 'new',
          flags,
          title: extracted.title,
          funder: extracted.funder,
          deadline: extracted.deadline,
          sourceUrl: extracted.sourceUrl,
        };
        report.outcome = flags.length
          ? `would be filed flagged (${flags.join(', ')})`
          : 'would be filed for review';

        console.log(`    ${flags.length ? '⚑' : '✓'} ${extracted.title}`);
        console.log(`      funder   : ${extracted.funder}`);
        console.log(`      deadline : ${extracted.deadline ?? '(not stated — reviewer fills it)'}`);
        console.log(`      amount   : ${extracted.amountCurrency} ${extracted.amountValue ?? '—'}`
          + ` (${extracted.amountType})`);
        console.log(`      levels   : ${extracted.degreeLevels.join(', ') || '—'}`);
        console.log(`      benefits : ${extracted.benefits.join(', ') || '—'}`);
        console.log(`      source   : ${extracted.sourceUrl}`);
        if (flags.length) console.log(`      flags    : ${flags.join(', ')}`);
        console.log('');
      }
    }

    await ledger.close(ledger.outOfTime ? 'deadline' : 'completed');
  } catch (error) {
    await ledger.close('failed', String(error));
    throw error;
  }

  const lifetime = await lifetimeSpend();
  const wouldFile = reports.filter((r) => r.submission).length;
  const wouldFlag = reports.filter((r) => (r.submission?.flags.length ?? 0) > 0).length;

  const report = {
    generatedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    note: 'Preview only. Nothing here was filed for review or written to the scholarships table.',
    options: { maxCredits, candidateLimit, listingOnly, withSearch },
    config: {
      listingUrls: listingUrls(),
      pagesPerSource: pagesPerSource(),
      searchQueries: withSearch ? searchQueries() : [],
    },
    credits: {
      spentThisRun: ledger.creditsSpent,
      reserved: ledger.reserved,
      lifetimeSpent: lifetime,
      lifetimeBudget: lifetimeBudget(),
    },
    discovery: { queuedFromListings, queuedFromSearch },
    queue: await queueSnapshot(),
    candidates: reports,
  };

  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');

  console.log('— Summary —');
  console.log(`  Credits spent : ${ledger.creditsSpent}/${ledger.reserved}`
    + ` (lifetime ${lifetime}/${lifetimeBudget()})`);
  console.log(`  Candidates    : ${reports.length} traced, ${wouldFile} would be filed`
    + ` (${wouldFlag} flagged for a reviewer to finish)`);
  console.log(`  Queue         : ${report.queue.pending} pending, ${report.queue.due} due now`);
  console.log(`  Report        : ${outPath}\n`);
}

main().catch((error) => {
  console.error('\nPreview failed:', error instanceof Error ? error.message : error, '\n');
  process.exit(1);
});
