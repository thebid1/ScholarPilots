import { NextRequest, NextResponse } from 'next/server';
import { runIngestion } from '@/lib/ingestion';

/**
 * Daily catalog refresh. Scrapes listing sites for leads, traces each one to the
 * funder's own page, and files what it reads there for review — including proposed
 * changes to rows it created earlier. It writes nothing to `scholarships`; an admin
 * approving a submission at `/admin` is what publishes.
 *
 * Guarded by the shared cron secret, and refuses to run rather than degrade if it
 * is unset — an unauthenticated endpoint that spends a finite Firecrawl allowance
 * is worse than one that is down.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set; refusing to run scholarship ingestion.');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.FIRECRAWL_API_KEY || !process.env.FEATHERLESS_API_KEY) {
    return NextResponse.json({ error: 'Firecrawl and Featherless are not configured' }, { status: 503 });
  }

  // A manual run can ask for a smaller cap than the daily one, for a cautious
  // first run against a live budget.
  const requested = Number(request.nextUrl.searchParams.get('maxCredits'));
  const maxCredits = Number.isInteger(requested) && requested > 0 ? requested : undefined;

  try {
    return NextResponse.json(await runIngestion({ maxCredits }));
  } catch (error) {
    console.error('[cron] Scholarship ingestion failed:', error);
    // The message carries the budget state, which is the thing worth knowing when
    // a run refuses to start.
    return NextResponse.json(
      { error: 'Scholarship ingestion failed', detail: String(error).slice(0, 300) },
      { status: 500 }
    );
  }
}
