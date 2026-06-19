'use client';

import { useState } from 'react';
import { Search, PenLine, CalendarCheck, ChevronRight } from 'lucide-react';
import AppLogo from './AppLogo';

interface OnboardingScreenProps {
  onStart: () => void;
}

const slides = [
  {
    icon: Search,
    accent: 'from-emerald-400 to-emerald-600',
    bg: 'var(--primary-fade)',
    shadow: 'shadow-emerald-200',
    title: 'Find your perfect scholarship',
    description: 'We match you with funding opportunities based on your field, degree, and destination.',
  },
  {
    icon: PenLine,
    accent: 'from-violet-400 to-violet-600',
    bg: 'rgba(139,92,246,0.12)',
    shadow: 'shadow-violet-200',
    title: 'Tailor your application',
    description: 'Get AI help drafting SOPs and polishing your CV for each scholarship you target.',
  },
  {
    icon: CalendarCheck,
    accent: 'from-amber-400 to-amber-600',
    bg: 'var(--amber-fade)',
    shadow: 'shadow-amber-200',
    title: 'Never miss a deadline',
    description: 'Track every application with auto-generated milestones and a clear timeline.',
  },
];

export default function OnboardingScreen({ onStart }: OnboardingScreenProps) {
  const [index, setIndex] = useState(0);
  const slide = slides[index];
  const SlideIcon = slide.icon;

  return (
    <div className="min-h-[100dvh] flex flex-col page-bg px-6 py-6">
      {/* Top bar */}
      <div className="safe-top flex items-center justify-between mb-6">
        <div className="flex items-center gap-2 font-extrabold text-lg" style={{ color: 'var(--primary)' }}>
          <AppLogo size={56} />
          ScholarPilot
        </div>
        <button onClick={() => setIndex(slides.length - 1)} className="text-sm font-bold text-tertiary hover:text-secondary">
          Skip
        </button>
      </div>

      {/* Slide content */}
      <div className="flex-1 flex flex-col justify-center">
        {/* Illustration */}
        <div className="relative w-full aspect-square max-w-[280px] mx-auto mb-8">
          <div className="absolute top-6 left-4 w-24 h-24 rounded-full blur-2xl opacity-70" style={{ backgroundColor: slide.bg }} />
          <div className="absolute bottom-8 right-4 w-32 h-32 rounded-full blur-2xl opacity-60" style={{ backgroundColor: slide.bg }} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-44 h-44 rounded-full surface-muted" />

          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className={`relative w-36 h-36 rounded-3xl bg-gradient-to-br ${slide.accent} ${slide.shadow} shadow-2xl flex items-center justify-center`}>
              <SlideIcon className="w-16 h-16 text-white" strokeWidth={1.5} />
            </div>
          </div>

          <div className={`absolute top-10 right-8 w-10 h-10 rounded-full bg-gradient-to-br ${slide.accent} opacity-20`} />
          <div className={`absolute bottom-16 left-6 w-6 h-6 rounded-full bg-gradient-to-br ${slide.accent} opacity-30`} />
        </div>

        {/* Text */}
        <div className="text-center max-w-xs mx-auto">
          <h2 className="text-[32px] font-extrabold leading-tight mb-3 text-primary">{slide.title}</h2>
          <p className="text-base text-secondary leading-relaxed">{slide.description}</p>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="mt-auto safe-bottom pb-2">
        <div className="flex items-center justify-center gap-2 mb-6">
          {slides.map((_, i) => {
            const active = i === index;
            return (
              <button
                key={i}
                onClick={() => setIndex(i)}
                className={`h-2 rounded-full transition-all duration-300 ${active ? `w-8 bg-gradient-to-r ${slide.accent}` : 'w-2 bg-[var(--border)]'}`}
                aria-label={`Go to slide ${i + 1}`}
              />
            );
          })}
        </div>

        {index < slides.length - 1 ? (
          <button
            onClick={() => setIndex((i) => i + 1)}
            className="w-full btn-primary justify-between"
          >
            Next
            <ChevronRight className="w-5 h-5" />
          </button>
        ) : (
          <button onClick={onStart} className="w-full btn-primary">
            Get started
          </button>
        )}
      </div>
    </div>
  );
}
