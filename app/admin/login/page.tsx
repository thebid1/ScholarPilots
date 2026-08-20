'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { ArrowRight, Lock, Mail, ShieldCheck } from 'lucide-react';
import { getFirebaseAuth } from '@/lib/firebase/client';
import { useAuth } from '@/app/providers/AuthProvider';
import AppLogo from '@/app/components/AppLogo';
import SplashScreen from '@/app/components/SplashScreen';

/**
 * The reviewer's own sign-in page, at its own URL.
 *
 * Separate from [SignInScreen](app/components/SignInScreen.tsx) on purpose, and
 * not a variant of it: a student session does not carry into `/admin`, so the two
 * are different acts with different consequences and they get different doors.
 * Nothing links here — the address is the only way in, which also means a student
 * never sees a hint that a review desk exists.
 *
 * Password only. Reviewer accounts are created by hand in the Firebase console,
 * so there is no sign-up path here and nothing to verify by email — the account
 * either exists and is on `ADMIN_EMAILS`, or the server refuses it. The gate
 * itself lives on the server ([lib/admin/auth.ts](lib/admin/auth.ts)); this page
 * only obtains a token, and being able to sign in here proves nothing about being
 * allowed to approve.
 *
 * It never redirects on its own — only after a sign-in it performed. An automatic
 * "already signed in, go to /admin" bounce would ping-pong forever against an
 * `/admin` that is redirecting here because the server refused that same session.
 */

function messageFor(code: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address does not look right.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password is incorrect.';
    case 'auth/user-disabled':
      return 'That account has been disabled in Firebase.';
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is not enabled for this Firebase project. Turn it on under '
        + 'Authentication → Sign-in method.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}

function codeOf(error: unknown): string {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
}

export default function AdminLoginPage() {
  const router = useRouter();
  const { user, loading, configured, signOut } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A session already in the browser is the reauth case: the account is settled,
  // only the proof of presence is missing, so the address is fixed and read-only.
  const known = user?.email ?? null;
  const address = known ?? email;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const auth = getFirebaseAuth();
    if (!auth) return setError('Firebase is not configured on this deployment.');

    const typed = address.trim().toLowerCase();
    if (!typed.includes('@')) return setError('Please enter a valid email address.');
    if (!password) return setError('Please enter your password.');

    setError(null);
    setBusy(true);
    try {
      // Signing in again on an existing session replaces it and, crucially, resets
      // `auth_time` — which is the claim the server's freshness check reads.
      await signInWithEmailAndPassword(auth, typed, password);
      setPassword('');
      // A new `auth_time` only reaches the server through a newly minted token,
      // and `getIdToken()` will happily hand back the cached one.
      try {
        await auth.currentUser?.getIdToken(true);
      } catch {
        // Not fatal — /admin asks the server anyway and will send us back here.
      }
      router.replace('/admin');
    } catch (err) {
      setError(messageFor(codeOf(err)));
      setBusy(false);
    }
  }

  if (loading) return <SplashScreen />;

  return (
    <main className="min-h-[100dvh] flex flex-col" style={{ backgroundColor: 'var(--primary)' }}>
      <div className="relative flex-1 flex flex-col justify-end px-5 sm:px-6 pb-7 safe-top pt-8 overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3" />
        <div
          className="absolute bottom-0 left-0 w-48 h-48 rounded-full blur-3xl translate-y-1/3 -translate-x-1/3"
          style={{ backgroundColor: 'var(--primary-light)', opacity: 0.3 }}
        />

        <div className="relative z-10 max-w-md w-full mx-auto">
          <div className="flex items-center gap-3 text-white font-extrabold text-xl sm:text-2xl mb-3">
            <AppLogo size={56} className="bg-white shadow-lg" />
            ScholarPilot
          </div>
          <div className="inline-flex items-center gap-1.5 mb-3 px-2.5 py-1 rounded-full bg-white/15 text-white text-[11px] font-bold uppercase tracking-wide">
            <ShieldCheck className="w-3.5 h-3.5" />
            Reviewer access
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight mb-2">
            {known ? 'Confirm it’s you' : 'Reviewer sign in'}
          </h1>
          <p className="text-sm text-white/80">
            {known
              ? 'Reviewer sessions expire on their own, so approving again means proving it is still you.'
              : 'This desk is separate from a student account. Approving here is what puts a scholarship in front of students.'}
          </p>
        </div>
      </div>

      <div className="surface rounded-t-[32px] px-5 sm:px-6 pt-7 pb-8 safe-bottom shadow-[0_-8px_40px_rgba(0,0,0,0.12)]">
        <form onSubmit={submit} className="max-w-md w-full mx-auto space-y-4">
          {!configured && (
            <div
              className="p-3 rounded-xl text-sm font-bold border"
              style={{
                backgroundColor: 'var(--amber-fade)',
                borderColor: 'var(--amber)',
                color: 'var(--amber)',
              }}
            >
              Firebase is not configured on this deployment, so nobody can sign in.
            </div>
          )}

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

          <div>
            <label
              htmlFor="admin-email"
              className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5"
            >
              Reviewer email
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-tertiary" />
              <input
                id="admin-email"
                type="email"
                value={address}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={Boolean(known)}
                placeholder="you@example.com"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                className="input pl-11 read-only:opacity-70"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="admin-password"
              className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-tertiary" />
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="input pl-11"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy || !configured}
            className="w-full btn-primary justify-center disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? 'Checking…' : known ? 'Continue to the review desk' : 'Sign in'}
            {!busy && <ArrowRight className="w-4 h-4" />}
          </button>

          {known && (
            <button
              type="button"
              onClick={async () => {
                await signOut();
                setEmail('');
                setPassword('');
                setError(null);
              }}
              className="w-full btn-ghost justify-center text-sm"
            >
              Sign in as a different reviewer
            </button>
          )}

          <p className="text-xs text-tertiary text-center">
            Reviewer accounts are created in the Firebase console and listed in{' '}
            <span className="font-semibold">ADMIN_EMAILS</span>. There is no sign-up here.
          </p>
        </form>
      </div>
    </main>
  );
}
