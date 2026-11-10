// 配置与数据目录：令牌、登录名、本地仓库根目录、当前仓库。
// 令牌只落在这个目录的 config.json（chmod 600），从不进入视图、toast 或日志。

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ROOT = dirname(HERE)
export const DATA_DIR = join(PLUGIN_ROOT, 'data')
export const CONFIG_PATH = join(DATA_DIR, 'config.json')

/** 手机存储优先（文件管理器里能看到），否则回落到家目录。 */
export function defaultBaseDir() {
  if (existsSync('/sdcard/DeepSeek')) return '/sdcard/DeepSeek/github'
  return join(homedir(), 'workspace', 'github')
}

function normalize(raw) {
  const data = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    token: typeof data.token === 'string' ? data.token.trim() : '',
    login: typeof data.login === 'string' ? data.login.trim() : '',
    baseDir: typeof data.baseDir === 'string' && data.baseDir.trim() !== ''
      ? data.baseDir.trim()
      : defaultBaseDir(),
    current: typeof data.current === 'string' ? data.current.trim() : '',
  }
}

export async function loadConfig() {
  try {
    const text = await readFile(CONFIG_PATH, 'utf8')
    return normalize(JSON.parse(text))
  } catch {
    return normalize(null)
  }
}

export async function saveConfig(patch) {
  const current = await loadConfig()
  const next = normalize({ ...current, ...patch })
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
  const tmp = `${CONFIG_PATH}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  await chmod(tmp, 0o600).catch(() => {})
  await rename(tmp, CONFIG_PATH)
  await chmod(CONFIG_PATH, 0o600).catch(() => {})
  return next
}

/** 给视图看的安全副本：只有账号和路径，没有令牌。 */
export function summary(config) {
  return {
    configured: config.token !== '',
    login: config.login,
    baseDir: config.baseDir,
    current: config.current,
  }
}
