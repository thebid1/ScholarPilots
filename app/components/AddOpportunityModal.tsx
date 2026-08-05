'use client';

import { useState } from 'react';
import { Scholarship } from '@/app/types';
import { AlertTriangle, ClipboardPaste, Loader2, Search, Sparkles, X } from 'lucide-react';

interface AddOpportunityModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (opportunity: Omit<Scholarship, 'id'>) => Promise<void>;
}

interface Draft extends Omit<Scholarship, 'id'> {
  uncertainFields: string[];
}

const EMPTY: Draft = {
  title: '',
  funder: '',
  country: '',
  degreeLevel: '',
  amount: '',
  deadline: '',
  eligibility: [],
  requiredDocs: [],
  description: '',
  url: '',
  uncertainFields: [],
};

/**
 * Add an opportunity the user found elsewhere.
 *
 * Two ways in: name the scholarship and let the AI research it online, or paste
 * the listing when the search can't reach it (bot walls, PDFs, intranets).
 * Both land on the same editable confirm step.
 *
 * The confirm step is not optional. AI output is never saved directly — a
 * hallucinated deadline in a deadline-tracking app is the one error that
 * actually costs the user something.
 */
export default function AddOpportunityModal({ open, onClose, onSave }: AddOpportunityModalProps) {
  const [step, setStep] = useState<'input' | 'confirm'>('input');
  const [mode, setMode] = useState<'search' | 'paste'>('search');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [sources, setSources] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setStep('input');
    setMode('search');
    setName('');
    setText('');
    setDraft(EMPTY);
    setSources([]);
    setError(null);
    setBusy(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  /** Research the scholarship online from its name alone. */
  async function handleSearch() {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/opportunities/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not find that scholarship.');
      setDraft({ ...EMPTY, ...data.draft });
      setSources(data.sources ?? []);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not find that scholarship.');
    } finally {
      setBusy(false);
    }
  }

  async function handleParse() {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/opportunities/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not read that listing.');
      setDraft({ ...EMPTY, ...data.draft });
      setSources([]);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that listing.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setError(null);
    if (!draft.title.trim()) return setError('Give the opportunity a title.');
    if (!draft.deadline) return setError('A deadline is required — it is what reminders run on.');

    setBusy(true);
    try {
      // uncertainFields is a UI hint from the parser, not part of the record.
      const opportunity: Omit<Scholarship, 'id'> = {
        title: draft.title.trim(),
        funder: draft.funder.trim(),
        country: draft.country.trim(),
        degreeLevel: draft.degreeLevel.trim(),
        amount: draft.amount.trim(),
        deadline: draft.deadline,
        eligibility: draft.eligibility,
        requiredDocs: draft.requiredDocs,
        description: draft.description.trim(),
        url: draft.url.trim(),
      };
      await onSave(opportunity);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
      setBusy(false);
    }
  }

  const uncertain = (field: string) => draft.uncertainFields.includes(field);

  /** Fields the model flagged get an amber border so the eye lands there first. */
  const fieldClass = (field: string) =>
    `input ${uncertain(field) ? 'border-[var(--amber)]' : ''}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm p-0 md:p-4">
      <div className="surface w-full md:max-w-lg rounded-t-3xl md:rounded-3xl max-h-[92dvh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 surface flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-base font-extrabold text-primary">
            {step === 'input' ? 'Add an opportunity' : 'Check the details'}
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
            <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm font-bold border border-red-100">
              {error}
            </div>
          )}

          {step === 'input' ? (
            <>
              <div className="flex gap-1 p-1 rounded-xl surface-muted">
                <button
                  onClick={() => {
                    setMode('search');
                    setError(null);
                  }}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition-colors ${
                    mode === 'search'
                      ? 'surface text-primary shadow-sm'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  <Search className="w-3.5 h-3.5" />
                  Search by name
                </button>
                <button
                  onClick={() => {
                    setMode('paste');
                    setError(null);
                  }}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition-colors ${
                    mode === 'paste'
                      ? 'surface text-primary shadow-sm'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  Paste listing
                </button>
              </div>

              {mode === 'search' ? (
                <>
                  <p className="text-sm text-secondary">
                    Name the scholarship and ScholarPilot will look it up online — deadline,
                    eligibility, and the link to apply.
                  </p>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !busy && name.trim().length >= 3) handleSearch();
                    }}
                    placeholder="e.g. Chevening Scholarship"
                    className="input"
                    autoFocus
                  />
                  <button
                    onClick={handleSearch}
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
                    Copy the listing and paste it below — useful when the page is behind a login or
                    the search can&apos;t reach it.
                  </p>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={10}
                    placeholder="Paste the scholarship page text here…"
                    className="input resize-none text-sm"
                  />
                  <button
                    onClick={handleParse}
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
            </>
          ) : (
            <>
              {draft.uncertainFields.length > 0 && (
                <div
                  className="p-3 rounded-xl text-xs font-semibold flex items-start gap-2"
                  style={{ backgroundColor: 'var(--amber-fade)', color: 'var(--amber)' }}
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Double-check the highlighted fields — they weren&apos;t clearly stated in the
                    source.
                  </span>
                </div>
              )}

              {sources.length > 0 && (
                <div className="text-xs text-secondary">
                  <span className="font-bold text-tertiary uppercase tracking-wide">
                    Read from
                  </span>
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

              <div>
                <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">
                  Title
                </label>
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className={fieldClass('title')}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">
                    Funder
                  </label>
                  <input
                    value={draft.funder}
                    onChange={(e) => setDraft({ ...draft, funder: e.target.value })}
                    className={fieldClass('funder')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">
                    Country
                  </label>
                  <input
                    value={draft.country}
                    onChange={(e) => setDraft({ ...draft, country: e.target.value })}
                    className={fieldClass('country')}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">
                  Deadline
                </label>
                {/* Date input, never free text: this value drives the reminder cron. */}
                <input
                  type="date"
                  value={draft.deadline}
                  onChange={(e) => setDraft({ ...draft, deadline: e.target.value })}
                  className={fieldClass('deadline')}
                />
                {uncertain('deadline') && (
                  <p className="text-xs mt-1.5 font-semibold" style={{ color: 'var(--amber)' }}>
                    No confirmed deadline — set it yourself.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">
                    Degree level
                  </label>
                  <input
                    value={draft.degreeLevel}
                    onChange={(e) => setDraft({ ...draft, degreeLevel: e.target.value })}
                    className={fieldClass('degreeLevel')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">
                    Amount
                  </label>
                  <input
                    value={draft.amount}
                    onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                    className={fieldClass('amount')}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">
                  Link
                </label>
                <input
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                  placeholder="https://…"
                  className={fieldClass('url')}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">
                  Eligibility (one per line)
                </label>
                <textarea
                  value={draft.eligibility.join('\n')}
                  onChange={(e) =>
                    setDraft({ ...draft, eligibility: e.target.value.split('\n').filter(Boolean) })
                  }
                  rows={3}
                  className={`${fieldClass('eligibility')} resize-none text-sm`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">
                  Required documents (one per line)
                </label>
                <textarea
                  value={draft.requiredDocs.join('\n')}
                  onChange={(e) =>
                    setDraft({ ...draft, requiredDocs: e.target.value.split('\n').filter(Boolean) })
                  }
                  rows={3}
                  className={`${fieldClass('requiredDocs')} resize-none text-sm`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">
                  Description
                </label>
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  rows={3}
                  className={`${fieldClass('description')} resize-none text-sm`}
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setStep('input')}
                  className="px-4 py-2.5 text-sm font-bold text-secondary surface-muted hover:opacity-80 rounded-xl transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSave}
                  disabled={busy}
                  className="flex-1 btn-primary justify-center disabled:opacity-60"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save opportunity'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
