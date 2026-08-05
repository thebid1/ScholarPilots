import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!);
parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
const app = initializeApp({ credential: cert(parsed), projectId: parsed.project_id });
const db = getFirestore(app);
const auth = getAuth(app);

const EMAIL = 'e2e-probe@scholarpilot.test';

function isoInDays(n: number) {
  const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

(async () => {
  let uid: string;
  try {
    uid = (await auth.getUserByEmail(EMAIL)).uid;
    console.log('reusing probe user', uid);
  } catch {
    uid = (await auth.createUser({ email: EMAIL, password: 'probe-password-123' })).uid;
    console.log('created probe user', uid);
  }

  await db.doc(`users/${uid}`).set({
    profile: { id: uid, name: 'E2E Probe', email: EMAIL, country: 'Nigeria',
      degreeLevel: "Master's", fieldOfStudy: 'Computer Science', gpa: '3.8',
      careerGoal: 'Research', languages: ['English'] },
    // A fake token: FCM will reject it, which is exactly the pruning path we want to exercise.
    fcmTokens: { 'fake-token-for-pruning-test': { createdAt: new Date().toISOString(), userAgent: 'e2e' } },
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  const appsCol = db.collection(`users/${uid}/applications`);
  const existing = await appsCol.get();
  await Promise.all(existing.docs.map((d) => d.ref.delete()));

  // One inside the d7 window, one far out, one already closed.
  const rows = [
    { key: 'due-in-5',  deadline: isoInDays(5),   title: 'Probe Grant (5 days out)' },
    { key: 'due-in-40', deadline: isoInDays(40),  title: 'Probe Grant (40 days out)' },
    { key: 'closed',    deadline: isoInDays(-3),  title: 'Probe Grant (closed)' },
  ];
  for (const r of rows) {
    await appsCol.add({
      source: 'catalog', scholarshipId: `probe-${r.key}`,
      snapshot: { title: r.title, funder: 'Probe Foundation', country: 'Global',
        deadline: r.deadline, amount: '$1,000', url: 'https://example.com' },
      status: 'Discovered', healthScore: 50, milestones: [],
      createdAt: new Date().toISOString(), notified: {},
    });
  }
  console.log('seeded', rows.length, 'applications with deadlines:', rows.map(r => `${r.key}=${r.deadline}`).join(' '));
  console.log('UID=' + uid);
  process.exit(0);
})().catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });
