// dsh-go 原生插件「GitHub 仓库」：随时建仓、随时推送当前项目、
// 一键 fork+clone 别人的项目。所有网络请求走 GitHub REST，git 直接用本机 git。
// 令牌只存插件私有目录，从不进入视图、toast 或日志。

import { loadConfig, saveConfig } from './config.js'
import * as api from './api.js'
import { GhError } from './api.js'
import { boolOf, readForm, stringOf } from './forms.js'
import * as ops from './ops.js'
import { UserError } from './ops.js'

export const name = 'dsh-github'

const STRIP_INTERVAL_MS = 30_000
const STRIP_MAX = 24

/** 用户输入错误优先用原话，其余给一句能看懂的话。 */
function messageOf(error) {
  if (error instanceof UserError) return error.message
  if (error instanceof GhError) return error.message
  const raw = String(error?.message ?? '')
  if (/ENOENT/.test(raw)) return '本地目录不存在，检查手机存储'
  if (/EACCES|EPERM/.test(raw)) return '没有权限访问本地目录'
  return '操作失败，稍后再试'
}

function clamp(text, max) {
  const chars = Array.from(String(text ?? ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function stripText(config) {
  if (!config.token) return 'GitHub · 未连接'
  if (config.login) return clamp(`GitHub @${config.login}`, STRIP_MAX)
  return 'GitHub · 已配置'
}

function repoItems(repos, config, localMap) {
  const mine = String(config.current ?? '').toLowerCase()
  return repos.slice(0, 20).map((repo) => {
    if (repo === null || typeof repo !== 'object') return null
    const full = typeof repo.full_name === 'string' ? repo.full_name : ''
    if (full === '') return null
    const isCurrent = full.toLowerCase() === mine
    const isLocal = localMap.has(full.toLowerCase())
    return {
      title: String(repo.name ?? full),
      subtitle: `${repo.private === true ? '私有' : '公开'} · ${String(repo.owner?.login ?? '')}`,
      trailing: isCurrent ? '当前' : isLocal ? '本地' : '',
      action: { id: 'useRepo', args: { full } },
    }
  }).filter((item) => item !== null)
}

function localItems(local, config) {
  const mine = String(config.current ?? '').toLowerCase()
  return local.slice(0, 12).map((item) => ({
    title: item.full,
    subtitle: '本地工作副本',
    trailing: item.full.toLowerCase() === mine ? '当前' : '',
    action: { id: 'useLocal', args: { full: item.full } },
  }))
}

const setupView = () => ({
  v: 2,
  type: 'stack',
  title: 'GitHub 仓库',
  children: [
    { type: 'callout', tone: 'info', text: '还没有连接 GitHub。到 GitHub 网页版 → Settings → Developer settings → Personal access tokens 生成一个带 repo 权限的令牌，粘贴到下面。' },
    {
      type: 'form',
      label: '接入令牌',
      submit: { id: 'saveToken' },
      submitLabel: '保存并连接',
      children: [
        {
          type: 'textField',
          label: '访问令牌',
          bind: 'data.form.token',
          placeholder: 'ghp_… 或 github_pat_…',
          maxLength: 200,
        },
      ],
    },
    { type: 'text', tone: 'muted', text: '令牌只存在本机插件目录里，不会出现在对话里。也可以把令牌复制到剪贴板，再在输入框上方的加号面板点「设置」自动连接。' },
  ],
})

function readyView() {
  return {
    v: 2,
    type: 'stack',
    title: 'GitHub 仓库',
    children: [
      { type: 'callout', text: { $: 'data.message.text' }, tone: 'info' },
      {
        type: 'keyValue',
        items: [
          ['账号', { $: 'data.login' }],
        ],
      },
      {
        type: 'form',
        label: '新建仓库（建好后自动拉到本地）',
        submit: { id: 'createRepo' },
        submitLabel: '建仓',
        children: [
          { type: 'textField', label: '仓库名', bind: 'data.form.repoName', placeholder: 'my-project', maxLength: 100 },
          { type: 'textField', label: '描述（可空）', bind: 'data.form.desc', maxLength: 200 },
          { type: 'toggle', label: '私有仓库', bind: 'data.form.private' },
        ],
      },
      {
        type: 'form',
        label: '一键添加别人的项目（fork + 拉到本地）',
        submit: { id: 'addRepo' },
        submitLabel: '一键添加',
        children: [
          { type: 'textField', label: '项目', bind: 'data.form.addTarget', placeholder: 'owner/repo 或链接', maxLength: 200 },
          { type: 'toggle', label: 'Fork 到我账号', bind: 'data.form.fork' },
        ],
      },
      { type: 'keyValue', items: [['当前仓库', { $: 'data.current' }]] },
      {
        type: 'actions',
        items: [
          { label: '同步', action: 'sync' },
          { label: '推送', action: 'push', style: 'primary' },
          { label: '打开网页', action: 'openSite' },
        ],
      },
      { type: 'text', tone: 'muted', text: '我的仓库（点一下：本地有就切换，没有就克隆）' },
      { type: 'list', items: { $: 'data.repos' } },
      { type: 'text', tone: 'muted', text: '本地工作副本（点一下切换）' },
      { type: 'list', items: { $: 'data.local' } },
      { type: 'actions', items: [{ label: '刷新', action: 'reload', style: 'plain' }] },
    ],
  }
}

function buildView(config) {
  return config.token === '' ? setupView() : readyView()
}

/** 面板最近一次操作的提示；刷新后仍保留。 */
let lastNote = ''

/** data() 推给 App 的完整快照（不含令牌）。 */
async function snapshot(config) {
  const form = {
    token: '',
    repoName: '',
    desc: '',
    private: true,
    addTarget: '',
    fork: true,
  }
  if (config.token === '') {
    return { login: '—', current: '—', form, repos: [], local: [], message: { text: '还没连接 GitHub。' } }
  }
  const local = await ops.scanLocal(config)
  const localMap = new Map(local.map((item) => [item.full.toLowerCase(), item.path]))
  let repos = []
  let note = lastNote
  try {
    repos = await api.listRepos(config, 30)
    if (lastNote === '') note = `最近更新：${String(repos[0]?.full_name ?? '暂无仓库')}`
  } catch (error) {
    note = messageOf(error)
  }
  return {
    login: config.login === '' ? '—' : `@${config.login}`,
    current: config.current === '' ? '—' : config.current,
    form,
    repos: repoItems(repos, config, localMap),
    local: localItems(local, config),
    message: { text: note },
  }
}

function setNote(text) {
  lastNote = text
  return { patch: { message: { text } } }
}

export function apply(ctx) {
  ctx.inject(['dshGo'], (ctx) => {
    // 输入框上方常驻一行连接状态，点开是面板。
    ctx.dshGo.strip('status', (scope, emit) => {
      let alive = true
      const push = async () => {
        const config = await loadConfig()
        if (!alive) return
        emit({ text: stripText(config) })
      }
      push()
      const timer = setInterval(push, STRIP_INTERVAL_MS)
      return () => {
        alive = false
        clearInterval(timer)
      }
    })

    // 面板：状态、建仓、一键添加、当前仓库操作、仓库列表。
    ctx.dshGo.panel('github', {
      view: async () => buildView(await loadConfig()),
      data: async (scope, emit, caps) => {
        let alive = true
        const config = await loadConfig()
        if (!alive) return () => {}
        emit(await snapshot(config))
        return () => {
          alive = false
        }
      },
      actions: {
        reload: () => ({ refresh: true }),

        saveToken: async (scope, event) => {
          const fields = readForm(event, ['token'])
          const token = stringOf(fields.token)
          if (token === '') return { toast: '没拿到令牌内容，重新粘贴一次' }
          const config = await loadConfig()
          const saved = await saveConfig({ ...config, token })
          try {
            const user = await api.getUser(saved)
            const login = typeof user?.login === 'string' ? user.login : ''
            if (login === '') throw new GhError('GitHub 没返回账号信息')
            await saveConfig({ login })
            lastNote = `已连接 @${login}`
            return { refresh: true, toast: `已连接 @${login}` }
          } catch (error) {
            await saveConfig({ token: '', login: '' })
            return { toast: messageOf(error) }
          }
        },

        createRepo: (scope, event) => {
          const fields = readForm(event, ['repoName', 'desc', 'private'])
          const repoName = stringOf(fields.repoName)
          const description = stringOf(fields.desc)
          const privateRepo = boolOf(fields.private, true)
          return {
            pending: { label: '正在建仓', timeoutMs: 55_000 },
            result: async () => {
              try {
                const config = await loadConfig()
                if (config.token === '') return { toast: '先配置 GitHub 令牌', ...setNote('还没有令牌。') }
                const created = await ops.createRepo(config, { name: repoName, privateRepo, description })
                await saveConfig({ current: created.fullName })
                return {
                  refresh: true,
                  toast: `已建仓 ${clamp(created.fullName, 24)}`,
                  ...setNote(`已建 ${created.fullName}，本地在 ${created.path}`),
                }
              } catch (error) {
                return { toast: messageOf(error), ...setNote(messageOf(error)) }
              }
            },
          }
        },

        addRepo: (scope, event) => {
          const fields = readForm(event, ['addTarget', 'fork'])
          const target = stringOf(fields.addTarget)
          const fork = boolOf(fields.fork, true)
          return {
            pending: { label: '正在添加', timeoutMs: 58_000 },
            result: async () => {
              try {
                const config = await loadConfig()
                if (config.token === '') return { toast: '先配置 GitHub 令牌', ...setNote('还没有令牌。') }
                const added = await ops.addProject(config, target, { fork })
                await saveConfig({ current: added.fullName })
                const verb = added.forked ? '已 Fork 并克隆' : '已克隆'
                return {
                  refresh: true,
                  toast: `${verb} ${clamp(added.fullName, 20)}`,
                  ...setNote(`${verb} ${added.fullName}${added.existed ? '（本地已有）' : ''}`),
                }
              } catch (error) {
                return { toast: messageOf(error), ...setNote(messageOf(error)) }
              }
            },
          }
        },

        useRepo: (scope, event) => {
          const full = stringOf(event?.value?.full ?? event?.value)
          return {
            pending: { label: '正在准备', timeoutMs: 55_000 },
            result: async () => {
              try {
                const config = await loadConfig()
                if (config.token === '') return { toast: '先配置 GitHub 令牌' }
                let path = ops.localExists(config, full) ? ops.localPath(config, full) : ''
                if (path === '') {
                  const cloned = await ops.addProject(config, full, { fork: false })
                  path = cloned.path
                }
                await saveConfig({ current: full })
                return { refresh: true, toast: `当前仓库 ${clamp(full, 24)}`, ...setNote(`当前仓库切到 ${full}`) }
              } catch (error) {
                return { toast: messageOf(error), ...setNote(messageOf(error)) }
              }
            },
          }
        },

        useLocal: async (scope, event) => {
          const full = stringOf(event?.value?.full ?? event?.value)
          if (full === '') return { toast: '没拿到仓库名' }
          await saveConfig({ current: full })
          lastNote = `当前仓库切到 ${full}`
          return { refresh: true, toast: `当前仓库 ${clamp(full, 24)}` }
        },

        sync: () => ({
          pending: { label: '正在同步', timeoutMs: 55_000 },
          result: async () => {
            try {
              const config = await loadConfig()
              const synced = await ops.syncCurrent(config)
              return { toast: `已同步 ${clamp(synced.fullName, 20)}`, ...setNote(`已从 GitHub 同步 ${synced.fullName}`) }
            } catch (error) {
              return { toast: messageOf(error), ...setNote(messageOf(error)) }
            }
          },
        }),

        push: () => ({
          pending: { label: '正在推送', timeoutMs: 55_000 },
          result: async () => {
            try {
              const config = await loadConfig()
              const pushed = await ops.pushCurrent(config, '更新')
              const detail = pushed.committed ? '已提交并推送' : '没有新改动，已确认远端最新'
              return { toast: `${detail} ${clamp(pushed.fullName, 16)}`, ...setNote(`${detail}：${pushed.fullName}`) }
            } catch (error) {
              return { toast: messageOf(error), ...setNote(messageOf(error)) }
            }
          },
        }),

        openSite: async () => {
          const config = await loadConfig()
          if (config.current === '') return { toast: '还没有选仓库' }
          return { link: `https://github.com/${config.current}` }
        },
      },
    })

    // 胶囊「建仓」：把输入框里的文字当仓库名，建一个私有仓库并拉到本地。
    ctx.dshGo.on('ghCreate', (scope) => {
      const draft = stringOf(scope.draft)
      if (draft === '') return { toast: '先在输入框写仓库名' }
      return {
        pending: { label: '正在建仓', timeoutMs: 55_000 },
        result: async () => {
          try {
            const config = await loadConfig()
            if (config.token === '') return { toast: '先在插件面板配置令牌' }
            const created = await ops.createRepo(config, { name: draft, privateRepo: true })
            await saveConfig({ current: created.fullName })
            return { toast: `已建仓 ${clamp(created.fullName, 24)}（私有）` }
          } catch (error) {
            return { toast: messageOf(error) }
          }
        },
      }
    })

    // 胶囊「推代码」：输入框里的文字当提交信息，推送当前仓库。
    ctx.dshGo.on('ghPush', (scope) => {
      const message = stringOf(scope.draft)
      return {
        pending: { label: '正在推送', timeoutMs: 55_000 },
        result: async () => {
          try {
            const config = await loadConfig()
            const pushed = await ops.pushCurrent(config, message)
            return { toast: pushed.committed ? `已推送 ${clamp(pushed.fullName, 20)}` : '没有新改动' }
          } catch (error) {
            return { toast: messageOf(error) }
          }
        },
      }
    })

    // 输入框加号面板「加项目」：输入框里写 owner/repo，一键 fork + 克隆。
    ctx.dshGo.on('ghAdd', (scope) => {
      const draft = stringOf(scope.draft)
      if (draft === '') return { toast: '先在输入框写 owner/repo' }
      return {
        pending: { label: '正在添加', timeoutMs: 58_000 },
        result: async () => {
          try {
            const config = await loadConfig()
            if (config.token === '') return { toast: '先在插件面板配置令牌' }
            const added = await ops.addProject(config, draft, { fork: true })
            await saveConfig({ current: added.fullName })
            return { toast: `已添加 ${clamp(added.fullName, 20)}` }
          } catch (error) {
            return { toast: messageOf(error) }
          }
        },
      }
    })

    // 加号面板「设置」：没连接时把剪贴板里的令牌接上（面板表单之外的兜底），已连接就打开面板。
    ctx.dshGo.on('ghSetup', async (scope) => {
      const config = await loadConfig()
      if (config.token !== '') return { open: 'panel:github' }
      const clip = stringOf(scope.clipboard)
      if (clip === '') return { toast: '先把令牌复制到剪贴板' }
      if (!/^(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{10,}$/.test(clip)) {
        return { toast: '剪贴板里不是 GitHub 令牌' }
      }
      return {
        pending: { label: '正在连接', timeoutMs: 30_000 },
        result: async () => {
          try {
            const user = await api.getUser({ ...config, token: clip })
            const login = typeof user?.login === 'string' ? user.login : ''
            if (login === '') throw new GhError('GitHub 没返回账号信息')
            await saveConfig({ token: clip, login })
            lastNote = `已连接 @${login}`
            return { toast: `已连接 @${login}` }
          } catch (error) {
            return { toast: messageOf(error) }
          }
        },
      }
    })
  })
}
