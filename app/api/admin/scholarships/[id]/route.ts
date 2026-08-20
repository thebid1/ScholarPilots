import { NextRequest, NextResponse } from 'next/server';
import { adminGate } from '@/lib/admin/auth';
import { deleteCatalogRow, updateCatalogRow } from '@/lib/admin/catalog';
import { parseEdits } from '@/lib/ingestion/fields';

/**
 * Edit or delete one catalog row. `id` is the row's `external_id`.
 *
 * `PATCH` lays the posted fields over the stored ones and re-runs every check, so
 * an edit cannot leave behind a row the pipeline would have refused to write.
 * `DELETE` removes the row outright.
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

  const edits = parseEdits((body as { fields?: unknown })?.fields ?? body);

  try {
    const result = await updateCatalogRow(params.id, edits);
    if (!result.ok) {
      const status = result.error === 'That scholarship is not in the catalog.' ? 404 : 422;
      return NextResponse.json({ error: result.error }, { status });
    }

    console.log(`[admin] ${admin.email} edited ${params.id}`);
    return NextResponse.json({ ok: true, scholarship: result.row });
  } catch (error) {
    console.error(`[admin] Failed to edit ${params.id}:`, error);
    return NextResponse.json(
      { error: 'Could not save the changes.', detail: String(error).slice(0, 300) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { admin, denied } = await adminGate(request);
  if (denied) return denied;

  try {
    const removed = await deleteCatalogRow(params.id);
    if (!removed) {
      return NextResponse.json({ error: 'That scholarship is not in the catalog.' }, { status: 404 });
    }

    console.log(`[admin] ${admin.email} deleted ${params.id}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[admin] Failed to delete ${params.id}:`, error);
    return NextResponse.json(
      { error: 'Could not delete the scholarship.', detail: String(error).slice(0, 300) },
      { status: 500 }
    );
  }
}
