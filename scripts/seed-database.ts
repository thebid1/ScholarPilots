import dotenv from 'dotenv';
import scholarships from '../app/lib/scholarships.json';

dotenv.config({ path: '.env.local' });

async function getQueryDb() {
  const module = await import('../lib/db');
  return module.queryDb;
}

function normalizeDegreeLevel(value: string): string[] {
  const raw = value.toLowerCase();
  if (raw.includes('phd')) return ['masters', 'phd'];
  if (raw.includes('master')) return ['masters'];
  if (raw.includes('bachelor')) return ['undergraduate'];
  return ['all'];
}

function normalizeFields(value?: string[]): string[] {
  if (!value || value.length === 0) return ['all'];
  return value.map((item) => item.toLowerCase().replace(/\s+/g, '-'));
}

async function seed() {
  const queryDb = await getQueryDb();
  console.log(`Seeding ${scholarships.length} scholarships...`);

  for (const scholarship of scholarships as any[]) {
    const degreeLevels = normalizeDegreeLevel(scholarship.degreeLevel || 'all');
    const fields = normalizeFields(scholarship.fields_of_study || scholarship.fields || ['all']);
    const nationalities = ['all'];

    const eligibility = Array.isArray(scholarship.eligibility)
      ? scholarship.eligibility
      : scholarship.eligibility
      ? [String(scholarship.eligibility)]
      : ['Open to all'];

    await queryDb(
      `
        INSERT INTO scholarships (
          external_id, title, funder, country, amount_currency, amount_value, amount_type,
          deadline, degree_levels, fields_of_study, eligible_nationalities, min_gpa,
          requirements, eligibility, description, source_url, required_docs, is_active, verified_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true,NOW())
        ON CONFLICT (external_id) DO NOTHING
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
        degreeLevels,
        fields,
        nationalities,
        null,
        scholarship.eligibility?.join('; ') || '',
        eligibility,
        scholarship.description || '',
        scholarship.url || '#',
        scholarship.requiredDocs || ['Application documents not listed'],
      ]
    );
  }

  console.log('Seed complete');
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
