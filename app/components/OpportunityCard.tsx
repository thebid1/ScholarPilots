'use client';

import { useState } from 'react';
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
}

export default function OpportunityCard({ scholarship, isTracked, onTrack }: OpportunityCardProps) {
  const [expanded, setExpanded] = useState(false);
  const days = daysUntil(scholarship.deadline);
  const Icon = iconMap[scholarship.id] || Award;

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
              {days === 0 ? 'Due today' : `${days}d left`}
            </span>
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
          </div>
        </div>
      )}
    </div>
  );
}
