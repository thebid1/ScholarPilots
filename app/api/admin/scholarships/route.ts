import { NextRequest, NextResponse } from 'next/server';
import { adminGate } from '@/lib/admin/auth';
import { catalogCounts, listCatalog, saveCatalogFields } from '@/lib/admin/catalog';
import { fieldsFrom } from '@/lib/ingestion/fields';

/**
 * The catalog itself — everything students can see, plus what they cannot.
 *
 * `POST` publishes an award straight away rather than filing a submission: the
 * admin doing the typing is the same person who would approve it. The field
 * checks are identical either way.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { denied } = await adminGate(request);
  if (denied) return denied;

  const search = request.nextUrl.searchParams.get('search') ?? '';

  try {
    const [scholarships, counts] = await Promise.all([
      listCatalog({ search }),
      catalogCounts(),
    ]);
    return NextResponse.json({ scholarships, counts });
  } catch (error) {
    console.error('[admin] Failed to load the catalog:', error);
    return NextResponse.json({ error: 'Could not load the catalog.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { admin, denied } = await adminGate(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const fields = fieldsFrom((body as { fields?: unknown })?.fields ?? body);

  try {
    const result = await saveCatalogFields(fields);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });

    console.log(`[admin] ${admin.email} added ${result.row.external_id} by hand`);
    return NextResponse.json({ ok: true, action: result.action, scholarship: result.row });
  } catch (error) {
    console.error('[admin] Failed to add a scholarship:', error);
    return NextResponse.json(
      { error: 'Could not save the scholarship.', detail: String(error).slice(0, 300) },
      { status: 500 }
    );
  }
}
