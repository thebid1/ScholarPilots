export interface UserProfile {
  id: string;
  name: string;
  discipline: string;
  cgpa: number;
  targetDegree: 'BSc' | 'MSc' | 'PhD';
  countryPreference: string[];
  careerGoal: string;
}

export interface Scholarship {
  id: string;
  title: string;
  funder: string;
  country: string;
  degreeLevel: string;
  amount: string;
  deadline: string;
  eligibility: string[];
  requiredDocs: string[];
  description: string;
  url: string;
}

export type ApplicationStatus = 'Discovered' | 'Tailoring' | 'Documents Ready' | 'Submitted';

export interface Milestone {
  label: string;
  dueDate: string;
  completed: boolean;
}

/** 'catalog' = from the shared Postgres catalog. 'user' = added by this user. */
export type ApplicationSource = 'catalog' | 'user';

/**
 * Denormalized copy of the opportunity, written when the application is created.
 * The deadline cron reads Firestore only — it must not have to join back into
 * Postgres to learn what an application is called or when it closes. It also
 * means a catalog entry going inactive doesn't blank out a tracked application.
 */
export interface ApplicationSnapshot {
  title: string;
  funder: string;
  country: string;
  deadline: string;
  amount: string;
  url: string;
}

/** Which reminders have already been sent, so the daily cron can't repeat itself. */
export interface NotifiedFlags {
  d7?: boolean;
  d1?: boolean;
}

export interface Application {
  id: string;
  source: ApplicationSource;
  /** null for user-added opportunities, which have no catalog id. */
  scholarshipId: string | null;
  snapshot: ApplicationSnapshot;
  status: ApplicationStatus;
  healthScore: number;
  milestones: Milestone[];
  createdAt: string;
  updatedAt?: string;
  notified?: NotifiedFlags;
}

/** An opportunity the user added themselves, stored under users/{uid}/opportunities. */
export interface UserOpportunity extends Scholarship {
  createdAt: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: string;
}

export interface ChatThread {
  id: string;
  title: string;
  /** Optional link to a scholarship this thread is about. */
  scholarshipId?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}
