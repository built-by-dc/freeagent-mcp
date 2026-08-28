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
