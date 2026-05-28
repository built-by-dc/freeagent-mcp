import { refreshAccessToken, type TokenData } from './oauth.js';
import type { TokenStore } from './token-store.js';

const TOKEN_REFRESH_BUFFER_MS = 60 * 1000; // 60 seconds before expiry
const MAX_REFRESH_PER_MINUTE = 15;

export interface TokenExpirySnapshot {
  expiresAt: number;
  refreshTokenExpiresAt: number;
}

export interface TokenManager {
  getAccessToken(): Promise<string>;
  setTokens(tokens: TokenData): Promise<void>;
  isAuthenticated(): boolean;
  clearTokens(): Promise<void>;
  getTokenSnapshot(): TokenExpirySnapshot | null;
}

export function createTokenManager(store: TokenStore): TokenManager {
  let refreshCount = 0;
  let refreshResetTime = Date.now();
  let refreshPromise: Promise<TokenData> | null = null;

  async function doRefresh(currentTokens: TokenData): Promise<TokenData> {
    // Rate limit refresh attempts
    const now = Date.now();
    if (now - refreshResetTime > 60 * 1000) {
      refreshCount = 0;
      refreshResetTime = now;
    }

    if (refreshCount >= MAX_REFRESH_PER_MINUTE) {
      throw new Error('Token refresh rate limit exceeded (15/minute)');
    }

    refreshCount++;

    try {
      const newTokens = await refreshAccessToken(currentTokens.refreshToken);
      store.set(newTokens);
      await store.persist();
      return newTokens;
    } finally {
      refreshPromise = null;
    }
  }

  const manager: TokenManager = {
    async getAccessToken(): Promise<string> {
      const tokens = store.get();

      if (!tokens) {
        throw new Error('Not authenticated. Please complete OAuth flow first.');
      }

      const now = Date.now();

      // Check if refresh token has expired
      if (now >= tokens.refreshTokenExpiresAt) {
        store.clear();
        throw new Error('Refresh token expired. Please re-authenticate.');
      }

      // Check if access token needs refresh
      if (now >= tokens.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
        // Use existing refresh promise if one is in progress (prevents concurrent refreshes)
        if (!refreshPromise) {
          refreshPromise = doRefresh(tokens);
        }

        const newTokens = await refreshPromise;
        return newTokens.accessToken;
      }

      return tokens.accessToken;
    },

    async setTokens(tokens: TokenData): Promise<void> {
      store.set(tokens);
      await store.persist();
    },

    isAuthenticated(): boolean {
      const tokens = store.get();
      if (!tokens) {
        return false;
      }

      // Check if refresh token is still valid
      return Date.now() < tokens.refreshTokenExpiresAt;
    },

    async clearTokens(): Promise<void> {
      store.clear();
      await store.persist();
    },

    getTokenSnapshot(): TokenExpirySnapshot | null {
      const tokens = store.get();
      if (!tokens) return null;
      return {
        expiresAt: tokens.expiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      };
    },
  };

  return manager;
}
