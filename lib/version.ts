/**
 * App version, shown in the admin header so you can see which build is live.
 * Bump it whenever you ship a change you want to be able to confirm.
 */
export const APP_VERSION = '1.1';

export interface BuildInfo {
  version: string;
  /** Short git commit Vercel built this deployment from (empty outside Vercel). */
  commit: string;
}

export function buildInfo(): BuildInfo {
  return { version: APP_VERSION, commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) };
}
