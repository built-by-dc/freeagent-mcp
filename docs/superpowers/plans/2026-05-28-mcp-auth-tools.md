# MCP Auth Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose OAuth as two MCP tools (`auth_status`, `authenticate`) so any MCP client (Cowork, Claude Code) can detect and recover auth state in-session without leaving chat.

**Architecture:** A singleton `CallbackServer` binds 127.0.0.1:3000, runs the OAuth callback exchange, and is shared between the `authenticate` and `auth_status` tools. `authenticate` is hybrid: inline-blocking up to `wait_seconds`, falling through to a `pending` response while the listener keeps running until a 2 min absolute deadline. `auth_status` is read-only and reports either the persisted auth state or any in-flight pending flow.

**Tech Stack:** TypeScript, Node 24+, ESM, vitest, Zod, `@modelcontextprotocol/sdk`. Existing conventions in `src/tools/` (Zod schema + handler + types, `xxxSchema`/`xxxName`/`XxxInput`).

**Working directory:** `/Users/davidcarling/Documents/built by dc/_tools/freeagent-mcp/`
**Branch:** `feat/read-list-tools` (spec already committed at `cdfa460`)

**Spec:** `docs/superpowers/specs/2026-05-28-mcp-auth-tools-design.md`

---

## File Structure

### Create
- `src/utils/open-browser.ts` — fire-and-forget browser open (darwin `open` / linux `xdg-open`)
- `src/auth/callback-server.ts` — HTTP listener singleton, pending-auth state, CSRF validation, deferred code exchange
- `src/tools/auth-tools.ts` — `authStatus`, `authenticate` handlers + Zod schemas
- `tests/unit/open-browser.test.ts`
- `tests/unit/callback-server.test.ts`
- `tests/unit/auth-tools.test.ts`

### Modify
- `src/auth/index.ts` — re-export `createCallbackServer`, `CallbackServer`, `PendingAuth`
- `src/tools/index.ts` — re-export auth tool symbols
- `src/server.ts` — instantiate `callbackServer` at startup, register `auth_status` + `authenticate` in `ListToolsRequestSchema` and `CallToolRequestSchema` dispatch

---

## Task 1: Browser-open helper

**Files:**
- Create: `src/utils/open-browser.ts`
- Test: `tests/unit/open-browser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/open-browser.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawn } from 'child_process';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn(), on: vi.fn() })),
}));

import { openBrowser } from '../../src/utils/open-browser.js';

describe('openBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses `open` on darwin', async () => {
    await openBrowser('https://example.com', 'darwin');
    expect(spawn).toHaveBeenCalledWith(
      'open',
      ['https://example.com'],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    );
  });

  it('uses `xdg-open` on linux', async () => {
    await openBrowser('https://example.com', 'linux');
    expect(spawn).toHaveBeenCalledWith(
      'xdg-open',
      ['https://example.com'],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    );
  });

  it('returns false on unsupported platforms without throwing', async () => {
    const result = await openBrowser('https://example.com', 'win32');
    expect(result).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('returns false (does not throw) if spawn errors', async () => {
    (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const result = await openBrowser('https://example.com', 'darwin');
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/open-browser.test.ts`
Expected: FAIL — `Cannot find module '../../src/utils/open-browser.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/open-browser.ts`:

```ts
import { spawn } from 'child_process';

export async function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  let command: string | null = null;
  if (platform === 'darwin') command = 'open';
  else if (platform === 'linux') command = 'xdg-open';

  if (!command) return false;

  try {
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/open-browser.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/open-browser.ts tests/unit/open-browser.test.ts
git commit -m "feat(auth): add openBrowser utility for OAuth flow"
```

---

## Task 2: CallbackServer — state shape and idempotent start

**Files:**
- Create: `src/auth/callback-server.ts`
- Test: `tests/unit/callback-server.test.ts`

This task only covers the state shape and `start`/`stop`/`getPending` idempotency. Code-receive and exchange-and-persist behavior come in Task 3.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/callback-server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCallbackServer } from '../../src/auth/callback-server.js';

const authUrlBuilder = (state: string) => `https://freeagent.example/oauth?state=${state}`;
const exchangeAndPersist = vi.fn(async () => undefined);

describe('CallbackServer — state and idempotency', () => {
  let server: ReturnType<typeof createCallbackServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Tests bind to ephemeral port via `port: 0` override.
    server = createCallbackServer(authUrlBuilder, exchangeAndPersist, { port: 0 });
  });

  afterEach(async () => {
    await server.stop();
  });

  it('starts idle', () => {
    expect(server.getPending().state).toBe('idle');
  });

  it('start() binds and reports awaiting_callback', async () => {
    const deadline = Date.now() + 120_000;
    const result = await server.start({ csrfState: 'abc', absoluteDeadlineMs: deadline });

    expect(result.url).toBe('https://freeagent.example/oauth?state=abc');
    const pending = server.getPending();
    expect(pending.state).toBe('awaiting_callback');
    expect(pending.csrfState).toBe('abc');
    expect(pending.url).toBe(result.url);
    expect(pending.expiresAt).toBe(deadline);
    expect(pending.startedAt).toBeTypeOf('number');
  });

  it('start() while pending returns the existing URL (idempotent)', async () => {
    const deadline = Date.now() + 120_000;
    const first = await server.start({ csrfState: 'abc', absoluteDeadlineMs: deadline });
    const second = await server.start({ csrfState: 'different', absoluteDeadlineMs: deadline + 5_000 });

    expect(second.url).toBe(first.url);
    expect(server.getPending().csrfState).toBe('abc');
  });

  it('stop() resets state to idle', async () => {
    await server.start({ csrfState: 'abc', absoluteDeadlineMs: Date.now() + 120_000 });
    await server.stop();
    expect(server.getPending().state).toBe('idle');
    expect(server.getPending().csrfState).toBeNull();
  });

  it('absolute deadline auto-stops listener', async () => {
    vi.useFakeTimers();
    try {
      await server.start({ csrfState: 'abc', absoluteDeadlineMs: Date.now() + 1_000 });
      expect(server.getPending().state).toBe('awaiting_callback');
      await vi.advanceTimersByTimeAsync(1_500);
      expect(server.getPending().state).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/callback-server.test.ts`
Expected: FAIL — `Cannot find module '../../src/auth/callback-server.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/auth/callback-server.ts`:

```ts
import { createServer, type Server } from 'http';

export interface PendingAuth {
  state: 'awaiting_callback' | 'exchanging' | 'idle';
  url: string | null;
  csrfState: string | null;
  startedAt: number | null;
  expiresAt: number | null;
}

export type ExchangeAndPersist = (code: string) => Promise<void>;

export interface CallbackServer {
  start(opts: { csrfState: string; absoluteDeadlineMs: number }): Promise<{ url: string }>;
  waitForCode(maxWaitMs: number): Promise<
    | { status: 'received'; code: string }
    | { status: 'pending' }
    | { status: 'timeout' }
    | { status: 'user_denied'; detail?: string }
  >;
  stop(): Promise<void>;
  getPending(): PendingAuth;
}

interface CallbackServerOptions {
  port?: number; // defaults to 3000; tests use 0 for ephemeral
  host?: string; // defaults to 127.0.0.1
}

export function createCallbackServer(
  authUrlBuilder: (state: string) => string,
  exchangeAndPersist: ExchangeAndPersist,
  options: CallbackServerOptions = {}
): CallbackServer {
  const port = options.port ?? 3000;
  const host = options.host ?? '127.0.0.1';

  let pending: PendingAuth = {
    state: 'idle',
    url: null,
    csrfState: null,
    startedAt: null,
    expiresAt: null,
  };

  let httpServer: Server | null = null;
  let deadlineTimer: NodeJS.Timeout | null = null;

  const server: CallbackServer = {
    async start({ csrfState, absoluteDeadlineMs }) {
      if (pending.state !== 'idle' && pending.url) {
        return { url: pending.url };
      }

      const url = authUrlBuilder(csrfState);

      httpServer = createServer((_req, res) => {
        // Real handler wired in Task 3.
        res.statusCode = 404;
        res.end();
      });

      await new Promise<void>((resolve, reject) => {
        httpServer!.once('error', reject);
        httpServer!.listen(port, host, () => resolve());
      });

      pending = {
        state: 'awaiting_callback',
        url,
        csrfState,
        startedAt: Date.now(),
        expiresAt: absoluteDeadlineMs,
      };

      deadlineTimer = setTimeout(() => {
        void server.stop();
      }, Math.max(0, absoluteDeadlineMs - Date.now()));

      return { url };
    },

    async waitForCode(_maxWaitMs) {
      // Wired in Task 3.
      return { status: 'timeout' };
    },

    async stop() {
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
      if (httpServer) {
        await new Promise<void>((resolve) => {
          httpServer!.close(() => resolve());
        });
        httpServer = null;
      }
      pending = {
        state: 'idle',
        url: null,
        csrfState: null,
        startedAt: null,
        expiresAt: null,
      };
    },

    getPending() {
      return { ...pending };
    },
  };

  return server;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/callback-server.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/auth/callback-server.ts tests/unit/callback-server.test.ts
git commit -m "feat(auth): scaffold CallbackServer with idempotent start/stop and deadline"
```

---

## Task 3: CallbackServer — code receive, CSRF validation, deferred exchange

**Files:**
- Modify: `src/auth/callback-server.ts`
- Modify: `tests/unit/callback-server.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `tests/unit/callback-server.test.ts`:

```ts
import { request as httpRequest } from 'http';
import type { AddressInfo } from 'net';

function getPort(s: ReturnType<typeof createCallbackServer>): number {
  // Internal accessor — tests use getActualPort() exposed for testing.
  return (s as unknown as { getActualPort: () => number }).getActualPort();
}

function callCallback(port: number, query: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: `/callback?${query}`, method: 'GET' },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('CallbackServer — code receive', () => {
  let server: ReturnType<typeof createCallbackServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createCallbackServer(authUrlBuilder, exchangeAndPersist, { port: 0 });
  });

  afterEach(async () => {
    await server.stop();
  });

  it('valid callback resolves waitForCode with received code', async () => {
    await server.start({ csrfState: 'csrf-xyz', absoluteDeadlineMs: Date.now() + 60_000 });
    const port = getPort(server);

    const waiter = server.waitForCode(5_000);
    const res = await callCallback(port, 'code=AUTHCODE&state=csrf-xyz');
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).toContain('close this tab');

    const result = await waiter;
    expect(result).toEqual({ status: 'received', code: 'AUTHCODE' });
  });

  it('CSRF mismatch returns 400 and does not resolve waitForCode', async () => {
    await server.start({ csrfState: 'csrf-xyz', absoluteDeadlineMs: Date.now() + 60_000 });
    const port = getPort(server);

    let resolved = false;
    const waiter = server.waitForCode(500).then((r) => {
      resolved = true;
      return r;
    });

    const res = await callCallback(port, 'code=AUTHCODE&state=WRONG');
    expect(res.status).toBe(400);
    expect(resolved).toBe(false);

    const result = await waiter;
    expect(result.status).toBe('timeout');
  });

  it('user denial returns 200 page and resolves waitForCode with user_denied', async () => {
    await server.start({ csrfState: 'csrf-xyz', absoluteDeadlineMs: Date.now() + 60_000 });
    const port = getPort(server);

    const waiter = server.waitForCode(5_000);
    const res = await callCallback(port, 'error=access_denied&state=csrf-xyz');
    expect(res.status).toBe(200);

    const result = await waiter;
    expect(result.status).toBe('user_denied');
  });

  it('waitForCode resolves with pending when window elapses but deadline has not', async () => {
    await server.start({ csrfState: 'csrf-xyz', absoluteDeadlineMs: Date.now() + 60_000 });
    const result = await server.waitForCode(50);
    expect(result.status).toBe('pending');
    expect(server.getPending().state).toBe('awaiting_callback');
  });

  it('callback after waitForCode has returned still triggers exchangeAndPersist', async () => {
    await server.start({ csrfState: 'csrf-xyz', absoluteDeadlineMs: Date.now() + 60_000 });
    const port = getPort(server);

    const pendingResult = await server.waitForCode(50);
    expect(pendingResult.status).toBe('pending');

    await callCallback(port, 'code=LATE&state=csrf-xyz');

    // Allow microtask queue to flush exchange.
    await new Promise((r) => setTimeout(r, 50));
    expect(exchangeAndPersist).toHaveBeenCalledWith('LATE');
    expect(server.getPending().state).toBe('idle');
  });
});
```

Note: the tests use `getActualPort()` — a test-only accessor. Add it to the CallbackServer interface for testability.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/callback-server.test.ts`
Expected: FAIL — multiple tests fail because `waitForCode` always returns `timeout` and the http handler is a stub.

- [ ] **Step 3: Implement the full callback handler**

Replace the body of `src/auth/callback-server.ts` with:

```ts
import { createServer, type Server } from 'http';
import { URL } from 'url';

export interface PendingAuth {
  state: 'awaiting_callback' | 'exchanging' | 'idle';
  url: string | null;
  csrfState: string | null;
  startedAt: number | null;
  expiresAt: number | null;
}

export type ExchangeAndPersist = (code: string) => Promise<void>;

export type WaitForCodeResult =
  | { status: 'received'; code: string }
  | { status: 'pending' }
  | { status: 'timeout' }
  | { status: 'user_denied'; detail?: string };

export interface CallbackServer {
  start(opts: { csrfState: string; absoluteDeadlineMs: number }): Promise<{ url: string }>;
  waitForCode(maxWaitMs: number): Promise<WaitForCodeResult>;
  stop(): Promise<void>;
  getPending(): PendingAuth;
  /** @internal — exposed for tests using ephemeral ports. */
  getActualPort(): number;
}

interface CallbackServerOptions {
  port?: number;
  host?: string;
}

const SUCCESS_PAGE = `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:3em;"><h1>Authenticated</h1><p>You can close this tab.</p></body></html>`;
const DENIED_PAGE = `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:3em;"><h1>Access denied</h1><p>You can close this tab.</p></body></html>`;

export function createCallbackServer(
  authUrlBuilder: (state: string) => string,
  exchangeAndPersist: ExchangeAndPersist,
  options: CallbackServerOptions = {}
): CallbackServer {
  const port = options.port ?? 3000;
  const host = options.host ?? '127.0.0.1';

  let pending: PendingAuth = {
    state: 'idle',
    url: null,
    csrfState: null,
    startedAt: null,
    expiresAt: null,
  };

  let httpServer: Server | null = null;
  let actualPort = 0;
  let deadlineTimer: NodeJS.Timeout | null = null;

  let waiters: Array<(r: WaitForCodeResult) => void> = [];

  function resolveWaiters(result: WaitForCodeResult): void {
    const queued = waiters;
    waiters = [];
    for (const w of queued) w(result);
  }

  async function handleReceivedCode(code: string): Promise<void> {
    pending = { ...pending, state: 'exchanging' };
    try {
      await exchangeAndPersist(code);
    } finally {
      await self.stop();
    }
  }

  const self: CallbackServer = {
    async start({ csrfState, absoluteDeadlineMs }) {
      if (pending.state !== 'idle' && pending.url) {
        return { url: pending.url };
      }

      const url = authUrlBuilder(csrfState);

      httpServer = createServer(async (req, res) => {
        if (!req.url) {
          res.statusCode = 400;
          res.end();
          return;
        }

        const parsed = new URL(req.url, `http://${host}`);
        if (parsed.pathname !== '/callback') {
          res.statusCode = 404;
          res.end();
          return;
        }

        const state = parsed.searchParams.get('state');
        const code = parsed.searchParams.get('code');
        const errorParam = parsed.searchParams.get('error');

        if (state !== pending.csrfState) {
          res.statusCode = 400;
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          res.end('Invalid state');
          return;
        }

        if (errorParam) {
          res.statusCode = 200;
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(DENIED_PAGE);
          const detail = parsed.searchParams.get('error_description') ?? undefined;
          if (waiters.length > 0) {
            resolveWaiters({ status: 'user_denied', detail });
          }
          await self.stop();
          return;
        }

        if (!code) {
          res.statusCode = 400;
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          res.end('Missing code');
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(SUCCESS_PAGE);

        if (waiters.length > 0) {
          resolveWaiters({ status: 'received', code });
        } else {
          // No live waiter — server completes exchange itself so deferred callers
          // see authenticated state on next auth_status call.
          void handleReceivedCode(code);
        }
      });

      await new Promise<void>((resolve, reject) => {
        httpServer!.once('error', reject);
        httpServer!.listen(port, host, () => {
          const addr = httpServer!.address();
          actualPort = typeof addr === 'object' && addr ? addr.port : port;
          resolve();
        });
      });

      pending = {
        state: 'awaiting_callback',
        url,
        csrfState,
        startedAt: Date.now(),
        expiresAt: absoluteDeadlineMs,
      };

      const remaining = Math.max(0, absoluteDeadlineMs - Date.now());
      deadlineTimer = setTimeout(() => {
        if (waiters.length > 0) resolveWaiters({ status: 'timeout' });
        void self.stop();
      }, remaining);

      return { url };
    },

    waitForCode(maxWaitMs) {
      if (pending.state === 'idle') {
        return Promise.resolve({ status: 'timeout' });
      }
      return new Promise<WaitForCodeResult>((resolve) => {
        const timer = setTimeout(() => {
          waiters = waiters.filter((w) => w !== resolver);
          resolve({ status: 'pending' });
        }, maxWaitMs);

        const resolver = (r: WaitForCodeResult) => {
          clearTimeout(timer);
          resolve(r);
        };
        waiters.push(resolver);
      });
    },

    async stop() {
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
      if (waiters.length > 0) {
        resolveWaiters({ status: 'timeout' });
      }
      if (httpServer) {
        await new Promise<void>((resolve) => {
          httpServer!.close(() => resolve());
        });
        httpServer = null;
      }
      pending = {
        state: 'idle',
        url: null,
        csrfState: null,
        startedAt: null,
        expiresAt: null,
      };
    },

    getPending() {
      return { ...pending };
    },

    getActualPort() {
      return actualPort;
    },
  };

  return self;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/callback-server.test.ts`
Expected: PASS — 10 tests total (5 from Task 2, 5 from Task 3).

- [ ] **Step 5: Commit**

```bash
git add src/auth/callback-server.ts tests/unit/callback-server.test.ts
git commit -m "feat(auth): wire CallbackServer code receive, CSRF check, deferred exchange"
```

---

## Task 4: Export CallbackServer from src/auth/index.ts

**Files:**
- Modify: `src/auth/index.ts`

- [ ] **Step 1: Update the barrel**

Replace contents of `src/auth/index.ts` with:

```ts
export { generateAuthorizationUrl, exchangeCodeForTokens, refreshAccessToken } from './oauth.js';
export type { TokenData } from './oauth.js';
export { createTokenStore } from './token-store.js';
export type { TokenStore } from './token-store.js';
export { createTokenManager } from './token-manager.js';
export type { TokenManager } from './token-manager.js';
export { createCallbackServer } from './callback-server.js';
export type { CallbackServer, PendingAuth, ExchangeAndPersist, WaitForCodeResult } from './callback-server.js';
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS — no errors.

- [ ] **Step 3: Commit**

```bash
git add src/auth/index.ts
git commit -m "feat(auth): export CallbackServer from auth barrel"
```

---

## Task 5: Auth tools — schemas and handlers

**Files:**
- Create: `src/tools/auth-tools.ts`
- Test: `tests/unit/auth-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/auth-tools.test.ts`:

```ts
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
    // Internal accessor for tool to read expiry timestamps.
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
    // After successful exchange, isAuthenticated flips true.
    (tm.isAuthenticated as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(false) // pre-flow check
      .mockReturnValue(true); // post-exchange in status build
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
```

The test references a `getTokenSnapshot()` method on `TokenManager` and a `tokenManager` + `callbackServer` injected via context. Both are introduced in this task.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/auth-tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Extend `TokenManager` to expose token expiry snapshot**

Modify `src/auth/token-manager.ts`. Add a `getTokenSnapshot` method that returns `{ expiresAt, refreshTokenExpiresAt }` or `null`, without leaking the tokens themselves.

Add the snapshot type at the top of the file (after the existing imports):

```ts
export interface TokenExpirySnapshot {
  expiresAt: number;
  refreshTokenExpiresAt: number;
}
```

Extend the `TokenManager` interface:

```ts
export interface TokenManager {
  getAccessToken(): Promise<string>;
  setTokens(tokens: TokenData): Promise<void>;
  isAuthenticated(): boolean;
  clearTokens(): Promise<void>;
  getTokenSnapshot(): TokenExpirySnapshot | null;
}
```

Inside the `const manager: TokenManager = { ... }` object literal, add a new method alongside the existing ones (before the closing brace):

```ts
    getTokenSnapshot(): TokenExpirySnapshot | null {
      const tokens = store.get();
      if (!tokens) return null;
      return {
        expiresAt: tokens.expiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      };
    },
```

- [ ] **Step 4: Implement the tool module**

Create `src/tools/auth-tools.ts`:

```ts
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
} {
  return {
    state: pending.state,
    url: pending.url,
    started_at: pending.startedAt !== null ? new Date(pending.startedAt).toISOString() : null,
    expires_at: pending.expiresAt !== null ? new Date(pending.expiresAt).toISOString() : null,
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
  authenticated?: true;
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
      // Listener resolves with the code but does not exchange when a live waiter is present —
      // the tool handler runs the exchange so its own success/failure becomes the tool response.
      try {
        const tokens = await exchangeCodeForTokens(result.code);
        await ctx.tokenManager.setTokens(tokens);
      } catch (err) {
        await ctx.callbackServer.stop();
        return { error: 'exchange_failed', detail: (err as Error).message };
      }
      await ctx.callbackServer.stop();
      return { authenticated: true, ...buildStatus(ctx) };
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
```

- [ ] **Step 5: Run tests**

Run: `npm run test:unit -- tests/unit/auth-tools.test.ts`
Expected: PASS — all schema and behavior tests pass.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/auth/token-manager.ts src/tools/auth-tools.ts tests/unit/auth-tools.test.ts
git commit -m "feat(auth): add authStatus and authenticate MCP tool handlers"
```

---

## Task 6: Export auth tools from src/tools/index.ts

**Files:**
- Modify: `src/tools/index.ts`

- [ ] **Step 1: Add re-exports**

Append to `src/tools/index.ts`:

```ts
// Auth tools
export {
  authStatus,
  authenticate,
  authStatusSchema,
  authenticateSchema,
} from './auth-tools.js';
export type {
  AuthStatusInput,
  AuthenticateInput,
  AuthContext,
} from './auth-tools.js';
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/tools/index.ts
git commit -m "feat(auth): re-export auth tools from tools barrel"
```

---

## Task 7: Wire auth tools and CallbackServer into server.ts

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Add CallbackServer instantiation**

At the top of `src/server.ts`, update the import from `./auth/index.js` to include `createCallbackServer` and types:

```ts
import {
  createTokenStore,
  createTokenManager,
  createCallbackServer,
  generateAuthorizationUrl,
  exchangeCodeForTokens,
  type TokenManager,
  type TokenStore,
  type CallbackServer,
} from './auth/index.js';
```

Inside `createFreeAgentMcpServer()`, just after `const tokenManager = createTokenManager(tokenStore);` add:

```ts
const callbackServer = createCallbackServer(
  (state) => generateAuthorizationUrl(state),
  async (code) => {
    const tokens = await exchangeCodeForTokens(code);
    await tokenManager.setTokens(tokens);
    contactNameLookup = null;
    bankAccountNameLookup = null;
  }
);
```

(Note: `contactNameLookup` and `bankAccountNameLookup` are declared further down — the closure references the outer `let` bindings.)

Update the exported `FreeAgentMcpServer` interface to include `callbackServer`:

```ts
export interface FreeAgentMcpServer {
  server: Server;
  tokenStore: TokenStore;
  callbackServer: CallbackServer;
  getAuthorizationUrl: (state?: string) => string;
  handleAuthorizationCode: (code: string) => Promise<void>;
  isAuthenticated: () => boolean;
}
```

Update the final `return` statement to add `callbackServer`.

- [ ] **Step 2: Register tools in ListToolsRequestSchema**

In the `tools: [...]` array inside the `ListToolsRequestSchema` handler, append before the closing `]`:

```ts
// Auth tools
{
  name: 'auth_status',
  description: 'Report current OAuth authentication state and any in-flight authentication flow.',
  inputSchema: zodToJsonSchema(tools.authStatusSchema),
},
{
  name: 'authenticate',
  description: 'Start an OAuth flow against FreeAgent. Hybrid behavior: waits inline up to wait_seconds (default 90) then returns {pending} while a 2-minute callback listener stays running. Subsequent auth_status calls report progress.',
  inputSchema: zodToJsonSchema(tools.authenticateSchema),
},
```

- [ ] **Step 3: Register tool dispatch in CallToolRequestSchema**

In the `switch (name)` block, add cases before the `default:`:

```ts
case 'auth_status':
  result = await tools.authStatus({ tokenManager, callbackServer });
  break;
case 'authenticate':
  result = await tools.authenticate(
    { tokenManager, callbackServer },
    args as tools.AuthenticateInput
  );
  break;
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run full unit suite**

Run: `npm run test:unit`
Expected: PASS — all existing tests plus the new auth-tools, callback-server, and open-browser tests.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: SUCCESS — `dist/` updated.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts
git commit -m "feat(auth): register auth_status and authenticate MCP tools"
```

---

## Task 8: Documentation — update runbook

**Files:**
- Modify: `/Users/davidcarling/Documents/built by dc/projects/little-dc/runbooks/freeagent-mcp-setup.md`

- [ ] **Step 1: Add a section describing the new tools**

Add a section titled "## In-session re-auth (MCP tools)" below the existing OAuth bootstrap section. Content:

```markdown
## In-session re-auth (MCP tools)

The fork exposes two MCP tools for clients (Cowork, Claude Code) to detect and recover authentication state without leaving the chat session:

- **`auth_status`** — read-only. Reports `authenticated`, expiry timestamps, refresh-token days remaining, and any in-flight `pending_auth` flow.
- **`authenticate`** — starts an OAuth flow. Binds `127.0.0.1:3000`, opens the FreeAgent consent URL in the default browser, waits inline up to `wait_seconds` (default 90, max 110) for the callback. If the callback does not arrive in that window, returns `{ pending: true, url, expires_at }` while the listener keeps running until a 2-minute absolute deadline. Use `force: true` to clear existing tokens and re-consent.

Tool count after this change: **53** (51 + 2 auth).

The standalone bootstrap script remains the canonical first-time setup path. The MCP tools are designed for in-session recovery when tokens expire or are missing.
```

- [ ] **Step 2: Commit (in the runbook repo)**

```bash
cd "/Users/davidcarling/Documents/built by dc/projects/little-dc"
git add runbooks/freeagent-mcp-setup.md
git commit -m "docs(freeagent-mcp): document auth_status and authenticate tools"
```

---

## Task 9: Manual integration verification

This task is interactive and cannot be automated. It validates the full OAuth round-trip against the FreeAgent sandbox.

**Files:**
- Modify (optionally): `runbooks/freeagent-mcp-setup.md` if any quirks emerge

- [ ] **Step 1: Reinstall the fork globally**

```bash
cd "/Users/davidcarling/Documents/built by dc/_tools/freeagent-mcp"
npm run build
npm pack
npm install -g ./stupidcodefactory-freeagent-mcp-server-*.tgz
```

- [ ] **Step 2: Verify the wrapper still works**

```bash
/opt/homebrew/bin/freeagent-mcp <<< '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' 2>/dev/null | head -200
```

Expected: response includes `auth_status` and `authenticate` in the tools list.

- [ ] **Step 3: Run a real OAuth round-trip via Claude Code**

Manually invoke `authenticate` via the MCP client. Expected sequence:
- Browser opens to FreeAgent consent screen.
- Approve.
- Page renders "Authenticated. You can close this tab."
- Tool returns `{ authenticated: true, ... }`.

- [ ] **Step 4: Verify auth_status reflects the new tokens**

Invoke `auth_status`. Expected output includes `authenticated: true` and valid ISO timestamps.

- [ ] **Step 5: Verify the pending path**

Invoke `authenticate({ wait_seconds: 5 })`. Expected output: `{ pending: true, url, expires_at }`. Visit the URL, complete consent. Then invoke `auth_status` — expected `authenticated: true`.

- [ ] **Step 6: Verify error path — port in use**

Run `nc -l 3000 &` to occupy the port, then invoke `authenticate`. Expected: `{ error: 'port_3000_in_use' }`. Kill the netcat.

- [ ] **Step 7: Final commit if any runbook tweaks were needed**

If the runbook needed adjustments based on actual behavior:

```bash
cd "/Users/davidcarling/Documents/built by dc/projects/little-dc"
git add runbooks/freeagent-mcp-setup.md
git commit -m "docs(freeagent-mcp): clarify auth tool behavior from manual verification"
```

---

## Out of scope (deferred from this plan)

- `revoke` tool (per spec).
- Replacing the standalone bootstrap script (per spec).
- Upstream PR to `StupidCodeFactory/freeagent-mcp` (decide post-verification).
- Multi-account / token-switching support.
