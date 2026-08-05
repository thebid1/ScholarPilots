import { NextResponse } from 'next/server';
import { queryDb } from '@/lib/db';
import { Scholarship } from '@/app/types';

// The catalog must be read per-request. Without this, Next prerenders this
// route at build time and serves a frozen snapshot of the database — which is
// what the old `output: 'export'` config did, silently.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await queryDb(
      `SELECT id, title, funder, country, deadline, degree_levels, amount_currency, amount_value, amount_type,
              eligibility, required_docs, description, source_url
       FROM scholarships
       WHERE is_active = true AND deadline >= CURRENT_DATE
       ORDER BY deadline ASC`
    );

    const scholarships: Scholarship[] = result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id ?? ''),
        title: String(r.title ?? ''),
        funder: String(r.funder ?? ''),
        country: String(r.country ?? ''),
        degreeLevel: Array.isArray(r.degree_levels) ? r.degree_levels.join(', ') : String(r.degree_levels ?? ''),
        amount: r.amount_value ? `${r.amount_currency ?? 'USD'} ${r.amount_value}` : 'TBD',
        deadline: r.deadline ? new Date(String(r.deadline)).toISOString().split('T')[0] : '',
        eligibility: Array.isArray(r.eligibility) ? r.eligibility : r.eligibility ? [String(r.eligibility)] : [],
        requiredDocs: Array.isArray(r.required_docs) ? r.required_docs : r.required_docs ? [String(r.required_docs)] : [],
        description: String(r.description ?? ''),
        url: String(r.source_url ?? ''),
      };
    });



    return NextResponse.json(scholarships);
  } catch (error) {
    console.error('Failed to load scholarships from DB', error);
    return NextResponse.json([], { status: 500 });
  }
}
