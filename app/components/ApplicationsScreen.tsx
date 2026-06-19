'use client';

import { useState } from 'react';
import { Application, ApplicationStatus } from '@/app/types';
import { getScholarshipById, daysUntil, computeHealthScore } from '@/app/lib/mockData';
import { useScholarships } from '@/app/lib/scholarships';
import DeadlineTimeline from './DeadlineTimeline';
import ScreenHeader from './ScreenHeader';
import ChatFAB from './ChatFAB';
import {
  ArrowRight,
  ChevronUp,
  Clock,
  MoreHorizontal,
  ClipboardCheck,
} from 'lucide-react';

interface ApplicationsScreenProps {
  applications: Application[];
  onUpdate: (apps: Application[]) => void;
}

const STATUS_ORDER: ApplicationStatus[] = ['Discovered', 'Tailoring', 'Documents Ready', 'Submitted'];

const STATUS_COLORS: Record<ApplicationStatus, string> = {
  Discovered: 'bg-[var(--surface-muted)] text-tertiary',
  Tailoring: 'text-[var(--primary)]',
  'Documents Ready': 'text-[var(--amber)]',
  Submitted: 'text-[var(--primary)]',
};

const STATUS_BG: Record<ApplicationStatus, string> = {
  Discovered: 'var(--surface-muted)',
  Tailoring: 'var(--primary-fade)',
  'Documents Ready': 'var(--amber-fade)',
  Submitted: 'var(--primary-fade)',
};

export default function ApplicationsScreen({ applications, onUpdate }: ApplicationsScreenProps) {
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);
  const { scholarships } = useScholarships();

  function advanceStatus(appId: string) {
    const updated = applications.map((a) => {
      if (a.id !== appId) return a;
      const currentIndex = STATUS_ORDER.indexOf(a.status);
      const nextIndex = Math.min(STATUS_ORDER.length - 1, currentIndex + 1);
      return { ...a, status: STATUS_ORDER[nextIndex] };
    });
    onUpdate(updated);
  }

  function toggleMilestone(appId: string, index: number) {
    const updated = applications.map((a) => {
      if (a.id !== appId) return a;
      const milestones = a.milestones.map((m, i) => (i === index ? { ...m, completed: !m.completed } : m));
      return { ...a, milestones, healthScore: computeHealthScore(milestones) };
    });
    onUpdate(updated);
  }

  return (
    <div className="space-y-4">
      <ScreenHeader title="Pipeline" subtitle={`${applications.length} application${applications.length === 1 ? '' : 's'}`} />

      {applications.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 surface-muted text-tertiary">
            <ClipboardCheck className="w-7 h-7" />
          </div>
          <p className="text-sm font-bold text-primary">No applications yet</p>
          <p className="text-xs text-secondary mt-1">Go to Discover and tap &quot;Track&quot;.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {applications.map((app) => {
            const s = getScholarshipById(app.scholarshipId, scholarships);
            if (!s) return null;
            const days = daysUntil(s.deadline);
            const isExpanded = expandedAppId === app.id;
            const isSubmitted = app.status === 'Submitted';
            return (
              <div key={app.id} className="card p-4 overflow-hidden" style={{ borderLeftWidth: 4, borderLeftColor: app.status === 'Submitted' ? 'var(--primary)' : app.status === 'Documents Ready' ? 'var(--amber)' : 'var(--primary)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-bold text-primary leading-snug pr-2">{s.title}</h4>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <span className="badge font-bold" style={{ backgroundColor: STATUS_BG[app.status], color: 'inherit' }}>
                        <span className={STATUS_COLORS[app.status]}>{app.status}</span>
                      </span>
                      <span className="text-[10px] text-secondary flex items-center gap-0.5 font-medium">
                        <Clock className="w-3 h-3" />
                        {days === 0 ? 'Due today' : `${days}d left`}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setExpandedAppId((id) => (id === app.id ? null : app.id))}
                    className="p-1.5 text-tertiary hover:bg-[var(--surface-muted)] rounded-lg shrink-0"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <MoreHorizontal className="w-4 h-4" />}
                  </button>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-secondary font-semibold">Health</span>
                    <span className={`font-bold ${app.healthScore >= 75 ? 'text-[var(--primary)]' : app.healthScore >= 40 ? 'text-[var(--amber)]' : 'text-[var(--red)]'}`}>
                      {app.healthScore}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden surface-muted">
                    <div
                      className={`h-full rounded-full transition-all ${app.healthScore >= 75 ? 'gradient-emerald' : app.healthScore >= 40 ? '' : ''}`}
                      style={{ width: `${app.healthScore}%`, backgroundColor: app.healthScore >= 75 ? undefined : app.healthScore >= 40 ? 'var(--amber)' : 'var(--red)' }}
                    />
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  {!isSubmitted && (
                    <button
                      onClick={() => advanceStatus(app.id)}
                      className="flex-1 flex items-center justify-center gap-1 btn-primary text-xs px-3 py-2.5 rounded-xl"
                    >
                      Advance
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={() => setExpandedAppId((id) => (id === app.id ? null : app.id))}
                    className="px-4 py-2.5 text-xs font-bold text-secondary surface-muted hover:opacity-80 rounded-xl transition-colors"
                  >
                    {isExpanded ? 'Hide' : 'Timeline'}
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-[var(--border)]">
                    <DeadlineTimeline milestones={app.milestones} onToggle={(idx) => toggleMilestone(app.id, idx)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ChatFAB />
    </div>
  );
}
