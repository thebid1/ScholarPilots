import { NextRequest, NextResponse } from 'next/server';
import { queryDb } from '@/lib/db';
import { filterByDiscipline } from '@/app/lib/featherless-filter';
import { UserProfile, Scholarship } from '@/app/types';

interface DbScholarship {
  id: string;
  title: string;
  funder: string;
  country: string;
  amount_currency: string | null;
  amount_value: number | null;
  amount_type: string | null;
  deadline: string;
  degree_levels: string[] | null;
  fields_of_study: string[] | null;
  eligible_nationalities: string[] | null;
  eligibility: string[] | null;
  description: string | null;
  requirements: string | null;
  source_url: string | null;
  required_docs: string[] | null;
}

export async function POST(req: NextRequest) {
  try {
    const { profile } = await req.json();

    console.log('[Opportunities API] Received request for profile:', {
      discipline: profile?.discipline,
      targetDegree: profile?.targetDegree,
      name: profile?.name,
    });

    if (!profile || !profile.discipline) {
      console.warn('[Opportunities API] Missing discipline in profile');
      return NextResponse.json({ error: 'Profile with discipline required' }, { status: 400 });
    }

    // Fetch all active scholarships from DB
    console.log('[Opportunities API] Fetching scholarships from database...');
    const result = await queryDb<DbScholarship>(
      `SELECT id, title, funder, country, amount_currency, amount_value, amount_type, deadline, degree_levels, fields_of_study,
              eligible_nationalities, eligibility, description, requirements, source_url, required_docs
       FROM scholarships
       WHERE is_active = true AND deadline >= CURRENT_DATE
       ORDER BY deadline ASC`,
      []
    );
    console.log(`[Opportunities API] Fetched ${result.rows.length} scholarships from DB`);

    const scholarships: Scholarship[] = result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      funder: row.funder,
      country: row.country,
      // All levels, not just the first. An award open to masters and PhD used to
      // advertise only "masters", which the discipline filter would then read as a
      // restriction and exclude for a PhD applicant.
      degreeLevel: row.degree_levels?.length ? row.degree_levels.join(', ') : 'all',
      amount: row.amount_value ? `${row.amount_currency} ${row.amount_value}` : 'Not specified',
      deadline: row.deadline,
      eligibility: row.eligibility && row.eligibility.length > 0 ? row.eligibility : ['Open to all'],
      requiredDocs: row.required_docs || ['Application documents not listed'],
      description: row.description || '',
      url: row.source_url || '#',
    }));

    // Apply AI discipline filter
    console.log('[Opportunities API] Applying AI discipline filter...');
    const filtered = await filterByDiscipline(scholarships, profile as UserProfile);
    console.log(`[Opportunities API] Returning ${filtered.length} filtered scholarships`);

    return NextResponse.json({ scholarships: filtered });
  } catch (error) {
    console.error('[Opportunities API] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch opportunities' }, { status: 500 });
  }
}
