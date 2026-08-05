'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Scholarship } from '@/app/types';
import { daysUntil } from '@/app/lib/mockData';
import {
  ChevronDown,
  ChevronUp,
  Calendar,
  Banknote,
  Award,
  FileText,
  CheckCircle,
  Plus,
  Crown,
  Globe,
  Landmark,
  CreditCard,
  GraduationCap,
  Leaf,
  Microscope,
  ArrowUpRight,
  Trash2,
  MessageCircle,
  LucideIcon,
} from 'lucide-react';

const iconMap: Record<string, LucideIcon> = {
  chevening: Crown,
  commonwealth: Globe,
  fulbright: Landmark,
  mastercard: CreditCard,
  daad: GraduationCap,
  heinrich: Leaf,
  vanier: Award,
  idrc: Microscope,
};

interface OpportunityCardProps {
  scholarship: Scholarship;
  isTracked: boolean;
  onTrack: () => void;
  /** Marks entries the user added themselves rather than catalog entries. */
  isUserAdded?: boolean;
  onRemove?: () => void;
}

export default function OpportunityCard({
  scholarship,
  isTracked,
  onTrack,
  isUserAdded = false,
  onRemove,
}: OpportunityCardProps) {
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  const days = daysUntil(scholarship.deadline);
  const Icon = iconMap[scholarship.id] || Award;

  /**
   * Hand the whole opportunity to chat, not just its id.
   *
   * The catalog lives in Postgres and user-added ones live in Firestore, so the
   * chat screen would otherwise need to know which source to look in. sessionStorage
   * carries it across the navigation and is read once on arrival; the id in the
   * query string is what makes the thread re-openable later.
   */
  function askAboutIt(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      sessionStorage.setItem('scholarpilot_chat_focus', JSON.stringify(scholarship));
    } catch {
      // Private mode or a full quota — chat falls back to a general thread.
    }
    router.push(`/chat?scholarship=${encodeURIComponent(scholarship.id)}`);
  }

  return (
    <div className="card overflow-hidden" style={{ borderLeftWidth: 4, borderLeftColor: 'var(--primary)' }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-4 flex items-start gap-4"
        aria-expanded={expanded}
      >
        <div className="w-12 h-12 rounded-xl gradient-emerald text-white flex items-center justify-center shrink-0 shadow-sm shadow-emerald-200">
          <Icon className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-primary leading-tight pr-2">{scholarship.title}</h3>
          <p className="text-xs text-secondary mt-0.5">{scholarship.funder}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-secondary px-2 py-1 rounded-md surface-muted">
              <Banknote className="w-3 h-3" />
              <span className="truncate max-w-[110px]">{scholarship.amount}</span>
            </span>
            <span className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md ${days <= 14 ? 'text-[var(--red)]' : days <= 45 ? 'text-[var(--amber)]' : 'text-secondary'} surface-muted`}>
              <Calendar className="w-3 h-3" />
              {days < 0 ? 'Closed' : days === 0 ? 'Due today' : `${days}d left`}
            </span>
            {isUserAdded && (
              <span
                className="text-[11px] font-bold px-2 py-1 rounded-md"
                style={{ backgroundColor: 'var(--primary-fade)', color: 'var(--primary)' }}
              >
                Added by you
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 pt-1 text-tertiary">
          {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-[var(--border)] pt-3">
          <p className="text-sm text-secondary mb-4 leading-relaxed">{scholarship.description}</p>

          <div className="mb-4">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-tertiary mb-2">
              <Award className="w-3.5 h-3.5" />
              Eligibility
            </div>
            <ul className="space-y-2">
              {scholarship.eligibility.map((item, i) => (
                <li key={i} className="text-sm text-secondary flex items-start gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: 'var(--primary)' }} />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="mb-4">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-tertiary mb-2">
              <FileText className="w-3.5 h-3.5" />
              Required documents
            </div>
            <ul className="space-y-2">
              {scholarship.requiredDocs.map((doc, i) => (
                <li key={i} className="text-sm text-secondary flex items-start gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: 'var(--primary)' }} />
                  {doc}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={askAboutIt}
              className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl text-sm font-bold transition-colors surface-muted text-primary hover:opacity-80"
            >
              <MessageCircle className="w-4 h-4" />
              Ask AI
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTrack();
              }}
              disabled={isTracked}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                isTracked
                  ? 'surface-muted text-[var(--primary)] cursor-default'
                  : 'btn-primary'
              }`}
            >
              {isTracked ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Tracked
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Track
                </>
              )}
            </button>
            <a
              href={scholarship.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl text-sm font-bold transition-colors"
              style={{ backgroundColor: 'var(--primary-fade)', color: 'var(--primary)' }}
            >
              Visit
              <ArrowUpRight className="w-4 h-4" />
            </a>
            {isUserAdded && onRemove && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                className="flex items-center justify-center px-3 py-3 rounded-xl text-tertiary hover:text-[var(--red)] surface-muted transition-colors"
                aria-label={`Delete ${scholarship.title}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
