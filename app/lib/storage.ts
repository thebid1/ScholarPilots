import { UserProfile, Application, ChatMessage, UserSession } from '@/app/types';

const SESSION_KEY = 'scholarpilot_session';
const PROFILE_KEY = 'scholarpilot_profile';
const APPLICATIONS_KEY = 'scholarpilot_applications';
const CHAT_KEY = 'scholarpilot_chat_history';

function safeGet<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeSet<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

export const saveSession = (session: UserSession): void => safeSet(SESSION_KEY, session);
export const getSession = (): UserSession | null => safeGet<UserSession>(SESSION_KEY);
export const clearSession = (): void => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SESSION_KEY);
};

export const saveProfile = (profile: UserProfile): void => safeSet(PROFILE_KEY, profile);
export const getProfile = (): UserProfile | null => safeGet<UserProfile>(PROFILE_KEY);

export const saveApplications = (applications: Application[]): void =>
  safeSet(APPLICATIONS_KEY, applications);
export const getApplications = (): Application[] =>
  safeGet<Application[]>(APPLICATIONS_KEY) ?? [];

export const saveChat = (messages: ChatMessage[]): void => safeSet(CHAT_KEY, messages);
export const getChat = (): ChatMessage[] => safeGet<ChatMessage[]>(CHAT_KEY) ?? [];
