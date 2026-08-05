import { queryDb } from '../lib/db';
import scholarships from '../app/lib/scholarships.json';

async function sync() {
  const list = scholarships as any[];
  let inserted = 0;
  let updated = 0;

  for (const scholarship of list) {
    const result = await queryDb(
      `
        INSERT INTO scholarships (
          external_id, title, funder, country, amount_currency, amount_value, amount_type,
          deadline, degree_levels, fields_of_study, eligible_nationalities, min_gpa,
          requirements, eligibility, description, source_url, required_docs, is_active, verified_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true,NOW())
        ON CONFLICT (external_id)
        DO UPDATE SET
          title = EXCLUDED.title,
          funder = EXCLUDED.funder,
          country = EXCLUDED.country,
          amount_currency = EXCLUDED.amount_currency,
          amount_value = EXCLUDED.amount_value,
          amount_type = EXCLUDED.amount_type,
          deadline = EXCLUDED.deadline,
          degree_levels = EXCLUDED.degree_levels,
          fields_of_study = EXCLUDED.fields_of_study,
          eligible_nationalities = EXCLUDED.eligible_nationalities,
          min_gpa = EXCLUDED.min_gpa,
          requirements = EXCLUDED.requirements,
          description = EXCLUDED.description,
          source_url = EXCLUDED.source_url,
          is_active = true,
          updated_at = NOW()
        RETURNING (xmax = 0) AS is_insert
      `,
      [
        scholarship.id || `demo-${Math.random().toString(36).slice(2, 10)}`,
        scholarship.title,
        scholarship.funder || 'Unknown',
        scholarship.country || 'International',
        'USD',
        0,
        'unknown',
        scholarship.deadline || null,
        ['all'],
        ['all'],
        ['all'],
        null,
        scholarship.eligibility?.join('; ') || '',
        scholarship.eligibility || ['Open to all'],
        scholarship.description || '',
        scholarship.url || '#',
        scholarship.requiredDocs || ['Application documents not listed'],
      ]
    );

    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row?.is_insert) inserted += 1; else updated += 1;
  }

  console.log(`Sync complete: ${inserted} inserted, ${updated} updated`);
}

sync().catch((error) => {
  console.error(error);
  process.exit(1);
});
