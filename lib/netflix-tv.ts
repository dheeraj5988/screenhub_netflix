import 'server-only';
import { BrowserCookie, buildCookieHeader } from './netflix-cookies';
import { mergeUpdatedCookies } from './netflix-keepalive';
import { NetflixAccount } from './store';

/**
 * Confirms a TV sign-in code on netflix.com/tv2 as the given account, the same
 * as a signed-in member typing the code on the website:
 *   1. GET  /tv2  with the account cookies -> page contains a one-time authURL
 *   2. POST /tv2  with authURL + code      -> Netflix links the TV
 */

const TV_URL = 'https://www.netflix.com/tv2';
const TV_URL_ALT = 'https://www.netflix.com/tv8';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CODE_MODE = 'enterTvLoginRendezvousCode';

export type TvPairOutcome = 'success' | 'invalid_code' | 'session_expired' | 'blocked' | 'unknown';

export interface TvPairResult {
  ok: boolean;
  outcome: TvPairOutcome;
  /** Short, non-secret description for logs and the admin activity view. */
  detail: string;
  /** Netflix's own error text, if it showed one. */
  netflixMessage?: string;
  /** Cookies after merging anything Netflix refreshed during the exchange. */
  cookies: BrowserCookie[];
}

function setCookies(res: Response): string[] {
  const h = res.headers as any;
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  const raw = res.headers.get('set-cookie');
  return raw ? [raw] : [];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function hiddenInput(html: string, name: string): string | null {
  const m =
    html.match(new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"`, 'i')) ||
    html.match(new RegExp(`<input[^>]*value="([^"]*)"[^>]*name="${name}"`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

/** Decodes the \xNN / \uNNNN / \/ escapes Netflix uses inside its embedded JSON. */
function decodeJsString(s: string): string {
  return s
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, '/');
}

/**
 * The one-time authURL: from the hidden form field when the page is
 * server-rendered, otherwise from Netflix's embedded page data.
 */
function findAuthURL(html: string): string | null {
  const fromInput = hiddenInput(html, 'authURL');
  if (fromInput) return fromInput;
  const m = html.match(/"authURL"\s*:\s*"([^"]+)"/);
  return m ? decodeJsString(m[1]) : null;
}

/** Short, non-secret summary of an unexpected page, so the admin log says what Netflix showed. */
function describePage(html: string, path: string): string {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = [`${path}`, `${html.length} bytes`];
  if (title) parts.push(`title "${decodeEntities(title).slice(0, 60)}"`);
  if (h1) parts.push(`heading "${decodeEntities(h1).slice(0, 60)}"`);
  parts.push(html.includes('reactContext') ? 'page data present' : 'no page data');
  return parts.join(', ');
}

function isProfileGate(html: string): boolean {
  return /profile-gate|data-uia="profile-link"|Who(?:&#x27;|'|’)s watching/i.test(html);
}

function isChallengePage(html: string): boolean {
  return /captcha|challenge-platform|cf-chl|Access Denied|unusual traffic/i.test(html);
}

/** Page "mode" from Netflix's embedded reactContext (e.g. enterTvLoginRendezvousCode). */
function pageMode(html: string): string | null {
  const m = html.match(/"trackingInfo":\{[^}]*"mode":"([^"]+)"/) || html.match(/"mode":"([^"]+)"/);
  return m ? m[1] : null;
}

function errorText(html: string): string | undefined {
  const m =
    html.match(/class="[^"]*ui-message-contents[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
    html.match(/data-uia="[^"]*(?:error|UIMessage)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|span)>/i);
  if (!m) return undefined;
  const text = decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function isMobileUserAgent(ua: string): boolean {
  return /Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(ua);
}

function isLoginRedirect(res: Response): boolean {
  const loc = (res.headers.get('location') || '').toLowerCase();
  return res.status >= 300 && res.status < 400 && loc.includes('/login');
}

export async function confirmTvCode(account: NetflixAccount, rawCode: string): Promise<TvPairResult> {
  const code = rawCode.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  let cookies = account.cookies || [];
  // Netflix serves phones a script-only version of the code page with no form,
  // so a phone User-Agent (e.g. cookies added from the admin panel on a phone)
  // is swapped for a desktop one here.
  const savedUa = account.userAgent?.trim() || '';
  const ua = savedUa && !isMobileUserAgent(savedUa) ? savedUa : DEFAULT_USER_AGENT;
  const baseHeaders = {
    'User-Agent': ua,
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
  };
  const absorb = (res: Response) => {
    cookies = mergeUpdatedCookies(cookies, setCookies(res)).merged;
  };
  const result = (ok: boolean, outcome: TvPairOutcome, detail: string, netflixMessage?: string): TvPairResult => ({
    ok,
    outcome,
    detail,
    netflixMessage,
    cookies,
  });

  try {
    // 1. Load the code page as the account. Netflix serves the same form on
    //    /tv2 and /tv8; if one variant has no authURL, try the other, and
    //    finally with only the login cookies (stale helper cookies can make
    //    Netflix serve a different page).
    const authOnly = cookies.filter((c) => /^(Secure)?NetflixId$/.test(c.name));
    const attempts: Array<{ url: string; jar: 'all' | 'auth' }> = [
      { url: TV_URL, jar: 'all' },
      { url: TV_URL_ALT, jar: 'all' },
      ...(authOnly.length > 0 && authOnly.length < cookies.length ? [{ url: TV_URL, jar: 'auth' as const }] : []),
    ];

    let html = '';
    let pageUrl = TV_URL;
    let authCookiesOnly = false;
    let authURL: string | null = null;
    const notes: string[] = [];

    for (const attempt of attempts) {
      const jar = attempt.jar === 'auth' ? authOnly : cookies;
      const page = await fetch(attempt.url, {
        headers: {
          ...baseHeaders,
          Cookie: buildCookieHeader(jar),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Upgrade-Insecure-Requests': '1',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
        cache: 'no-store',
      });
      absorb(page);
      const path = new URL(attempt.url).pathname + (attempt.jar === 'auth' ? ' (login cookies only)' : '');

      if (isLoginRedirect(page)) {
        return result(false, 'session_expired', 'Netflix redirected the code page to login: account cookies are logged out');
      }
      if (page.status >= 300 && page.status < 400) {
        notes.push(`${path} -> HTTP ${page.status} ${page.headers.get('location') || ''}`.trim());
        continue;
      }
      if (page.status !== 200) {
        notes.push(`${path} -> HTTP ${page.status}`);
        continue;
      }

      html = await page.text();

      // The code page also loads when logged out, so check who Netflix thinks we are.
      const membership = html.match(/"membershipStatus":"([A-Z_]+)"/)?.[1];
      if (membership && membership !== 'CURRENT_MEMBER') {
        return result(
          false,
          'session_expired',
          membership === 'ANONYMOUS'
            ? 'Netflix treats these cookies as logged out (membershipStatus=ANONYMOUS)'
            : `Netflix account is not an active member (membershipStatus=${membership})`
        );
      }

      authURL = findAuthURL(html);
      if (authURL) {
        pageUrl = attempt.url;
        authCookiesOnly = attempt.jar === 'auth';
        break;
      }
      notes.push(
        isChallengePage(html)
          ? `${path}: Netflix showed a bot check`
          : isProfileGate(html)
            ? `${path}: Netflix showed the profile picker`
            : `${path}: no authURL (mode=${pageMode(html) || 'none'}; ${describePage(html, path)})`
      );
    }

    if (!authURL) {
      const detail = `Netflix code page had no authURL. ${notes.join(' | ')}`.slice(0, 600);
      console.warn('[tv-login] no authURL', { account: account.id, notes });
      return result(false, notes.some((n) => /bot check|HTTP 403|HTTP 429/.test(n)) ? 'blocked' : 'unknown', detail);
    }

    // 2. Submit the code exactly as the website form does
    const form = new URLSearchParams({
      flow: hiddenInput(html, 'flow') || 'websiteSignUp',
      authURL,
      flowMode: hiddenInput(html, 'flowMode') || CODE_MODE,
      withFields: hiddenInput(html, 'withFields') || 'tvLoginRendezvousCode,isTvUrl2',
      code,
      tvLoginRendezvousCode: code,
      isTvUrl2: 'true',
      action: hiddenInput(html, 'action') || 'nextAction',
    });

    const submit = await fetch(pageUrl, {
      method: 'POST',
      headers: {
        ...baseHeaders,
        Cookie: buildCookieHeader(authCookiesOnly ? cookies.filter((c) => /^(Secure)?NetflixId$/.test(c.name)) : cookies),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Origin: 'https://www.netflix.com',
        Referer: pageUrl,
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Upgrade-Insecure-Requests': '1',
      },
      body: form.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    absorb(submit);

    if (isLoginRedirect(submit)) {
      return result(false, 'session_expired', 'Netflix redirected the code submission to login: account cookies are logged out');
    }

    // A redirect away from the code page means Netflix accepted the code.
    const location = submit.headers.get('location') || '';
    if (submit.status >= 300 && submit.status < 400) {
      if (/tv2|tv8/i.test(location) && !/success/i.test(location)) {
        return result(false, 'unknown', `Netflix redirected back to the code page (${location})`);
      }
      return result(true, 'success', `Netflix accepted the code (HTTP ${submit.status} -> ${location || 'no location'})`);
    }

    const body = await submit.text();
    const mode = pageMode(body);
    const message = errorText(body);

    if (submit.status === 200 && mode && mode !== CODE_MODE) {
      return /success|complete|done/i.test(mode) || !message
        ? result(true, 'success', `Netflix accepted the code (page mode=${mode})`)
        : result(false, 'unknown', `Netflix showed page mode=${mode}`, message);
    }
    if (submit.status === 200 && mode === CODE_MODE) {
      return result(false, 'invalid_code', 'Netflix rejected the code (still on the code page)', message);
    }
    return result(false, submit.status === 403 || submit.status === 429 ? 'blocked' : 'unknown', `Netflix answered HTTP ${submit.status} (mode=${mode || 'none'})`, message);
  } catch (err: any) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return result(false, 'blocked', timeout ? 'Netflix did not respond in time' : `Could not reach Netflix: ${err?.message || 'network error'}`);
  }
}
