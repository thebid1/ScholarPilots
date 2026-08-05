import { Scholarship, Application, ApplicationSource, Milestone } from '@/app/types';

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

/**
 * Discipline vocabulary. No longer used for scoring — scholarships are not
 * ranked. Retained as the seed for populating `fields_of_study` on the catalog
 * (see PIPELINE_NOTES.md, Issue 1), which is currently 'all' for every row.
 */
export const DISCIPLINE_KEYWORDS: Record<string, string[]> = {
  Agriculture: [
    'agriculture',
    'agricultural',
    'farming',
    'crop',
    'soil',
    'livestock',
    'food security',
    'rural',
    'agribusiness',
    'sustainable agriculture',
  ],
  Law: [
    'law',
    'legal',
    'justice',
    'human rights',
    'governance',
    'public policy',
    'constitutional',
    'regulation',
    'rule of law',
    'legal studies',
  ],
  Engineering: ['engineering', 'mechanical', 'electrical', 'civil', 'systems', 'robotics', 'materials', 'industrial'],
  'Computer Science': [
    'computer science',
    'software',
    'artificial intelligence',
    'machine learning',
    'data science',
    'informatics',
    'cybersecurity',
    'programming',
    'algorithms',
  ],
  Medicine: ['medicine', 'health', 'public health', 'nursing', 'biomedical', 'clinical', 'healthcare'],
  Business: ['business', 'finance', 'management', 'entrepreneurship', 'marketing', 'economics', 'accounting'],
  Education: ['education', 'teaching', 'learning', 'pedagogy', 'curriculum', 'instruction'],
  'Social Sciences': ['social sciences', 'development', 'sociology', 'psychology', 'policy', 'governance', 'community'],
  'Natural Sciences': ['science', 'biology', 'chemistry', 'physics', 'environment', 'research', 'ecology'],
  Arts: ['arts', 'design', 'humanities', 'culture', 'media', 'music', 'literature'],
};

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

/**
 * Days until `dateString`. Returns a NEGATIVE number for past dates — do not
 * clamp to 0. Notifications rely on telling "due today" apart from "expired".
 */
export function daysUntil(dateString: string): number {
  const target = new Date(dateString);
  if (Number.isNaN(target.getTime())) return 0;
  const diff = target.getTime() - new Date().getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function isExpired(dateString: string): boolean {
  return daysUntil(dateString) < 0;
}

/**
 * Milestones are back-dated from the deadline, so a near or past deadline would
 * otherwise emit milestones that are already overdue at creation time. Offsets
 * are compressed into whatever runway actually remains.
 */
export function generateMilestones(deadline: string): Milestone[] {
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return [];

  const runway = Math.max(0, daysUntil(deadline));
  const labels: { label: string; idealOffset: number }[] = [
    { label: 'Draft SOP', idealOffset: 45 },
    { label: 'Request Recommendations', idealOffset: 30 },
    { label: 'Finalise Documents', idealOffset: 14 },
    { label: 'Submit Application', idealOffset: 0 },
  ];

  // Compress proportionally when there is less than the ideal 45 days left.
  const scale = runway >= 45 ? 1 : runway / 45;

  const offset = (days: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() - Math.round(days * scale));
    return x.toISOString().split('T')[0];
  };

  return labels.map(({ label, idealOffset }) => ({
    label,
    dueDate: offset(idealOffset),
    completed: false,
  }));
}

export function computeHealthScore(milestones: Milestone[]): number {
  if (milestones.length === 0) return 0;
  const completed = milestones.filter((m) => m.completed).length;
  return Math.round((completed / milestones.length) * 100);
}

/**
 * Builds an application from an opportunity, copying a `snapshot` of it. The
 * snapshot is what the deadline cron and the pipeline UI read, so a user-added
 * opportunity and a catalog one behave identically from here on.
 */
export function createApplication(
  scholarship: Scholarship,
  source: ApplicationSource = 'catalog'
): Omit<Application, 'id'> {
  const milestones = generateMilestones(scholarship.deadline);
  const now = new Date().toISOString();
  return {
    source,
    scholarshipId: source === 'catalog' ? scholarship.id : null,
    snapshot: {
      title: scholarship.title,
      funder: scholarship.funder,
      country: scholarship.country,
      deadline: scholarship.deadline,
      amount: scholarship.amount,
      url: scholarship.url,
    },
    status: 'Discovered',
    healthScore: computeHealthScore(milestones),
    milestones,
    createdAt: now,
    updatedAt: now,
    notified: {},
  };
}
