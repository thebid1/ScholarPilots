import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Scholarship, UserProfile } from '@/app/types';
import { queryDb } from '@/lib/db';
import { generateText, geminiConfigured, geminiModel } from '@/lib/gemini';

/**
 * Model family is chosen by GEMINI_MODEL (default gemini-3.6-flash). The filter
 * is served to the user on Discover, so it fails over to the keyword fallback
 * rather than hanging: without a signal, fetch waits indefinitely and three
 * retries could stack into minutes.
 */
const CALL_TIMEOUT_MS = 25_000;
/** Whole-operation ceiling across all retries, so a bad run can't stack them. */
const TOTAL_BUDGET_MS = 40_000;

const CACHE_TTL_HOURS = 12;

/**
 * Append a line to logs/discipline-filter.log. Discover is a serverless route,
 * so `console.log` dies with the process — a file on disk is the only way to
 * look back at why a given profile saw (or didn't see) a scholarship.
 */
const FILTER_LOG_PATH = join(process.cwd(), 'logs', 'discipline-filter.log');

function writeFilterLog(entry: string): void {
  try {
    mkdirSync(join(process.cwd(), 'logs'), { recursive: true });
    appendFileSync(FILTER_LOG_PATH, entry + '\n', 'utf8');
  } catch (error) {
    console.warn('[discipline-filter] Could not write log:', error);
  }
}

function getCacheKey(profile: UserProfile): string {
  // Cache is keyed on everything the prompt interpolates, so editing a profile
  // misses the cache rather than serving an answer built from the old one.
  const countries = [...profile.countryPreference].sort().join(',');
  return `${profile.id}::${profile.discipline}::${profile.targetDegree}::${profile.careerGoal}::${countries}`;
}

/**
 * Read cached ids for this profile.
 *
 * Lives in Postgres, not memory: Render restarts on every deploy and spins
 * services down when idle, so an in-process Map would rarely survive long
 * enough for the TTL to matter — which is the whole point of caching an LLM call.
 * A cache miss is never fatal, so DB trouble degrades to a fresh call.
 */
async function getCached(profile: UserProfile): Promise<string[] | null> {
  try {
    const result = await queryDb<{ scholarship_ids: string[] }>(
      `SELECT scholarship_ids FROM filter_cache
       WHERE cache_key = $1 AND created_at > NOW() - INTERVAL '${CACHE_TTL_HOURS} hours'`,
      [getCacheKey(profile)]
    );
    return result.rows[0]?.scholarship_ids ?? null;
  } catch (error) {
    console.warn('[discipline-filter] Cache read failed:', error);
    return null;
  }
}

async function setCached(profile: UserProfile, ids: string[]): Promise<void> {
  try {
    // Upsert refreshes created_at, so a re-filter restarts the TTL.
    await queryDb(
      `INSERT INTO filter_cache (cache_key, scholarship_ids, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (cache_key)
       DO UPDATE SET scholarship_ids = EXCLUDED.scholarship_ids, created_at = NOW()`,
      [getCacheKey(profile), ids]
    );
  } catch (error) {
    console.warn('[discipline-filter] Cache write failed:', error);
  }
}

function buildPrompt(scholarships: Scholarship[], profile: UserProfile): string {
  // Only what bears on the field-of-study call. The UUID is dropped entirely —
  // the model answers with the bracketed number and the server maps it back,
  // which removes ~1,800 output tokens of UUID transcription from the reply and
  // is what brought this call inside its timeout.
  const scholarshipList = scholarships
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title} — ${s.funder}\nLevel: ${s.degreeLevel}\n${s.description.slice(
          0,
          180
        )}\nEligibility: ${s.eligibility.join('; ').slice(0, 220)}`
    )
    .join('\n---\n');

  return `You are a scholarship eligibility filter. A student is studying "${profile.discipline}" and pursuing a ${profile.targetDegree}.

Your task: decide which scholarships below this student COULD APPLY FOR.

STUDENT PROFILE:
- Discipline: ${profile.discipline}
- Target Degree: ${profile.targetDegree}
- Career Goal: ${profile.careerGoal}

SCHOLARSHIPS:
${scholarshipList}

RULES:
1. EXCLUDE when the scholarship is restricted to a FIELD that genuinely does not include the
   student's. Be specific: an award for "Medicine and Public Health" excludes a Law student;
   one for "STEM" includes an Engineering student.
2. EXCLUDE when the DEGREE LEVEL does not match. A PhD-only award does not fit a masters
   applicant; a postdoctoral fellowship fits neither.
3. Most large government and foundation scholarships (Chevening, Fulbright, Commonwealth,
   Rhodes, Gates, Mastercard Foundation, DAAD, Erasmus and similar) fund EVERY academic
   field. Their eligibility text talks about nationality, degree class, leadership and
   financial need rather than subject. INCLUDE these for any discipline.
4. Silence means open. If nothing in the entry restricts the field of study, INCLUDE it.
   Do NOT invent a restriction from:
   - the funder's name or reputation
   - words like "prestigious", "leadership", "character", "service" or "excellence"
   - the subjects a description happens to mention as examples
   - your own background knowledge of the programme
5. Ignore nationality, GPA, deadlines and funding amount — those are handled elsewhere.
6. When genuinely unsure, INCLUDE. A student who sees an award they cannot win loses a
   minute; one who never sees an eligible award may lose the award.

Return ONLY a JSON array of the bracketed numbers of the scholarships the student can apply
for. No explanation, no markdown, just the JSON array.

Example output: [1, 2, 5, 9, 14]`;
}

/**
 * Pull the JSON array of selected item numbers out of a model reply.
 *
 * Tolerant by design: models wrap arrays in prose or markdown fences even when
 * told not to, and a parse failure here costs a full retry.
 */
function extractJsonArray(content: string): number[] | null {
  const patterns = [
    /```(?:json)?\s*([\s\S]*?)\s*```/, // Markdown code block — try first, it wraps the rest
    /\[[\s\S]*?\]/, // Bare JSON array
    /"?relevant"?\s*:?\s*(\[[\s\S]*?\])/, // "relevant": [...]
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      try {
        const jsonStr = (match[1] || match[0]).trim();
        // A fenced block may itself contain the array rather than be one.
        const inner = jsonStr.startsWith('[') ? jsonStr : jsonStr.match(/\[[\s\S]*?\]/)?.[0];
        if (!inner) continue;
        const parsed = JSON.parse(inner);
        if (Array.isArray(parsed)) {
          const nums = parsed
            .map((item) => parseInt(String(item), 10))
            .filter((n) => Number.isFinite(n));
          if (nums.length > 0) return nums;
        }
      } catch {
        // Try next pattern
      }
    }
  }

  // Last resort: any bare integers in the reply. Only trusted when the reply is
  // mostly numbers, so a prose refusal isn't mined for stray digits.
  const loose = content.match(/\b\d{1,3}\b/g);
  if (loose && loose.length > 0 && content.replace(/[\d\s,[\]]/g, '').length < 40) {
    return loose.map((n) => parseInt(n, 10));
  }

  return null;
}

async function callGeminiWithRetry(
  prompt: string,
  scholarships: Scholarship[],
  maxRetries: number = 3
): Promise<string[] | null> {
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Retries are only worth it while someone is still waiting. Past the budget,
    // hand over to the keyword fallback instead of starting another 25s call.
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
      console.warn('[discipline-filter] Budget spent; falling back to keywords');
      return null;
    }

    try {
      const content = await generateText(prompt, {
        model: geminiModel(),
        temperature: 0.1,
        maxOutputTokens: 2000,
        timeoutMs: CALL_TIMEOUT_MS,
      });

      writeFilterLog(`  MODEL REPLY (attempt ${attempt}):\n${content}`);

      const parsed = extractJsonArray(content);
      if (parsed !== null) {
        // The model returns 1-indexed numbers, so map them back to IDs.
        return parsed
          .map((item) => {
            const idx = parseInt(String(item), 10);
            return idx >= 1 && idx <= scholarships.length ? scholarships[idx - 1].id : null;
          })
          .filter((id): id is string => id !== null);
      }

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch {
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  return null;
}

async function callGemini(
  prompt: string,
  scholarships: Scholarship[]
): Promise<string[] | null> {
  if (!geminiConfigured()) {
    return null;
  }

  return callGeminiWithRetry(prompt, scholarships, 3);
}

/**
 * Filter scholarships by discipline using Gemini.
 * Falls back to keyword-based filtering if the AI is unavailable.
 * Results are cached for 12 hours per user profile.
 */
export async function filterByDiscipline(
  scholarships: Scholarship[],
  profile: UserProfile
): Promise<Scholarship[]> {
  if (!scholarships.length) {
    return [];
  }

  const titles = new Map(scholarships.map((s) => [s.id, s.title]));
  const describe = (ids: string[]) => ids.map((id) => titles.get(id) ?? id);

  writeFilterLog(
    `[${new Date().toISOString()}] discipline=${profile.discipline} degree=${profile.targetDegree} career="${profile.careerGoal}" — ${scholarships.length} candidates`
  );

  // Check cache first
  const cachedIds = await getCached(profile);
  if (cachedIds) {
    writeFilterLog(`  → CACHE HIT: ${cachedIds.length} kept`);
    const idSet = new Set(cachedIds);
    return scholarships.filter((s) => idSet.has(s.id));
  }

  // Build the prompt
  const prompt = buildPrompt(scholarships, profile);
  writeFilterLog(`  PROMPT:\n${prompt}\n${'-'.repeat(60)}`);

  // Call Gemini
  const relevantIds = await callGemini(prompt, scholarships);

  if (relevantIds) {
    const kept = describe(relevantIds);
    writeFilterLog(
      `  → AI RESULT: ${kept.length}/${scholarships.length} kept\n${JSON.stringify(kept, null, 2)}\n${'='.repeat(60)}`
    );
    const idSet = new Set(relevantIds);
    await setCached(profile, relevantIds);
    return scholarships.filter((s) => idSet.has(s.id));
  }

  // Fallback: keyword-based filtering. Deliberately not cached — it costs
  // nothing to recompute, and pinning a degraded result for 12h would outlast
  // whatever transient failure produced it.
  const fallbackIds = fallbackFilter(scholarships, profile);
  writeFilterLog(`  → FALLBACK (keyword): ${fallbackIds.length}/${scholarships.length} kept`);
  const fallbackSet = new Set(fallbackIds);
  return scholarships.filter((s) => fallbackSet.has(s.id));
}

function fallbackFilter(scholarships: Scholarship[], profile: UserProfile): string[] {
  return scholarships
    .filter((s) => {
      const text = `${s.title} ${s.description} ${s.eligibility.join(' ')}`.toLowerCase();

      // Silence means open, same rule the prompt uses. Catalog eligibility text is
      // mostly about nationality and degree class, so a discipline-restricted award
      // is the exception and has to announce itself. Requiring a keyword match
      // instead excluded Chevening and Fulbright from every student.
      const restrictionMarkers = [
        'only for students of',
        'restricted to',
        'must be studying',
        'limited to students in',
        'applicants must be enrolled in a',
        'exclusively for',
      ];
      const declaresRestriction = restrictionMarkers.some((m) => text.includes(m));
      if (!declaresRestriction) {
        return true;
      }

      // Check for discipline keywords
      const keywords: Record<string, string[]> = {
        agriculture: ['agriculture', 'agricultural', 'farming', 'crop', 'soil', 'livestock'],
        law: ['law', 'legal', 'justice', 'governance', 'policy', 'rights'],
        engineering: ['engineering', 'mechanical', 'electrical', 'civil', 'systems'],
        'computer science': ['computer science', 'software', 'artificial intelligence', 'data science', 'informatics'],
        medicine: ['medicine', 'health', 'public health', 'biomedical', 'clinical'],
        business: ['business', 'finance', 'management', 'economics', 'entrepreneurship'],
        education: ['education', 'teaching', 'learning', 'pedagogy'],
        'social sciences': ['social sciences', 'sociology', 'psychology', 'politics', 'development'],
        'natural sciences': ['science', 'biology', 'chemistry', 'physics', 'environment', 'ecology'],
        arts: ['arts', 'design', 'humanities', 'culture', 'media', 'music', 'literature'],
      };

      const profileKeywords = keywords[profile.discipline] || [profile.discipline.toLowerCase()];
      return profileKeywords.some((kw) => text.includes(kw));
    })
    .map((s) => s.id);
}
