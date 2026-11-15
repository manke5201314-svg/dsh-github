// 把 API 与本地文件拼成三件事：建仓、一键添加别人的项目、推送当前仓库。
// 全程只走 api.github.com（Git Data API），不调本机 git：手机网络里 github.com:443 常被掐。

import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import * as api from './api.js'
import { GhError } from './api.js'
import * as remote from './remote.js'

/** 用户输入错误：消息直接进 toast。 */
export class UserError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UserError'
  }
}

const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/

export function localPath(config, fullName) {
  const [owner, repo] = fullName.split('/')
  return join(config.baseDir, owner, repo)
}

export function checkRepoName(name) {
  const value = String(name ?? '').trim()
  if (value === '') throw new UserError('先在输入框写仓库名')
  if (!REPO_RE.test(value)) throw new UserError('仓库名只能用字母、数字、点、横线和下划线')
  if (value === '.' || value === '..') throw new UserError('换个仓库名')
  return value
}

/** 接受 owner/repo、github.com 链接、git@github.com:owner/repo.git。 */
export function parseTarget(text) {
  let raw = String(text ?? '').trim()
  if (raw === '') return null
  raw = raw
    .replace(/^git@github\.com:/i, '')
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
    .replace(/^github\.com\//i, '')
  raw = raw.replace(/^\/+|\/+$/g, '')
  if (raw.toLowerCase().endsWith('.git')) raw = raw.slice(0, -4)
  const parts = raw.split('/').filter((part) => part !== '')
  if (parts.length !== 2) return null
  const [owner, repo] = parts
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) return null
  if (repo === '.' || repo === '..') return null
  return { owner, repo, full: `${owner}/${repo}` }
}

async function readdirSafe(dir) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** 本地已克隆的仓库（最多 limit 个）。 */
export async function scanLocal(config, limit = 24) {
  const out = []
  for (const ownerEntry of await readdirSafe(config.baseDir)) {
    if (!ownerEntry.isDirectory()) continue
    const ownerDir = join(config.baseDir, ownerEntry.name)
    for (const repoEntry of await readdirSafe(ownerDir)) {
      if (!repoEntry.isDirectory()) continue
      const dir = join(ownerDir, repoEntry.name)
      if (!remote.isRepo(dir)) continue
      out.push({ full: `${ownerEntry.name}/${repoEntry.name}`, path: dir })
      if (out.length >= limit) return out
    }
  }
  return out
}

async function cloneInto(config, fullName) {
  const dir = localPath(config, fullName)
  const existed = remote.isRepo(dir)
  if (existed) return { path: dir, existed: true }
  try {
    await remote.pullRepo(config, fullName, dir)
  } catch (error) {
    if (error instanceof remote.TransferError) throw new UserError(error.message)
    throw error
  }
  return { path: dir, existed: false }
}

/** 建仓：GitHub 上创建（带 README），然后拉到本地并设为当前仓库。 */
export async function createRepo(config, { name, privateRepo = true, description = '' }) {
  const repoName = checkRepoName(name)
  let repo
  try {
    repo = await api.createRepo(config, {
      name: repoName,
      privateRepo: privateRepo === true,
      description: String(description ?? '').trim().slice(0, 300),
    })
  } catch (error) {
    if (error instanceof GhError && error.status === 422) {
      throw new UserError('这个名字已被占用，换一个')
    }
    throw error
  }
  const fullName = typeof repo?.full_name === 'string' && repo.full_name !== ''
    ? repo.full_name
    : `${config.login}/${repoName}`
  const cloned = await cloneInto(config, fullName)
  return { fullName, path: cloned.path, existed: cloned.existed }
}

/** 一键添加别人的项目：fork 到自己账号（可选），再克隆到本地。 */
export async function addProject(config, input, { fork = true } = {}) {
  const target = parseTarget(input)
  if (target === null) throw new UserError('写 owner/repo，比如 octocat/Hello-World')
  const mine = target.owner.toLowerCase() === String(config.login).toLowerCase()
  let fullName = target.full
  let forked = false
  if (fork && !mine) {
    const created = await api.forkRepo(config, target.owner, target.repo)
    const forkOwner = typeof created?.owner?.login === 'string' && created.owner.login !== ''
      ? created.owner.login
      : config.login
    fullName = `${forkOwner}/${created?.name ?? target.repo}`
    forked = true
    const ready = await api.waitForRepo(config, fullName)
    if (ready === null) throw new UserError('已发起 Fork，GitHub 还在准备，过一会儿再点一次')
  }
  const cloned = await cloneInto(config, fullName)
  return { fullName, path: cloned.path, forked, existed: cloned.existed }
}

/** 推送当前仓库：只把有变化的文件用 API 提交上去。 */
export async function pushCurrent(config, message) {
  const fullName = config.current
  if (fullName === '') throw new UserError('还没有选仓库，先在面板里选一个')
  const dir = localPath(config, fullName)
  if (!remote.isRepo(dir)) throw new UserError('本地没有这个仓库，先在面板里克隆')
  const text = String(message ?? '').trim().slice(0, 200) || '更新'
  try {
    const pushed = await remote.pushRepo(config, fullName, dir, text)
    return { fullName, path: dir, committed: pushed.committed, files: pushed.files }
  } catch (error) {
    if (error instanceof remote.TransferError) throw new UserError(error.message)
    throw error
  }
}

/** 从远端同步当前仓库。 */
export async function syncCurrent(config) {
  const fullName = config.current
  if (fullName === '') throw new UserError('还没有选仓库，先在面板里选一个')
  const dir = localPath(config, fullName)
  if (!remote.isRepo(dir)) throw new UserError('本地没有这个仓库，先在面板里克隆')
  try {
    const pulled = await remote.pullRepo(config, fullName, dir)
    return { fullName, path: dir, files: pulled.files }
  } catch (error) {
    if (error instanceof remote.TransferError) throw new UserError(error.message)
    throw error
  }
}

/** 面板上每个仓库的状态：本地有没有、当前是不是它。 */
export async function localFlags(config) {
  const local = await scanLocal(config)
  const map = new Map(local.map((item) => [item.full.toLowerCase(), item.path]))
  return { local, map }
}

export function localExists(config, fullName) {
  return existsSync(localPath(config, fullName))
}
