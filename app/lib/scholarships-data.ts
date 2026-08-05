import { Scholarship } from '@/app/types';

export interface LoadResult {
  scholarships: Scholarship[];
  source: 'db';
}

export async function loadScholarships(): Promise<LoadResult> {
  const response = await fetch('/api/scholarships');
  if (!response.ok) {
    throw new Error('Failed to load scholarships from database');
  }
  const scholarships = (await response.json()) as Scholarship[];
  return { scholarships, source: 'db' };
}
