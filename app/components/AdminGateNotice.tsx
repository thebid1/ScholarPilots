'use client';

import Link from 'next/link';
import { LogOut, ShieldOff, UserX } from 'lucide-react';
import { useAuth } from '@/app/providers/AuthProvider';
import type { AdminDenial } from '@/app/hooks/useAdminApi';
import AppLogo from './AppLogo';

/**
 * The refusals that signing in again cannot fix.
 *
 * `no_token` and `stale_session` are not handled here — those are a sign-in
 * prompt, and `/admin` sends them to [/admin/login](app/admin/login/page.tsx)
 * instead. Putting them in a dead-end card is exactly the mistake this split
 * avoids. What is left are the two states with genuinely different remedies: use
 * a different account, or fix the deployment.
 */

interface AdminGateNoticeProps {
  code: Exclude<AdminDenial, 'no_token' | 'stale_session'>;
  /** The gate's own message, so the UI never contradicts the server. */
  message?: string | null;
}

export default function AdminGateNotice({ code, message }: AdminGateNoticeProps) {
  const { user, signOut } = useAuth();

  const content = {
    not_configured: {
      icon: <ShieldOff className="w-7 h-7" />,
      title: 'No reviewers are configured',
      body: 'This deployment has an empty ADMIN_EMAILS list, so the queue refuses every request '
        + '— an empty allowlist never means everyone. Set it and redeploy.',
    },
    not_admin: {
      icon: <UserX className="w-7 h-7" />,
      title: 'This account is not a reviewer',
      body: `${user?.email ?? 'This account'} is not on the reviewer list. Signing in again will `
        + 'not change that — use a reviewer account, or add this address to ADMIN_EMAILS.',
    },
  }[code];

  return (
    <main className="min-h-[100dvh] flex items-center justify-center px-5 sm:px-6 py-10 safe-top safe-bottom">
      <div className="w-full max-w-md space-y-5">
        <div className="flex items-center gap-2.5 justify-center">
          <AppLogo size={36} />
          <span className="font-extrabold text-primary">ScholarPilot</span>
        </div>

        <div className="card p-5 sm:p-6 space-y-4 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center gradient-emerald text-white shadow-md">
            {content.icon}
          </div>

          <div className="space-y-2">
            <h1 className="text-lg font-extrabold text-primary">{content.title}</h1>
            <p className="text-sm text-secondary text-balance">{content.body}</p>
            {message && <p className="text-xs text-tertiary">{message}</p>}
          </div>

          {code === 'not_admin' && (
            <div className="space-y-2">
              <button onClick={signOut} className="w-full btn-primary justify-center">
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
              <Link href="/admin/login" className="block w-full btn-ghost justify-center text-sm">
                Use a reviewer account
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
