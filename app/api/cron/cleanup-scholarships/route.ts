import { NextRequest, NextResponse } from 'next/server';
import { queryDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set; refusing to run scholarship cleanup.');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await queryDb<{ id: string }>(
      `DELETE FROM scholarships
       WHERE deadline < CURRENT_DATE
       RETURNING id`
    );
    if (result.rows.length > 0) await queryDb('DELETE FROM filter_cache');
    return NextResponse.json({ deleted: result.rows.length });
  } catch (error) {
    console.error('[cron] Scholarship cleanup failed:', error);
    return NextResponse.json({ error: 'Scholarship cleanup failed' }, { status: 500 });
  }
}