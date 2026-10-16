import { NextRequest, NextResponse } from 'next/server';
import { deleteCustomer, saveCustomer, setCustomerBlocked } from '@/lib/store';
import { adminRoute } from '@/lib/api-response';
import { calculateExpiryDate } from '@/lib/validity';

export const POST = adminRoute(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const { id, mobile, service, subscriptionDate, validity, expiryDate, assignedAccountId, isBlocked } = body;

  // Block/unblock toggle sends only id + isBlocked
  if (id && mobile === undefined && typeof isBlocked === 'boolean') {
    await setCustomerBlocked(id, isBlocked);
    return NextResponse.json({ ok: true });
  }

  const cleanMobile = String(mobile || '').replace(/\D/g, '');
  if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
    return NextResponse.json({ ok: false, message: 'Please enter a valid 10-digit mobile number' }, { status: 400 });
  }

  const start = subscriptionDate || new Date().toISOString().slice(0, 10);
  const val = validity || '1 Month';
  const customer = await saveCustomer(
    {
      mobile: cleanMobile,
      service: service || 'Netflix',
      subscriptionDate: start,
      validity: val,
      expiryDate: expiryDate || calculateExpiryDate(start, val),
      assignedAccountId: assignedAccountId || null,
      isBlocked: Boolean(isBlocked),
    },
    id || undefined
  );
  return NextResponse.json({ ok: true, customer });
});

export const DELETE = adminRoute(async (request: NextRequest) => {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, message: 'Missing customer ID' }, { status: 400 });
  await deleteCustomer(id);
  return NextResponse.json({ ok: true });
});
