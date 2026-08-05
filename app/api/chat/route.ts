import { NextRequest, NextResponse } from 'next/server';
import { Application, Scholarship, UserProfile } from '@/app/types';

/**
 * The chat endpoint.
 *
 * Replaces a keyword router in the client that decided what the user meant by
 * substring-matching their message: "deadline" ran a canned pipeline summary,
 * "find"+"scholarship" listed the catalog, and so on. Asking "when is the
 * Chevening deadline, and can I apply as a final year student?" matched the
 * deadline branch, printed the user's tracked applications, and never answered
 * the second half. Compound questions were unanswerable by construction.
 *
 * So there is no routing here. The model gets the profile, the tracked
 * applications and the scholarships the user is eligible for, and answers from
 * that. Being wrong about what someone asked is a thing models are good at
 * avoiding and `String.includes` is not.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FEATHERLESS_API_URL = 'https://api.featherless.ai/v1/chat/completions';
/**
 * Chosen on measured latency for a conversational turn: ~13s here, against ~16s
 * for Kimi-K2-Instruct and ~38s for Qwen2.5-72B. The Kimi reasoning models
 * answer this well but take 49-79s, which is too long to sit behind a typing
 * indicator.
 */
const MODEL = 'Qwen/Qwen3-30B-A3B-Instruct-2507';
const MODEL_TIMEOUT_MS = 45_000;

/** Turns of history sent back. Enough for follow-ups without an unbounded prompt. */
const HISTORY_TURNS = 8;
/**
 * Scholarships described in full in the system prompt. The list is already
 * filtered to what this user can apply for; past this many the prompt costs more
 * latency than the extra options are worth, so the rest are named only.
 */
const DETAILED_SCHOLARSHIPS = 12;

interface IncomingMessage {
  role: 'user' | 'model' | 'assistant';
  content: string;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function daysUntil(iso: string): number {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Assemble everything the model needs to answer without a follow-up round trip.
 *
 * Deliberately verbose about the pipeline: the thing users liked about the old
 * chat was that it knew what they were tracking, and that came from stuffing
 * applications into the prompt. That part stays.
 *
 * `focus` is set when the thread was opened from a specific opportunity. It
 * moves that one to the top of the prompt with its full detail, so "what do I
 * need to strengthen?" resolves against the right award instead of the catalog
 * at large.
 */
function buildSystemPrompt(
  profile: UserProfile,
  applications: Application[],
  scholarships: Scholarship[],
  today: string,
  focus?: Scholarship | null
): string {
  const tracked = applications.length
    ? applications
        .map((app) => {
          const days = daysUntil(app.snapshot.deadline);
          const when =
            days < 0
              ? `closed ${Math.abs(days)} days ago`
              : days === 0
                ? 'closes today'
                : `${days} days left`;
          const done = app.milestones.filter((m) => m.completed).length;
          const next = app.milestones.find((m) => !m.completed);
          return `- ${app.snapshot.title} (${app.snapshot.funder}) — deadline ${formatDate(
            app.snapshot.deadline
          )}, ${when}. Status: ${app.status}. Milestones ${done}/${
            app.milestones.length
          } done${next ? `, next up: ${next.label}` : ''}.`;
        })
        .join('\n')
    : 'Nothing tracked yet.';

  const detailed = scholarships.slice(0, DETAILED_SCHOLARSHIPS);
  const remainder = scholarships.slice(DETAILED_SCHOLARSHIPS);

  const catalog = detailed.length
    ? detailed
        .map(
          (s) =>
            `- ${s.title} (${s.funder}, ${s.country}) — ${s.amount}. Deadline ${formatDate(
              s.deadline
            )}. Level: ${s.degreeLevel}. Eligibility: ${s.eligibility.join('; ')}`
        )
        .join('\n')
    : 'No open opportunities available.';

  const alsoAvailable = remainder.length
    ? `\n\nAlso open to them, ask if they want details: ${remainder
        .map((s) => s.title)
        .join(', ')}.`
    : '';

  // The focused award is repeated in full even if it also appears in the list
  // below — the duplication is cheap and makes it unambiguous what "it" means.
  const focusBlock = focus
    ? `

THIS CONVERSATION IS ABOUT:
${focus.title} — ${focus.funder}
Country: ${focus.country}
Level: ${focus.degreeLevel}
Award: ${focus.amount}
Deadline: ${formatDate(focus.deadline)} (${daysUntil(focus.deadline)} days away)
Eligibility: ${focus.eligibility.join('; ')}
Required documents: ${focus.requiredDocs.join('; ')}
About: ${focus.description}
Official page: ${focus.url}

They opened this chat from that opportunity, so answer about it unless they clearly
change the subject. On the first message, without waiting to be asked:
1. Say what the award actually gives them, in two lines.
2. Go through the eligibility criteria against their profile above. State plainly which
   ones they meet, which they do not, and which cannot be judged from what you know —
   do not assume the unknowns are met.
3. Name the specific gaps worth closing before they apply, and what would strengthen a
   weak point given their field and career goal.
4. Flag the required documents that take the longest to get (references, transcripts,
   language tests) against the deadline.
Do not score them, give a percentage, or predict whether they will win.`
    : '';

  return `You are ScholarPilot, a scholarship application copilot. You help this student find funding, write their applications, and hit their deadlines. Be warm, specific and concrete. Keep answers short unless asked to write something long.

Today is ${today}.

THE STUDENT:
Name: ${profile.name}
Field: ${profile.discipline}
CGPA: ${profile.cgpa}
Applying for: ${profile.targetDegree}
Wants to study in: ${profile.countryPreference.join(', ')}
Career goal: ${profile.careerGoal}

THEIR PIPELINE:
${tracked}

OPPORTUNITIES THEY ARE ELIGIBLE FOR:
${catalog}${alsoAvailable}${focusBlock}

HOW TO ANSWER:
- Answer every part of what they asked. Compound questions get compound answers.
- Keep the two lists distinct. "My deadlines" and "what I'm working on" mean THEIR PIPELINE
  only. The opportunities list is what they could still apply for — never present an
  untracked opportunity as one of their deadlines. You may suggest they track one.
- The lists above are the truth about dates and eligibility. Prefer them over your own recollection of a programme, which may be out of date.
- If they ask something the lists do not cover — an eligibility edge case, how competitive an award is, how to approach an essay — answer from your general knowledge, and say plainly that they should confirm the specifics with the funder.
- Never invent a deadline, an award amount or an eligibility rule. If you do not know, say so and point them at the official page.
- Do not rank the opportunities or tell them which is the best fit. Lay out what is available and what each requires; the choice is theirs.
- Talk to them by name occasionally, not in every message.
- Use markdown. Bold the dates that matter. Keep lists short.`;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.FEATHERLESS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Chat is not configured.' }, { status: 503 });
  }

  let profile: UserProfile;
  let applications: Application[];
  let scholarships: Scholarship[];
  let history: IncomingMessage[];
  let focus: Scholarship | null = null;

  try {
    const body = await req.json();
    profile = body.profile;
    applications = Array.isArray(body.applications) ? body.applications : [];
    scholarships = Array.isArray(body.scholarships) ? body.scholarships : [];
    history = Array.isArray(body.messages) ? body.messages : [];
    // Optional: the scholarship this conversation is about. The client sends it
    // when opening a thread from Discover or when the thread was created with a
    // scholarshipId.
    focus = body.focus && typeof body.focus === 'object' ? (body.focus as Scholarship) : null;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (!profile?.name || history.length === 0) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const messages = [
    { role: 'system', content: buildSystemPrompt(profile, applications, scholarships, today, focus) },
    // The client stores assistant turns as 'model' (a Gemini convention); the
    // OpenAI-compatible API expects 'assistant'.
    ...history.slice(-HISTORY_TURNS).map((m) => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: m.content,
    })),
  ];

  try {
    const response = await fetch(FEATHERLESS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        // Higher than the extraction routes: this is conversation, and at 0 the
        // replies read like a form letter across a long session.
        temperature: 0.4,
        max_tokens: 1200,
      }),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[chat] Featherless ${response.status}: ${detail.slice(0, 200)}`);
      return NextResponse.json(
        { error: 'I could not reach the model just then. Try again in a moment.' },
        { status: 502 }
      );
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return NextResponse.json(
        { error: 'I did not manage a reply that time. Try rephrasing?' },
        { status: 502 }
      );
    }

    return NextResponse.json({ reply });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    console.error('[chat] Failed:', error);
    return NextResponse.json(
      {
        error: timedOut
          ? 'That took too long to think about. Try asking something more specific.'
          : 'Something went wrong. Try again.',
      },
      { status: timedOut ? 504 : 500 }
    );
  }
}
