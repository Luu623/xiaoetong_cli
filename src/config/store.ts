import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface UserInfo {
  user_id: string;
  nickname: string;
  avatar: string;
}

export interface StoredConfig {
  p_token?: string;
  user?: UserInfo;
  login_time?: string;
}

function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, 'xiaoetong-cli') : join(homedir(), '.config', 'xiaoetong-cli');
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export function loadConfig(): StoredConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveConfig(config: StoredConfig): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

export function getToken(): string | undefined {
  return loadConfig().p_token;
}
