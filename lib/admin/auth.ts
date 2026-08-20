/**
 * Who is allowed to approve a scholarship into the catalog.
 *
 * The dashboard is the only place data becomes visible to students, so the gate
 * on it holds a higher bar than the rest of the app:
 *
 *   1. `ADMIN_EMAILS` must be set. Unset means *nobody* is an admin, never
 *      everybody — reported as 503 (misconfigured) rather than 403 (wrong
 *      person), because those need different fixes.
 *   2. The email must be on the allowlist.
 *   3. The sign-in must be **recent**. A session that has been open for a week
 *      does not silently confer approval rights; the reviewer signs in again at
 *      `/admin/login`. This is what makes admin access its own act rather than an
 *      inherited side effect of being logged in, and it is why a forgotten
 *      session on a shared machine cannot publish to the catalog.
 *
 * Deliberately *not* checked: `email_verified`. Reviewer accounts are created by
 * hand in the Firebase console, which issues them unverified and sends nothing,
 * so requiring verification here would refuse every legitimate reviewer while
 * proving nothing extra — the allowlist is the real control, and an address only
 * reaches it by being typed into the deployment's own environment.
 *
 * Identity comes from the Firebase ID token the app already issues, so there is
 * no second credential store to breach — only a stricter reading of the same
 * token.
 */

import { NextResponse } from 'next/server';
import { verifyRequestToken } from '@/lib/firebase/admin';
import { configuredList, integerSetting } from '@/lib/ingestion/util';

export interface AdminIdentity {
  uid: string;
  email: string;
  /** `password`, `google.com`, … — what the reviewer actually authenticated with. */
  provider: string;
  /** Seconds since the reviewer last authenticated. */
  sessionAgeSeconds: number;
}

/**
 * Why a request was refused. The client shows a different screen for each,
 * because each has a different fix: configure the deployment, use another
 * account, or sign in again.
 */
export type AdminDenialCode =
  | 'not_configured'
  | 'no_token'
  | 'not_admin'
  | 'stale_session';

/** The configured allowlist, lowercased. Empty means the gate is shut. */
export function adminEmails(): string[] {
  return configuredList('ADMIN_EMAILS').map((email) => email.toLowerCase());
}

export function adminAccessConfigured(): boolean {
  return adminEmails().length > 0;
}

/**
 * How long after signing in a reviewer may still approve. Twelve hours by
 * default: long enough that nobody is bounced out of `/admin` mid-review with a
 * card full of hand-typed corrections, short enough that a session left open on
 * a borrowed laptop is dead by morning. Clamped to 5 minutes–7 days so a typo in
 * the env var cannot quietly switch the check off.
 */
export function adminSessionMaxAgeSeconds(): number {
  return integerSetting('ADMIN_SESSION_MAX_AGE_MINUTES', 720, 5, 10080) * 60;
}

export type AdminCheck =
  | { admin: AdminIdentity; code: null }
  | { admin: null; code: AdminDenialCode };

/**
 * Run every check in the order that leaks least while still being diagnosable.
 *
 * `not_admin` is decided *before* session freshness, so a signed-in student who
 * wanders onto `/admin` is never told anything about how reviewer sessions work.
 */
export async function checkAdmin(request: Request): Promise<AdminCheck> {
  if (!adminAccessConfigured()) return { admin: null, code: 'not_configured' };

  const token = await verifyRequestToken(request);
  if (!token) return { admin: null, code: 'no_token' };

  const email = (token.email ?? '').toLowerCase();
  if (!email || !adminEmails().includes(email)) return { admin: null, code: 'not_admin' };

  // `auth_time` is when the reviewer last proved who they were — not when this
  // token was minted. Firebase refreshes ID tokens hourly on its own, which is
  // exactly why expiry is no measure of how long a session has been sitting open.
  const authTime = Number(token.auth_time ?? 0);
  const sessionAgeSeconds = Math.max(0, Math.floor(Date.now() / 1000) - authTime);
  if (!authTime || sessionAgeSeconds > adminSessionMaxAgeSeconds()) {
    return { admin: null, code: 'stale_session' };
  }

  const provider = String(token.firebase?.sign_in_provider ?? 'unknown');
  return { admin: { uid: token.uid, email, provider, sessionAgeSeconds }, code: null };
}

const DENIALS: Record<AdminDenialCode, { status: number; error: string }> = {
  not_configured: {
    status: 503,
    error: 'Admin access is not configured on this deployment.',
  },
  no_token: {
    status: 401,
    error: 'Sign in to review submissions.',
  },
  not_admin: {
    status: 403,
    error: 'This account is not a reviewer.',
  },
  stale_session: {
    status: 401,
    error: 'Your reviewer session has expired. Sign in again to continue.',
  },
};

/**
 * The whole gate, as one call an admin route can start with.
 *
 * The status codes follow HTTP's own split: 401 means "authenticate again and
 * this may work" (no token, stale session), 403 means "we know exactly who you
 * are and the answer is no", 503 means no login will help because the deployment
 * has no reviewers at all. The body repeats the reason as a stable `code`, which
 * is what the UI switches on.
 */
export async function adminGate(
  request: Request
): Promise<{ admin: AdminIdentity; denied: null } | { admin: null; denied: NextResponse }> {
  const result = await checkAdmin(request);
  if (result.code === null) return { admin: result.admin, denied: null };

  if (result.code === 'not_configured') {
    console.error('[admin] ADMIN_EMAILS is not set; refusing every admin request.');
  }

  const { status, error } = DENIALS[result.code];
  return {
    admin: null,
    denied: NextResponse.json({ error, code: result.code }, { status }),
  };
}

/**
 * Kept for callers that only need a yes/no. Prefer `adminGate`, which can say
 * *why* — a null here cannot distinguish a student from a reviewer whose session
 * has simply been open too long.
 */
export async function requireAdmin(request: Request): Promise<AdminIdentity | null> {
  return (await checkAdmin(request)).admin;
}
