import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { Auth, getAuth } from 'firebase-admin/auth';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { Messaging, getMessaging } from 'firebase-admin/messaging';

/**
 * Server-only Firebase access. Never import this from a client component — the
 * service account grants full read/write and bypasses security rules.
 */

let app: App | null = null;

function getAdminApp(): App | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  if (app) return app;

  try {
    // Render stores the key as a single-line JSON string. Some shells escape the
    // newlines inside private_key, so restore them before handing it to cert().
    const parsed = JSON.parse(raw);
    if (typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    app = getApps().length
      ? getApps()[0]
      : initializeApp({ credential: cert(parsed), projectId: parsed.project_id });
    return app;
  } catch (error) {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON is missing or malformed:', error);
    return null;
  }
}

export function getAdminAuth(): Auth | null {
  const a = getAdminApp();
  return a ? getAuth(a) : null;
}

export function getAdminDb(): Firestore | null {
  const a = getAdminApp();
  return a ? getFirestore(a) : null;
}

export function getAdminMessaging(): Messaging | null {
  const a = getAdminApp();
  return a ? getMessaging(a) : null;
}

/**
 * Resolves the caller's uid from an `Authorization: Bearer <idToken>` header.
 * Returns null for a missing, malformed, expired, or revoked token — routes
 * must treat null as 401 rather than falling back to a query parameter.
 */
export async function verifyRequest(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) return null;

  const auth = getAdminAuth();
  if (!auth) return null;

  try {
    const decoded = await auth.verifyIdToken(match[1], true);
    return decoded.uid;
  } catch {
    return null;
  }
}
