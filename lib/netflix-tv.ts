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

// ---------------------------------------------------------------------------
// New Netflix code page (2026): the page is a server-driven "CLCS" screen and
// the code is sent with a GraphQL mutation instead of a form POST.
// ---------------------------------------------------------------------------

const GRAPHQL_URL = 'https://www.netflix.com/graphql';
/** Persisted query id of the CLCSScreenUpdate mutation in Netflix's login client. */
const CLCS_SCREEN_UPDATE_ID = '43a29c42-1f93-4e18-80b6-97dfbb6483c6';
const MAX_CLCS_STEPS = 3;

interface ClcsAction {
  serverScreenUpdate: string;
  inputFieldIds: string[];
  label: string;
}

interface ClcsScreen {
  serverState: string;
  viewName: string;
  screenName: string;
  texts: string[];
  codeError?: string;
  actions: ClcsAction[];
}

function isClcsPage(html: string): boolean {
  return html.includes('"serverState":"') && html.includes('CLCSRequestScreenUpdate');
}

/** Walks a CLCS screen (parsed JSON) and collects what we need to drive it. */
function readClcsScreen(screen: any): ClcsScreen {
  const out: ClcsScreen = {
    serverState: String(screen?.serverState || ''),
    viewName: String(screen?.loggingViewName || ''),
    screenName: '',
    texts: [],
    actions: [],
  };
  try {
    out.screenName = JSON.parse(screen?.trackingInfo || '{}').screenName || '';
  } catch {
    // trackingInfo is optional
  }
  const seen = new Set<string>();
  const walk = (n: any, buttonLabel: string) => {
    if (Array.isArray(n)) return n.forEach((v) => walk(v, buttonLabel));
    if (!n || typeof n !== 'object') return;
    if (n.__typename === 'CLCSText' && n.plainContent?.value) out.texts.push(String(n.plainContent.value));
    if (n.initialErrorMessage?.value && /rendezvous|code/i.test(JSON.stringify(n.inputField || n.field || ''))) {
      out.codeError = String(n.initialErrorMessage.value);
    }
    const label = n.__typename === 'CLCSButton' ? String(n.label?.value || '') : buttonLabel;
    if (n.effectType === 'CLCSRequestScreenUpdate' && n.serverScreenUpdate && !seen.has(n.serverScreenUpdate)) {
      seen.add(n.serverScreenUpdate);
      out.actions.push({
        serverScreenUpdate: String(n.serverScreenUpdate),
        inputFieldIds: (n.inputFieldRequirements || []).map((r: any) => String(r?.field?.id || '')).filter(Boolean),
        label,
      });
    }
    for (const v of Object.values(n)) walk(v, label);
  };
  walk(screen?.componentTree, '');
  return out;
}

/** Reads the first screen from the page's embedded data (Netflix escapes it as a JS string). */
function clcsScreenFromHtml(html: string): ClcsScreen | null {
  const state = html.match(/"serverState":"([^"]+)"/)?.[1];
  if (!state) return null;
  const start = html.indexOf('"effectType":"CLCSRequestScreenUpdate"');
  const actions: ClcsAction[] = [];
  const re = /"serverScreenUpdate":"([^"]+)"/g;
  re.lastIndex = Math.max(0, start);
  const m = re.exec(html);
  if (m) {
    const near = html.slice(Math.max(0, start), m.index);
    actions.push({
      serverScreenUpdate: decodeJsString(m[1]),
      inputFieldIds: near.includes('"id":"rendezvousCode"') ? ['rendezvousCode'] : [],
      label: 'Continue',
    });
  }
  return {
    serverState: decodeJsString(state),
    viewName: html.match(/"loggingViewName":"([^"]+)"/)?.[1] || '',
    screenName: '',
    texts: [],
    actions,
  };
}

function screenSummary(s: ClcsScreen): string {
  return `${s.screenName || s.viewName || 'unknown screen'}${s.texts[0] ? ` "${s.texts[0].slice(0, 60)}"` : ''}`;
}

const SUCCESS_TEXT = /all set|you('|’)re (now )?(signed|connected)|connected|signed in|success|enjoy|ready to watch/i;
const SUCCESS_SCREEN = /success|complete|confirmation|connected|done/i;
const LOGIN_SCREEN = /login|password|email|signin|sign_in/i;

async function submitCodeViaClcs(
  html: string,
  code: string,
  headers: Record<string, string>,
  cookieHeader: () => string,
  absorb: (res: Response) => void,
  pageUrl: string
): Promise<{ ok: boolean; outcome: TvPairOutcome; detail: string; netflixMessage?: string }> {
  let screen = clcsScreenFromHtml(html);
  if (!screen || screen.actions.length === 0) {
    return { ok: false, outcome: 'unknown', detail: 'New Netflix code page: could not find the Continue action' };
  }
  let action = screen.actions.find((a) => a.inputFieldIds.includes('rendezvousCode')) || screen.actions[0];
  const steps: string[] = [];

  for (let step = 0; step < MAX_CLCS_STEPS; step++) {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        ...headers,
        Cookie: cookieHeader(),
        'Content-Type': 'application/json',
        Accept: '*/*',
        Origin: 'https://www.netflix.com',
        Referer: pageUrl,
        'x-netflix.context.operation-name': 'CLCSScreenUpdate',
        'x-netflix.request.clcs.bucket': 'high',
      },
      body: JSON.stringify({
        operationName: 'CLCSScreenUpdate',
        variables: {
          format: 'HTML',
          imageFormat: 'PNG',
          locale: 'en-US',
          serverState: screen.serverState,
          serverScreenUpdate: action.serverScreenUpdate,
          inputFields: action.inputFieldIds.includes('rendezvousCode')
            ? [{ name: 'rendezvousCode', value: { stringValue: code } }]
            : [],
        },
        extensions: { persistedQuery: { id: CLCS_SCREEN_UPDATE_ID, version: 102 } },
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    absorb(res);

    if (isLoginRedirect(res)) {
      return { ok: false, outcome: 'session_expired', detail: 'Netflix sent the code submission to login: account cookies are logged out' };
    }
    if (res.status !== 200) {
      return {
        ok: false,
        outcome: res.status === 403 || res.status === 429 ? 'blocked' : 'unknown',
        detail: `Netflix API answered HTTP ${res.status}${steps.length ? ` after ${steps.join(' > ')}` : ''}`,
      };
    }

    const json: any = await res.json().catch(() => null);
    if (json?.errors?.length) {
      return { ok: false, outcome: 'unknown', detail: `Netflix API error: ${String(json.errors[0]?.message || 'unknown').slice(0, 120)}` };
    }
    const result = json?.data?.result;
    const outcomeType = String(result?.__typename || result?.outcomeType || 'none');

    if (!result?.screen) {
      // Navigation away from the code flow (e.g. to /browse) means Netflix is done.
      const text = JSON.stringify(result || {});
      if (/browse|success|complete/i.test(text)) {
        return { ok: true, outcome: 'success', detail: `Netflix accepted the code (${outcomeType})` };
      }
      return { ok: false, outcome: 'unknown', detail: `Netflix answered ${outcomeType} with no screen` };
    }

    screen = readClcsScreen(result.screen);
    steps.push(screenSummary(screen));

    if (screen.codeError) {
      return { ok: false, outcome: 'invalid_code', detail: 'Netflix rejected the code', netflixMessage: screen.codeError };
    }
    if (LOGIN_SCREEN.test(screen.screenName) && !/rendezvous/i.test(screen.screenName)) {
      return { ok: false, outcome: 'session_expired', detail: `Netflix asked to sign in (${screenSummary(screen)}): account cookies are logged out` };
    }
    if (SUCCESS_SCREEN.test(screen.screenName) || SUCCESS_SCREEN.test(screen.viewName) || screen.texts.some((t) => SUCCESS_TEXT.test(t))) {
      return { ok: true, outcome: 'success', detail: `Netflix accepted the code (${screenSummary(screen)})` };
    }

    // A follow-up confirmation (e.g. "Continue" on a confirm screen): press it.
    const next =
      screen.actions.find((a) => a.inputFieldIds.length === 0 && /continue|confirm|yes|next|done|ok/i.test(a.label)) ||
      screen.actions.find((a) => a.inputFieldIds.includes('rendezvousCode'));
    if (!next) break;
    action = next;
  }

  return { ok: false, outcome: 'unknown', detail: `Netflix showed: ${steps.join(' > ') || 'no screen'}` };
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
      if (authURL || isClcsPage(html)) {
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

    if (!authURL && !isClcsPage(html)) {
      const detail = `Netflix code page had no authURL. ${notes.join(' | ')}`.slice(0, 600);
      console.warn('[tv-login] no authURL', { account: account.id, notes });
      return result(false, notes.some((n) => /bot check|HTTP 403|HTTP 429/.test(n)) ? 'blocked' : 'unknown', detail);
    }

    // Netflix randomly serves the old form or the new screen. The old form's
    // POST now answers with the new screen instead of a result, so reload a
    // few times to get the new screen and use its API.
    for (let retry = 0; retry < 4 && !isClcsPage(html); retry++) {
      const again = await fetch(pageUrl, {
        headers: {
          ...baseHeaders,
          Cookie: buildCookieHeader(authCookiesOnly ? cookies.filter((c) => /^(Secure)?NetflixId$/.test(c.name)) : cookies),
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
      absorb(again);
      if (again.status !== 200) break;
      const text = await again.text();
      if (isClcsPage(text)) html = text;
    }

    // 2a. New Netflix page: send the code through its GraphQL screen API.
    if (isClcsPage(html)) {
      const clcs = await submitCodeViaClcs(
        html,
        code,
        baseHeaders,
        () => buildCookieHeader(authCookiesOnly ? cookies.filter((c) => /^(Secure)?NetflixId$/.test(c.name)) : cookies),
        absorb,
        pageUrl
      );
      return result(clcs.ok, clcs.outcome, clcs.detail, clcs.netflixMessage);
    }

    // 2b. Classic page: submit the code exactly as the website form does
    if (!authURL) {
      return result(false, 'unknown', `Netflix code page had no authURL (${describePage(html, new URL(pageUrl).pathname)})`);
    }
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
    if (submit.status === 200 && isClcsPage(body)) {
      const clcs = await submitCodeViaClcs(
        body,
        code,
        baseHeaders,
        () => buildCookieHeader(cookies),
        absorb,
        pageUrl
      );
      return result(clcs.ok, clcs.outcome, `${clcs.detail} (after classic form)`, clcs.netflixMessage);
    }
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
    return result(false, submit.status === 403 || submit.status === 429 ? 'blocked' : 'unknown', `Netflix answered HTTP ${submit.status} (mode=${mode || 'none'}; ${describePage(body, 'code submit')})`, message);
  } catch (err: any) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return result(false, 'blocked', timeout ? 'Netflix did not respond in time' : `Could not reach Netflix: ${err?.message || 'network error'}`);
  }
}
