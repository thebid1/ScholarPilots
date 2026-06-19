import { Scholarship, UserProfile, Application, Milestone } from '@/app/types';

export const DISCIPLINES = [
  'Engineering',
  'Computer Science',
  'Medicine',
  'Business',
  'Law',
  'Arts',
  'Social Sciences',
  'Natural Sciences',
  'Agriculture',
  'Education',
];

export const COUNTRIES = [
  'Australia',
  'Austria',
  'Belgium',
  'Canada',
  'China',
  'Czech Republic',
  'Denmark',
  'France',
  'Germany',
  'Ireland',
  'Italy',
  'Japan',
  'Netherlands',
  'New Zealand',
  'Saudi Arabia',
  'Singapore',
  'South Korea',
  'Sweden',
  'Switzerland',
  'Taiwan',
  'Turkey',
  'UK',
  'US',
];

function degreeMatches(s: Scholarship, target: string): boolean {
  const level = s.degreeLevel.toLowerCase();
  if (target === 'PhD') return level.includes('phd');
  if (target === 'MSc') return level.includes("master's") || level.includes('phd');
  if (target === 'BSc') return level.includes("bachelor's");
  return true;
}

function disciplineMatches(s: Scholarship, discipline: string): number {
  const text = `${s.description} ${s.eligibility.join(' ')}`.toLowerCase();
  const disc = discipline.toLowerCase();
  if (text.includes(disc)) return 25;
  const broad = ['engineering', 'science', 'technology', 'social sciences', 'humanities', 'any discipline'];
  if (broad.some((b) => text.includes(b))) return 12;
  return 0;
}

export function computeRelevance(s: Scholarship, profile: UserProfile): number {
  let score = 0;

  if (profile.countryPreference.includes(s.country)) score += 30;
  if (degreeMatches(s, profile.targetDegree)) score += 25;
  score += disciplineMatches(s, profile.discipline);

  if (profile.cgpa >= 3.7) score += 20;
  else if (profile.cgpa >= 3.5) score += 15;
  else if (profile.cgpa >= 3.0) score += 10;
  else score += 5;

  return Math.min(100, Math.max(0, score));
}

export function enrichScholarships(
  profile: UserProfile,
  list: Scholarship[] = []
): Scholarship[] {
  return list
    .map((s) => ({ ...s, relevanceScore: computeRelevance(s, profile) }))
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
}

export function getScholarshipById(
  id: string,
  list: Scholarship[] = []
): Scholarship | undefined {
  return list.find((s) => s.id === id);
}

export function findScholarshipByName(
  name: string,
  list: Scholarship[] = []
): Scholarship | undefined {
  const lower = name.toLowerCase();
  return list.find(
    (s) =>
      s.title.toLowerCase().includes(lower) ||
      s.funder.toLowerCase().includes(lower) ||
      s.id.toLowerCase().includes(lower)
  );
}

export function daysUntil(dateString: string): number {
  const target = new Date(dateString);
  const diff = target.getTime() - new Date().getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function generateMilestones(deadline: string): Milestone[] {
  const d = new Date(deadline);
  const offset = (days: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() - days);
    return x.toISOString().split('T')[0];
  };
  return [
    { label: 'Draft SOP', dueDate: offset(45), completed: false },
    { label: 'Request Recommendations', dueDate: offset(30), completed: false },
    { label: 'Finalise Documents', dueDate: offset(14), completed: false },
    { label: 'Submit Application', dueDate: deadline, completed: false },
  ];
}

export function computeHealthScore(milestones: Milestone[]): number {
  if (milestones.length === 0) return 0;
  const completed = milestones.filter((m) => m.completed).length;
  return Math.round((completed / milestones.length) * 100);
}

export function createApplication(
  scholarshipId: string,
  list: Scholarship[] = []
): Application {
  const s = getScholarshipById(scholarshipId, list);
  const milestones = s ? generateMilestones(s.deadline) : [];
  return {
    id: `${scholarshipId}-${Date.now()}`,
    scholarshipId,
    status: 'Discovered',
    healthScore: computeHealthScore(milestones),
    milestones,
    createdAt: new Date().toISOString(),
  };
}
