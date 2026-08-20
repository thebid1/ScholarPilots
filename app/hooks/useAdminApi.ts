'use client';

import { useCallback } from 'react';
import { useAuth } from '@/app/providers/AuthProvider';
import type { AdminDenialCode } from '@/lib/admin/auth';

/**
 * A fetch that carries the caller's Firebase ID token.
 *
 * The admin routes are the app's only authenticated API callers, and the token is
 * short-lived, so it is fetched per request rather than held in state —
 * `getIdToken()` returns the cached one until it is close to expiry and refreshes
 * transparently after that.
 *
 * `denied` carries the gate's own `code` rather than a guess from the status,
 * because the refusals need different screens: configure the deployment, use
 * another account, sign in again. Falling back to the status alone would collapse
 * them into one unhelpful "not allowed".
 */
export type AdminDenial = AdminDenialCode;

export interface AdminResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  denied: AdminDenial | null;
}

const DENIAL_CODES: AdminDenial[] = [
  'not_configured', 'no_token', 'not_admin', 'stale_session',
];

function denialFrom(body: unknown, status: number): AdminDenial | null {
  const code = (body as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && DENIAL_CODES.includes(code as AdminDenial)) {
    return code as AdminDenial;
  }
  // A route that fails before reaching the gate (or an HTML error page) still has
  // to land somewhere sensible.
  if (status === 503) return 'not_configured';
  if (status === 401 || status === 403) return 'no_token';
  return null;
}

export function useAdminApi() {
  const { user } = useAuth();

  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<AdminResponse<T>> => {
      if (!user) {
        return { ok: false, status: 401, data: null, error: 'Not signed in.', denied: 'no_token' };
      }

      let token: string;
      try {
        token = await user.getIdToken();
      } catch {
        return {
          ok: false, status: 401, data: null,
          error: 'Could not refresh your session. Sign in again.',
          denied: 'stale_session',
        };
      }

      try {
        const response = await fetch(path, {
          ...init,
          headers: {
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers,
            Authorization: `Bearer ${token}`,
          },
        });

        // A run can take minutes and an error page is not always JSON.
        const body = await response.json().catch(() => null);
        const error = typeof (body as { error?: unknown })?.error === 'string'
          ? (body as { error: string }).error
          : null;

        return {
          ok: response.ok,
          status: response.status,
          data: response.ok ? (body as T) : null,
          error: response.ok ? null : error ?? `Request failed (${response.status}).`,
          denied: response.ok ? null : denialFrom(body, response.status),
        };
      } catch (err) {
        return {
          ok: false, status: 0, data: null,
          error: err instanceof Error ? err.message : 'Network error.',
          denied: null,
        };
      }
    },
    [user]
  );

  return { request, signedIn: Boolean(user) };
}
