'use client';

import { useState } from 'react';
import {
  AlertTriangle, ClipboardPaste, Loader2, Plus, Search, Sparkles, X,
} from 'lucide-react';
import { useAdminApi } from '@/app/hooks/useAdminApi';
import ScholarshipForm, {
  EMPTY_DRAFT, isPublishable, type ScholarshipDraft,
} from '@/app/components/ScholarshipForm';
import type { CatalogRow } from '@/lib/admin/catalog';

interface AdminAddScholarshipProps {
  open: boolean;
  onClose: () => void;
  /** Called with the row the server wrote, so the list can show it. */
  onAdded: (row: CatalogRow) => void;
}

/** What the Discover parser returns. Its columns are looser than the catalog's. */
interface ParsedDraft {
  title: string;
  funder: string;
  country: string;
  degreeLevel: string;
  amount: string;
  deadline: string;
  eligibility: string[];
  requiredDocs: string[];
  description: string;
  url: string;
  uncertainFields: string[];
}

const CURRENCY_CODES = /\b(USD|EUR|GBP|NGN|CAD|AUD|ZAR|JPY|CNY|INR|CHF|SEK|KES|GHS)\b/i;
const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD', '€': 'EUR', '£': 'GBP', '₦': 'NGN', '¥': 'JPY', '₹': 'INR',
};

/** The parser's one free-text amount split into the catalog's three columns. */
function splitAmount(text: string): Pick<ScholarshipDraft, 'amountCurrency' | 'amountValue' | 'amountType'> {
  const lower = text.toLowerCase();
  const amountType = /\bfull(y)?\b|100%|all (tuition|costs)/.test(lower) ? 'full'
    : /\bpartial\b|up to|towards/.test(lower) ? 'partial'
      : /\bstipend\b|monthly|living (allowance|cost)/.test(lower) ? 'stipend'
        : 'unknown';

  const code = text.match(CURRENCY_CODES)?.[1]?.toUpperCase();
  const symbol = Object.keys(CURRENCY_SYMBOLS).find((mark) => text.includes(mark));
  const digits = text.match(/(\d[\d,]*(?:\.\d+)?)/)?.[1] ?? '';

  return {
    amountCurrency: code ?? (symbol ? CURRENCY_SYMBOLS[symbol] : 'USD'),
    amountValue: digits.replace(/,/g, ''),
    amountType,
  };
}

/** The parser's field names, in catalog terms, for the amber outlines. */
const UNCERTAIN_FIELDS: Record<string, string> = {
  url: 'sourceUrl',
  amount: 'amountValue',
  degreeLevel: 'degreeLevels',
};

function toDraft(parsed: Partial<ParsedDraft>): ScholarshipDraft {
  return {
    ...EMPTY_DRAFT,
    ...splitAmount(parsed.amount ?? ''),
    title: parsed.title ?? '',
    funder: parsed.funder ?? '',
    country: parsed.country ?? '',
    deadline: parsed.deadline ?? '',
    degreeLevels: (parsed.degreeLevel ?? '')
      .split(/[,;/]|\band\b/)
      .map((level) => level.trim())
      .filter(Boolean),
    eligibility: parsed.eligibility ?? [],
    requiredDocs: parsed.requiredDocs ?? [],
    description: parsed.description ?? '',
    sourceUrl: parsed.url ?? '',
  };
}

/**
 * Add a scholarship to the catalog by hand.
 *
 * The same two ways in as Discover's [AddOpportunityModal](app/components/AddOpportunityModal.tsx)
 * — name it and let the AI research it, or paste the page when the search cannot
 * reach it — landing on the same editable confirm step. The difference is where it
 * goes: a student's addition is theirs alone in Firestore, this one is published to
 * every student, so the server re-checks the source URL and deadline before storing.
 *
 * Starting from a blank form is the third way in: skip both AI paths and type it.
 */
export default function AdminAddScholarship({ open, onClose, onAdded }: AdminAddScholarshipProps) {
  const { request } = useAdminApi();
  const [step, setStep] = useState<'input' | 'confirm'>('input');
  const [mode, setMode] = useState<'search' | 'paste'>('search');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<ScholarshipDraft>(EMPTY_DRAFT);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function handleClose() {
    setStep('input');
    setMode('search');
    setName('');
    setText('');
    setDraft(EMPTY_DRAFT);
    setHighlight([]);
    setSources([]);
    setError(null);
    setBusy(false);
    onClose();
  }

  function accept(parsed: Partial<ParsedDraft>, readFrom: string[]) {
    setDraft(toDraft(parsed));
    setHighlight((parsed.uncertainFields ?? []).map((field) => UNCERTAIN_FIELDS[field] ?? field));
    setSources(readFrom);
    setStep('confirm');
  }

  /** Both AI paths are the app's public endpoints — no admin token involved. */
  async function extract(path: string, body: unknown, failure: string) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || failure);
      accept(data.draft ?? {}, data.sources ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setError(null);
    setBusy(true);
    const response = await request<{ scholarship: CatalogRow }>('/api/admin/scholarships', {
      method: 'POST',
      body: JSON.stringify({ fields: draft }),
    });
    setBusy(false);
    if (!response.ok || !response.data) {
      setError(response.error);
      return;
    }
    onAdded(response.data.scholarship);
    handleClose();
  }

  const tabClass = (active: boolean) =>
    `flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition-colors ${
      active ? 'surface text-primary shadow-sm' : 'text-secondary hover:text-primary'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm p-0 md:p-4">
      <div className="surface w-full md:max-w-lg rounded-t-3xl md:rounded-3xl max-h-[92dvh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 surface flex items-center justify-between px-5 py-4 border-b border-[var(--border)] z-10">
          <h2 className="text-base font-extrabold text-primary">
            {step === 'input' ? 'Add to the catalog' : 'Check the details'}
          </h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-tertiary hover:bg-[var(--surface-muted)]"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
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

          {step === 'input' ? (
            <>
              <div className="flex gap-1 p-1 rounded-xl surface-muted">
                <button onClick={() => { setMode('search'); setError(null); }} className={tabClass(mode === 'search')}>
                  <Search className="w-3.5 h-3.5" />
                  Search by name
                </button>
                <button onClick={() => { setMode('paste'); setError(null); }} className={tabClass(mode === 'paste')}>
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  Paste listing
                </button>
              </div>

              {mode === 'search' ? (
                <>
                  <p className="text-sm text-secondary">
                    Name the scholarship and the AI will look it up online — deadline, eligibility,
                    and the page to apply on.
                  </p>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !busy && name.trim().length >= 3) {
                        extract('/api/opportunities/search', { name }, 'Could not find that scholarship.');
                      }
                    }}
                    placeholder="e.g. Chevening Scholarship"
                    className="input"
                    autoFocus
                  />
                  <button
                    onClick={() => extract('/api/opportunities/search', { name }, 'Could not find that scholarship.')}
                    disabled={busy || name.trim().length < 3}
                    className="w-full btn-primary justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Searching the web…
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Find it for me
                      </>
                    )}
                  </button>
                  {busy && (
                    <p className="text-xs text-tertiary text-center">
                      Reading the funder&apos;s page. This can take up to a minute.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-secondary">
                    Copy the funder&apos;s page and paste it below — useful when the search cannot
                    reach it, or the details live in a PDF.
                  </p>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={10}
                    placeholder="Paste the scholarship page text here…"
                    className="input resize-none text-sm"
                  />
                  <button
                    onClick={() => extract('/api/opportunities/parse', { text }, 'Could not read that listing.')}
                    disabled={busy || text.trim().length < 40}
                    className="w-full btn-primary justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Reading the listing…
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Extract details
                      </>
                    )}
                  </button>
                </>
              )}

              <button
                onClick={() => { setDraft(EMPTY_DRAFT); setHighlight([]); setSources([]); setStep('confirm'); }}
                className="w-full btn-ghost justify-center text-sm"
              >
                <Plus className="w-4 h-4" />
                Fill it in myself
              </button>
            </>
          ) : (
            <>
              {highlight.length > 0 && (
                <div
                  className="p-3 rounded-xl text-xs font-semibold flex items-start gap-2"
                  style={{ backgroundColor: 'var(--amber-fade)', color: 'var(--amber)' }}
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Check the highlighted fields — they were not clearly stated in the source.
                  </span>
                </div>
              )}

              {sources.length > 0 && (
                <div className="text-xs text-secondary">
                  <span className="font-bold text-tertiary uppercase tracking-wide">Read from</span>
                  <ul className="mt-1.5 space-y-1">
                    {sources.map((src) => (
                      <li key={src} className="truncate">
                        <a
                          href={src}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                          style={{ color: 'var(--primary)' }}
                        >
                          {src}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <ScholarshipForm draft={draft} onChange={setDraft} highlight={highlight} />

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setStep('input')}
                  className="px-4 py-2.5 text-sm font-bold text-secondary surface-muted hover:opacity-80 rounded-xl transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={publish}
                  disabled={busy || !isPublishable(draft)}
                  className="flex-1 btn-primary justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Publish to the catalog
                </button>
              </div>
              {!isPublishable(draft) && (
                <p className="text-xs text-tertiary">
                  Title, source URL, source type and deadline are all required.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
