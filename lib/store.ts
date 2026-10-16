import 'server-only';
import { BrowserCookie } from './netflix-cookies';
import { db, must, StorageError } from './db';

/**
 * Supabase-backed storage. Supabase is the only source of truth: there is no
 * cache, no /tmp file and no seed fallback. Every function throws a
 * StorageError if the database cannot be read or written.
 */

export type AccountStatus = 'live' | 'expiring_soon' | 'expired' | 'needs_reimport' | 'unverified' | 'unknown';
export type ActivationAction = 'tv_login' | 'household_update';
export type ActivationStatus = 'success' | 'failed' | 'rate_limited' | 'blocked';

export interface NetflixAccount {
  id: string;
  profileName: string;
  accountLabel: string;
  accountEmail?: string;
  userAgent?: string;
  deviceMetadata?: Record<string, unknown>;
  cookies: BrowserCookie[];
  status: AccountStatus;
  earliestExpiryIso?: string | null;
  lastCheckedAt: string | null;
  lastRefreshedAt?: string | null;
  lastResult: string | null;
  lastDetail: string;
  consecutiveFailures?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  mobile: string;
  service: string;
  subscriptionDate: string;
  validity: string;
  expiryDate: string;
  assignedAccountId: string | null;
  isBlocked: boolean;
  tvQuotaResetAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivationLogItem {
  id: string;
  subscriberId: string | null;
  mobile: string;
  action: ActivationAction;
  code?: string;
  ip: string;
  status: ActivationStatus;
  accountUsed?: string;
  notes?: string;
  timestamp: string;
}

export interface AppSettings {
  companyName: string;
  supportWhatsapp: string;
  maxUpdatesPerMonth: number;
  logRetentionDays: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalizes to a 10-digit mobile (strips +91 / 0 prefixes), or null. */
export function normalizeMobile(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (/^\d{10}$/.test(d)) return d;
  if (/^91\d{10}$/.test(d) || /^0\d{10}$/.test(d)) return d.slice(-10);
  return null;
}

/** Start of the current calendar month in India time, as a UTC Date. */
export function indiaMonthStart(now = new Date()): Date {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60 * 1000);
}

/** Today's date (YYYY-MM-DD) in India time. */
export function indiaToday(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** "1st November 2026" style label for the first day of next month (India time). */
export function nextMonthLabel(now = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  const next = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1));
  return `1st ${next.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
}

function toAccount(r: any): NetflixAccount {
  return {
    id: r.id,
    profileName: r.profile_name,
    accountLabel: r.account_label || r.profile_name,
    accountEmail: r.account_email || '',
    userAgent: r.user_agent || '',
    deviceMetadata: r.device_metadata || {},
    cookies: Array.isArray(r.cookies) ? r.cookies : [],
    status: r.status,
    earliestExpiryIso: r.earliest_expiry,
    lastCheckedAt: r.last_checked_at,
    lastRefreshedAt: r.last_refreshed_at,
    lastResult: r.last_result,
    lastDetail: r.last_detail || '',
    consecutiveFailures: r.consecutive_failures || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toCustomer(r: any): Customer {
  return {
    id: r.id,
    mobile: r.mobile,
    service: r.service,
    subscriptionDate: r.subscription_date || '',
    validity: r.validity,
    expiryDate: r.expiry_date || '',
    assignedAccountId: r.assigned_account_id,
    isBlocked: r.is_blocked,
    tvQuotaResetAt: r.tv_quota_reset_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toActivation(r: any): ActivationLogItem {
  return {
    id: String(r.id),
    subscriberId: r.subscriber_id,
    mobile: r.mobile,
    action: r.action,
    code: r.code || undefined,
    ip: r.ip || 'unknown',
    status: r.status,
    accountUsed: r.account_id || undefined,
    notes: r.notes || undefined,
    timestamp: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Netflix accounts (cookie_pool)
// ---------------------------------------------------------------------------

export async function listAccounts(): Promise<NetflixAccount[]> {
  const rows = must(
    await db().from('cookie_pool').select('*').order('created_at', { ascending: false }),
    'loading Netflix accounts'
  );
  return rows.map(toAccount);
}

export async function getAccount(id: string): Promise<NetflixAccount | null> {
  const row = must(await db().from('cookie_pool').select('*').eq('id', id).maybeSingle(), 'loading Netflix account');
  return row ? toAccount(row) : null;
}

export interface AccountInput {
  profileName: string;
  accountLabel: string;
  accountEmail: string;
  userAgent: string;
  deviceMetadata?: Record<string, unknown>;
  cookies: BrowserCookie[];
  status: AccountStatus;
  earliestExpiryIso: string | null;
}

/** Creates an account, or replaces the cookies/details of an existing one. */
export async function saveAccount(input: AccountInput, id?: string): Promise<NetflixAccount> {
  const payload: Record<string, unknown> = {
    profile_name: input.profileName,
    account_label: input.accountLabel,
    account_email: input.accountEmail || null,
    user_agent: input.userAgent,
    cookies: input.cookies,
    status: input.status,
    earliest_expiry: input.earliestExpiryIso,
    consecutive_failures: 0,
  };
  if (input.deviceMetadata) payload.device_metadata = input.deviceMetadata;

  if (id) {
    payload.last_detail = 'Cookies re-imported, ready to test';
    const row = must(
      await db().from('cookie_pool').update(payload).eq('id', id).select('*').maybeSingle(),
      'updating Netflix account'
    );
    if (!row) throw new StorageError('Netflix account not found');
    return toAccount(row);
  }

  payload.last_detail = 'Imported, ready to test and keep alive';
  const row = must(await db().from('cookie_pool').insert(payload).select('*').single(), 'saving Netflix account');
  return toAccount(row);
}

export interface AccountHealth {
  cookies: BrowserCookie[];
  status: AccountStatus;
  lastResult: string;
  lastDetail: string;
  lastCheckedAt: string;
  lastRefreshedAt: string | null;
  earliestExpiryIso: string | null;
  ok: boolean;
}

/** Persists a keepalive/test result, including any refreshed cookies from Netflix. */
export async function saveAccountHealth(account: NetflixAccount, h: AccountHealth): Promise<NetflixAccount> {
  const row = must(
    await db()
      .from('cookie_pool')
      .update({
        cookies: h.cookies,
        status: h.status,
        last_result: h.lastResult,
        last_detail: h.lastDetail,
        last_checked_at: h.lastCheckedAt,
        last_refreshed_at: h.lastRefreshedAt,
        earliest_expiry: h.earliestExpiryIso,
        consecutive_failures: h.ok ? 0 : (account.consecutiveFailures || 0) + 1,
      })
      .eq('id', account.id)
      .select('*')
      .maybeSingle(),
    'saving Netflix account status'
  );
  if (!row) throw new StorageError('Netflix account was deleted while it was being checked');
  return toAccount(row);
}

/** Deletes an account. Linked customers are unassigned by the database (ON DELETE SET NULL). */
export async function deleteAccount(id: string): Promise<void> {
  must(await db().from('cookie_pool').delete().eq('id', id), 'deleting Netflix account');
}

// ---------------------------------------------------------------------------
// Customers (subscribers)
// ---------------------------------------------------------------------------

export async function listCustomers(): Promise<Customer[]> {
  const out: Customer[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const rows = must(
      await db()
        .from('subscribers')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, from + page - 1),
      'loading customers'
    );
    out.push(...rows.map(toCustomer));
    if (rows.length < page) return out;
  }
}

export async function getCustomerByMobile(mobile: string): Promise<Customer | null> {
  const clean = normalizeMobile(mobile);
  if (!clean) return null;
  const row = must(
    await db().from('subscribers').select('*').eq('mobile', clean).maybeSingle(),
    'looking up customer'
  );
  return row ? toCustomer(row) : null;
}

export interface CustomerInput {
  mobile: string;
  service: string;
  subscriptionDate: string | null;
  validity: string;
  expiryDate: string | null;
  assignedAccountId: string | null;
  isBlocked: boolean;
}

function customerRow(c: CustomerInput) {
  return {
    mobile: c.mobile,
    service: c.service,
    subscription_date: c.subscriptionDate || null,
    validity: c.validity,
    expiry_date: c.expiryDate || null,
    assigned_account_id: c.assignedAccountId || null,
    is_blocked: c.isBlocked,
  };
}

/** Adds a customer (fails if the mobile exists) or edits one by id. */
export async function saveCustomer(input: CustomerInput, id?: string): Promise<Customer> {
  const q = id
    ? db().from('subscribers').update(customerRow(input)).eq('id', id).select('*').maybeSingle()
    : db().from('subscribers').insert(customerRow(input)).select('*').single();
  const res = await q;
  if (res.error?.code === '23505') {
    throw new UserError('A customer with this mobile number already exists');
  }
  const row = must(res, 'saving customer');
  if (!row) throw new UserError('Customer not found');
  return toCustomer(row);
}

export async function setCustomerBlocked(id: string, isBlocked: boolean): Promise<void> {
  must(await db().from('subscribers').update({ is_blocked: isBlocked }).eq('id', id), 'updating customer');
}

export async function deleteCustomer(id: string): Promise<void> {
  must(await db().from('subscribers').delete().eq('id', id), 'deleting customer');
}

/** Lets a customer use their full monthly TV login allowance again from now. */
export async function resetTvQuota(id: string): Promise<boolean> {
  const row = must(
    await db()
      .from('subscribers')
      .update({ tv_quota_reset_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
      .maybeSingle(),
    'resetting TV login counter'
  );
  return Boolean(row);
}

export interface ImportRow {
  mobile: string;
  service?: string;
  subscriptionDate?: string;
  validity?: string;
  expiryDate?: string;
}

/**
 * Imports pasted sheet rows: one record per mobile number. Existing customers
 * get their subscription fields updated; their linked account, block flag and
 * history are left untouched.
 */
export async function importCustomers(
  rows: ImportRow[],
  computeExpiry: (start: string, validity: string) => string
): Promise<{ imported: number; updated: number; invalid: string[] }> {
  const byMobile = new Map<string, ReturnType<typeof customerRow>>();
  const invalid: string[] = [];
  const today = indiaToday();

  for (const r of rows) {
    const mobile = normalizeMobile(r.mobile);
    if (!mobile) {
      if (String(r.mobile || '').trim()) invalid.push(String(r.mobile));
      continue;
    }
    const start = r.subscriptionDate || today;
    const validity = r.validity || '1 Month';
    byMobile.set(mobile, {
      mobile,
      service: r.service || 'Netflix',
      subscription_date: start,
      validity,
      expiry_date: r.expiryDate || computeExpiry(start, validity),
    } as ReturnType<typeof customerRow>);
  }

  const mobiles = [...byMobile.keys()];
  const existing = new Set<string>();
  for (let i = 0; i < mobiles.length; i += 200) {
    const found = must(
      await db().from('subscribers').select('mobile').in('mobile', mobiles.slice(i, i + 200)),
      'checking existing customers'
    );
    found.forEach((f: any) => existing.add(f.mobile));
  }

  const payload = [...byMobile.values()];
  for (let i = 0; i < payload.length; i += 200) {
    must(
      await db().from('subscribers').upsert(payload.slice(i, i + 200), { onConflict: 'mobile' }),
      'importing customers'
    );
  }

  return { imported: mobiles.length - existing.size, updated: existing.size, invalid };
}

// ---------------------------------------------------------------------------
// Activations
// ---------------------------------------------------------------------------

export async function listActivations(limit = 1000): Promise<ActivationLogItem[]> {
  const rows = must(
    await db().from('activations').select('*').order('created_at', { ascending: false }).limit(limit),
    'loading activity log'
  );
  return rows.map(toActivation);
}

/** Successful TV logins since the start of this India calendar month. */
export async function listTvLoginsThisMonth(): Promise<ActivationLogItem[]> {
  const rows = must(
    await db()
      .from('activations')
      .select('*')
      .eq('action', 'tv_login')
      .eq('status', 'success')
      .gte('created_at', indiaMonthStart().toISOString())
      .limit(10000),
    'counting TV logins'
  );
  return rows.map(toActivation);
}

export async function logActivation(entry: {
  subscriberId: string | null;
  mobile: string;
  action: ActivationAction;
  status: ActivationStatus;
  ip?: string;
  code?: string;
  accountId?: string | null;
  notes?: string;
}): Promise<void> {
  must(
    await db().from('activations').insert({
      subscriber_id: entry.subscriberId,
      mobile: entry.mobile,
      action: entry.action,
      status: entry.status,
      ip: entry.ip || null,
      code: entry.code || null,
      account_id: entry.accountId || null,
      notes: entry.notes || null,
    }),
    'writing activity log'
  );
}

export async function pruneActivations(retentionDays: number): Promise<void> {
  const cutoff = new Date(Date.now() - Math.max(31, retentionDays) * 24 * 60 * 60 * 1000);
  must(await db().from('activations').delete().lt('created_at', cutoff.toISOString()), 'pruning old activity log');
}

// ---------------------------------------------------------------------------
// TV login (atomic, enforced in the database)
// ---------------------------------------------------------------------------

export interface TvLoginResult {
  ok: boolean;
  reason?: 'not_found' | 'blocked' | 'expired' | 'monthly_limit' | 'account_unavailable' | 'no_account';
  used: number;
  max: number;
  expiryDate?: string;
  accountId?: string;
  accountLabel?: string;
  accountEmail?: string | null;
}

/**
 * Checks eligibility, enforces the monthly limit, picks/keeps the linked
 * account and logs the attempt in a single database transaction
 * (see screenhub_record_tv_login in the migration).
 */
export async function recordTvLogin(mobile: string, code: string, ip: string): Promise<TvLoginResult> {
  const r: any = must(
    await db().rpc('screenhub_record_tv_login', { p_mobile: mobile, p_code: code, p_ip: ip }),
    'recording TV login'
  );
  return {
    ok: Boolean(r?.ok),
    reason: r?.reason,
    used: Number(r?.used) || 0,
    max: Number(r?.max) || 2,
    expiryDate: r?.expiry_date,
    accountId: r?.account_id,
    accountLabel: r?.account_label,
    accountEmail: r?.account_email,
  };
}

/**
 * Finalizes the TV login that recordTvLogin just logged as a success, once
 * Netflix has answered. A failed confirmation is re-marked as failed so it
 * does not count toward the monthly limit.
 */
export async function finalizeTvLogin(
  subscriberMobile: string,
  code: string,
  ok: boolean,
  notes: string
): Promise<void> {
  const row: any = must(
    await db()
      .from('activations')
      .select('id')
      .eq('mobile', subscriberMobile)
      .eq('action', 'tv_login')
      .eq('status', 'success')
      .eq('code', code)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'finding TV login record'
  );
  if (!row) return;
  must(
    await db()
      .from('activations')
      .update({ status: ok ? 'success' : 'failed', notes: notes.slice(0, 500) })
      .eq('id', row.id),
    'updating TV login record'
  );
}

/** Saves cookies Netflix refreshed during a TV sign-in, and flags a logged-out session. */
export async function updateAccountAfterTvLogin(
  accountId: string,
  cookies: BrowserCookie[],
  sessionExpired: boolean,
  detail: string
): Promise<void> {
  const patch: Record<string, unknown> = { cookies };
  if (sessionExpired) {
    patch.status = 'needs_reimport';
    patch.last_result = 'needs_reimport';
    patch.last_detail = detail;
    patch.last_checked_at = new Date().toISOString();
  }
  must(await db().from('cookie_pool').update(patch).eq('id', accountId), 'saving account cookies');
}

// ---------------------------------------------------------------------------
// Eligibility (used for household update and for showing quota)
// ---------------------------------------------------------------------------

export interface EligibilityResult {
  eligible: boolean;
  reason?: 'not_found' | 'blocked' | 'expired' | 'monthly_limit';
  message: string;
  customer?: Customer;
  currentCount: number;
  maxCount: number;
  nextAllowedDate?: string;
}

async function countTvLoginsThisMonth(c: Customer): Promise<number> {
  const monthStart = indiaMonthStart();
  const from =
    c.tvQuotaResetAt && new Date(c.tvQuotaResetAt) > monthStart ? new Date(c.tvQuotaResetAt) : monthStart;
  const res = await db()
    .from('activations')
    .select('id', { count: 'exact', head: true })
    .eq('subscriber_id', c.id)
    .eq('action', 'tv_login')
    .eq('status', 'success')
    .gte('created_at', from.toISOString());
  if (res.error) throw new StorageError(`Database error while counting TV logins: ${res.error.message}`);
  return res.count || 0;
}

/**
 * TV login: max N per calendar month (India time). Household update: unlimited.
 * The authoritative TV check happens in recordTvLogin; this is for display
 * and for gating the household link.
 */
export async function checkCustomerEligibility(
  mobile: string,
  action: ActivationAction
): Promise<EligibilityResult> {
  const [customer, settings] = await Promise.all([getCustomerByMobile(mobile), getSettings()]);
  const max = settings.maxUpdatesPerMonth;

  if (!customer) {
    return {
      eligible: false,
      reason: 'not_found',
      message:
        'No active Netflix subscription found for this mobile number. Please check your number or contact support on WhatsApp.',
      currentCount: 0,
      maxCount: max,
    };
  }
  if (customer.isBlocked) {
    return {
      eligible: false,
      reason: 'blocked',
      message: 'Your access has been blocked. Please contact support on WhatsApp.',
      customer,
      currentCount: 0,
      maxCount: max,
    };
  }
  if (customer.expiryDate && customer.expiryDate < indiaToday()) {
    return {
      eligible: false,
      reason: 'expired',
      message: `Your Netflix subscription expired on ${customer.expiryDate}. Please renew to continue.`,
      customer,
      currentCount: 0,
      maxCount: max,
    };
  }
  if (action === 'household_update') {
    return { eligible: true, message: 'Eligible for household update', customer, currentCount: 0, maxCount: 0 };
  }

  const used = await countTvLoginsThisMonth(customer);
  if (used >= max) {
    const next = nextMonthLabel();
    return {
      eligible: false,
      reason: 'monthly_limit',
      message: `Monthly TV login limit reached: you have used ${used}/${max} TV logins this month. Your limit resets on ${next}.`,
      customer,
      currentCount: used,
      maxCount: max,
      nextAllowedDate: next,
    };
  }
  return { eligible: true, message: 'Eligible for TV login', customer, currentCount: used, maxCount: max };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<AppSettings> {
  const row: any = must(
    await db().from('app_settings').select('*').eq('id', 'default').maybeSingle(),
    'loading settings'
  );
  if (!row) throw new StorageError('Settings row is missing. Run the Supabase migration.');
  return {
    companyName: row.company_name,
    supportWhatsapp: row.support_whatsapp,
    maxUpdatesPerMonth: row.max_tv_logins_per_month,
    logRetentionDays: row.log_retention_days,
  };
}

export async function saveSettings(s: Partial<AppSettings>): Promise<AppSettings> {
  const patch: Record<string, unknown> = {};
  if (s.companyName !== undefined) patch.company_name = s.companyName;
  if (s.supportWhatsapp !== undefined) patch.support_whatsapp = s.supportWhatsapp;
  if (s.maxUpdatesPerMonth !== undefined) patch.max_tv_logins_per_month = s.maxUpdatesPerMonth;
  if (s.logRetentionDays !== undefined) patch.log_retention_days = s.logRetentionDays;
  must(await db().from('app_settings').update(patch).eq('id', 'default'), 'saving settings');
  return getSettings();
}

// ---------------------------------------------------------------------------
// Storage status (read-only)
// ---------------------------------------------------------------------------

export interface StorageStatus {
  ok: boolean;
  provider: 'supabase';
  label: string;
  isPersistent: boolean;
  details: string;
  counts?: Record<string, number>;
}

export async function getStorageStatus(): Promise<StorageStatus> {
  try {
    const tables = ['subscribers', 'cookie_pool', 'activations', 'app_settings'];
    const counts: Record<string, number> = {};
    await Promise.all(
      tables.map(async (t) => {
        const res = await db().from(t).select('*', { count: 'exact', head: true });
        if (res.error) throw new StorageError(`Table "${t}": ${res.error.message || res.error.code}`);
        counts[t] = res.count || 0;
      })
    );
    if (!counts.app_settings) throw new StorageError('Settings row is missing. Run the Supabase migration.');
    return {
      ok: true,
      provider: 'supabase',
      label: 'Supabase (permanent)',
      isPersistent: true,
      details: 'Connected to Supabase with the service role key',
      counts,
    };
  } catch (err: any) {
    return {
      ok: false,
      provider: 'supabase',
      label: 'Storage error',
      isPersistent: false,
      details: err?.message || 'Could not reach Supabase',
    };
  }
}

/** An error caused by bad input, shown to the user as a 400. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}
