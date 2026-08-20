'use client';

import { useState } from 'react';
import {
  AlertTriangle, ArchiveX, Check, ChevronDown, ChevronRight, ExternalLink,
  Loader2, RefreshCw, Sparkles, X,
} from 'lucide-react';
import { useAdminApi } from '@/app/hooks/useAdminApi';
import type { SubmissionRow } from '@/lib/ingestion/submissions';

interface SubmissionReviewProps {
  submission: SubmissionRow;
  /** Called once the server has acted, so the queue can drop the card. */
  onReviewed: (id: string, outcome: 'approved' | 'rejected') => void;
}

/** The editable shape. Numbers stay strings while typing; the server coerces them. */
interface Draft {
  title: string;
  funder: string;
  country: string;
  amountCurrency: string;
  amountValue: string;
  amountType: string;
  deadline: string;
  degreeLevels: string[];
  fieldsOfStudy: string[];
  eligibleNationalities: string[];
  minGpa: string;
  requirements: string;
  eligibility: string[];
  description: string;
  sourceUrl: string;
  sourceType: string;
  requiredDocs: string[];
  benefits: string[];
}

const AMOUNT_TYPES = ['full', 'partial', 'stipend', 'unknown'];
const SOURCE_TYPES = ['university', 'funder', 'government'];

/** What each flag is actually asking the reviewer to do. */
const FLAG_LABELS: Record<string, string> = {
  'no-deadline': 'deadline missing',
  'no-source-url': 'source link missing',
  'no-source-type': 'source type missing',
  'source-unverified': 'source unverified',
};

const KIND_LABELS: Record<SubmissionRow['kind'], string> = {
  new: 'New award',
  refresh: 'Changed',
  retire: 'Retire',
};

function numberText(value: number | null): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * The page the pipeline read but could not confirm as the funder's own, taken
 * from `candidate_links.unconfirmed`. Returns null unless it holds an http(s) URL.
 */
function unconfirmedLink(links: unknown): { url: string; reason: string } | null {
  if (!links || typeof links !== 'object') return null;
  const entry = (links as Record<string, unknown>).unconfirmed;
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  const url = typeof record.url === 'string' ? record.url : '';
  if (!/^https?:\/\//i.test(url)) return null;
  return { url, reason: typeof record.reason === 'string' ? record.reason : '' };
}

function fromRow(row: SubmissionRow): Draft {
  return {
    title: row.title ?? '',
    funder: row.funder ?? '',
    country: row.country ?? '',
    amountCurrency: row.amount_currency ?? '',
    amountValue: numberText(row.amount_value),
    amountType: row.amount_type ?? 'unknown',
    deadline: row.deadline ?? '',
    degreeLevels: row.degree_levels ?? [],
    fieldsOfStudy: row.fields_of_study ?? [],
    eligibleNationalities: row.eligible_nationalities ?? [],
    minGpa: numberText(row.min_gpa),
    requirements: row.requirements ?? '',
    eligibility: row.eligibility ?? [],
    description: row.description ?? '',
    sourceUrl: row.source_url ?? '',
    sourceType: row.source_type ?? '',
    requiredDocs: row.required_docs ?? [],
    benefits: row.benefits ?? [],
  };
}

/**
 * One submission, editable, with everything needed to judge it on screen.
 *
 * The same shape as [AddOpportunityModal](app/components/AddOpportunityModal.tsx):
 * an AI extraction, an editable confirm step, then a save. The differences are
 * what this queue exists for — flagged gaps are highlighted in amber rather than
 * merely mentioned, a `refresh` shows `was:` beneath every field that changed, and
 * the links the resolver considered are one click away, because "I verify the link
 * myself" has to be a ten-second job or it will not happen.
 *
 * Approving is the only path into the catalog, and the server re-checks every
 * invariant on whatever is typed here — a rejected approval comes back as an
 * inline message with the submission still pending.
 */
export default function SubmissionReview({ submission, onReviewed }: SubmissionReviewProps) {
  const { request } = useAdminApi();
  const [draft, setDraft] = useState<Draft>(() => fromRow(submission));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [expanded, setExpanded] = useState(submission.kind !== 'retire');

  const flags = submission.flags ?? [];
  const previous = submission.previous;
  const isRetire = submission.kind === 'retire';
  const unconfirmed = unconfirmedLink(submission.candidate_links);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  /** The row's value before this proposal, when it differs from what is on screen. */
  function was(field: keyof Draft): string | null {
    if (!previous || !(field in previous)) return null;
    const old = previous[field];
    const oldText = Array.isArray(old)
      ? old.join(', ')
      : old === null || old === undefined ? '' : String(old);
    const current = draft[field];
    const nowText = Array.isArray(current) ? current.join(', ') : String(current ?? '');
    if (oldText.trim() === nowText.trim()) return null;
    return oldText.trim() || '—';
  }

  /**
   * Which inputs get the amber border, derived from the flags so border and badge
   * cannot disagree. `source-unverified` maps to the source URL field.
   */
  const needsAttention = new Set(
    flags.flatMap((flag) =>
      flag === 'source-unverified' ? ['source-url'] : flag.startsWith('no-') ? [flag.slice(3)] : []
    )
  );

  /** Amber where the pipeline could not read a value, matching the modal's idiom. */
  const fieldClass = (field: string) =>
    `input ${needsAttention.has(field) ? 'border-[var(--amber)]' : ''}`;

  async function act(action: 'approve' | 'reject') {
    setError(null);
    setBusy(action);
    const response = await request<{ ok: true }>(`/api/admin/submissions/${submission.id}`, {
      method: 'PATCH',
      body: JSON.stringify(
        action === 'approve' ? { action, fields: draft, note } : { action, note }
      ),
    });
    if (!response.ok) {
      setError(response.error);
      setBusy(null);
      return;
    }
    onReviewed(submission.id, action === 'approve' ? 'approved' : 'rejected');
  }

  const canApprove = isRetire
    || (draft.title.trim() !== '' && draft.deadline !== '' && draft.sourceUrl.trim() !== ''
      && SOURCE_TYPES.includes(draft.sourceType));

  const label = (text: string) => (
    <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">
      {text}
    </label>
  );

  const wasLine = (field: keyof Draft) => {
    const old = was(field);
    if (!old) return null;
    return (
      <p className="text-xs mt-1.5 text-tertiary truncate" title={old}>
        was: <span className="font-semibold">{old}</span>
      </p>
    );
  };

  const arrayField = (field: 'degreeLevels' | 'fieldsOfStudy' | 'eligibleNationalities'
    | 'eligibility' | 'requiredDocs' | 'benefits', text: string, rows = 2) => (
    <div className="min-w-0">
      {label(`${text} (one per line)`)}
      <textarea
        value={draft[field].join('\n')}
        onChange={(e) => set(field, e.target.value.split('\n').filter(Boolean))}
        rows={rows}
        className="input resize-none text-sm"
      />
      {wasLine(field)}
    </div>
  );

  return (
    <div className="card p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span
              className="badge"
              style={
                isRetire
                  ? { backgroundColor: 'rgba(239,68,68,0.12)', color: '#dc2626' }
                  : submission.kind === 'refresh'
                    ? { backgroundColor: 'var(--surface-muted)', color: 'var(--text-secondary)' }
                    : { backgroundColor: 'var(--primary)', color: '#fff' }
              }
            >
              {KIND_LABELS[submission.kind]}
            </span>
            {flags.map((flag) => (
              <span
                key={flag}
                className="badge"
                style={{ backgroundColor: 'var(--amber-fade)', color: 'var(--amber)' }}
              >
                {FLAG_LABELS[flag] ?? flag}
              </span>
            ))}
          </div>
          <h3 className="text-base font-extrabold text-primary break-words">
            {draft.title || 'Untitled award'}
          </h3>
          <p className="text-xs text-secondary mt-0.5">
            {draft.funder || 'Unknown funder'}
            {draft.country ? ` · ${draft.country}` : ''}
            {' · filed '}
            {new Date(submission.created_at).toLocaleDateString()}
          </p>
        </div>
        <button
          onClick={() => setExpanded((open) => !open)}
          className="btn-ghost shrink-0"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {submission.notes && (
        <div
          className="p-3 rounded-xl text-xs font-semibold flex items-start gap-2"
          style={{ backgroundColor: 'var(--amber-fade)', color: 'var(--amber)' }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="min-w-0 break-words">{submission.notes}</span>
        </div>
      )}

      <div className="flex flex-col gap-1 text-xs">
        {submission.source_url ? (
          <a
            href={submission.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 truncate hover:underline"
            style={{ color: 'var(--primary)' }}
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{submission.source_url}</span>
          </a>
        ) : (
          <span className="text-tertiary">No funder page confirmed — see the links below.</span>
        )}
        {submission.article_url && (
          <a
            href={submission.article_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 truncate text-tertiary hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Found on {submission.article_url}</span>
          </a>
        )}
      </div>

      {expanded && !isRetire && (
        <div className="space-y-3 pt-1">
          <div>
            {label('Title')}
            <input
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
              className={fieldClass('title')}
            />
            {wasLine('title')}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              {label('Funder')}
              <input
                value={draft.funder}
                onChange={(e) => set('funder', e.target.value)}
                className="input"
              />
              {wasLine('funder')}
            </div>
            <div className="min-w-0">
              {label('Country')}
              <input
                value={draft.country}
                onChange={(e) => set('country', e.target.value)}
                className="input"
              />
              {wasLine('country')}
            </div>
          </div>

          <div>
            {label('Source URL — the funder\'s own page')}
            <input
              value={draft.sourceUrl}
              onChange={(e) => set('sourceUrl', e.target.value)}
              placeholder="https://…"
              className={fieldClass('source-url')}
            />
            {wasLine('sourceUrl')}
            {unconfirmed && (
              <div
                className="mt-2 p-3 rounded-xl space-y-2"
                style={{ backgroundColor: 'var(--amber-fade)' }}
              >
                <p className="text-xs font-semibold" style={{ color: 'var(--amber)' }}>
                  This page was read and the award details below came off it, but it could not be
                  confirmed as the funder&apos;s own{unconfirmed.reason ? `: ${unconfirmed.reason}` : '.'}
                </p>
                <a
                  href={unconfirmed.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs hover:underline"
                  style={{ color: 'var(--primary)' }}
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{unconfirmed.url}</span>
                </a>
                <button
                  type="button"
                  onClick={() => set('sourceUrl', unconfirmed.url)}
                  disabled={draft.sourceUrl.trim() === unconfirmed.url}
                  className="btn-ghost text-xs disabled:opacity-60"
                >
                  {draft.sourceUrl.trim() === unconfirmed.url ? 'Using this link' : 'Use this link'}
                </button>
              </div>
            )}
            {flags.includes('no-source-url') && (
              <p className="text-xs mt-1.5 font-semibold" style={{ color: 'var(--amber)' }}>
                The official page could not be confirmed, so nothing was filled in. Open the links
                below and paste the right one — a listing site will be refused.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              {label('Deadline')}
              {/* Date input, never free text: this value drives the reminder cron. */}
              <input
                type="date"
                value={draft.deadline}
                onChange={(e) => set('deadline', e.target.value)}
                className={fieldClass('deadline')}
              />
              {wasLine('deadline')}
              {flags.includes('no-deadline') && (
                <p className="text-xs mt-1.5 font-semibold" style={{ color: 'var(--amber)' }}>
                  Not printed on the page — set it yourself.
                </p>
              )}
            </div>
            <div className="min-w-0">
              {label('Source type')}
              <select
                value={draft.sourceType}
                onChange={(e) => set('sourceType', e.target.value)}
                className={fieldClass('source-type')}
              >
                <option value="">Choose…</option>
                {SOURCE_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              {wasLine('sourceType')}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="min-w-0">
              {label('Currency')}
              <input
                value={draft.amountCurrency}
                onChange={(e) => set('amountCurrency', e.target.value)}
                className="input"
              />
              {wasLine('amountCurrency')}
            </div>
            <div className="min-w-0">
              {label('Amount')}
              <input
                value={draft.amountValue}
                onChange={(e) => set('amountValue', e.target.value)}
                inputMode="decimal"
                className="input"
              />
              {wasLine('amountValue')}
            </div>
            <div className="min-w-0 col-span-2 sm:col-span-1">
              {label('Type')}
              <select
                value={draft.amountType}
                onChange={(e) => set('amountType', e.target.value)}
                className="input"
              >
                {AMOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              {wasLine('amountType')}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {arrayField('degreeLevels', 'Degree levels')}
            {arrayField('fieldsOfStudy', 'Fields of study')}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {arrayField('eligibleNationalities', 'Eligible nationalities')}
            <div className="min-w-0">
              {label('Minimum GPA')}
              <input
                value={draft.minGpa}
                onChange={(e) => set('minGpa', e.target.value)}
                inputMode="decimal"
                className="input"
              />
              {wasLine('minGpa')}
            </div>
          </div>

          {arrayField('benefits', 'What the award covers', 3)}
          {arrayField('eligibility', 'Eligibility', 3)}
          {arrayField('requiredDocs', 'Required documents', 3)}

          <div>
            {label('Requirements')}
            <textarea
              value={draft.requirements}
              onChange={(e) => set('requirements', e.target.value)}
              rows={2}
              className="input resize-none text-sm"
            />
          </div>

          <div>
            {label('Description')}
            <textarea
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              className="input resize-none text-sm"
            />
          </div>
        </div>
      )}

      {expanded && isRetire && (
        <div className="surface-muted rounded-xl p-3 text-xs text-secondary space-y-1">
          <p className="font-bold text-primary">
            Approving hides this row from students. Nothing is deleted.
          </p>
          <p>Deadline on file: {draft.deadline || '—'}</p>
          <p>Amount on file: {[draft.amountCurrency, draft.amountValue].filter(Boolean).join(' ') || '—'}</p>
        </div>
      )}

      {(submission.raw_extraction || submission.candidate_links) && (
        <div>
          <button
            onClick={() => setShowRaw((open) => !open)}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-tertiary uppercase tracking-wide hover:text-secondary"
          >
            <Sparkles className="w-3.5 h-3.5" />
            What the AI saw
            {showRaw ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          {showRaw && (
            <div className="mt-2 space-y-2">
              {submission.candidate_links && (
                <div>
                  <p className="text-xs font-bold text-tertiary mb-1">Links considered</p>
                  <pre className="surface-muted rounded-xl p-3 text-[11px] leading-relaxed overflow-x-auto text-secondary">
                    {JSON.stringify(submission.candidate_links, null, 2)}
                  </pre>
                </div>
              )}
              {submission.raw_extraction && (
                <div>
                  <p className="text-xs font-bold text-tertiary mb-1">Extraction</p>
                  <pre className="surface-muted rounded-xl p-3 text-[11px] leading-relaxed overflow-x-auto text-secondary">
                    {JSON.stringify(submission.raw_extraction, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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

      <div className="space-y-2 pt-1">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Review note (optional)"
          className="input text-sm"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => act('reject')}
            disabled={busy !== null}
            className="px-4 py-2.5 text-sm font-bold text-secondary surface-muted hover:opacity-80 rounded-xl transition-colors disabled:opacity-60 inline-flex items-center gap-1.5"
          >
            {busy === 'reject' ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            Reject
          </button>
          <button
            onClick={() => act('approve')}
            disabled={busy !== null || !canApprove}
            className="flex-1 btn-primary justify-center disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy === 'approve' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isRetire ? (
              <ArchiveX className="w-4 h-4" />
            ) : submission.kind === 'refresh' ? (
              <RefreshCw className="w-4 h-4" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {isRetire ? 'Retire it' : submission.kind === 'refresh' ? 'Apply changes' : 'Approve'}
          </button>
        </div>
        {!canApprove && !isRetire && (
          <p className="text-xs text-tertiary">
            Title, source URL, source type and deadline are all required before this can be
            published.
          </p>
        )}
      </div>
    </div>
  );
}
