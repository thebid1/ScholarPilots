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

(async () => {
  try {
    const { uid } = await auth.getUserByEmail(EMAIL);
    for (const sub of ['applications', 'opportunities']) {
      const snap = await db.collection(`users/${uid}/${sub}`).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
      console.log(`deleted ${snap.size} ${sub}`);
    }
    await db.doc(`users/${uid}`).delete();
    await auth.deleteUser(uid);
    console.log('deleted probe user', uid);
  } catch (e: any) {
    if (e.code === 'auth/user-not-found') console.log('no probe user — already clean');
    else throw e;
  }
  process.exit(0);
})();
