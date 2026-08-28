import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  config: {
    freeagent: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3000/callback',
      environment: 'sandbox',
    },
    tokenEncryptionKey: 'test-key',
    logLevel: 'info',
  },
  FREEAGENT_API_BASE: 'https://api.sandbox.freeagent.com/v2',
  FREEAGENT_AUTH_URL: 'https://api.sandbox.freeagent.com/v2/approve_app',
  FREEAGENT_TOKEN_URL: 'https://api.sandbox.freeagent.com/v2/token_endpoint',
}));

vi.mock('../../src/utils/open-browser.js', () => ({
  openBrowser: vi.fn(async () => true),
}));

vi.mock('../../src/auth/oauth.js', () => ({
  generateAuthorizationUrl: vi.fn(() => 'https://oauth.example/x'),
  exchangeCodeForTokens: vi.fn(async () => ({
    accessToken: 'access-test',
    refreshToken: 'refresh-test',
    expiresAt: Date.now() + 3_600_000,
    refreshTokenExpiresAt: Date.now() + 14 * 24 * 3_600_000,
  })),
  refreshAccessToken: vi.fn(),
}));

import {
  authStatus,
  authStatusSchema,
  authenticate,
  authenticateSchema,
} from '../../src/tools/auth-tools.js';
import type { TokenManager } from '../../src/auth/index.js';
import type { CallbackServer, PendingAuth, WaitForCodeResult } from '../../src/auth/index.js';
import { openBrowser } from '../../src/utils/open-browser.js';

function makeTokenManager(opts: {
  authenticated?: boolean;
  accessExpiresAt?: number;
  refreshExpiresAt?: number;
} = {}): TokenManager {
  return {
    getAccessToken: vi.fn(),
    setTokens: vi.fn(),
    isAuthenticated: vi.fn(() => opts.authenticated ?? false),
    clearTokens: vi.fn(async () => undefined),
    getTokenSnapshot: vi.fn(() =>
      opts.authenticated
        ? {
            expiresAt: opts.accessExpiresAt ?? Date.now() + 3_600_000,
            refreshTokenExpiresAt: opts.refreshExpiresAt ?? Date.now() + 14 * 24 * 3_600_000,
          }
        : null
    ),
  } as unknown as TokenManager;
}

function makeCallbackServer(opts: {
  pending?: PendingAuth;
  waitResult?: WaitForCodeResult;
  startUrl?: string;
} = {}): CallbackServer {
  const idle: PendingAuth = {
    state: 'idle',
    url: null,
    csrfState: null,
    startedAt: null,
    expiresAt: null,
    lastError: null,
  };
  return {
    start: vi.fn(async () => ({ url: opts.startUrl ?? 'https://oauth.example/x' })),
    waitForCode: vi.fn(async () => opts.waitResult ?? { status: 'pending' }),
    stop: vi.fn(async () => undefined),
    getPending: vi.fn(() => opts.pending ?? idle),
    getActualPort: vi.fn(() => 3000),
  };
}

describe('auth_status', () => {
  it('reports unauthenticated when no tokens', async () => {
    const tm = makeTokenManager({ authenticated: false });
    const cb = makeCallbackServer();
    const out = await authStatus({ tokenManager: tm, callbackServer: cb });
    expect(out.authenticated).toBe(false);
    expect(out.access_token_expires_at).toBeNull();
    expect(out.refresh_token_expires_at).toBeNull();
    expect(out.refresh_token_days_remaining).toBeNull();
    expect(out.pending_auth.state).toBe('idle');
  });

  it('reports authenticated and expiry metadata', async () => {
    const accessExp = Date.now() + 60 * 60 * 1000;
    const refreshExp = Date.now() + 7 * 24 * 3_600_000;
    const tm = makeTokenManager({
      authenticated: true,
      accessExpiresAt: accessExp,
      refreshExpiresAt: refreshExp,
    });
    const cb = makeCallbackServer();
    const out = await authStatus({ tokenManager: tm, callbackServer: cb });
    expect(out.authenticated).toBe(true);
    expect(out.access_token_expires_at).toBe(new Date(accessExp).toISOString());
    expect(out.refresh_token_expires_at).toBe(new Date(refreshExp).toISOString());
    expect(out.refresh_token_days_remaining).toBe(7);
  });

  it('reflects pending_auth from callbackServer', async () => {
    const started = Date.now();
    const cb = makeCallbackServer({
      pending: {
        state: 'awaiting_callback',
        url: 'https://oauth.example/x',
        csrfState: 'csrf-xyz',
        startedAt: started,
        expiresAt: started + 120_000,
        lastError: null,
      },
    });
    const tm = makeTokenManager({ authenticated: false });
    const out = await authStatus({ tokenManager: tm, callbackServer: cb });
    expect(out.pending_auth.state).toBe('awaiting_callback');
    expect(out.pending_auth.url).toBe('https://oauth.example/x');
    expect(out.pending_auth.started_at).toBe(new Date(started).toISOString());
    expect(out.pending_auth.expires_at).toBe(new Date(started + 120_000).toISOString());
  });
});

describe('authenticate — schema', () => {
  it('accepts empty input', () => {
    expect(authenticateSchema.safeParse({}).success).toBe(true);
  });

  it('clamps wait_seconds upper bound', () => {
    const r = authenticateSchema.safeParse({ wait_seconds: 999 });
    expect(r.success).toBe(false);
  });

  it('rejects negative wait_seconds', () => {
    expect(authenticateSchema.safeParse({ wait_seconds: -5 }).success).toBe(false);
  });
});

describe('authenticate — behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns already_authenticated short-circuit when authed and force=false', async () => {
    const tm = makeTokenManager({ authenticated: true });
    const cb = makeCallbackServer();
    const out = await authenticate(
      { tokenManager: tm, callbackServer: cb },
      {}
    );
    expect(out.already_authenticated).toBe(true);
    expect(cb.start).not.toHaveBeenCalled();
  });

  it('proceeds with flow when authed but force=true', async () => {
    const tm = makeTokenManager({ authenticated: true });
    const cb = makeCallbackServer({
      waitResult: { status: 'received', code: 'CODE123' },
    });
    await authenticate(
      { tokenManager: tm, callbackServer: cb },
      { force: true }
    );
    expect(tm.clearTokens).toHaveBeenCalled();
    expect(cb.start).toHaveBeenCalled();
  });

  it('returns authenticated:true when waitForCode resolves received', async () => {
    const tm = makeTokenManager({ authenticated: false });
    (tm.isAuthenticated as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const cb = makeCallbackServer({
      waitResult: { status: 'received', code: 'CODE123' },
    });
    const out = await authenticate(
      { tokenManager: tm, callbackServer: cb },
      {}
    );
    expect(out.authenticated).toBe(true);
  });

  it('returns pending when waitForCode resolves pending', async () => {
    const tm = makeTokenManager({ authenticated: false });
    const cb = makeCallbackServer({
      waitResult: { status: 'pending' },
      startUrl: 'https://oauth.example/x',
    });
    (cb.getPending as ReturnType<typeof vi.fn>).mockReturnValue({
      state: 'awaiting_callback',
      url: 'https://oauth.example/x',
      csrfState: 'csrf',
      startedAt: Date.now(),
      expiresAt: Date.now() + 120_000,
      lastError: null,
    });
    const out = await authenticate(
      { tokenManager: tm, callbackServer: cb },
      {}
    );
    expect(out.pending).toBe(true);
    expect(out.url).toBe('https://oauth.example/x');
    expect(out.expires_at).toBeTypeOf('string');
  });

  it('returns user_denied error when waitForCode resolves user_denied', async () => {
    const tm = makeTokenManager({ authenticated: false });
    const cb = makeCallbackServer({
      waitResult: { status: 'user_denied' },
    });
    const out = await authenticate(
      { tokenManager: tm, callbackServer: cb },
      {}
    );
    expect(out.error).toBe('user_denied');
  });

  it('returns timeout error when waitForCode resolves timeout', async () => {
    const tm = makeTokenManager({ authenticated: false });
    const cb = makeCallbackServer({
      waitResult: { status: 'timeout' },
    });
    const out = await authenticate(
      { tokenManager: tm, callbackServer: cb },
      {}
    );
    expect(out.error).toBe('timeout');
  });

  it('returns port_3000_in_use when start() rejects with EADDRINUSE', async () => {
    const tm = makeTokenManager({ authenticated: false });
    const cb = makeCallbackServer();
    const err = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    (cb.start as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);
    const out = await authenticate(
      { tokenManager: tm, callbackServer: cb },
      {}
    );
    expect(out.error).toBe('port_3000_in_use');
  });

  it('skips browser open when open_browser=false', async () => {
    const tm = makeTokenManager({ authenticated: false });
    const cb = makeCallbackServer({
      waitResult: { status: 'received', code: 'C' },
    });
    await authenticate(
      { tokenManager: tm, callbackServer: cb },
      { open_browser: false }
    );
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('opens browser by default', async () => {
    const tm = makeTokenManager({ authenticated: false });
    const cb = makeCallbackServer({
      waitResult: { status: 'received', code: 'C' },
      startUrl: 'https://oauth.example/x',
    });
    await authenticate(
      { tokenManager: tm, callbackServer: cb },
      {}
    );
    expect(openBrowser).toHaveBeenCalledWith('https://oauth.example/x');
  });
});
