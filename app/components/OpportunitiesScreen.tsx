'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { UserProfile } from '@/app/types';
import { enrichScholarships } from '@/app/lib/mockData';
import { useScholarships } from '@/app/lib/scholarships';
import OpportunityCard from './OpportunityCard';
import ScreenHeader from './ScreenHeader';
import ChatFAB from './ChatFAB';
import {
  Search,
  SlidersHorizontal,
  Loader2,
  Database,
  AlertCircle,
  RefreshCw,
  Check,
  CalendarArrowDown,
  CalendarArrowUp,
  Star,
  Target,
} from 'lucide-react';

interface OpportunitiesScreenProps {
  profile: UserProfile;
  applications: { scholarshipId: string }[];
  onTrack: (scholarshipId: string) => void;
}

const FILTERS = [
  'All',
  'UK',
  'US',
  'Germany',
  'Canada',
  'Australia',
  'France',
  'Japan',
  'South Korea',
  'China',
  'Netherlands',
  'Sweden',
];

type SortOption = 'relevance' | 'deadline-asc' | 'deadline-desc' | 'tracking';

interface SortChoice {
  value: SortOption;
  label: string;
  icon: React.ElementType;
}

const SORT_CHOICES: SortChoice[] = [
  { value: 'relevance', label: 'Best match', icon: Target },
  { value: 'deadline-asc', label: 'Due soonest', icon: CalendarArrowDown },
  { value: 'deadline-desc', label: 'Due latest', icon: CalendarArrowUp },
  { value: 'tracking', label: 'Tracking first', icon: Star },
];

export default function OpportunitiesScreen({ profile, applications, onTrack }: OpportunitiesScreenProps) {
  const { scholarships, loading, error, source, rootHash, retry } = useScholarships();
  const enriched = useMemo(() => enrichScholarships(profile, scholarships), [profile, scholarships]);
  const trackedIds = useMemo(() => new Set(applications.map((a) => a.scholarshipId)), [applications]);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        sortMenuOpen &&
        sortMenuRef.current &&
        !sortMenuRef.current.contains(event.target as Node) &&
        sortButtonRef.current &&
        !sortButtonRef.current.contains(event.target as Node)
      ) {
        setSortMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sortMenuOpen]);

  const filtered = useMemo(() => {
    const result = enriched.filter((s) => {
      const matchesFilter = filter === 'All' || s.country === filter;
      const q = query.trim().toLowerCase();
      const matchesQuery =
        !q ||
        s.title.toLowerCase().includes(q) ||
        s.funder.toLowerCase().includes(q) ||
        s.country.toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });

    result.sort((a, b) => {
      switch (sortBy) {
        case 'deadline-asc':
          return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        case 'deadline-desc':
          return new Date(b.deadline).getTime() - new Date(a.deadline).getTime();
        case 'tracking': {
          const aTracked = trackedIds.has(a.id) ? 1 : 0;
          const bTracked = trackedIds.has(b.id) ? 1 : 0;
          if (aTracked !== bTracked) return bTracked - aTracked;
          return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
        }
        default:
          return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
      }
    });

    return result;
  }, [enriched, filter, query, sortBy, trackedIds]);

  const activeSortLabel = SORT_CHOICES.find((c) => c.value === sortBy)?.label ?? 'Sort';

  return (
    <div className="space-y-4">
      <ScreenHeader
        title="Discover"
        subtitle={`${filtered.length} scholarship${filtered.length === 1 ? '' : 's'} · ${activeSortLabel}`}
      />

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-tertiary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search scholarships..."
            className="input pl-9 py-2.5"
          />
        </div>
        <div className="relative">
          <button
            ref={sortButtonRef}
            onClick={() => setSortMenuOpen((open) => !open)}
            className={`p-2.5 rounded-xl surface-muted transition-colors ${
              sortMenuOpen ? 'text-[var(--primary)] bg-[var(--surface-muted)]' : 'text-secondary'
            }`}
            aria-label="Sort scholarships"
            aria-expanded={sortMenuOpen}
          >
            <SlidersHorizontal className="w-5 h-5" />
          </button>

          {sortMenuOpen && (
            <div
              ref={sortMenuRef}
              className="absolute right-0 top-full mt-2 w-48 card shadow-lg border border-[var(--border)] z-20 py-1"
            >
              {SORT_CHOICES.map((choice) => {
                const Icon = choice.icon;
                const active = sortBy === choice.value;
                return (
                  <button
                    key={choice.value}
                    onClick={() => {
                      setSortBy(choice.value);
                      setSortMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm transition-colors ${
                      active ? 'text-[var(--primary)] font-bold bg-[var(--surface-muted)]' : 'text-secondary hover:bg-[var(--surface-muted)]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="flex-1 text-left">{choice.label}</span>
                    {active && <Check className="w-4 h-4" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {FILTERS.map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold border transition-all ${
                active
                  ? 'text-white border-transparent shadow-sm'
                  : 'text-secondary border-[var(--border)] hover:border-[var(--primary)]'
              }`}
              style={{ backgroundColor: active ? 'var(--primary)' : undefined }}
            >
              {f}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="card p-3 flex items-center justify-between gap-3 text-xs text-secondary">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[var(--red)]" />
            <span>{error}</span>
          </div>
          <button onClick={retry} className="p-1.5 rounded-lg surface-muted hover:opacity-80">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {source === '0g' && rootHash && (
        <a
          href={`${process.env.NEXT_PUBLIC_OG_STORAGE_INDEXER}/file?root=${encodeURIComponent(rootHash)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="card p-3 flex items-center gap-2 text-xs text-secondary hover:bg-[var(--surface-muted)] transition-colors"
        >
          <Database className="w-4 h-4" style={{ color: 'var(--primary)' }} />
          <span>Catalog loaded from 0G Storage</span>
          <span className="ml-auto font-mono text-tertiary truncate max-w-[120px]">{rootHash.slice(0, 12)}…</span>
        </a>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-secondary">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--primary)' }} />
          Loading scholarships from 0G…
        </div>
      )}

      <div className="flex flex-col gap-3">
        {filtered.map((s) => (
          <OpportunityCard
            key={s.id}
            scholarship={s}
            isTracked={trackedIds.has(s.id)}
            onTrack={() => onTrack(s.id)}
          />
        ))}
      </div>

      <ChatFAB />
    </div>
  );
}
