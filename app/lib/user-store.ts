import {
  DocumentData,
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { getDb } from '@/lib/firebase/client';
import {
  Application,
  ApplicationSnapshot,
  ChatMessage,
  ChatThread,
  Milestone,
  UserOpportunity,
  UserProfile,
} from '@/app/types';

/**
 * Firestore access for everything user-owned, scoped to `users/{uid}`.
 *
 * Layout:
 *   users/{uid}                      → { profile, fcmTokens }
 *   users/{uid}/applications/{id}    → Application
 *   users/{uid}/opportunities/{id}   → UserOpportunity
 *   users/{uid}/chats/{id}           → ChatThread
 *
 * Every function takes an explicit `uid` rather than reading auth state, so a
 * caller can never accidentally write to the wrong user's tree. Security rules
 * enforce the same boundary server-side.
 */

function db() {
  const instance = getDb();
  if (!instance) throw new Error('Firestore is not configured.');
  return instance;
}

const userDoc = (uid: string) => doc(db(), 'users', uid);
const applicationsCol = (uid: string) => collection(db(), 'users', uid, 'applications');
const opportunitiesCol = (uid: string) => collection(db(), 'users', uid, 'opportunities');
const chatsCol = (uid: string) => collection(db(), 'users', uid, 'chats');

/* ------------------------------------------------------------------ profile */

export async function fetchProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(userDoc(uid));
  const profile = snap.exists() ? (snap.data().profile as UserProfile | undefined) : undefined;
  return profile ?? null;
}

export async function saveProfile(uid: string, profile: UserProfile): Promise<void> {
  // merge: the same document also holds fcmTokens, which must survive a profile edit.
  await setDoc(userDoc(uid), { profile, updatedAt: new Date().toISOString() }, { merge: true });
}

/* --------------------------------------------------------------- fcm tokens */

export async function saveFcmToken(uid: string, token: string): Promise<void> {
  await setDoc(
    userDoc(uid),
    {
      fcmTokens: {
        [token]: {
          createdAt: new Date().toISOString(),
          userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
        },
      },
    },
    { merge: true }
  );
}

export async function removeFcmToken(uid: string, token: string): Promise<void> {
  await updateDoc(userDoc(uid), { [`fcmTokens.${token}`]: deleteField() });
}

/* ------------------------------------------------------------- applications */

/**
 * Firestore hands back Timestamps for anything written as one and plain values
 * for ISO strings. Normalize to ISO so the UI has a single shape to render.
 */
function toIso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function toApplication(id: string, data: DocumentData): Application {
  const snapshot = (data.snapshot ?? {}) as Partial<ApplicationSnapshot>;
  return {
    id,
    source: data.source === 'user' ? 'user' : 'catalog',
    scholarshipId: typeof data.scholarshipId === 'string' ? data.scholarshipId : null,
    snapshot: {
      title: snapshot.title ?? 'Untitled opportunity',
      funder: snapshot.funder ?? '',
      country: snapshot.country ?? '',
      deadline: snapshot.deadline ?? '',
      amount: snapshot.amount ?? 'TBD',
      url: snapshot.url ?? '',
    },
    status: data.status ?? 'Discovered',
    healthScore: typeof data.healthScore === 'number' ? data.healthScore : 0,
    milestones: Array.isArray(data.milestones) ? (data.milestones as Milestone[]) : [],
    createdAt: toIso(data.createdAt),
    updatedAt: data.updatedAt ? toIso(data.updatedAt) : undefined,
    notified: data.notified ?? {},
  };
}

export async function fetchApplications(uid: string): Promise<Application[]> {
  const snap = await getDocs(query(applicationsCol(uid), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => toApplication(d.id, d.data()));
}

/** Live subscription; returns the unsubscribe function. */
export function watchApplications(
  uid: string,
  onChange: (apps: Application[]) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    query(applicationsCol(uid), orderBy('createdAt', 'desc')),
    (snap) => onChange(snap.docs.map((d) => toApplication(d.id, d.data()))),
    (err) => onError?.(err)
  );
}

export async function addApplication(
  uid: string,
  application: Omit<Application, 'id'>
): Promise<string> {
  const ref = await addDoc(applicationsCol(uid), application);
  return ref.id;
}

export async function updateApplication(
  uid: string,
  id: string,
  patch: Partial<Omit<Application, 'id'>>
): Promise<void> {
  await updateDoc(doc(applicationsCol(uid), id), {
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteApplication(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(applicationsCol(uid), id));
}

/* ------------------------------------------------------ user opportunities */

export async function fetchUserOpportunities(uid: string): Promise<UserOpportunity[]> {
  const snap = await getDocs(query(opportunitiesCol(uid), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ ...(d.data() as UserOpportunity), id: d.id }));
}

export async function addUserOpportunity(
  uid: string,
  opportunity: Omit<UserOpportunity, 'id'>
): Promise<string> {
  const ref = await addDoc(opportunitiesCol(uid), opportunity);
  return ref.id;
}

export async function deleteUserOpportunity(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(opportunitiesCol(uid), id));
}

/* --------------------------------------------------------------- chat threads */

/**
 * Threads the list view renders. Messages are deliberately excluded: a user with
 * 20 conversations would otherwise pull every message of every one just to draw
 * a sidebar. The full thread is fetched on open.
 */
export interface ChatThreadSummary {
  id: string;
  title: string;
  scholarshipId?: string;
  updatedAt: string;
  messageCount: number;
}

/** Cap per thread. Old turns fall off rather than growing a document without bound. */
const MAX_STORED_MESSAGES = 200;
/** Threads listed in the picker. */
const MAX_THREADS = 50;

function toMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((m): m is DocumentData => !!m && typeof m === 'object')
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      content: typeof m.content === 'string' ? m.content : '',
      timestamp: toIso(m.timestamp),
    }));
}

export async function fetchChatThreads(uid: string): Promise<ChatThreadSummary[]> {
  const snap = await getDocs(
    query(chatsCol(uid), orderBy('updatedAt', 'desc'), limit(MAX_THREADS))
  );
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      title: typeof data.title === 'string' ? data.title : 'Untitled chat',
      scholarshipId: typeof data.scholarshipId === 'string' ? data.scholarshipId : undefined,
      updatedAt: toIso(data.updatedAt),
      messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
    };
  });
}

export async function fetchChatThread(uid: string, id: string): Promise<ChatThread | null> {
  const snap = await getDoc(doc(chatsCol(uid), id));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    id: snap.id,
    title: typeof data.title === 'string' ? data.title : 'Untitled chat',
    scholarshipId: typeof data.scholarshipId === 'string' ? data.scholarshipId : undefined,
    messages: toMessages(data.messages),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

export async function createChatThread(
  uid: string,
  title: string,
  scholarshipId?: string
): Promise<string> {
  const now = new Date().toISOString();
  const ref = await addDoc(chatsCol(uid), {
    title,
    // Firestore rejects undefined, so the key is omitted rather than set to it.
    ...(scholarshipId ? { scholarshipId } : {}),
    messages: [],
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

/**
 * Replace a thread's messages.
 *
 * The whole array is rewritten rather than appended with arrayUnion: the client
 * already holds the full conversation, and arrayUnion de-duplicates by value,
 * which would silently drop a user sending the same message twice.
 */
export async function saveChatMessages(
  uid: string,
  id: string,
  messages: ChatMessage[]
): Promise<void> {
  await updateDoc(doc(chatsCol(uid), id), {
    messages: messages.slice(-MAX_STORED_MESSAGES),
    updatedAt: new Date().toISOString(),
  });
}

export async function renameChatThread(uid: string, id: string, title: string): Promise<void> {
  await updateDoc(doc(chatsCol(uid), id), { title, updatedAt: new Date().toISOString() });
}

export async function deleteChatThread(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(chatsCol(uid), id));
}
