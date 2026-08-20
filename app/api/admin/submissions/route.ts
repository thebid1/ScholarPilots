import { NextRequest, NextResponse } from 'next/server';
import { adminGate } from '@/lib/admin/auth';
import { pendingSubmissions, submissionCounts, type SubmissionStatus } from '@/lib/ingestion/submissions';

/**
 * The review queue. Nothing the ingestion pipeline extracts is visible to
 * students until it has been through here.
 */
export const dynamic = 'force-dynamic';

const STATUSES: SubmissionStatus[] = ['pending', 'approved', 'rejected'];

export async function GET(request: NextRequest) {
  const { denied } = await adminGate(request);
  if (denied) return denied;

  const requested = request.nextUrl.searchParams.get('status') ?? 'pending';
  const status = STATUSES.includes(requested as SubmissionStatus)
    ? (requested as SubmissionStatus)
    : 'pending';

  try {
    const [submissions, counts] = await Promise.all([
      pendingSubmissions(status, 100),
      submissionCounts(),
    ]);
    return NextResponse.json({ status, submissions, counts });
  } catch (error) {
    console.error('[admin] Failed to load submissions:', error);
    return NextResponse.json({ error: 'Could not load the review queue.' }, { status: 500 });
  }
}
