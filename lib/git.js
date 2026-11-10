// 本地 git 操作。令牌通过 GIT_CONFIG_* 环境变量传进子进程，不写 argv、
// 不落到 .git/config，也不出现在进程列表里。工作副本在手机存储上时
// 用 safe.directory=* 绕过 FUSE 挂载带来的「dubious ownership」。

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'

const DEFAULT_TIMEOUT_MS = 120_000
const CLONE_TIMEOUT_MS = 45_000
const PUSH_TIMEOUT_MS = 60_000

function configEnv(config) {
  const entries = [['safe.directory', '*']]
  if (config?.token) {
    const basic = Buffer.from(`x-access-token:${config.token}`).toString('base64')
    entries.push(['http.extraheader', `Authorization: Basic ${basic}`])
  }
  if (config?.login) {
    entries.push(['user.name', config.login])
    entries.push(['user.email', `${config.login}@users.noreply.github.com`])
  }
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/bin/true',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: String(entries.length),
  }
  entries.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key
    env[`GIT_CONFIG_VALUE_${index}`] = value
  })
  return env
}

/** 跑一次 git；不抛错，返回 { ok, code, stdout, stderr }。 */
function exec(config, args, { cwd, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd,
      env: configEnv(config),
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      const out = String(stdout ?? '')
      const err = String(stderr ?? '')
      if (error === null || error === undefined) {
        resolve({ ok: true, code: 0, stdout: out, stderr: err })
        return
      }
      const timedOut = error.killed === true || error.signal === 'SIGTERM'
      const code = timedOut ? 'timeout' : (typeof error.code === 'number' ? error.code : 1)
      resolve({ ok: false, code, stdout: out, stderr: err || String(error.message ?? '') })
    })
  })
}

export function isRepo(path) {
  return existsSync(`${path}/.git`)
}

export function cloneUrl(fullName) {
  return `https://github.com/${fullName}.git`
}

export async function clone(config, fullName, dir) {
  if (isRepo(dir)) return { ok: true, path: dir, existed: true }
  await mkdir(dirname(dir), { recursive: true })
  const result = await exec(config, ['clone', '--origin', 'origin', '--', cloneUrl(fullName), dir], {
    timeout: CLONE_TIMEOUT_MS,
  })
  if (!result.ok) {
    return { ok: false, error: cloneErrorText(result) }
  }
  return { ok: true, path: dir, existed: false }
}

function cloneErrorText(result) {
  if (result.code === 'timeout') return '克隆超时了，网络慢或仓库太大，稍后重试'
  const err = result.stderr
  if (/could not resolve host|network is unreachable|connection timed out/i.test(err)) {
    return '连不上 GitHub，检查手机网络或代理'
  }
  if (/authentication failed|invalid username or password/i.test(err)) {
    return '令牌没有访问这个仓库的权限'
  }
  if (/repository .* not found|does not appear to be a git repository/i.test(err)) {
    return 'GitHub 上找不到这个仓库'
  }
  if (/already exists and is not an empty directory/i.test(err)) {
    return '本地已有同名目录，先换个名字或清掉旧目录'
  }
  return '克隆失败，稍后重试'
}

export async function branch(config, dir) {
  const result = await exec(config, ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
  const name = result.ok ? result.stdout.trim() : ''
  return name === '' || name === 'HEAD' ? 'main' : name
}

/** 工作区改动行数（含未跟踪文件）。 */
export async function dirtyCount(config, dir) {
  const result = await exec(config, ['status', '--porcelain=v1'], { cwd: dir })
  if (!result.ok) return 0
  return result.stdout.split('\n').filter((line) => line.trim() !== '').length
}

export async function remoteFullName(config, dir) {
  const result = await exec(config, ['remote', 'get-url', 'origin'], { cwd: dir })
  if (!result.ok) return ''
  const match = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(result.stdout.trim())
  return match ? `${match[1]}/${match[2]}` : ''
}

/** add -A + commit；没有改动时返回 { committed: false }。 */
export async function commitAll(config, dir, message) {
  const add = await exec(config, ['add', '-A'], { cwd: dir })
  if (!add.ok) return { ok: false, error: '暂存改动失败，检查本地目录权限' }
  const commit = await exec(config, ['commit', '-m', message], { cwd: dir })
  if (commit.ok) return { ok: true, committed: true }
  if (/nothing to commit|no changes added/i.test(commit.stderr) || /nothing to commit/i.test(commit.stdout)) {
    return { ok: true, committed: false }
  }
  if (/Please tell me who you are/i.test(commit.stderr)) {
    return { ok: false, error: 'git 还没有配置提交身份' }
  }
  return { ok: false, error: '提交失败，检查本地目录状态' }
}

export async function push(config, dir) {
  const name = await branch(config, dir)
  const result = await exec(config, ['push', '--set-upstream', 'origin', name], {
    cwd: dir,
    timeout: PUSH_TIMEOUT_MS,
  })
  if (result.ok) return { ok: true, branch: name }
  if (result.code === 'timeout') return { ok: false, error: '推送超时了，检查网络后重试' }
  const err = result.stderr
  if (/non-fast-forward|fetch first|rejected/i.test(err)) {
    return { ok: false, error: '远端有新提交，先点「同步」拉取再推' }
  }
  if (/authentication failed|invalid username or password|403/i.test(err)) {
    return { ok: false, error: '令牌没有推送权限，需要 repo 权限' }
  }
  if (/could not resolve host|network is unreachable/i.test(err)) {
    return { ok: false, error: '连不上 GitHub，检查网络' }
  }
  return { ok: false, error: '推送失败，检查网络后重试' }
}

export async function pull(config, dir) {
  const result = await exec(config, ['pull', '--ff-only'], { cwd: dir, timeout: PUSH_TIMEOUT_MS })
  if (result.ok) return { ok: true }
  const err = result.stderr + result.stdout
  if (/diverged|not possible to fast-forward|would be overwritten/i.test(err)) {
    return { ok: false, error: '本地和远端都有新提交，需要手动合并' }
  }
  if (/could not resolve host|network is unreachable/i.test(err)) {
    return { ok: false, error: '连不上 GitHub，检查网络' }
  }
  return { ok: false, error: '同步失败，检查网络后重试' }
}
