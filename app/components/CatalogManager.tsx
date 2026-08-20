'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check, ExternalLink, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, X,
} from 'lucide-react';
import AdminAddScholarship from '@/app/components/AdminAddScholarship';
import ScholarshipForm, {
  draftFromRow, isPublishable, type ScholarshipDraft,
} from '@/app/components/ScholarshipForm';
import { useAdminApi } from '@/app/hooks/useAdminApi';
import type { CatalogCounts, CatalogRow } from '@/lib/admin/catalog';

interface CatalogManagerProps {
  /** Surfaces a one-line confirmation in the page's toast. */
  onNotice: (message: string) => void;
}

/**
 * The published catalog: every row, editable and deletable, plus the manual add.
 *
 * Expired and hidden rows are listed alongside the live ones. Students never see
 * them — `/api/scholarships` filters on `is_active` and the deadline — which is
 * exactly why this screen has to, or a stale row is invisible to the one person
 * who can fix it.
 */
export default function CatalogManager({ onNotice }: CatalogManagerProps) {
  const { request } = useAdminApi();

  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [counts, setCounts] = useState<CatalogCounts>({ total: 0, active: 0, expired: 0 });
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScholarshipDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    const response = await request<{ scholarships: CatalogRow[]; counts: CatalogCounts }>(
      `/api/admin/scholarships?search=${encodeURIComponent(term)}`
    );
    if (response.ok && response.data) {
      setRows(response.data.scholarships);
      setCounts(response.data.counts);
    } else {
      setError(response.error);
    }
    setLoading(false);
  }, [request]);

  useEffect(() => {
    load(query);
  }, [load, query]);

  function startEdit(row: CatalogRow) {
    setEditing(row.external_id);
    setDraft(draftFromRow(row));
    setConfirmDelete(null);
    setRowError(null);
  }

  function stopEdit() {
    setEditing(null);
    setDraft(null);
  }

  async function saveEdit(externalId: string) {
    if (!draft) return;
    setRowError(null);
    setBusy(externalId);
    const response = await request<{ scholarship: CatalogRow }>(
      `/api/admin/scholarships/${encodeURIComponent(externalId)}`,
      { method: 'PATCH', body: JSON.stringify({ fields: draft }) }
    );
    setBusy(null);
    if (!response.ok || !response.data) {
      setRowError(response.error);
      return;
    }
    const saved = response.data.scholarship;
    setRows((current) => current.map((row) => (row.external_id === externalId ? saved : row)));
    stopEdit();
    onNotice('Saved.');
  }

  async function remove(externalId: string) {
    setRowError(null);
    setBusy(externalId);
    const response = await request(
      `/api/admin/scholarships/${encodeURIComponent(externalId)}`,
      { method: 'DELETE' }
    );
    setBusy(null);
    if (!response.ok) {
      setRowError(response.error);
      return;
    }
    setRows((current) => current.filter((row) => row.external_id !== externalId));
    setCounts((current) => ({ ...current, total: Math.max(0, current.total - 1) }));
    setConfirmDelete(null);
    onNotice('Deleted from the catalog.');
  }

  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-title">Catalog</h2>
          <button onClick={() => load(query)} className="btn-ghost text-xs" aria-label="Reload">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <dl className="grid grid-cols-3 gap-2 sm:gap-3 text-xs">
          <div className="surface-muted rounded-xl p-3">
            <dt className="text-tertiary font-bold uppercase tracking-wide">Rows</dt>
            <dd className="font-extrabold text-base" style={{ color: 'var(--primary)' }}>
              {counts.total.toLocaleString()}
            </dd>
          </div>
          <div className="surface-muted rounded-xl p-3">
            <dt className="text-tertiary font-bold uppercase tracking-wide">Live</dt>
            <dd className="font-extrabold text-base" style={{ color: 'var(--primary)' }}>
              {counts.active.toLocaleString()}
            </dd>
          </div>
          <div className="surface-muted rounded-xl p-3">
            <dt className="text-tertiary font-bold uppercase tracking-wide">Expired</dt>
            <dd className="font-extrabold text-base" style={{ color: 'var(--amber)' }}>
              {counts.expired.toLocaleString()}
            </dd>
          </div>
        </dl>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setQuery(search.trim());
              }}
              placeholder="Search title, funder or country"
              className="input pl-9"
            />
          </div>
          <button onClick={() => setQuery(search.trim())} className="btn-ghost justify-center text-sm">
            Search
          </button>
          <button onClick={() => setAdding(true)} className="btn-primary justify-center text-sm">
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </section>

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
          Loading the catalog…
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 sm:p-8 text-center space-y-2">
          <p className="text-sm font-bold text-primary">
            {query ? 'Nothing matches that search' : 'The catalog is empty'}
          </p>
          <p className="text-xs text-secondary">
            {query
              ? 'Try the funder’s name, or clear the search.'
              : 'Approve a submission, or add an award by hand.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const open = editing === row.external_id;
            const working = busy === row.external_id;
            return (
              <div key={row.external_id} className="card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2 sm:gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                      {!row.is_active && (
                        <span
                          className="badge"
                          style={{ backgroundColor: 'var(--surface-muted)', color: 'var(--text-secondary)' }}
                        >
                          hidden
                        </span>
                      )}
                      {row.expired && (
                        <span
                          className="badge"
                          style={{ backgroundColor: 'var(--amber-fade)', color: 'var(--amber)' }}
                        >
                          closed
                        </span>
                      )}
                      <span
                        className="badge"
                        style={{ backgroundColor: 'var(--surface-muted)', color: 'var(--text-secondary)' }}
                      >
                        {row.automated ? 'ingested' : 'by hand'}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-primary break-words">{row.title}</h3>
                    <p className="text-xs text-secondary mt-0.5 break-words">
                      {row.funder || 'Unknown funder'}
                      {row.country ? ` · ${row.country}` : ''}
                      {row.deadline ? ` · closes ${row.deadline}` : ' · no deadline'}
                    </p>
                    {row.source_url && (
                      <a
                        href={row.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs mt-1 max-w-full hover:underline"
                        style={{ color: 'var(--primary)' }}
                      >
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{row.source_url}</span>
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => (open ? stopEdit() : startEdit(row))}
                      className="btn-ghost"
                      aria-label={open ? 'Stop editing' : 'Edit'}
                    >
                      {open ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(row.external_id)}
                      disabled={working}
                      className="p-2 rounded-xl transition-colors disabled:opacity-60"
                      style={{ color: 'var(--red)', backgroundColor: 'var(--red-fade)' }}
                      aria-label="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {confirmDelete === row.external_id && (
                  <div
                    className="p-3 rounded-xl space-y-2"
                    style={{ backgroundColor: 'var(--red-fade)' }}
                  >
                    <p className="text-xs font-semibold" style={{ color: 'var(--red)' }}>
                      Delete this for good? Students tracking it keep their own copy, but it leaves
                      the catalog.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => remove(row.external_id)}
                        disabled={working}
                        className="px-3 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-60 inline-flex items-center gap-1.5"
                        style={{ backgroundColor: 'var(--red)' }}
                      >
                        {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        Delete
                      </button>
                      <button onClick={() => setConfirmDelete(null)} className="btn-ghost text-xs">
                        Keep it
                      </button>
                    </div>
                  </div>
                )}

                {open && draft && (
                  <div className="space-y-3 pt-1 border-t border-[var(--border)]">
                    <div className="pt-3">
                      <ScholarshipForm draft={draft} onChange={setDraft} />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={stopEdit}
                        className="px-4 py-2.5 text-sm font-bold text-secondary surface-muted hover:opacity-80 rounded-xl transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(row.external_id)}
                        disabled={working || !isPublishable(draft)}
                        className="flex-1 btn-primary justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {working ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Save changes
                      </button>
                    </div>
                    {!isPublishable(draft) && (
                      <p className="text-xs text-tertiary">
                        Title, source URL, source type and deadline are all required.
                      </p>
                    )}
                  </div>
                )}

                {rowError && (editing === row.external_id || confirmDelete === row.external_id) && (
                  <p className="text-xs font-bold" style={{ color: 'var(--red)' }}>{rowError}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AdminAddScholarship
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(row) => {
          // Adding an award that is already on file updates it rather than inserting,
          // so the totals only move for one that was not there.
          const known = rows.some((r) => r.external_id === row.external_id);
          setRows((current) => [row, ...current.filter((r) => r.external_id !== row.external_id)]);
          if (!known) {
            setCounts((current) => ({
              ...current, total: current.total + 1, active: current.active + 1,
            }));
          }
          onNotice('Published to the catalog.');
        }}
      />
    </div>
  );
}
