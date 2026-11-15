// 纯 API 的仓库内容传输：拉取、推送都不再调本机 git。
// 手机网络里 github.com:443 常常连不上，但 api.github.com 通，所以走 Git Data API：
// 本地文件算 git blob sha → 只上传变化的部分 → 拼 tree → 建 commit → 快进分支。

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import * as api from './api.js'

export const MARKER = '.dsh-github.json'
const MAX_FILES = 2000
const MAX_BLOB_BYTES = 40 * 1024 * 1024
const POOL = 4

/** 用户能看懂的错误；消息直接进 toast。 */
export class TransferError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TransferError'
  }
}

export function blobSha(buffer) {
  return createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex')
}

/** 本地仓库判定：有标记文件或旧的 .git 都算。 */
export function isRepo(dir) {
  return existsSync(join(dir, MARKER)) || existsSync(join(dir, '.git'))
}

async function readMarker(dir) {
  try {
    const raw = await readFile(join(dir, MARKER), 'utf8')
    const data = JSON.parse(raw)
    return data !== null && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

async function writeMarker(dir, data) {
  await writeFile(join(dir, MARKER), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

async function runPool(items, worker, limit = POOL) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/** 本地工作副本里的文件：相对路径 → { abs, sha, mode }。跳过标记文件和 .git。 */
async function listLocalFiles(dir) {
  const out = new Map()
  const walk = async (current, prefix) => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const abs = join(current, entry.name)
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue
        await walk(abs, rel)
        continue
      }
      if (!entry.isFile()) continue
      if (rel === MARKER) continue
      const info = await stat(abs).catch(() => null)
      if (info === null || info.size > MAX_BLOB_BYTES) continue
      const buf = await readFile(abs).catch(() => null)
      if (buf === null) continue
      out.set(rel, { abs, sha: blobSha(buf), size: buf.length, mode: (info.mode & 0o111) === 0 ? '100644' : '100755' })
      if (out.size > MAX_FILES) throw new TransferError(`本地文件超过 ${MAX_FILES} 个，这个面板只适合中小项目`)
    }
  }
  await walk(dir, '')
  return out
}

/** 远端某个分支的头：{ branch, commit, tree }。仓库为空时返回 null。 */
async function remoteHead(config, fullName) {
  const repo = await api.getRepo(config, fullName)
  const branch = typeof repo?.default_branch === 'string' && repo.default_branch !== '' ? repo.default_branch : 'main'
  let ref = null
  try {
    ref = await api.getRef(config, fullName, branch)
  } catch (error) {
    if (error?.status !== 404) throw error
    return { branch, commit: null, tree: null, files: new Map() }
  }
  const commit = await api.getCommit(config, fullName, ref.object.sha)
  const tree = await api.getTree(config, fullName, commit.tree.sha)
  if (tree?.truncated === true) throw new TransferError('仓库文件太多，GitHub 一次读不全，换用命令行处理')
  const files = new Map()
  for (const item of Array.isArray(tree?.tree) ? tree.tree : []) {
    if (item.type !== 'blob') continue
    if (item.mode === '120000') continue
    files.set(item.path, { sha: item.sha, mode: item.mode === '100755' ? '100755' : '100644', size: item.size ?? 0 })
  }
  return { branch, commit: ref.object.sha, tree: commit.tree.sha, files }
}

/** 拉取（也用于克隆）：把远端内容写到 dir，删掉远端没有的文件。 */
export async function pullRepo(config, fullName, dir) {
  if (fullName.split('/').length !== 2) throw new TransferError('仓库名不完整')
  const head = await remoteHead(config, fullName)
  await mkdir(dir, { recursive: true })
  const paths = [...head.files.keys()]
  await runPool(paths, async (path) => {
    const info = head.files.get(path)
    const abs = join(dir, path.split('/').join(sep))
    const existing = await readFile(abs).catch(() => null)
    if (existing !== null && existing.length === info.size && blobSha(existing) === info.sha) return
    const blob = await api.getBlob(config, fullName, info.sha)
    const buf = Buffer.from(String(blob?.content ?? ''), 'base64')
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, buf)
    if (info.mode === '100755') await chmodExecutable(abs)
  })
  await removeExtras(dir, new Set(paths))
  await writeMarker(dir, { v: 1, full: fullName, branch: head.branch, commit: head.commit, tree: head.tree })
  return { fullName, path: dir, branch: head.branch, files: paths.length }
}

async function chmodExecutable(abs) {
  try {
    const { chmod } = await import('node:fs/promises')
    await chmod(abs, 0o755)
  } catch {
    // 手机存储可能不支持改权限，忽略
  }
}

async function removeExtras(dir, keep) {
  const walk = async (current, prefix) => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const abs = join(current, entry.name)
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue
        await walk(abs, rel)
        const left = await readdir(abs).catch(() => null)
        if (left !== null && left.length === 0) await rm(abs, { recursive: true, force: true })
        continue
      }
      if (rel === MARKER) continue
      if (!keep.has(rel)) await rm(abs, { force: true })
    }
  }
  await walk(dir, '')
}

/** 推送：只上传有变化的文件，再用 Git Data API 建提交并快进分支。 */
export async function pushRepo(config, fullName, dir, message) {
  const local = await listLocalFiles(dir)
  if (local.size === 0) throw new TransferError('本地目录是空的，没什么可推')
  const head = await remoteHead(config, fullName)
  const changed = []
  const removed = []
  for (const [path, info] of local) {
    const remote = head.files.get(path)
    if (remote === undefined || remote.sha !== info.sha || remote.mode !== info.mode) changed.push(path)
  }
  for (const path of head.files.keys()) {
    if (!local.has(path)) removed.push(path)
  }
  if (changed.length === 0 && removed.length === 0) return { fullName, path: dir, committed: false, files: 0 }

  const entries = []
  await runPool(changed, async (path) => {
    const info = local.get(path)
    const buf = await readFile(info.abs)
    const blob = await api.createBlob(config, fullName, buf.toString('base64'))
    entries.push({ path, mode: info.mode, type: 'blob', sha: blob.sha })
  })
  for (const path of removed) entries.push({ path, mode: '100644', type: 'blob', sha: null })

  const tree = await api.createTree(config, fullName, entries, head.tree ?? undefined)
  const text = String(message ?? '').trim().slice(0, 200) || '更新'
  const commit = await api.createCommit(config, fullName, {
    message: text,
    tree: tree.sha,
    parents: head.commit === null ? [] : [head.commit],
  })
  if (head.commit === null) {
    await api.createRef(config, fullName, head.branch, commit.sha)
  } else {
    await api.updateRef(config, fullName, head.branch, commit.sha)
  }
  await writeMarker(dir, { v: 1, full: fullName, branch: head.branch, commit: commit.sha, tree: tree.sha })
  return { fullName, path: dir, committed: true, files: changed.length + removed.length }
}

/** 本地相对远端的差异数量，用来提示「有未推送改动」。 */
export async function pendingCount(config, dir) {
  const marker = await readMarker(dir)
  if (marker === null || typeof marker.full !== 'string') return 0
  try {
    const head = await remoteHead(config, marker.full)
    const local = await listLocalFiles(dir)
    let count = 0
    for (const [path, info] of local) {
      const remote = head.files.get(path)
      if (remote === undefined || remote.sha !== info.sha) count += 1
    }
    for (const path of head.files.keys()) if (!local.has(path)) count += 1
    return count
  } catch {
    return 0
  }
}
