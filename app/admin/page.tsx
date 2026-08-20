'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Inbox, Library, Loader2, LogOut, Play, RefreshCw, ShieldCheck, Zap, type LucideIcon,
} from 'lucide-react';
import AdminGateNotice from '@/app/components/AdminGateNotice';
import AppLogo from '@/app/components/AppLogo';
import CatalogManager from '@/app/components/CatalogManager';
import SplashScreen from '@/app/components/SplashScreen';
import SubmissionReview from '@/app/components/SubmissionReview';
import { useAdminApi, type AdminDenial } from '@/app/hooks/useAdminApi';
import { useAuth } from '@/app/providers/AuthProvider';
import type { IngestionPlan, IngestionResult } from '@/lib/ingestion';
import type { SubmissionCounts, SubmissionRow, SubmissionStatus } from '@/lib/ingestion/submissions';

interface IngestionPlanResponse extends IngestionPlan {
  inFlight: boolean;
  maxManualCredits: number;
  defaultCredits: number;
  configured: boolean;
}

const STATUSES: SubmissionStatus[] = ['pending', 'approved', 'rejected'];

type AdminView = 'queue' | 'catalog';

const VIEWS: [AdminView, string, LucideIcon][] = [
  ['queue', 'Review queue', Inbox],
  ['catalog', 'Catalog', Library],
];

/**
 * The refusals a fresh sign-in fixes, as opposed to the ones it cannot. Written
 * as a guard so the notice below is typed against only the codes it renders.
 */
function needsSignIn(code: AdminDenial): code is 'no_token' | 'stale_session' {
  return code === 'no_token' || code === 'stale_session';
}

/**
 * How many leads a given credit figure actually buys.
 *
 * Worth showing, because the relationship is not obvious and its consequence is:
 * a run holds back up to a quarter of its budget for re-checking rows already in
 * the catalog, and each remaining lead costs one credit for the funder's page
 * plus a second when the article behind it cannot be fetched for free. Two
 * credits is therefore one or two leads — which looks like a broken run if you
 * expected a queue full of them.
 */
function leadEstimate(credits: number, plan: IngestionPlanResponse): string {
  const quarter = Math.floor(plan.credits.runBudget * 0.25);
  // The reserve is min(INGESTION_REFRESH_PER_RUN, a quarter of the run). When the
  // plan shows less than a quarter held back, the setting is what we are looking
  // at and the same sum applies to any figure; when they are equal it is at least
  // that large, and assuming no cap errs toward promising fewer leads.
  const cap = plan.allocation.refreshReserve < quarter ? plan.allocation.refreshReserve : Infinity;
  const forLeads = Math.max(0, credits - Math.min(cap, Math.floor(credits * 0.25)));
  const most = Math.min(forLeads, plan.allocation.newCandidatesPerRun, plan.queue.due || forLeads);
  if (most < 1) return 'not enough for a single lead';
  const fewest = Math.max(1, Math.ceil(most / 2));
  return fewest === most ? `about ${most} lead${most === 1 ? '' : 's'}` : `${fewest}–${most} leads`;
}

/**
 * The review desk. Nothing the pipeline extracts reaches a student until it has
 * been approved here.
 *
 * Deliberately standalone: no `Sidebar`, and nothing links to it. It is not a
 * student surface, and the gate is server-side anyway — this page learns whether
 * the account is a reviewer only from the API's response, so there is no
 * allowlist in the browser bundle to read.
 */
export default function AdminPage() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const { request } = useAdminApi();

  const [status, setStatus] = useState<SubmissionStatus>('pending');
  const [view, setView] = useState<AdminView>('queue');
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [counts, setCounts] = useState<SubmissionCounts>({ pending: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState<AdminDenial | null>(null);
  const [deniedMessage, setDeniedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [plan, setPlan] = useState<IngestionPlanResponse | null>(null);
  const [credits, setCredits] = useState('2');
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<IngestionResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const loadQueue = useCallback(async (which: SubmissionStatus) => {
    setLoading(true);
    setError(null);
    const response = await request<{
      status: SubmissionStatus;
      submissions: SubmissionRow[];
      counts: SubmissionCounts;
    }>(`/api/admin/submissions?status=${which}`);

    if (response.ok && response.data) {
      setDenied(null);
      setDeniedMessage(null);
      setSubmissions(response.data.submissions);
      setCounts(response.data.counts);
    } else {
      setDenied(response.denied);
      setDeniedMessage(response.error);
      if (!response.denied) setError(response.error);
    }
    setLoading(false);
  }, [request]);

  const loadPlan = useCallback(async () => {
    const response = await request<IngestionPlanResponse>('/api/admin/ingest');
    if (response.ok && response.data) setPlan(response.data);
  }, [request]);

  useEffect(() => {
    if (authLoading || !user) return;
    loadQueue(status);
  }, [authLoading, user, status, loadQueue]);

  useEffect(() => {
    if (authLoading || !user) return;
    loadPlan();
  }, [authLoading, user, loadPlan]);

  /**
   * No session, or one the server will not accept — both are the same answer, and
   * that answer lives at its own URL. Sending the reviewer there rather than
   * rendering a form in place keeps admin sign-in a page you can bookmark, land
   * on, and reason about, instead of a state this page can be in.
   */
  const signInNeeded = !authLoading && (!user || (denied !== null && needsSignIn(denied)));

  useEffect(() => {
    if (signInNeeded) router.replace('/admin/login');
  }, [signInNeeded, router]);

  /** Run the pipeline. Long — up to fifteen minutes — so the UI says so and waits. */
  async function runNow() {
    setConfirming(false);
    setRunError(null);
    setRunResult(null);
    setRunning(true);
    const response = await request<IngestionResult>('/api/admin/ingest', {
      method: 'POST',
      body: JSON.stringify({ maxCredits: Number(credits) || undefined }),
    });
    setRunning(false);
    if (response.ok && response.data) {
      setRunResult(response.data);
      await Promise.all([loadQueue('pending'), loadPlan()]);
      setStatus('pending');
    } else {
      setRunError(response.error);
      await loadPlan();
    }
  }

  /** One-line confirmation, four seconds, shared by both views. */
  function notice(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 4000);
  }

  function handleReviewed(id: string, outcome: 'approved' | 'rejected') {
    setSubmissions((current) => current.filter((row) => row.id !== id));
    setCounts((current) => ({
      ...current,
      pending: Math.max(0, current.pending - 1),
      [outcome]: current[outcome] + 1,
    }));
    notice(outcome === 'approved' ? 'Published to the catalog.' : 'Rejected.');
  }

  if (authLoading || signInNeeded) return <SplashScreen />;

  // What is left are the refusals no sign-in fixes. The guard is inverted rather
  // than assumed, so the notice is typed against exactly the codes it renders.
  if (denied && !needsSignIn(denied)) {
    return <AdminGateNotice code={denied} message={deniedMessage} />;
  }

  return (
    <main className="min-h-[100dvh] max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-5 safe-top safe-bottom">
      {/* The same emerald hero the student surfaces use, so the desk reads as part
          of the app rather than a bare admin table. */}
      <header className="relative overflow-hidden rounded-3xl gradient-emerald text-white p-4 sm:p-5 shadow-xl">
        <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3" />

        <div className="relative z-10 space-y-3">
          <div className="flex items-start justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <AppLogo size={40} className="bg-white/95 shadow-md shrink-0" />
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/15 text-[10px] font-bold uppercase tracking-wide">
                  <ShieldCheck className="w-3 h-3" />
                  Reviewer desk
                </span>
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight leading-tight mt-1">
                  {view === 'catalog' ? 'Catalog' : 'Review queue'}
                </h1>
              </div>
            </div>
            <button
              onClick={signOut}
              aria-label="Sign out"
              className="shrink-0 inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 transition-colors text-xs font-bold"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>

          <p className="text-xs sm:text-sm text-white/85 break-words">
            <span className="break-all">{user?.email}</span> ·{' '}
            {view === 'catalog'
              ? 'every published award, including the ones students no longer see.'
              : 'approving is the only way anything reaches the catalog.'}
          </p>
        </div>
      </header>

      {/* Two jobs at this desk: clear the queue, and keep what is already published
          correct. */}
      <div className="flex gap-1 p-1 rounded-xl surface-muted">
        {VIEWS.map(([key, text, Icon]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 sm:px-3 py-2 text-[11px] sm:text-xs font-bold rounded-lg transition-colors ${
              view === key ? 'gradient-emerald text-white shadow-sm' : 'text-secondary hover:text-primary'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {text}
            {key === 'queue' && counts.pending > 0 ? ` (${counts.pending})` : ''}
          </button>
        ))}
      </div>

      {toast && (
        <div
          className="p-3 rounded-xl text-sm font-bold"
          style={{ backgroundColor: 'var(--primary-fade)', color: 'var(--primary)' }}
        >
          {toast}
        </div>
      )}

      {view === 'catalog' ? (
        <CatalogManager onNotice={notice} />
      ) : (
        <>
          {/* Ingestion. The estimate is free; only the button spends credits. */}
          <section className="card p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="section-title flex items-center gap-1.5">
                <Zap className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                Ingestion
              </h2>
              <button onClick={loadPlan} className="btn-ghost text-xs" aria-label="Refresh estimate">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {plan ? (
              <>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-xs">
                  <div className="surface-muted rounded-xl p-3">
                    <dt className="text-tertiary font-bold uppercase tracking-wide">Credits left</dt>
                    <dd className="font-extrabold text-base" style={{ color: 'var(--primary)' }}>
                      {plan.credits.lifetimeRemaining.toLocaleString()}
                    </dd>
                    <dd className="text-tertiary">of {plan.credits.lifetimeBudget.toLocaleString()}</dd>
                  </div>
                  <div className="surface-muted rounded-xl p-3">
                    <dt className="text-tertiary font-bold uppercase tracking-wide">Leads due</dt>
                    <dd className="font-extrabold text-base" style={{ color: 'var(--primary)' }}>
                      {plan.queue.due}
                    </dd>
                    <dd className="text-tertiary">{plan.queue.pending} queued</dd>
                  </div>
                  <div className="surface-muted rounded-xl p-3">
                    <dt className="text-tertiary font-bold uppercase tracking-wide">Listing pages</dt>
                    <dd className="font-extrabold text-base" style={{ color: 'var(--primary)' }}>
                      {plan.listingUrls.length}
                    </dd>
                    <dd className="text-tertiary">{plan.searchQueries.length} searches</dd>
                  </div>
                  <div className="surface-muted rounded-xl p-3">
                    <dt className="text-tertiary font-bold uppercase tracking-wide">Daily cap</dt>
                    <dd className="font-extrabold text-base" style={{ color: 'var(--primary)' }}>
                      {plan.defaultCredits}
                    </dd>
                    <dd className="text-tertiary">credits per run</dd>
                  </div>
                </dl>

                {!plan.configured && (
                  <p className="text-xs font-semibold" style={{ color: 'var(--amber)' }}>
                    Firecrawl or Featherless is not configured on this deployment — a run would refuse
                    to start.
                  </p>
                )}

                <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                  <div className="w-full sm:w-28 shrink-0">
                    <label
                      htmlFor="max-credits"
                      className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5"
                    >
                      Max credits
                    </label>
                    <input
                      id="max-credits"
                      value={credits}
                      onChange={(e) => setCredits(e.target.value.replace(/[^\d]/g, ''))}
                      inputMode="numeric"
                      className="input py-2.5 text-sm"
                    />
                  </div>
                  {confirming ? (
                    <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <button
                        onClick={runNow}
                        className="flex-1 btn-primary justify-center py-2.5 text-sm"
                      >
                        Spend up to {Math.min(Number(credits) || 1, plan.maxManualCredits)} credits
                      </button>
                      <button
                        onClick={() => setConfirming(false)}
                        className="btn-ghost justify-center text-sm py-2.5"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirming(true)}
                      disabled={running || plan.inFlight || !plan.configured}
                      className="flex-1 btn-primary justify-center py-2.5 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {running ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Running…
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" />
                          {plan.inFlight ? 'A run is in progress' : 'Run ingestion now'}
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* Why a two-credit run files one submission, said before it surprises anyone. */}
                <p className="text-xs text-tertiary">
                  {Math.min(Number(credits) || 1, plan.maxManualCredits)} credits buys{' '}
                  <span className="font-semibold text-secondary">
                    {leadEstimate(Math.min(Number(credits) || 1, plan.maxManualCredits), plan)}
                  </span>{' '}
                  — one credit for the funder’s own page, a second when the article behind it cannot be
                  read for free, and up to a quarter of the run held back to re-check rows already in the
                  catalog. Not every lead survives verification, so fewer submissions than leads is
                  normal.
                </p>

                {running && (
                  <p className="text-xs text-tertiary">
                    Scraping listing pages, tracing each lead to the funder, and reading the details.
                    This can take several minutes — leave the tab open.
                  </p>
                )}

                {runError && (
                  <div
                    className="p-3 rounded-xl text-sm font-bold border"
                    style={{
                      backgroundColor: 'var(--red-fade)',
                      borderColor: 'var(--red)',
                      color: 'var(--red)',
                    }}
                  >
                    {runError}
                  </div>
                )}

                {runResult && (
                  <div className="surface-muted rounded-xl p-3 text-xs text-secondary">
                    <span className="font-bold" style={{ color: 'var(--primary)' }}>
                      {runResult.review.submitted} filed for review
                    </span>
                    {runResult.review.flagged > 0 && ` · ${runResult.review.flagged} flagged`}
                    {runResult.review.refreshed > 0 && ` · ${runResult.review.refreshed} changed`}
                    {runResult.review.retired > 0 && ` · ${runResult.review.retired} to retire`}
                    {runResult.review.duplicates > 0 && ` · ${runResult.review.duplicates} already known`}
                    {` · ${runResult.credits.spent} credits spent`}
                    {runResult.status === 'deadline' && ' · stopped on the time limit'}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-tertiary">Loading the estimate…</p>
            )}
          </section>

          <div className="flex gap-1 p-1 rounded-xl surface-muted">
            {STATUSES.map((option) => (
              <button
                key={option}
                onClick={() => setStatus(option)}
                className={`flex-1 px-2 sm:px-3 py-2 text-[11px] sm:text-xs font-bold rounded-lg capitalize transition-colors ${
                  status === option
                    ? 'gradient-emerald text-white shadow-sm'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                {option} ({counts[option]})
              </button>
            ))}
          </div>

          {error && (
            <div
              className="p-3 rounded-xl text-sm font-bold border"
              style={{
                backgroundColor: 'var(--red-fade)',
                borderColor: 'var(--red)',
                color: 'var(--red)',
              }}
            >
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-tertiary">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading the queue…
            </div>
          ) : submissions.length === 0 ? (
            <div className="card p-6 sm:p-8 text-center space-y-2">
              <Inbox className="w-8 h-8 mx-auto text-tertiary" />
              <p className="text-sm font-bold text-primary">Nothing {status}</p>
              <p className="text-xs text-secondary">
                {status === 'pending'
                  ? 'The pipeline files what it finds here. Run it, or wait for the daily cron.'
                  : `No submissions have been ${status} yet.`}
              </p>
            </div>
          ) : status === 'pending' ? (
            <div className="space-y-4">
              {submissions.map((submission) => (
                <SubmissionReview
                  key={submission.id}
                  submission={submission}
                  onReviewed={handleReviewed}
                />
              ))}
            </div>
          ) : (
            // Reviewed submissions are a record, not work: the values shown are the ones
            // that were actually approved, which is how a correction stays visible.
            <div className="space-y-2">
              {submissions.map((submission) => (
                <div key={submission.id} className="card p-4 space-y-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-bold text-primary break-words">{submission.title}</h3>
                    <span className="text-xs text-tertiary shrink-0">
                      {submission.reviewed_at
                        ? new Date(submission.reviewed_at).toLocaleDateString()
                        : ''}
                    </span>
                  </div>
                  <p className="text-xs text-secondary break-words">
                    {submission.funder || 'Unknown funder'}
                    {submission.deadline ? ` · closes ${submission.deadline}` : ''}
                    {submission.reviewed_by ? ` · by ${submission.reviewed_by}` : ''}
                  </p>
                  {submission.review_note && (
                    <p className="text-xs text-tertiary italic break-words">{submission.review_note}</p>
                  )}
                  {submission.source_url && (
                    <a
                      href={submission.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs truncate block hover:underline"
                      style={{ color: 'var(--primary)' }}
                    >
                      {submission.source_url}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
