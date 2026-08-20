import { NextRequest, NextResponse } from 'next/server';
import { adminGate } from '@/lib/admin/auth';
import { planIngestion, runIngestion } from '@/lib/ingestion';
import { runBudget, runInFlight } from '@/lib/ingestion/budget';

/**
 * Run the pipeline on demand, alongside the daily cron.
 *
 * `GET` costs nothing: it reports what a run *would* do — the listing pages, the
 * credits it would reserve, and how much of the lifetime pool is left — so the
 * button can be pressed with the price already on screen. `POST` is the only
 * billable call in this file, and takes `maxCredits` so a cautious run can be
 * capped well below the daily budget.
 *
 * Neither writes to `scholarships`. A run files submissions; approval publishes.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

/** A hand-triggered run is capped well below the daily one — this is for spot checks. */
const MAX_MANUAL_CREDITS = 50;

function configured(): string | null {
  if (!process.env.FIRECRAWL_API_KEY) return 'FIRECRAWL_API_KEY is not configured.';
  if (!process.env.FEATHERLESS_API_KEY) return 'FEATHERLESS_API_KEY is not configured.';
  return null;
}

export async function GET(request: NextRequest) {
  const { denied } = await adminGate(request);
  if (denied) return denied;

  try {
    const [plan, inFlight] = await Promise.all([planIngestion(), runInFlight()]);
    return NextResponse.json({
      ...plan,
      inFlight,
      // The clamp the POST will apply, so the UI can bound its own input rather
      // than discovering the limit by being corrected.
      maxManualCredits: MAX_MANUAL_CREDITS,
      defaultCredits: runBudget(),
      configured: configured() === null,
    });
  } catch (error) {
    console.error('[admin] Failed to plan ingestion:', error);
    return NextResponse.json(
      { error: 'Could not plan a run.', detail: String(error).slice(0, 300) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { admin, denied } = await adminGate(request);
  if (denied) return denied;

  const problem = configured();
  if (problem) return NextResponse.json({ error: problem }, { status: 503 });

  // No body is a perfectly good request: it means "use the configured budget".
  const body = await request.json().catch(() => ({})) as Record<string, unknown> | null;
  const asked = Number(body?.maxCredits);
  const maxCredits = Number.isFinite(asked) && asked > 0
    ? Math.min(Math.floor(asked), MAX_MANUAL_CREDITS)
    : undefined;

  // The reservation is what makes a double-run expensive: two overlapping runs
  // each hold their own credits against a pool that never refills.
  if (await runInFlight()) {
    return NextResponse.json(
      { error: 'A run is already in progress. Wait for it to finish before starting another.' },
      { status: 409 }
    );
  }

  try {
    console.log(`[admin] ${admin.email} started ingestion`
      + (maxCredits ? ` with maxCredits=${maxCredits}` : ''));
    return NextResponse.json(await runIngestion({ maxCredits }));
  } catch (error) {
    console.error('[admin] Manual ingestion failed:', error);
    // The message carries the budget state, which is the thing worth knowing when
    // a run refuses to start.
    return NextResponse.json(
      { error: 'Ingestion failed', detail: String(error).slice(0, 300) },
      { status: 500 }
    );
  }
}
