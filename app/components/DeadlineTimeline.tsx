'use client';

import { Milestone } from '@/app/types';
import { Calendar, Check } from 'lucide-react';

interface DeadlineTimelineProps {
  milestones: Milestone[];
  onToggle: (index: number) => void;
}

export default function DeadlineTimeline({ milestones, onToggle }: DeadlineTimelineProps) {
  const today = new Date();

  return (
    <div className="relative pl-2">
      <div className="absolute left-[17px] top-2 bottom-2 w-0.5" style={{ backgroundColor: 'var(--border)' }} />
      <div className="space-y-4">
        {milestones.map((m, idx) => {
          const due = new Date(m.dueDate);
          const isOverdue = due < today && !m.completed;
          const isDone = m.completed;
          return (
            <div key={m.label} className="relative flex items-start gap-3">
              <button
                onClick={() => onToggle(idx)}
                className={`relative z-10 mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                  isDone
                    ? 'text-white'
                    : isOverdue
                    ? 'border-[var(--red)] bg-transparent'
                    : 'border-tertiary bg-transparent hover:border-[var(--primary)]'
                }`}
                style={{ backgroundColor: isDone ? 'var(--primary)' : undefined, borderColor: isDone ? 'var(--primary)' : undefined }}
                aria-label={`Mark ${m.label} as ${isDone ? 'incomplete' : 'complete'}`}
              >
                {isDone && <Check className="w-3 h-3" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5">
                  <span className={`text-sm font-bold ${isDone ? 'text-tertiary line-through' : 'text-primary'}`}>
                    {m.label}
                  </span>
                  <span className={`text-xs flex items-center gap-1 shrink-0 ${isOverdue ? 'font-bold text-[var(--red)]' : isDone ? 'text-tertiary' : 'text-secondary'}`}>
                    <Calendar className="w-3 h-3" />
                    {m.dueDate}
                    {isOverdue && ' · overdue'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
