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
