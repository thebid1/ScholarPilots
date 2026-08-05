'use client';

import { Bell, BellOff, Loader2, Smartphone } from 'lucide-react';
import { useNotifications } from '@/app/hooks/useNotifications';

/**
 * Deadline reminder opt-in, shown on the Pipeline screen.
 *
 * Deliberately a card the user taps rather than an on-load permission prompt:
 * a denied Notification permission is effectively permanent, and only a user
 * who has already tracked something has a reason to say yes.
 */
export default function NotificationOptIn() {
  const { permission, enabled, busy, error, enable, needsInstall } = useNotifications();

  if (permission === 'unsupported') return null;

  if (enabled) {
    return (
      <div className="card p-3 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'var(--primary-fade)', color: 'var(--primary)' }}
        >
          <Bell className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-primary">Reminders on</p>
          <p className="text-xs text-secondary">
            We&apos;ll nudge you 7 days and 1 day before each deadline.
          </p>
        </div>
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <div className="card p-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 surface-muted text-tertiary">
          <BellOff className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-primary">Reminders blocked</p>
          <p className="text-xs text-secondary">
            Allow notifications for this site in your browser settings, then reload.
          </p>
        </div>
      </div>
    );
  }

  if (needsInstall) {
    return (
      <div className="card p-3 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'var(--amber-fade)', color: 'var(--amber)' }}
        >
          <Smartphone className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-primary">Install to get reminders</p>
          <p className="text-xs text-secondary">
            On iPhone, add ScholarPilot to your home screen first — Safari only delivers
            notifications to installed apps.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-3 flex items-center gap-3">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: 'var(--primary-fade)', color: 'var(--primary)' }}
      >
        <Bell className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-primary">Deadline reminders</p>
        <p className="text-xs text-secondary">
          {error ?? 'Get a push notification 7 days and 1 day before each deadline.'}
        </p>
      </div>
      <button
        onClick={enable}
        disabled={busy}
        className="btn-primary text-xs px-3 py-2 rounded-xl shrink-0 disabled:opacity-60"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Turn on'}
      </button>
    </div>
  );
}
