import { NextRequest, NextResponse } from 'next/server';
import { adminGate } from '@/lib/admin/auth';
import { parseEdits } from '@/lib/ingestion/fields';
import { approveSubmission, rejectSubmission, submissionById } from '@/lib/ingestion/submissions';

/**
 * Approve or reject one submission. Approving is the only path by which anything
 * reaches the `scholarships` table.
 *
 * The reviewer's edits ride along with the approval rather than being saved
 * separately — the same shape as [AddOpportunityModal](app/components/AddOpportunityModal.tsx),
 * where an extraction is corrected and committed in one step. A rejected
 * validation returns 422 with the reason, which the form shows inline; the
 * submission stays pending so the fix is one keystroke away.
 */
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { admin, denied } = await adminGate(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const action = typeof payload.action === 'string' ? payload.action : '';
  const note = typeof payload.note === 'string' ? payload.note : '';

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be "approve" or "reject".' }, { status: 400 });
  }

  try {
    const result = action === 'approve'
      ? await approveSubmission(params.id, parseEdits(payload.fields), admin.email, note)
      : await rejectSubmission(params.id, admin.email, note);

    if (!result.ok) {
      // 404 for a submission that is not there, 422 for one that is but cannot be
      // approved as it stands — the form can only act on the second.
      const status = result.error === 'Submission not found.' ? 404 : 422;
      return NextResponse.json({ error: result.error }, { status });
    }

    console.log(`[admin] ${admin.email} ${action === 'approve' ? 'approved' : 'rejected'}`
      + ` submission ${params.id}`
      + (result.externalId ? ` → ${result.externalId}` : ''));

    return NextResponse.json({
      ok: true,
      action: result.action,
      externalId: result.externalId,
      submission: await submissionById(params.id),
    });
  } catch (error) {
    console.error(`[admin] Failed to ${action} submission ${params.id}:`, error);
    return NextResponse.json(
      { error: `Could not ${action} the submission.`, detail: String(error).slice(0, 300) },
      { status: 500 }
    );
  }
}
