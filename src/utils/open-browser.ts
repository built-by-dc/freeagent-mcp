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
