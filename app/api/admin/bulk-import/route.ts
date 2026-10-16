import { NextRequest, NextResponse } from 'next/server';
import { importCustomers } from '@/lib/store';
import { adminRoute } from '@/lib/api-response';
import { calculateExpiryDate } from '@/lib/validity';

export const POST = adminRoute(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body?.rows) || body.rows.length === 0) {
    return NextResponse.json({ ok: false, message: 'No rows provided' }, { status: 400 });
  }

  const { imported, updated, invalid } = await importCustomers(body.rows, calculateExpiryDate);
  const skipped = invalid.length ? ` Skipped ${invalid.length} invalid number(s): ${invalid.slice(0, 10).join(', ')}.` : '';
  return NextResponse.json({
    ok: true,
    message: `Imported ${imported} new customers and updated ${updated} existing records.${skipped}`,
    importedCount: imported,
    updatedCount: updated,
    invalid,
  });
});
