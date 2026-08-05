import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!);
parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
const db = getFirestore(initializeApp({ credential: cert(parsed), projectId: parsed.project_id }));

(async () => {
  const [, , uid, action] = process.argv;
  const userSnap = await db.doc(`users/${uid}`).get();
  const tokens = Object.keys(userSnap.data()?.fcmTokens ?? {});
  console.log('fcmTokens remaining:', tokens.length, tokens);

  const apps = await db.collection(`users/${uid}/applications`).get();
  for (const d of apps.docs) {
    const x = d.data();
    console.log(`  ${x.snapshot.deadline}  notified=${JSON.stringify(x.notified ?? {})}  ${x.snapshot.title}`);
  }

  if (action === 'mark-sent') {
    const target = apps.docs.find((d) => d.data().snapshot.title.includes('5 days'));
    await target!.ref.update({ 'notified.d7': true });
    console.log('\nsimulated a successful d7 send on the 5-day row');
  }
  process.exit(0);
})();
