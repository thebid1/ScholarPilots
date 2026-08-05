import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, getAdminMessaging } from '@/lib/firebase/admin';

/**
 * Deadline reminder sweep, driven by the Render cron job (see render.yaml).
 *
 * Runs daily over the same rows, so every send is recorded in the application's
 * `notified` map and skipped on subsequent runs. Without that, a user gets the
 * same reminder every morning for a week.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Reminder windows, widest first — a 0-day-out application gets the d1 notice. */
const WINDOWS = [
  { flag: 'd7' as const, maxDays: 7, label: 'in 7 days' },
  { flag: 'd1' as const, maxDays: 1, label: 'tomorrow' },
];

interface Candidate {
  path: string;
  uid: string;
  title: string;
  deadline: string;
  days: number;
  flag: 'd7' | 'd1';
  label: string;
}

/** Whole-day difference in UTC, so a run at 08:00 and one at 23:00 agree. */
function daysUntilUtc(deadline: string, now: Date): number {
  const target = new Date(`${deadline}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return NaN;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target.getTime() - today) / 86_400_000);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set; refusing to run.');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getAdminDb();
  const messaging = getAdminMessaging();
  if (!db || !messaging) {
    return NextResponse.json({ error: 'Firebase Admin is not configured' }, { status: 503 });
  }

  const now = new Date();

  try {
    // A collectionGroup query needs a composite index once it filters and
    // orders; filtering in memory keeps this index-free, and the volume here is
    // one document per tracked application across all users.
    const snap = await db.collectionGroup('applications').get();

    const candidates: Candidate[] = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.status === 'Submitted') continue;

      const deadline = data.snapshot?.deadline;
      if (typeof deadline !== 'string' || !deadline) continue;

      const days = daysUntilUtc(deadline, now);
      if (Number.isNaN(days) || days < 0 || days > 7) continue;

      // Narrowest matching window wins, so a 1-day-out application says
      // "tomorrow" rather than "in 7 days".
      const window = [...WINDOWS].reverse().find((w) => days <= w.maxDays);
      if (!window) continue;
      if (data.notified?.[window.flag]) continue;

      // users/{uid}/applications/{id}
      const uid = doc.ref.parent.parent?.id;
      if (!uid) continue;

      candidates.push({
        path: doc.ref.path,
        uid,
        title: data.snapshot?.title ?? 'Your application',
        deadline,
        days,
        flag: window.flag,
        label: days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`,
      });
    }

    if (candidates.length === 0) {
      return NextResponse.json({ checked: snap.size, candidates: 0, sent: 0, skipped: 0, pruned: 0 });
    }

    // One token read per user, not per application.
    const uids = Array.from(new Set(candidates.map((c) => c.uid)));
    const tokensByUid = new Map<string, string[]>();
    await Promise.all(
      uids.map(async (uid) => {
        const userSnap = await db.collection('users').doc(uid).get();
        tokensByUid.set(uid, Object.keys(userSnap.data()?.fcmTokens ?? {}));
      })
    );

    let sent = 0;
    let skipped = 0;
    const staleTokens: { uid: string; token: string }[] = [];

    for (const c of candidates) {
      const tokens = tokensByUid.get(c.uid) ?? [];
      if (tokens.length === 0) {
        // No device registered. Leave `notified` alone so the reminder still
        // fires on a later run once the user opts in.
        skipped += 1;
        continue;
      }

      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: `${c.title} closes ${c.label}`,
          body: `Deadline ${c.deadline}. Open ScholarPilot to check your remaining milestones.`,
        },
        data: { url: '/applications', applicationId: c.path },
        webpush: {
          fcmOptions: { link: '/applications' },
        },
      });

      response.responses.forEach((r, i) => {
        const code = r.error?.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          staleTokens.push({ uid: c.uid, token: tokens[i] });
        }
      });

      if (response.successCount > 0) {
        sent += 1;
        await db.doc(c.path).update({ [`notified.${c.flag}`]: true });
      } else {
        skipped += 1;
      }
    }

    // Prune tokens FCM rejected. Dedupe first — the same dead device shows up
    // once per application it was notified about.
    const unique = new Map(staleTokens.map((s) => [`${s.uid}:${s.token}`, s]));
    await Promise.all(
      Array.from(unique.values()).map(({ uid, token }) =>
        db
          .collection('users')
          .doc(uid)
          .update({ [`fcmTokens.${token}`]: FieldValue.delete() })
          .catch(() => undefined)
      )
    );

    return NextResponse.json({
      checked: snap.size,
      candidates: candidates.length,
      sent,
      skipped,
      pruned: unique.size,
    });
  } catch (error) {
    console.error('[cron] Deadline sweep failed:', error);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
