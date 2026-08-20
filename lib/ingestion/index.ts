import { RunLedger, lifetimeBudget, lifetimeSpend } from './budget';
import {
  claimCandidates, markCandidateFailure, markCandidateStored,
  queueSnapshot, type CandidateRow, type QueueSnapshot,
} from './candidates';
import { discoverFromListings, discoverFromSearch } from './discovery';
import { loadDocument } from './fetch';
import { resolveOfficialUrl } from './resolve';
import { checkOfficialSource, listingUrls, pagesPerSource, searchQueries } from './sources';
import {
  CatalogIndex, identityKey, staleScholarships, touchScholarship, type StaleRow,
} from './store';
import { fileSubmission, type SubmissionFlag } from './submissions';
import { identityText, integerSetting } from './util';
import { verifyOfficialPage, type ExtractedScholarship, type PartialScholarship } from './verify';

export interface IngestionResult {
  runId: string | null;
  status: 'completed' | 'deadline';
  credits: {
    spent: number;
    reserved: number;
    lifetimeSpent: number;
    lifetimeBudget: number;
    lifetimeRemaining: number;
  };
  discovery: { listingsCrawled: number; candidatesQueued: number };
  candidates: { processed: number; resolved: number; verified: number; queue: QueueSnapshot };
  /** What was proposed. No run changes the catalog; approval does. */
  review: {
    submitted: number;
    flagged: number;
    refreshed: number;
    retired: number;
    duplicates: number;
  };
  durationMs: number;
}

function refreshPerRun(): number {
  return integerSetting('INGESTION_REFRESH_PER_RUN', 5, 0, 100);
}

function newCandidatesPerRun(): number {
  return integerSetting('INGESTION_NEW_CANDIDATES_PER_RUN', 10, 0, 200);
}

/**
 * Work out how much of the run's budget to hold back for re-checking rows we
 * already have. Capped at a quarter of the run so that discovery — the reason
 * this pipeline exists — always gets the majority.
 */
function refreshReserve(reserved: number): number {
  return Math.min(refreshPerRun(), Math.max(0, Math.floor(reserved * 0.25)));
}

/** Postgres array columns predate `NOT NULL` on some rows; treat absent as empty. */
function list(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

/** Record that a submission was filed, or that the award was already queued. */
function countFiling(ledger: RunLedger, filed: 'filed' | 'duplicate', flagged: boolean): void {
  if (filed === 'duplicate') {
    ledger.count('duplicates');
    return;
  }
  ledger.count('submitted');
  if (flagged) ledger.count('flagged');
}

/**
 * File a lead whose official page could not be established, with `source_url`
 * empty and every link that was considered attached.
 *
 * Returns false for a lead with no title, leaving it a retryable failure.
 */
async function fileUnresolvedLead(
  ledger: RunLedger,
  index: CatalogIndex,
  candidate: CandidateRow,
  input: { title: string; funder: string; links: unknown; note: string }
): Promise<boolean> {
  const title = input.title.trim();
  if (!title) return false;

  const identity = { title, funder: input.funder, sourceUrl: candidate.article_url };
  const key = identityKey(identity);
  if (index.match(identity, key)) {
    ledger.count('duplicates');
    await markCandidateStored(candidate.candidate_key, '', title, input.funder);
    return true;
  }

  const filed = await fileSubmission({
    kind: 'new',
    identityKey: key,
    candidateKey: candidate.candidate_key,
    articleUrl: candidate.article_url,
    sourceType: null,
    title,
    funder: input.funder,
    country: '',
    amountCurrency: '',
    amountValue: null,
    amountType: 'unknown',
    deadline: null,
    degreeLevels: [],
    fieldsOfStudy: [],
    eligibleNationalities: [],
    minGpa: null,
    requirements: '',
    eligibility: [],
    description: '',
    sourceUrl: null,
    requiredDocs: [],
    benefits: [],
    flags: ['no-source-url'],
    notes: input.note,
    candidateLinks: input.links,
  });

  countFiling(ledger, filed, true);
  await markCandidateStored(candidate.candidate_key, '', title, input.funder);
  return true;
}

/**
 * Maps the fields verification could not supply to reviewer-facing flags.
 *
 * `sourceUrl` becomes `source-unverified` rather than `no-source-url`: a page was
 * read and its URL is offered on the card, it just has not been vouched for.
 */
export function flagsFor(missing: string[]): SubmissionFlag[] {
  const flags: SubmissionFlag[] = [];
  if (missing.includes('sourceUrl')) flags.push('source-unverified');
  if (missing.includes('deadline')) flags.push('no-deadline');
  if (missing.includes('sourceType')) flags.push('no-source-type');
  return flags;
}

/**
 * Trace one candidate to a reviewable submission.
 *
 * Every exit records why on the candidate, so a queue full of failures is
 * diagnosable rather than mysterious. Transient failures — an unreachable article,
 * a page that would not scrape — are retried with backoff; anything that produced
 * a named award is filed for review and the candidate retires from the queue.
 */
async function processCandidate(
  candidate: CandidateRow,
  ledger: RunLedger,
  index: CatalogIndex,
  searchesUsed: number
): Promise<{ searchesUsed: number; filed: boolean }> {
  let officialUrl = candidate.official_url ?? '';
  let title = candidate.title;
  let funder = candidate.funder;
  let searches = searchesUsed;
  let links: Record<string, unknown> | null = null;

  // Discovery sometimes lands on an official page directly (a non-aggregator
  // search hit); those skip resolution entirely.
  if (!officialUrl) {
    const article = await loadDocument(candidate.article_url, ledger, { allowFreeFetch: true });
    if (!article) {
      await markCandidateFailure(candidate.candidate_key, 'listing article could not be fetched');
      return { searchesUsed: searches, filed: false };
    }

    const resolution = await resolveOfficialUrl(article, candidate.listing_url, searches);
    searches = resolution.searchesUsed;
    links = resolution.trace ? { ...resolution.trace } : null;

    if (!resolution.resolved) {
      const filed = await fileUnresolvedLead(ledger, index, candidate, {
        title: resolution.trace?.modelTitle || title,
        funder: resolution.trace?.modelFunder || funder,
        links,
        note: resolution.reason,
      });
      if (!filed) await markCandidateFailure(candidate.candidate_key, resolution.reason);
      return { searchesUsed: searches, filed };
    }

    officialUrl = resolution.resolved.officialUrl;
    title = resolution.resolved.title || title;
    funder = resolution.resolved.funder || funder;
  }

  // The gate, applied even to a URL carried over from a previous run: the
  // aggregator list may have grown since it was queued.
  const verdict = checkOfficialSource(officialUrl, {
    listingUrl: candidate.listing_url,
    funder,
    title,
  });
  if (!verdict.ok) {
    const filed = await fileUnresolvedLead(ledger, index, candidate, {
      title,
      funder,
      links: { ...(links ?? {}), gateRejected: { url: officialUrl, reason: verdict.reason } },
      note: `source gate rejected ${officialUrl}: ${verdict.reason}`,
    });
    if (!filed) {
      await markCandidateFailure(candidate.candidate_key, `rejected source: ${verdict.reason}`, {
        title, funder,
      });
    }
    return { searchesUsed: searches, filed };
  }
  ledger.count('resolved');

  // Official pages always go through Firecrawl. Its markdown is materially
  // better for field extraction, and a wrong deadline is the one error that
  // actually costs a student something.
  const official = await loadDocument(officialUrl, ledger, { allowFreeFetch: false });
  if (!official) {
    await markCandidateFailure(candidate.candidate_key, 'official page could not be scraped', {
      title, funder, officialUrl,
    });
    return { searchesUsed: searches, filed: false };
  }

  const result = await verifyOfficialPage(official, { title });
  const extracted: PartialScholarship | null = result.scholarship ?? result.partial;
  if (result.outcome === 'rejected' || !extracted) {
    // Rejection means we read the wrong page, or the right page for a closed
    // cycle. There is nothing here worth a reviewer's attention.
    await markCandidateFailure(candidate.candidate_key, result.reason, { title, funder, officialUrl });
    return { searchesUsed: searches, filed: false };
  }
  ledger.count('verified');

  const key = identityKey({
    title: extracted.title,
    funder: extracted.funder,
    sourceUrl: extracted.sourceUrl,
  });

  // Already in the catalog: leave it to the refresh pass rather than proposing an
  // award the reviewer has approved once already.
  if (index.match(extracted, key)) {
    ledger.count('duplicates');
    await markCandidateStored(candidate.candidate_key, official.url, extracted.title, extracted.funder);
    return { searchesUsed: searches, filed: false };
  }

  const flags = flagsFor(result.missing);

  // An unconfirmed URL goes into `candidateLinks` for the reviewer to accept,
  // never into `source_url`.
  const unconfirmed = result.outcome === 'unverified';
  const filed = await fileSubmission({
    kind: 'new',
    identityKey: key,
    candidateKey: candidate.candidate_key,
    articleUrl: candidate.article_url,
    sourceType: extracted.sourceType,
    title: extracted.title,
    funder: extracted.funder,
    country: extracted.country,
    amountCurrency: extracted.amountCurrency,
    amountValue: extracted.amountValue,
    amountType: extracted.amountType,
    deadline: extracted.deadline,
    degreeLevels: extracted.degreeLevels,
    fieldsOfStudy: extracted.fieldsOfStudy,
    eligibleNationalities: extracted.eligibleNationalities,
    minGpa: extracted.minGpa,
    requirements: extracted.requirements,
    eligibility: extracted.eligibility,
    description: extracted.description,
    sourceUrl: unconfirmed ? null : extracted.sourceUrl,
    requiredDocs: extracted.requiredDocs,
    benefits: extracted.benefits,
    flags,
    notes: result.reason || undefined,
    candidateLinks: unconfirmed
      ? { ...(links ?? {}), unconfirmed: { url: official.url, reason: result.reason } }
      : links,
    rawExtraction: result.raw,
  });

  countFiling(ledger, filed, flags.length > 0);
  await markCandidateStored(candidate.candidate_key, official.url, extracted.title, extracted.funder);
  console.log(`[ingestion] ${filed} for review: ${extracted.title} — ${official.url}`
    + (flags.length ? ` (${flags.join(', ')})` : ''));
  return { searchesUsed: searches, filed: filed === 'filed' };
}

/**
 * The row's current values, keyed as the review form's fields are, so the UI can
 * show `was: <old>` beside each input without a translation layer.
 */
function snapshotOf(row: StaleRow): Record<string, unknown> {
  return {
    title: row.title,
    funder: row.funder,
    country: row.country,
    amountCurrency: row.amount_currency,
    amountValue: row.amount_value,
    amountType: row.amount_type,
    deadline: row.deadline,
    degreeLevels: list(row.degree_levels),
    fieldsOfStudy: list(row.fields_of_study),
    eligibleNationalities: list(row.eligible_nationalities),
    minGpa: row.min_gpa,
    requirements: row.requirements,
    eligibility: list(row.eligibility),
    description: row.description,
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    requiredDocs: list(row.required_docs),
    benefits: list(row.benefits),
  };
}

/**
 * Which fields changed enough to be worth a reviewer's time.
 *
 * Prose is deliberately excluded. `description`, `requirements`, `eligibility`,
 * `requiredDocs` and `benefits` are all re-worded by the model on every read of
 * the same unchanged page, so comparing them would file a refresh submission for
 * every row every morning and the queue would be worthless within a week. What is
 * compared is what a student would act on differently: dates, money, levels,
 * eligibility scope.
 */
function materialChanges(row: StaleRow, next: ExtractedScholarship): string[] {
  const changed: string[] = [];
  const sameList = (left: string[] | null, right: string[]) => {
    const normalise = (values: string[]) =>
      list(values).map((value) => value.trim().toLowerCase()).sort().join('|');
    return normalise(list(left)) === normalise(right);
  };

  if ((row.deadline ?? '') !== next.deadline) changed.push('deadline');
  if (identityText(row.title) !== identityText(next.title)) changed.push('title');
  if ((row.amount_value ?? null) !== next.amountValue) changed.push('amount');
  if ((row.amount_currency ?? '') !== next.amountCurrency) changed.push('currency');
  if ((row.amount_type ?? '') !== next.amountType) changed.push('amount type');
  if ((row.min_gpa ?? null) !== next.minGpa) changed.push('minimum GPA');
  if ((row.source_type ?? '') !== next.sourceType) changed.push('source type');
  if (!sameList(row.degree_levels, next.degreeLevels)) changed.push('degree levels');
  if (!sameList(row.fields_of_study, next.fieldsOfStudy)) changed.push('fields of study');
  if (!sameList(row.eligible_nationalities, next.eligibleNationalities)) {
    changed.push('eligible nationalities');
  }
  return changed;
}

/**
 * Re-check the least recently crawled rows this pipeline created, and propose what
 * to do about each.
 *
 * Nothing is changed or hidden here — a row that no longer verifies becomes a
 * `retire` submission, not a deactivation. Every path ends in `touchScholarship`,
 * which is what stops a row from being re-scraped tomorrow while its submission
 * sits in the queue; `staleScholarships` skips rows already awaiting review, so
 * the two together mean one credit per row per cycle at most.
 */
async function refreshStaleRows(ledger: RunLedger, limit: number): Promise<void> {
  const rows = await staleScholarships(limit);

  for (const row of rows) {
    if (ledger.exhausted()) break;

    const document = await loadDocument(row.source_url, ledger, { allowFreeFetch: false });
    if (!document) {
      // Unreachable today is not evidence of anything. Back of the queue.
      await touchScholarship(row.external_id);
      continue;
    }

    const result = await verifyOfficialPage(document, { title: row.title });
    const identity = row.identity_key ?? identityKey({
      title: row.title,
      funder: row.funder ?? '',
      sourceUrl: row.source_url,
    });

    // `incomplete`: the page stopped printing an exact date, which is not evidence
    // the award closed, and the row's own deadline is still the best information.
    // `unverified`: a reviewer already approved this URL, so a failed source check
    // is not grounds to propose retiring the row.
    if (result.outcome === 'incomplete' || result.outcome === 'unverified') {
      await touchScholarship(row.external_id);
      continue;
    }

    if (result.outcome === 'rejected' || !result.scholarship) {
      const filed = await fileSubmission({
        kind: 'retire',
        identityKey: identity,
        externalId: row.external_id,
        sourceType: (row.source_type as ExtractedScholarship['sourceType'] | null) ?? null,
        title: row.title,
        funder: row.funder ?? '',
        country: row.country ?? '',
        amountCurrency: row.amount_currency ?? '',
        amountValue: row.amount_value,
        amountType: row.amount_type ?? 'unknown',
        deadline: row.deadline,
        degreeLevels: list(row.degree_levels),
        fieldsOfStudy: list(row.fields_of_study),
        eligibleNationalities: list(row.eligible_nationalities),
        minGpa: row.min_gpa,
        requirements: row.requirements ?? '',
        eligibility: list(row.eligibility),
        description: row.description ?? '',
        sourceUrl: row.source_url,
        requiredDocs: list(row.required_docs),
        benefits: list(row.benefits),
        flags: [],
        notes: `The funder's page no longer verifies: ${result.reason}`,
        previous: snapshotOf(row),
        rawExtraction: result.raw,
      });
      if (filed === 'filed') ledger.count('retired');
      await touchScholarship(row.external_id);
      console.log(`[ingestion] retire proposed: ${row.title} — ${result.reason}`);
      continue;
    }

    const changes = materialChanges(row, result.scholarship);
    if (changes.length === 0) {
      // The common case, and the reason this check exists: an unchanged page must
      // cost nothing downstream, or every run would file a queue full of no-ops.
      await touchScholarship(row.external_id);
      continue;
    }

    const next = result.scholarship;
    const filed = await fileSubmission({
      kind: 'refresh',
      identityKey: identity,
      externalId: row.external_id,
      sourceType: next.sourceType,
      title: next.title,
      funder: next.funder,
      country: next.country,
      amountCurrency: next.amountCurrency,
      amountValue: next.amountValue,
      amountType: next.amountType,
      deadline: next.deadline,
      degreeLevels: next.degreeLevels,
      fieldsOfStudy: next.fieldsOfStudy,
      eligibleNationalities: next.eligibleNationalities,
      minGpa: next.minGpa,
      requirements: next.requirements,
      eligibility: next.eligibility,
      description: next.description,
      sourceUrl: next.sourceUrl,
      requiredDocs: next.requiredDocs,
      benefits: next.benefits,
      flags: [],
      notes: `Changed since the last check: ${changes.join(', ')}.`,
      previous: snapshotOf(row),
      rawExtraction: result.raw,
    });
    if (filed === 'filed') ledger.count('refreshed');
    await touchScholarship(row.external_id);
    console.log(`[ingestion] refresh proposed: ${row.title} — ${changes.join(', ')}`);
  }
}

export interface IngestionOptions {
  /** Plan the run and report it without making a single billable call. */
  dryRun?: boolean;
  /** Override the per-run credit cap, for metered manual runs. */
  maxCredits?: number;
}

export interface IngestionPlan {
  dryRun: true;
  listingUrls: string[];
  searchQueries: string[];
  pagesPerSource: number;
  credits: { runBudget: number; lifetimeSpent: number; lifetimeBudget: number; lifetimeRemaining: number };
  allocation: { refreshReserve: number; discoveryAndCandidates: number; newCandidatesPerRun: number };
  queue: QueueSnapshot;
}

/** What a run would do, at zero cost. */
export async function planIngestion(options: IngestionOptions = {}): Promise<IngestionPlan> {
  const ledger = await RunLedger.open({ ...options, dryRun: true });
  const spent = await lifetimeSpend();
  const budget = lifetimeBudget();
  const reserve = refreshReserve(ledger.reserved);

  return {
    dryRun: true,
    listingUrls: listingUrls(),
    searchQueries: searchQueries(),
    pagesPerSource: pagesPerSource(),
    credits: {
      runBudget: ledger.reserved,
      lifetimeSpent: spent,
      lifetimeBudget: budget,
      lifetimeRemaining: Math.max(0, budget - spent),
    },
    allocation: {
      refreshReserve: reserve,
      discoveryAndCandidates: ledger.reserved - reserve,
      newCandidatesPerRun: newCandidatesPerRun(),
    },
    queue: await queueSnapshot(),
  };
}

/** Run the pipeline. Stops cleanly on either the credit cap or the wall clock. */
export async function runIngestion(options: IngestionOptions = {}): Promise<IngestionResult> {
  if (!process.env.FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY is not configured.');
  if (!process.env.FEATHERLESS_API_KEY) throw new Error('FEATHERLESS_API_KEY is not configured.');

  const startedAt = Date.now();
  const ledger = await RunLedger.open(options);
  const reserve = refreshReserve(ledger.reserved);
  const candidateCeiling = ledger.reserved - reserve;

  let candidatesQueued = 0;
  let processed = 0;

  try {
    // 1. Discovery. Usually free — aggregators are mostly server-rendered, so the
    //    plain HTTP path handles them and Firecrawl is never billed.
    candidatesQueued += await discoverFromListings(ledger);
    candidatesQueued += await discoverFromSearch(ledger);

    // 2. Trace queued candidates to funder pages, holding back the refresh reserve.
    const index = await CatalogIndex.load();
    const candidates = await claimCandidates(newCandidatesPerRun());
    let searchesUsed = 0;

    for (const candidate of candidates) {
      if (ledger.outOfTime || ledger.creditsSpent >= candidateCeiling) break;
      processed += 1;
      const outcome = await processCandidate(candidate, ledger, index, searchesUsed);
      searchesUsed = outcome.searchesUsed;
    }

    // 3. Re-check the oldest rows with whatever is left.
    if (reserve > 0 && !ledger.outOfTime) {
      await refreshStaleRows(ledger, reserve);
    }

    // No `clearFilterCache` here: a run changes nothing a student can see, so the
    // cache is still true. Approval clears it, because approval is what publishes.
    const status = ledger.outOfTime ? 'deadline' : 'completed';
    await ledger.close(status);

    const budget = lifetimeBudget();
    const spentLifetime = await lifetimeSpend();

    return {
      runId: ledger.runId,
      status,
      credits: {
        spent: ledger.creditsSpent,
        reserved: ledger.reserved,
        lifetimeSpent: spentLifetime,
        lifetimeBudget: budget,
        lifetimeRemaining: Math.max(0, budget - spentLifetime),
      },
      discovery: { listingsCrawled: ledger.totals.listings, candidatesQueued },
      candidates: {
        processed,
        resolved: ledger.totals.resolved,
        verified: ledger.totals.verified,
        queue: await queueSnapshot(),
      },
      review: {
        submitted: ledger.totals.submitted,
        flagged: ledger.totals.flagged,
        refreshed: ledger.totals.refreshed,
        retired: ledger.totals.retired,
        duplicates: ledger.totals.duplicates,
      },
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    await ledger.close('failed', String(error));
    throw error;
  }
}
