import { NextRequest, NextResponse } from 'next/server';
import {
  getStorageStatus,
  listAccounts,
  listActivations,
  listCustomers,
  listTvLoginsThisMonth,
  getSettings,
  importCustomers,
  indiaToday,
  indiaMonthStart,
} from '@/lib/store';
import { adminRoute } from '@/lib/api-response';
import { calculateExpiryDate } from '@/lib/validity';
import { buildInfo } from '@/lib/version';

export const GET = adminRoute(async () => {
  const storage = await getStorageStatus();
  if (!storage.ok) {
    return NextResponse.json({ ok: false, storageError: true, message: storage.details, storage, build: buildInfo() }, { status: 503 });
  }

  const [customers, accounts, settings, activations, monthLogins] = await Promise.all([
    listCustomers(),
    listAccounts(),
    getSettings(),
    listActivations(2000),
    listTvLoginsThisMonth(),
  ]);

  const historyBySubscriber = new Map<string, typeof activations>();
  for (const a of activations) {
    if (!a.subscriberId) continue;
    const list = historyBySubscriber.get(a.subscriberId) || [];
    list.push(a);
    historyBySubscriber.set(a.subscriberId, list);
  }

  const monthStart = indiaMonthStart();
  const customersOut = customers.map((c) => {
    const countFrom = c.tvQuotaResetAt && new Date(c.tvQuotaResetAt) > monthStart ? c.tvQuotaResetAt : monthStart.toISOString();
    const history = historyBySubscriber.get(c.id) || [];
    return {
      ...c,
      tvLoginsThisMonth: monthLogins.filter((l) => l.subscriberId === c.id && l.timestamp >= countFrom).length,
      totalUpdates: history.filter((h) => h.status === 'success').length,
      lastUpdateAt: history.find((h) => h.status === 'success')?.timestamp || null,
      history: history.map((h) => ({
        id: h.id,
        date: h.timestamp,
        action: h.action,
        status: h.status,
        code: h.code,
        notes: h.notes,
      })),
    };
  });

  const today = indiaToday();
  const startOfDay = new Date(new Date(`${today}T00:00:00+05:30`).getTime()).toISOString();
  const metrics = {
    totalSubscribers: customers.length,
    activeSubscribers: customers.filter((c) => (!c.expiryDate || c.expiryDate >= today) && !c.isBlocked).length,
    expiredSubscribers: customers.filter((c) => c.expiryDate && c.expiryDate < today).length,
    blockedSubscribers: customers.filter((c) => c.isBlocked).length,
    activationsToday: activations.filter((a) => a.status === 'success' && a.timestamp >= startOfDay).length,
    activationsMonth: activations.filter((a) => a.status === 'success' && a.timestamp >= monthStart.toISOString()).length,
    totalCookieAccounts: accounts.length,
    activeCookies: accounts.filter((a) => a.status === 'live' || a.status === 'expiring_soon').length,
  };

  return NextResponse.json({
    ok: true,
    storage,
    build: buildInfo(),
    data: { customers: customersOut, netflixCookies: accounts, settings, activationsLog: activations, metrics },
  });
});

/**
 * Restore from a backup file. Customers are merged by mobile number
 * (no duplicates); nothing is deleted.
 */
export const POST = adminRoute(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const rows = body?.restoreData?.customers;
  if (!Array.isArray(rows)) {
    return NextResponse.json({ ok: false, message: 'Invalid backup format' }, { status: 400 });
  }
  const result = await importCustomers(rows, calculateExpiryDate);
  return NextResponse.json({
    ok: true,
    message: `Restored customers: ${result.imported} added, ${result.updated} updated.`,
  });
});
