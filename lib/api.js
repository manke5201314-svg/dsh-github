// GitHub REST v3 的最小封装：只要建仓、列出、fork、查询这几件事。
// 所有错误都翻成中文人话，绝不把令牌写进错误信息。

const API_ROOT = 'https://api.github.com'
const USER_AGENT = 'dsh-github/0.1'
const NETWORK_HINT = '连不上 GitHub，检查手机网络或代理'

export class GhError extends Error {
  constructor(message, status = 0, detail = '') {
    super(message)
    this.name = 'GhError'
    this.status = status
    this.detail = detail
  }
}

function friendly(status, message) {
  if (status === 401) return '令牌无效或已过期，重新贴一个新令牌'
  if (status === 403 && /rate limit/i.test(message)) return 'GitHub 请求太频繁，过几分钟再试'
  if (status === 403) return '令牌权限不够，需要勾上 repo 权限'
  if (status === 404) return 'GitHub 上没有这个仓库，或令牌看不到它'
  if (status === 422) return `GitHub 不接受这个请求：${message || '名称或参数不合法'}`
  if (status === 451) return '仓库因政策原因不可访问'
  if (status >= 500) return 'GitHub 服务暂时不可用，稍后再试'
  return message !== '' ? message : `GitHub 返回 ${status}`
}

async function request(config, path, { method = 'GET', body, timeout = 20_000 } = {}) {
  if (!config || !config.token) throw new GhError('还没配置 GitHub 令牌')
  const headers = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT,
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let response
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
  } catch (error) {
    const message = String(error?.message ?? '')
    if (/abort|timeout|timed out/i.test(message)) throw new GhError('GitHub 响应太慢，稍后再试')
    throw new GhError(NETWORK_HINT)
  }
  const text = await response.text().catch(() => '')
  let data = null
  if (text !== '') {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!response.ok) {
    throw new GhError(friendly(response.status, typeof data?.message === 'string' ? data.message : ''), response.status)
  }
  return data
}

export function getUser(config) {
  return request(config, '/user')
}

export function getRepo(config, fullName) {
  return request(config, `/repos/${fullName}`)
}

/** 最近的仓库（自己的、协作的、组织的）。 */
export function listRepos(config, limit = 30) {
  const perPage = Math.min(Math.max(limit, 1), 100)
  return request(config, `/user/repos?sort=updated&per_page=${perPage}&affiliation=owner,collaborator,organization_member`)
}

export function createRepo(config, { name, description = '', privateRepo = true }) {
  const body = { name, private: privateRepo === true, auto_init: true }
  if (description !== '') body.description = description
  return request(config, '/user/repos', { method: 'POST', body })
}

/** fork 到当前令牌账号；返回 fork 的仓库对象。 */
export function forkRepo(config, owner, repo) {
  return request(config, `/repos/${owner}/${repo}/forks`, { method: 'POST', body: {} })
}

/** fork 是异步的，等它可访问再 clone；超时返回 null 让调用方提示。 */
export async function waitForRepo(config, fullName, { tries = 8, intervalMs = 1500 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const repo = await getRepo(config, fullName)
      if (repo && repo.full_name) return repo
    } catch {
      // 404 = 还在生成，继续等
    }
    if (i < tries - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return null
}
