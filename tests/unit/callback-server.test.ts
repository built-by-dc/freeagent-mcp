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
