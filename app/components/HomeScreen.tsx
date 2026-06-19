'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserProfile, Application, Scholarship } from '@/app/types';
import { getProfile, getApplications, saveProfile } from '@/app/lib/storage';
import { useScholarships } from '@/app/lib/scholarships';
import {
  Search,
  ClipboardList,
  MessageCircle,
  LogOut,
  ChevronRight,
  CalendarDays,
  Award,
  Briefcase,
} from 'lucide-react';
import ChatFAB from './ChatFAB';
import InstallPrompt from './InstallPrompt';

function findScholarship(id: string, list: Scholarship[]) {
  return list.find((s) => s.id === id);
}

function daysUntil(date: string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export default function HomeScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const { scholarships } = useScholarships();

  useEffect(() => {
    setProfile(getProfile());
    setApplications(getApplications());
  }, []);

  const upcoming = applications
    .slice()
    .sort(
      (a, b) =>
        new Date(findScholarship(a.scholarshipId, scholarships)?.deadline ?? '9999-12-31').getTime() -
        new Date(findScholarship(b.scholarshipId, scholarships)?.deadline ?? '9999-12-31').getTime()
    )[0];

  const upcomingScholarship = upcoming ? findScholarship(upcoming.scholarshipId, scholarships) : null;

  const trackedCount = applications.length;
  const submittedCount = applications.filter((a) => a.status === 'Submitted').length;
  const dueSoonCount = applications.filter((a) => {
    const s = findScholarship(a.scholarshipId, scholarships);
    if (!s) return false;
    const days = daysUntil(s.deadline);
    return days >= 0 && days <= 14 && a.status !== 'Submitted';
  }).length;

  function handleSignOut() {
    if (typeof window !== 'undefined' && confirm('Sign out and reset profile?')) {
      saveProfile(null as unknown as UserProfile);
      window.location.reload();
    }
  }

  const firstName = profile?.name?.split(' ')[0] ?? 'Scholar';

  return (
    <div className="min-h-[100dvh] flex flex-col page-bg">
      {/* Header */}
      <header className="sticky top-0 z-30 page-bg/80 backdrop-blur-md border-b border-[var(--border)]">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full gradient-emerald text-white flex items-center justify-center shadow-md font-extrabold text-sm">
              {firstName[0]?.toUpperCase() || 'S'}
            </div>
            <div>
              <p className="text-xs font-bold text-tertiary uppercase tracking-wide">Welcome back</p>
              <h1 className="text-lg font-extrabold text-primary leading-tight">{firstName}</h1>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="p-2.5 rounded-full border border-[var(--border)] text-secondary hover:bg-[var(--surface-muted)] transition-colors"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 pt-5 max-w-md mx-auto w-full space-y-5">
        <InstallPrompt />

        {/* Priority banner */}
        <section className="relative overflow-hidden rounded-3xl gradient-emerald text-white p-5 shadow-xl">
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <p className="text-xs font-bold uppercase tracking-wide text-white/80 mb-1">
              {upcomingScholarship ? 'Next deadline' : 'Ready to start?'}
            </p>
            <h2 className="text-2xl font-extrabold mb-2">
              {upcomingScholarship ? upcomingScholarship.title : 'Discover scholarships'}
            </h2>
            <p className="text-sm text-white/90 mb-4">
              {upcomingScholarship
                ? `Due ${new Date(upcomingScholarship.deadline).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}`
                : 'Let ScholarPilot match you with funded opportunities.'}
            </p>
            <button
              onClick={() => router.push(upcomingScholarship ? '/applications' : '/opportunities')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white font-bold text-sm shadow-md transition-transform active:scale-95"
              style={{ color: 'var(--primary)' }}
            >
              {upcomingScholarship ? 'View pipeline' : 'Find matches'}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </section>

        {/* Quick stats */}
        <section className="grid grid-cols-3 gap-3">
          <div className="card-soft p-3 text-center">
            <div className="w-8 h-8 mx-auto rounded-full flex items-center justify-center mb-2" style={{ backgroundColor: 'var(--primary-fade)', color: 'var(--primary)' }}>
              <ClipboardList className="w-4 h-4" />
            </div>
            <p className="text-xl font-extrabold text-primary">{trackedCount}</p>
            <p className="text-[10px] font-bold text-tertiary uppercase tracking-wide">Tracked</p>
          </div>
          <div className="card-soft p-3 text-center">
            <div className="w-8 h-8 mx-auto rounded-full flex items-center justify-center mb-2" style={{ backgroundColor: 'var(--amber-fade)', color: 'var(--amber)' }}>
              <CalendarDays className="w-4 h-4" />
            </div>
            <p className="text-xl font-extrabold text-primary">{dueSoonCount}</p>
            <p className="text-[10px] font-bold text-tertiary uppercase tracking-wide">Due soon</p>
          </div>
          <div className="card-soft p-3 text-center">
            <div className="w-8 h-8 mx-auto rounded-full flex items-center justify-center mb-2" style={{ backgroundColor: 'rgba(139,92,246,0.12)', color: 'var(--violet)' }}>
              <Award className="w-4 h-4" />
            </div>
            <p className="text-xl font-extrabold text-primary">{submittedCount}</p>
            <p className="text-[10px] font-bold text-tertiary uppercase tracking-wide">Submitted</p>
          </div>
        </section>

        {/* Actions */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-extrabold text-primary">Quick actions</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => router.push('/opportunities')}
              className="card-elevated p-4 text-left active:scale-[0.98] transition-transform"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: 'var(--primary-fade)', color: 'var(--primary)' }}>
                <Search className="w-5 h-5" />
              </div>
              <p className="font-extrabold text-primary text-sm">Find scholarships</p>
              <p className="text-xs text-tertiary mt-0.5">Matches based on profile</p>
            </button>
            <button
              onClick={() => router.push('/applications')}
              className="card-elevated p-4 text-left active:scale-[0.98] transition-transform"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: 'rgba(139,92,246,0.12)', color: 'var(--violet)' }}>
                <ClipboardList className="w-5 h-5" />
              </div>
              <p className="font-extrabold text-primary text-sm">Track applications</p>
              <p className="text-xs text-tertiary mt-0.5">Never miss a deadline</p>
            </button>
            <button
              onClick={() => router.push('/chat')}
              className="card-elevated p-4 text-left active:scale-[0.98] transition-transform"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: 'rgba(59,130,246,0.12)', color: 'var(--blue)' }}>
                <MessageCircle className="w-5 h-5" />
              </div>
              <p className="font-extrabold text-primary text-sm">Ask ScholarPilot</p>
              <p className="text-xs text-tertiary mt-0.5">SOPs, CVs, deadlines</p>
            </button>
            <button
              onClick={() => router.push('/chat?intent=review')}
              className="card-elevated p-4 text-left active:scale-[0.98] transition-transform"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: 'var(--amber-fade)', color: 'var(--amber)' }}>
                <Briefcase className="w-5 h-5" />
              </div>
              <p className="font-extrabold text-primary text-sm">Review CV</p>
              <p className="text-xs text-tertiary mt-0.5">Get tailored feedback</p>
            </button>
          </div>
        </section>
      </main>

      <ChatFAB />
    </div>
  );
}
