import { NextRequest, NextResponse } from 'next/server';
import { braveApiKey, fetchPageText, webSearch } from '@/app/lib/web-search';

/**
 * Find an opportunity from its name alone.
 *
 * The user types "Chevening" and gets a filled-in form back. This route does the
 * browsing itself — Brave for the search, a plain fetch for the page — and uses
 * Featherless only for the step a model is actually needed for: turning page
 * prose into structured fields.
 *
 * An earlier version let the model drive via tool calls. It researched well but
 * each call to a model this size costs 10-50s, so a three-round loop ran past two
 * minutes and users saw a spinner then a timeout. Searching and fetching are
 * deterministic anyway; there is nothing for a model to decide there. One call on
 * assembled text is both faster and more predictable.
 *
 * The result is still a *draft*. It goes to the same editable confirm step as a
 * pasted listing, because a wrong deadline is the one error that costs the user
 * something.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const FEATHERLESS_API_URL = 'https://api.featherless.ai/v1/chat/completions';
/**
 * Extraction is a read-and-reformat job, not a reasoning one, so this is chosen
 * for latency. Kimi-K3 does support tool calling and answers a trivial prompt in
 * ~7s, but it is a reasoning model and on a real two-page context it ran past a
 * 75s timeout. This one returns the same payload correctly in ~14s.
 *
 * Featherless documents native tool calling for Kimi-K2-Instruct and Qwen 3 only
 * (page last edited Aug 2025, so it predates K3). For models outside that list
 * the documented approach is response_format json_object plus an explicit field
 * spec — which is what this route does, so the model choice is free to be made
 * on latency alone.
 */
const MODEL = 'Qwen/Qwen2.5-72B-Instruct';
const MODEL_TIMEOUT_MS = 60_000;
/**
 * Pages fetched per lookup. The programme page carries most fields; the runner-up
 * is usually where the deadline hides ("key dates", "how to apply"). Both are
 * fetched concurrently, so this costs one page's latency, not two.
 */
const MAX_PAGES = 2;
/** Per page. Two of these plus the prompt is a context the model answers in ~40s. */
const PAGE_CHARS = 6_000;

const EXTRACTION_PROMPT = `Extract structured scholarship data from the pages below.

Output a JSON object with these exact fields:
- title: official programme name
- funder: organization funding it
- country: where the study takes place
- degreeLevel: "undergraduate", "masters", "phd", or "all"
- amount: what it covers, in the funder’s own words
- deadline: application deadline in YYYY-MM-DD format
- eligibility: array of eligibility requirements
- requiredDocs: array of required documents
- description: 2-3 sentence summary
- url: direct application or official programme page URL (use the first source URL if not stated)
- uncertainFields: array of field names you couldn’t extract confidently

Rules:
- Use ONLY what the sources state. Never fill a gap from memory.
- deadline must be YYYY-MM-DD. If only month/year is given or the round is not open, return "" and list "deadline".
- Prefer the deadline for the currently open or next-opening round.
- url should be where a student applies or reads about the programme.
- Anything unconfirmed goes in uncertainFields.
- Do not rank or score. Extract only.`;

interface Draft {
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
  uncertainFields: string[];
}

/**
 * Returns the model's raw parsed JSON, not a Draft. The shape is whatever the
 * model emitted — normalizeDraft is what turns it into a Draft.
 */
async function callModel(
  prompt: string,
  sources: string,
  apiKey: string
): Promise<Record<string, unknown>> {
  const response = await fetch(FEATHERLESS_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'user', content: `${prompt}\n\nSources:\n${sources}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 2000,
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Featherless returned ${response.status}: ${detail.slice(0, 200)}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  if (!choice?.message?.content) {
    throw new Error('Featherless returned no content');
  }

  return JSON.parse(choice.message.content);
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function normalizeDraft(raw: Record<string, unknown>, fallbackName: string, sourceUrls: string[]): Draft {
  const draft: Draft = {
    title: String(raw.title ?? '').trim() || fallbackName,
    funder: String(raw.funder ?? '').trim(),
    country: String(raw.country ?? '').trim(),
    degreeLevel: String(raw.degreeLevel ?? '').trim(),
    amount: String(raw.amount ?? '').trim(),
    deadline: String(raw.deadline ?? '').trim(),
    eligibility: asStringArray(raw.eligibility),
    requiredDocs: asStringArray(raw.requiredDocs),
    description: String(raw.description ?? '').trim(),
    url: String(raw.url ?? '').trim() || sourceUrls[0] || '',
    uncertainFields: asStringArray(raw.uncertainFields),
  };

  if (draft.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(draft.deadline)) {
    draft.deadline = '';
    if (!draft.uncertainFields.includes('deadline')) draft.uncertainFields.push('deadline');
  }

  // Sanity check: a past deadline means the model extracted a stale round or the
  // wrong year. Drop it rather than let it reach tracking, where it would never
  // trigger a notification and would render as "expired" in the UI.
  if (draft.deadline) {
    const deadlineDate = new Date(draft.deadline + 'T23:59:59Z');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (deadlineDate < today) {
      draft.deadline = '';
      if (!draft.uncertainFields.includes('deadline')) draft.uncertainFields.push('deadline');
    }
  }

  for (const [key, value] of Object.entries(draft)) {
    if (key === 'uncertainFields') continue;
    const empty = Array.isArray(value) ? value.length === 0 : !value;
    if (empty && !draft.uncertainFields.includes(key)) draft.uncertainFields.push(key);
  }

  return draft;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.FEATHERLESS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Search is not configured.' }, { status: 503 });
  }
  if (!braveApiKey()) {
    return NextResponse.json(
      { error: 'Search is not configured. Paste the listing text instead.' },
      { status: 503 }
    );
  }

  let name: string;
  try {
    const body = await req.json();
    name = typeof body?.name === 'string' ? body.name.trim() : '';
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (name.length < 3) {
    return NextResponse.json(
      { error: 'Type the name of the scholarship — at least a few characters.' },
      { status: 400 }
    );
  }
  if (name.length > 200) {
    return NextResponse.json(
      { error: 'That looks like a listing rather than a name — use the paste tab instead.' },
      { status: 400 }
    );
  }

  try {
    // Two queries, run together. The plain one finds the programme's home page,
    // which carries the funder, award and eligibility; the second targets the
    // "key dates"/"how to apply" pages where the deadline actually lives. Searching
    // only for the programme name reliably returned a draft with a blank deadline —
    // the one field that matters most here.
    const [generalResults, deadlineResults] = await Promise.all([
      webSearch(`${name} scholarship programme`),
      webSearch(`${name} scholarship application deadline how to apply`),
    ]);

    if (generalResults.length === 0 && deadlineResults.length === 0) {
      return NextResponse.json(
        { error: `No results for "${name}". Check the spelling or paste the listing instead.` },
        { status: 404 }
      );
    }

    // Interleave so one page comes from each query, then de-duplicate: the two
    // searches often agree on the top hit, and fetching it twice wastes a slot.
    const ranked: string[] = [];
    for (let i = 0; i < Math.max(generalResults.length, deadlineResults.length); i++) {
      if (generalResults[i]) ranked.push(generalResults[i].url);
      if (deadlineResults[i]) ranked.push(deadlineResults[i].url);
    }
    const topUrls = Array.from(new Set(ranked)).slice(0, MAX_PAGES);
    const pages = await Promise.all(topUrls.map((url) => fetchPageText(url)));

    const sourceTexts = pages
      .map((text, i) => {
        if (text.startsWith('[')) return null;
        const trimmed = text.slice(0, PAGE_CHARS);
        return `Source ${i + 1} (${topUrls[i]}):\n${trimmed}`;
      })
      .filter(Boolean);

    if (sourceTexts.length === 0) {
      return NextResponse.json(
        { error: `Couldn't fetch any pages for "${name}". Paste the listing text instead.` },
        { status: 502 }
      );
    }

    const sources = sourceTexts.join('\n\n---\n\n');
    const rawDraft = await callModel(EXTRACTION_PROMPT, sources, apiKey);
    const draft = normalizeDraft(rawDraft, name, topUrls);

    console.log(`[search] "${name}" extracted from ${sourceTexts.length} page(s)`, {
      uncertain: draft.uncertainFields,
    });

    return NextResponse.json({ draft, sources: topUrls });
  } catch (error) {
    console.error('[search] Failed:', error);
    const message =
      error instanceof Error && error.message.includes('timeout')
        ? `Search timed out for "${name}". Paste the listing text instead.`
        : 'Search failed. Paste the listing text instead.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
