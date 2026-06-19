'use client';

import { useState } from 'react';
import { UserSession } from '@/app/types';
import { Mail, Lock, ArrowRight } from 'lucide-react';
import AppLogo from './AppLogo';

interface SignInScreenProps {
  onSignIn: (session: UserSession) => void;
}

export default function SignInScreen({ onSignIn }: SignInScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !email.includes('@')) {
      return setError('Please enter a valid email address.');
    }
    if (password.length < 4) {
      return setError('Password must be at least 4 characters.');
    }

    setLoading(true);
    setTimeout(() => {
      onSignIn({ email: email.trim().toLowerCase() });
      setLoading(false);
    }, 600);
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
            Sign in
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
          <div>
            <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">Email</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-tertiary" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
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
                className="input pl-11"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary justify-center disabled:opacity-60 disabled:cursor-not-allowed mt-2"
          >
            {loading ? 'Signing in…' : 'Sign in'}
            {!loading && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>

        <p className="text-center text-xs text-tertiary mt-5">
          Demo mode — any email and 4+ character password works locally.
        </p>
      </div>
    </div>
  );
}
