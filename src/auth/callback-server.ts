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
