# MCP Auth Tools — Design

**Date:** 2026-05-28
**Fork:** built-by-dc/freeagent-mcp
**Status:** Draft — pending implementation

## Problem

The freeagent-mcp server handles OAuth internally: credentials injected via wrapper env vars at startup, encrypted tokens persisted at `~/.freeagent-mcp/tokens.enc`, refresh handled automatically by `TokenManager`. None of this is exposed to MCP clients.

When tokens expire, are missing, or need rotation, the only recovery path is a standalone bootstrap script — invisible to and unreachable from MCP clients like Cowork (Claude Desktop) or Claude Code. Clients cannot:
- Check whether the server is currently authenticated.
- Trigger an OAuth flow when auth is missing or stale.
- Tell the user what URL to visit to re-authenticate.

Goal: expose auth as first-class MCP tools so any client can detect and recover auth state without leaving the chat session.

## Non-goals

- Replacing the standalone bootstrap script (kept for first-time setup and headless contexts).
- Adding `revoke` / `logout` tool (out of scope for this iteration).
- Supporting non-loopback redirect URIs or PKCE (FreeAgent OAuth client is fixed to `http://localhost:3000/callback`).
- Multi-account / token-switching support.

## Tools

Two new MCP tools, registered in `src/tools/index.ts` alongside existing tool families.

### `auth_status`

Read-only. Reports current auth state and any in-flight OAuth flow.

**Input:** `{}` (no arguments)

**Output:**
```ts
{
  authenticated: boolean;
  access_token_expires_at: string | null;   // ISO 8601
  refresh_token_expires_at: string | null;  // ISO 8601
  refresh_token_days_remaining: number | null;
  pending_auth: {
    state: 'awaiting_callback' | 'exchanging' | 'idle';
    url: string | null;            // auth URL if a flow is in progress
    started_at: string | null;     // ISO 8601
    expires_at: string | null;     // ISO 8601 — 2 min after start
  };
}
```

### `authenticate`

Starts OAuth flow. Idempotent if a flow is already in progress. Idempotent if already authenticated unless `force: true`.

**Input:**
```ts
{
  open_browser?: boolean;   // default true
  wait_seconds?: number;    // default 90, max 110 (stays inside typical MCP tool-call timeouts)
  force?: boolean;          // default false — if true, clears existing tokens before flow
}
```

**Output (one of):**

Already authenticated:
```ts
{ already_authenticated: true, ...auth_status_fields }
```

Flow in progress, callback received within `wait_seconds`:
```ts
{ authenticated: true, ...auth_status_fields }
```

Flow in progress, callback not received within `wait_seconds` but 2-min absolute deadline not yet reached:
```ts
{
  pending: true,
  url: string,
  expires_at: string,                     // 2-min deadline
  message: 'Visit URL, then call auth_status to confirm.';
}
```

Error:
```ts
{ error: 'port_3000_in_use' | 'missing_credentials' | 'user_denied' | 'exchange_failed' | 'timeout', detail?: string }
```

## Architecture

### New files
- `src/auth/callback-server.ts` — encapsulates the HTTP listener and the pending-auth singleton.
- `src/tools/auth-tools.ts` — MCP tool implementations and Zod schemas for `authStatus` and `authenticate`.
- `src/utils/open-browser.ts` — wraps `child_process.spawn('open' | 'xdg-open', [url], { detached: true, stdio: 'ignore' })`. Errors swallowed.

### Modified files
- `src/tools/index.ts` — re-export new tools, schemas, and types.
- `src/server.ts` — register `auth_status` and `authenticate` in the tool dispatch; instantiate one `callbackServer` at startup and pass it into handlers with `tokenManager`.
- `src/auth/index.ts` — export `createCallbackServer` and `CallbackServer`.

### `callback-server.ts` interface

```ts
export interface PendingAuth {
  state: 'awaiting_callback' | 'exchanging' | 'idle';
  url: string | null;
  csrfState: string | null;
  startedAt: number | null;
  expiresAt: number | null;
}

export interface CallbackServer {
  start(opts: { csrfState: string; absoluteDeadlineMs: number }): Promise<{ url: string }>;
  waitForCode(maxWaitMs: number):
    Promise<
      | { status: 'received'; code: string }
      | { status: 'pending' }
      | { status: 'timeout' }
      | { status: 'user_denied' }
    >;
  stop(): Promise<void>;
  getPending(): PendingAuth;
}

export function createCallbackServer(
  authUrlBuilder: (state: string) => string,
  exchangeAndPersist: (code: string) => Promise<void>,
): CallbackServer;
```

Implementation notes:
- Singleton internal state; one listener bound on first `start()`.
- `start()` while pending is a no-op that returns the existing URL (idempotent).
- `stop()` closes the server, clears `setTimeout` deadline, resets state to `idle`.
- Listener validates CSRF `state` query param against stored value before accepting `code`.
- On valid callback, listener parks `code` and resolves any in-flight `waitForCode` promise. If no caller is waiting, the listener invokes `exchangeAndPersist(code)` itself so that a deferred client (post-`pending` return) still gets authenticated.
- 2-min absolute deadline armed via `setTimeout`; on fire, `stop()` runs and state goes to `idle`.

## Data flow

### Happy path
1. Client → `authenticate({})`.
2. Server: `tokenManager.isAuthenticated()` → false. `callbackServer.getPending().state === 'idle'`.
3. Generate CSRF `state` (`crypto.randomBytes(32).toString('hex')`).
4. `callbackServer.start({ csrfState, absoluteDeadlineMs: now + 120_000 })` → binds 127.0.0.1:3000, builds and stores auth URL.
5. `open_browser=true` → spawn `open` (darwin) or `xdg-open` (linux). Errors swallowed.
6. `await callbackServer.waitForCode(90_000)`.
7. User approves on FreeAgent → 302 to `http://localhost:3000/callback?code=XYZ&state=ABC`.
8. Listener validates `state`, returns 200 HTML "You can close this tab", resolves `waitForCode` with `{ status: 'received', code }`.
9. Tool calls `exchangeCodeForTokens(code)` → `tokenManager.setTokens(tokens)` → token-store persists encrypted to `~/.freeagent-mcp/tokens.enc`.
10. `callbackServer.stop()`. Tool returns `{ authenticated: true, ... }`.

### Pending path
- `waitForCode(90_000)` resolves `{ status: 'pending' }` because the 90 s window elapsed but the 2 min absolute deadline has not.
- Tool returns `{ pending: true, url, expires_at }`. Listener stays up.
- Client calls `auth_status` later: reads `getPending()`, sees `awaiting_callback`.
- Whenever the callback eventually arrives, the listener itself exchanges, persists tokens via the injected `exchangeAndPersist`, and resets state to `idle`. Next `auth_status` call shows `authenticated: true`.

### Error cases

| Case | Behavior |
|------|----------|
| Port 3000 in use | Listener bind fails. Tool returns `{ error: 'port_3000_in_use' }`. No fallback port — FreeAgent OAuth client has a fixed `redirect_uri`. |
| Missing client credentials in env | Config validation already runs at server startup, but tool re-checks before generating URL. Returns `{ error: 'missing_credentials', detail }`. |
| User denies on FreeAgent consent screen | FreeAgent redirects with `?error=access_denied`. Listener resolves `waitForCode` with `{ status: 'user_denied' }`. Tool returns `{ error: 'user_denied' }`. `stop()` runs. |
| CSRF state mismatch | Listener responds 400, ignores, keeps waiting. Could be replay. Times out normally if no valid callback arrives. |
| Code exchange fails (network / HTTP error) | Caught. Tool returns `{ error: 'exchange_failed', detail }`. `stop()` runs. |
| Concurrent `authenticate` call | Returns existing pending state idempotently. No double-bind on :3000. |
| 2 min absolute deadline elapses without callback | `setTimeout` runs `stop()` and resets state. Subsequent `auth_status` shows `idle`. |
| `open` / `xdg-open` spawn fails | Logged at debug, swallowed. URL is still in the tool response. |

## Security

- **CSRF state:** 32-byte random hex, generated per flow with `crypto.randomBytes`. Validated on callback before token exchange.
- **Localhost-only bind:** explicit `127.0.0.1`, never `0.0.0.0`. Prevents any LAN-reachable listener.
- **No token leakage:** tool responses never include access tokens or refresh tokens — only metadata (`authenticated`, expiry timestamps, days remaining).
- **`force: true` semantics:** clears existing tokens via `tokenManager.clearTokens()` before starting the flow. Effectively a re-consent. Caller must opt in explicitly.
- **Single concurrent flow:** the singleton prevents two parallel OAuth contexts; without this, two concurrent flows could race on `tokens.enc` writes.

## Testing

### Unit
- `src/tools/auth-tools.test.ts`:
  - `auth_status` shape — authenticated, not authenticated, pending.
  - `authenticate` already-authenticated short-circuit (with and without `force`).
  - `authenticate` idempotent on existing pending state.
  - `authenticate` returns `{ pending }` when window elapses but deadline has not.
  - All error branches: `port_3000_in_use`, `missing_credentials`, `user_denied`, `exchange_failed`, `timeout`.
  - Mocks: `callbackServer`, `tokenManager`.
- `src/auth/callback-server.test.ts`:
  - CSRF state validation (mismatch → 400, no resolution).
  - Deadline `setTimeout` cleanup.
  - `start()` is idempotent while pending.
  - `stop()` resets state and closes the http server.
  - End-to-end against a real `http.Server` on `127.0.0.1:0` (override default port for tests).

### Integration (manual)
- Runbook step: real OAuth round-trip from a clean state. Document under `runbooks/freeagent-mcp-setup.md`.

## Out of scope (deferred)

- `revoke` tool (clears tokens via MCP; today only the standalone script or filesystem removal does this).
- Multiple FreeAgent accounts in one server instance.
- Replacing the bootstrap script — the script remains the canonical first-time setup path; these tools are for in-session recovery.
