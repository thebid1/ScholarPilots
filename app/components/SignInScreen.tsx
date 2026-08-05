'use client';

import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { Mail, Lock, ArrowRight, User as UserIcon } from 'lucide-react';
import { getFirebaseAuth } from '@/lib/firebase/client';
import AppLogo from './AppLogo';

type Mode = 'signin' | 'signup';

/**
 * Firebase error codes are stable identifiers, not user-facing copy. Map the
 * ones a student can actually hit; fall through to a generic message rather
 * than leaking `auth/internal-error` into the UI.
 */
function messageFor(code: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address does not look right.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password is incorrect.';
    case 'auth/email-already-in-use':
      return 'An account already exists for that email. Try signing in.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export default function SignInScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isSignUp = mode === 'signup';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const auth = getFirebaseAuth();
    if (!auth) {
      return setError('Sign-in is unavailable — Firebase is not configured on this deployment.');
    }
    if (!email.trim() || !email.includes('@')) {
      return setError('Please enter a valid email address.');
    }
    // Firebase enforces 6 characters server-side; check first so the user gets
    // the message before a round trip.
    if (password.length < 6) {
      return setError('Password must be at least 6 characters.');
    }
    if (isSignUp && !name.trim()) {
      return setError('Please enter your name.');
    }

    setLoading(true);
    try {
      const address = email.trim().toLowerCase();
      if (isSignUp) {
        const cred = await createUserWithEmailAndPassword(auth, address, password);
        await updateProfile(cred.user, { displayName: name.trim() });
      } else {
        await signInWithEmailAndPassword(auth, address, password);
      }
      // No callback: AuthProvider's onAuthStateChanged listener swaps the screen.
    } catch (err) {
      const code = typeof err === 'object' && err && 'code' in err ? String(err.code) : '';
      setError(messageFor(code));
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col" style={{ backgroundColor: 'var(--primary)' }}>
      {/* Top section */}
      <div className="relative flex-1 flex flex-col justify-end px-6 pb-8 safe-top pt-6 overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full blur-3xl translate-y-1/3 -translate-x-1/3" style={{ backgroundColor: 'var(--primary-light)', opacity: 0.3 }} />

        <div className="relative z-10">
          <div className="flex items-center gap-3 text-white font-extrabold text-2xl mb-3">
            <AppLogo size={64} className="bg-white shadow-lg" />
            ScholarPilot
          </div>
          <h1 className="text-3xl font-extrabold text-white leading-tight mb-2">
            {isSignUp ? 'Create account' : 'Sign in'}
          </h1>
        </div>
      </div>

      {/* Form sheet */}
      <div className="surface rounded-t-[32px] px-6 pt-8 pb-8 safe-bottom shadow-[0_-8px_40px_rgba(0,0,0,0.12)]">
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm font-bold border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <div>
              <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">Name</label>
              <div className="relative">
                <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-tertiary" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  className="input pl-11"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">Email</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-tertiary" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="input pl-11"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-tertiary" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                className="input pl-11"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary justify-center disabled:opacity-60 disabled:cursor-not-allowed mt-2"
          >
            {loading
              ? isSignUp
                ? 'Creating account…'
                : 'Signing in…'
              : isSignUp
                ? 'Create account'
                : 'Sign in'}
            {!loading && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>

        <p className="text-center text-xs text-tertiary mt-5">
          {isSignUp ? 'Already have an account?' : 'New to ScholarPilot?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(isSignUp ? 'signin' : 'signup');
              setError(null);
            }}
            className="font-bold underline"
            style={{ color: 'var(--primary)' }}
          >
            {isSignUp ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>
    </div>
  );
}
