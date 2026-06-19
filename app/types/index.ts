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
  relevanceScore?: number;
}

export type ApplicationStatus = 'Discovered' | 'Tailoring' | 'Documents Ready' | 'Submitted';

export interface Milestone {
  label: string;
  dueDate: string;
  completed: boolean;
}

export interface Application {
  id: string;
  scholarshipId: string;
  status: ApplicationStatus;
  healthScore: number;
  milestones: Milestone[];
  createdAt: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: string;
  type?: 'sop' | 'cv' | 'general';
}

export interface UserSession {
  email: string;
  name?: string;
}
