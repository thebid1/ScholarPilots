import { NextRequest, NextResponse } from 'next/server';
import { generateJson, geminiConfigured, geminiModel } from '@/lib/gemini';

/**
 * Structures a pasted scholarship listing into a draft opportunity.
 *
 * Returns a DRAFT, never a saved record. The client renders it into an editable
 * form the user must confirm — extraction hallucinates dates, and in a
 * deadline-tracking app a wrong deadline is the one error that actually costs
 * the user something.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Uses the shared Gemini extraction model (GEMINI_MODEL / GEMINI_EXTRACTION_MODEL).
 * Pasted text is usually under 3k chars so the context is small.
 */
const MODEL_TIMEOUT_MS = 45_000;
const MAX_INPUT_CHARS = 20_000;

const EXTRACTION_PROMPT = `You extract structured scholarship data from text a student pasted from a funding page.

Output a JSON object with these exact fields:
- title: name of the scholarship or award
- funder: organisation providing the funding
- country: country of study, or "" if not stated
- degreeLevel: degree level(s), e.g. "masters" or "masters, phd". "" if not stated
- amount: award value as written, e.g. "Full tuition + GBP 18,000 stipend". "" if not stated
- deadline: application deadline as YYYY-MM-DD. Empty string if the text does not state one. NEVER guess.
- eligibility: array of eligibility requirements
- requiredDocs: array of documents the applicant must submit
- description: 2-3 sentence summary
- url: official application URL if present, else ""
- uncertainFields: array of field names you inferred, guessed, or could not find in the text. Be honest — these are highlighted for the user to correct.

Rules:
- Use ONLY what the text states. Do not fill gaps from prior knowledge about the programme.
- If a field is not stated, return "" (or an empty array) and list the field name in uncertainFields.
- Deadlines must be YYYY-MM-DD. If the text gives a partial date ("March 2027") or a rolling deadline, return "" and list "deadline" in uncertainFields. Never invent a day.
- Do not assess, score, or rank the opportunity. Extract only.`;

/**
 * Force the model's JSON into the shape the confirm form expects.
 *
 * responseMimeType: application/json still lets a key go missing or arrive with
 * the wrong type, which would reach the client and crash the form on `.trim()`.
 * Anything absent is reported as uncertain rather than silently blanked, so the
 * user sees which fields need their attention.
 */
function normalizeDraft(raw: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const arr = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    if (typeof v === 'string' && v.trim()) return [v.trim()];
    return [];
  };

  const draft = {
    title: str(raw.title),
    funder: str(raw.funder),
    country: str(raw.country),
    degreeLevel: str(raw.degreeLevel),
    amount: str(raw.amount),
    deadline: str(raw.deadline),
    eligibility: arr(raw.eligibility),
    requiredDocs: arr(raw.requiredDocs),
    description: str(raw.description),
    url: str(raw.url),
    uncertainFields: arr(raw.uncertainFields),
  };

  // A well-formed reply can still carry a malformed date. Blank it rather than
  // let it through — an unparseable deadline breaks the cron.
  if (draft.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(draft.deadline)) {
    draft.deadline = '';
  }

  for (const [key, value] of Object.entries(draft)) {
    if (key === 'uncertainFields') continue;
    const empty = Array.isArray(value) ? value.length === 0 : !value;
    if (empty && !draft.uncertainFields.includes(key)) draft.uncertainFields.push(key);
  }

  return draft;
}

export async function POST(request: NextRequest) {
  if (!geminiConfigured()) {
    return NextResponse.json(
      { error: 'AI parsing is unavailable — Gemini is not configured.' },
      { status: 503 }
    );
  }

  let text: unknown;
  try {
    ({ text } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (typeof text !== 'string' || text.trim().length < 40) {
    return NextResponse.json(
      { error: 'Paste more of the listing — at least a title, funder, and deadline.' },
      { status: 400 }
    );
  }

  try {
    const parsed = await generateJson(
      `${EXTRACTION_PROMPT}\n\nText:\n"""\n${text.slice(0, MAX_INPUT_CHARS)}\n"""`,
      { model: geminiModel(), temperature: 0, maxOutputTokens: 2000, timeoutMs: MODEL_TIMEOUT_MS }
    );

    if (!parsed) {
      return NextResponse.json({ error: 'The AI returned nothing. Try again.' }, { status: 502 });
    }

    return NextResponse.json({ draft: normalizeDraft(parsed) });
  } catch (error) {
    console.error('[parse] Failed to structure pasted opportunity:', error);
    return NextResponse.json({ error: 'Could not read that listing. Try again.' }, { status: 502 });
  }
}
