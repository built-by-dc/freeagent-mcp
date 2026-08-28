import { randomBytes } from 'crypto';
import { z } from 'zod';
import { exchangeCodeForTokens } from '../auth/oauth.js';
import type { CallbackServer, PendingAuth, TokenManager } from '../auth/index.js';
import { openBrowser } from '../utils/open-browser.js';

export interface AuthContext {
  tokenManager: TokenManager;
  callbackServer: CallbackServer;
}

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

function pendingToOutput(pending: PendingAuth): {
  state: PendingAuth['state'];
  url: string | null;
  started_at: string | null;
  expires_at: string | null;
  last_error: string | null;
} {
  return {
    state: pending.state,
    url: pending.url,
    started_at: pending.startedAt !== null ? new Date(pending.startedAt).toISOString() : null,
    expires_at: pending.expiresAt !== null ? new Date(pending.expiresAt).toISOString() : null,
    last_error: pending.lastError,
  };
}

function buildStatus(ctx: AuthContext): {
  authenticated: boolean;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  refresh_token_days_remaining: number | null;
  pending_auth: ReturnType<typeof pendingToOutput>;
} {
  const authenticated = ctx.tokenManager.isAuthenticated();
  const snap = ctx.tokenManager.getTokenSnapshot();
  return {
    authenticated,
    access_token_expires_at: snap ? new Date(snap.expiresAt).toISOString() : null,
    refresh_token_expires_at: snap ? new Date(snap.refreshTokenExpiresAt).toISOString() : null,
    refresh_token_days_remaining: snap
      ? Math.max(0, Math.floor((snap.refreshTokenExpiresAt - Date.now()) / MILLIS_PER_DAY))
      : null,
    pending_auth: pendingToOutput(ctx.callbackServer.getPending()),
  };
}

// ========== auth_status ==========

export const authStatusSchema = z.object({}).describe('No arguments.');
export type AuthStatusInput = z.infer<typeof authStatusSchema>;

export async function authStatus(ctx: AuthContext): Promise<ReturnType<typeof buildStatus>> {
  return buildStatus(ctx);
}

// ========== authenticate ==========

export const authenticateSchema = z.object({
  open_browser: z.boolean().optional().describe('Open the OAuth URL in the default browser (default true).'),
  wait_seconds: z
    .number()
    .int()
    .min(1)
    .max(110)
    .optional()
    .describe('How long to wait inline for the callback before returning {pending}. Default 90; absolute deadline always 120.'),
  force: z.boolean().optional().describe('Clear existing tokens and re-run OAuth (default false).'),
});
export type AuthenticateInput = z.infer<typeof authenticateSchema>;

const ABSOLUTE_DEADLINE_MS = 120_000;
const DEFAULT_WAIT_SECONDS = 90;

export async function authenticate(
  ctx: AuthContext,
  input: AuthenticateInput
): Promise<{
  already_authenticated?: true;
  pending?: true;
  url?: string;
  expires_at?: string;
  message?: string;
  error?: 'port_3000_in_use' | 'missing_credentials' | 'user_denied' | 'exchange_failed' | 'timeout';
  detail?: string;
} & Partial<ReturnType<typeof buildStatus>>> {
  const parsed = authenticateSchema.parse(input);
  const openBrowserOpt = parsed.open_browser ?? true;
  const waitSeconds = parsed.wait_seconds ?? DEFAULT_WAIT_SECONDS;
  const force = parsed.force ?? false;

  if (!force && ctx.tokenManager.isAuthenticated()) {
    return { already_authenticated: true, ...buildStatus(ctx) };
  }

  if (force) {
    await ctx.tokenManager.clearTokens();
  }

  const csrfState = randomBytes(32).toString('hex');
  const absoluteDeadlineMs = Date.now() + ABSOLUTE_DEADLINE_MS;

  let startResult: { url: string };
  try {
    startResult = await ctx.callbackServer.start({ csrfState, absoluteDeadlineMs });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      return { error: 'port_3000_in_use', detail: 'Port 3000 is already in use.' };
    }
    return { error: 'exchange_failed', detail: (err as Error).message };
  }

  if (openBrowserOpt) {
    void openBrowser(startResult.url);
  }

  const result = await ctx.callbackServer.waitForCode(waitSeconds * 1000);

  switch (result.status) {
    case 'received': {
      try {
        const tokens = await exchangeCodeForTokens(result.code);
        await ctx.tokenManager.setTokens(tokens);
      } catch (err) {
        await ctx.callbackServer.stop();
        return { error: 'exchange_failed', detail: (err as Error).message };
      }
      await ctx.callbackServer.stop();
      return buildStatus(ctx);
    }
    case 'pending': {
      const pending = ctx.callbackServer.getPending();
      return {
        pending: true,
        url: pending.url ?? startResult.url,
        expires_at: pending.expiresAt !== null ? new Date(pending.expiresAt).toISOString() : new Date(absoluteDeadlineMs).toISOString(),
        message: 'Visit URL, then call auth_status to confirm.',
        ...buildStatus(ctx),
      };
    }
    case 'user_denied':
      await ctx.callbackServer.stop();
      return { error: 'user_denied', detail: result.detail };
    case 'timeout':
      await ctx.callbackServer.stop();
      return { error: 'timeout' };
  }
}
