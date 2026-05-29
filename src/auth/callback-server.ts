import { createServer, type Server } from 'http';
import { URL } from 'url';

export interface PendingAuth {
  state: 'awaiting_callback' | 'exchanging' | 'idle';
  url: string | null;
  csrfState: string | null;
  startedAt: number | null;
  expiresAt: number | null;
  lastError: string | null;
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
    lastError: null,
  };

  let httpServer: Server | null = null;
  let actualPort = 0;
  let deadlineTimer: NodeJS.Timeout | null = null;
  let csrfFailed = false;

  let waiters: Array<(r: WaitForCodeResult) => void> = [];

  function resolveWaiters(result: WaitForCodeResult): void {
    const queued = waiters;
    waiters = [];
    for (const w of queued) w(result);
  }

  async function handleReceivedCode(code: string): Promise<void> {
    pending = { ...pending, state: 'exchanging' };
    let exchangeError: string | null = null;
    try {
      await exchangeAndPersist(code);
    } catch (err) {
      exchangeError = (err as Error).message;
      console.error('[callback-server] deferred token exchange failed:', err);
    } finally {
      await self.stop();
      if (exchangeError) {
        pending = { ...pending, lastError: `exchange_failed: ${exchangeError}` };
      }
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
          // Mark CSRF failure so any pending waiters will resolve as 'timeout'
          // when their window elapses (avoids async timing races with stop()).
          csrfFailed = true;
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

      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (err: Error) => {
            httpServer?.removeListener('listening', onListening);
            reject(err);
          };
          const onListening = () => {
            httpServer?.removeListener('error', onError);
            const addr = httpServer!.address();
            actualPort = typeof addr === 'object' && addr ? addr.port : port;
            resolve();
          };
          httpServer!.once('error', onError);
          httpServer!.once('listening', onListening);
          httpServer!.listen(port, host);
        });
      } catch (err) {
        // Bind failed — discard the server instance so the next start() call
        // creates a fresh one rather than orphaning this reference.
        try {
          httpServer?.close();
        } catch {
          // ignore — server never bound
        }
        httpServer = null;
        throw err;
      }

      pending = {
        state: 'awaiting_callback',
        url,
        csrfState,
        startedAt: Date.now(),
        expiresAt: absoluteDeadlineMs,
        lastError: null,
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
          // If the server is still alive and deadline hasn't passed, caller can retry.
          // Otherwise treat as a hard timeout.
          const now = Date.now();
          const deadlinePassed = pending.expiresAt !== null && now >= pending.expiresAt;
          const serverGone = pending.state === 'idle';
          resolve(deadlinePassed || serverGone || csrfFailed ? { status: 'timeout' } : { status: 'pending' });
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
        lastError: null,
      };
      csrfFailed = false;
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
