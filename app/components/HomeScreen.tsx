'use client';

import { useRouter } from 'next/navigation';
import { daysUntil } from '@/app/lib/mockData';
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
import { useAuth } from '@/app/providers/AuthProvider';
import { useProfile } from '@/app/hooks/useProfile';
import { useApplications } from '@/app/hooks/useApplications';

export default function HomeScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { profile } = useProfile();
  const { applications } = useApplications();

  // Deadlines come from each application's own snapshot, so a user-added
  // opportunity counts here exactly like a catalog one.
  const open = applications
    .filter((a) => a.status !== 'Submitted' && daysUntil(a.snapshot.deadline) >= 0)
    .slice()
    .sort(
      (a, b) =>
        new Date(a.snapshot.deadline || '9999-12-31').getTime() -
        new Date(b.snapshot.deadline || '9999-12-31').getTime()
    );

  const nextUp = open[0] ?? null;

  const trackedCount = applications.length;
  const submittedCount = applications.filter((a) => a.status === 'Submitted').length;
  const dueSoonCount = open.filter((a) => daysUntil(a.snapshot.deadline) <= 14).length;

  async function handleSignOut() {
    if (typeof window !== 'undefined' && confirm('Sign out of ScholarPilot?')) {
      await signOut();
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
              {nextUp ? 'Next deadline' : 'Ready to start?'}
            </p>
            <h2 className="text-2xl font-extrabold mb-2">
              {nextUp ? nextUp.snapshot.title : 'Discover scholarships'}
            </h2>
            <p className="text-sm text-white/90 mb-4">
              {nextUp
                ? `Due ${new Date(nextUp.snapshot.deadline).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}`
                : 'Browse what is open right now and track what interests you.'}
            </p>
            <button
              onClick={() => router.push(nextUp ? '/applications' : '/opportunities')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white font-bold text-sm shadow-md transition-transform active:scale-95"
              style={{ color: 'var(--primary)' }}
            >
              {nextUp ? 'View pipeline' : 'Browse opportunities'}
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
              <p className="text-xs text-tertiary mt-0.5">See what&apos;s open now</p>
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
