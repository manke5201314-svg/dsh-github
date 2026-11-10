// 集成自测：用官方测试宿主模拟 dsh-go 的清单解析、视图校验和 invoke，
// 验证未连接状态的各个入口都给出人话提示、不抛异常。
// 用法：node test/integration.mjs

import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const KIT = '/root/.dsh/skills/dsh-go-plugin/kit'
const { createTestHost } = await import(pathToFileURL(join(KIT, 'lib/testing.js')).href)
const plugin = await import(pathToFileURL(new URL('../lib/index.js', import.meta.url).pathname).href)

const dir = new URL('..', import.meta.url).pathname
const dataDir = join(dir, 'data')

let passed = 0
async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`ok   ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

function effectsOf(result) {
  return (result.effects ?? []).map((effect) => effect.type)
}

function firstToast(effects) {
  return (effects ?? []).find((effect) => effect.type === 'toast')?.text ?? ''
}

const host = createTestHost({ dir })
plugin.apply(host.ctx)
assert.equal(host.registrations().handlers.length, 4, '应注册 4 个处理函数')

await test('未连接时面板是接入视图', async () => {
  const { view, stats } = await host.view('github')
  assert.equal(view.type, 'stack')
  assert.ok(stats.bytes < 32768)
  const json = JSON.stringify(view)
  assert.ok(json.includes('saveToken'), '应有令牌表单')
  assert.ok(!json.includes('ghp_'), '视图里不能出现令牌字样')
})

await test('未连接时面板数据不含令牌', async () => {
  const feed = host.subscribe('github')
  await feed.settled
  assert.equal(feed.data.login, '—')
  assert.deepEqual(feed.data.repos, [])
  assert.ok(!JSON.stringify(feed.data).includes('token":'), '数据里不能有令牌字段')
})

await test('状态条显示未连接', async () => {
  const feed = host.subscribe('status')
  await feed.settled
  assert.equal(feed.data.text, 'GitHub · 未连接')
})

await test('胶囊建仓：没写名字时提示', async () => {
  const result = await host.invoke('ghCreate', { surface: 'composer.actions' })
  assert.deepEqual(effectsOf(result), ['toast'])
  assert.match(firstToast(result.effects), /输入框写仓库名/)
})

await test('胶囊推代码：还没仓库时提示', async () => {
  const result = await host.invoke('ghPush', { surface: 'composer.actions' })
  const pending = result.pending ?? result
  const settled = pending.settled ?? null
  if (settled !== null) {
    const done = await settled
    assert.match(firstToast(done.effects), /还没有选仓库/)
  } else {
    assert.match(firstToast(result.effects), /还没有选仓库|先/)
  }
})

await test('加号工具：没写 owner/repo 时提示', async () => {
  const result = await host.invoke('ghAdd', { surface: 'composer.tools' })
  assert.match(firstToast(result.effects), /owner\/repo/)
})

await test('加号设置：剪贴板为空时提示', async () => {
  const result = await host.invoke('ghSetup', { surface: 'composer.tools' })
  assert.match(firstToast(result.effects), /剪贴板/)
})

await test('面板建仓：没有令牌时给出提示', async () => {
  const result = await host.invoke('github', { action: 'createRepo', value: { repoName: 'demo' } })
  const done = await result.settled
  assert.deepEqual(effectsOf(done), ['toast', 'patch'])
  assert.match(firstToast(done.effects), /先配置|令牌/)
})

await test('面板表单值：嵌套形状也能读到仓库名', async () => {
  const result = await host.invoke('github', {
    action: 'createRepo',
    value: { values: { 'data.form.repoName': 'nested-name' } },
  })
  const done = await result.settled
  assert.match(firstToast(done.effects), /先配置|令牌/)
})

await test('面板动作列表齐全', async () => {
  const reg = host.registrations()
  assert.equal(reg.dataPanels.includes('github'), true)
  const { view } = await host.view('github')
  const actions = new Set()
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (typeof node.action === 'string') actions.add(node.action)
    else if (node.action?.id) actions.add(node.action.id)
    if (typeof node.submit?.id === 'string') actions.add(node.submit.id)
    for (const value of Object.values(node)) walk(value)
  }
  walk(view)
  assert.ok(actions.has('saveToken'))
})

// 清理测试写入的配置（真实使用时这里存令牌，不能留着假数据）
await rm(dataDir, { recursive: true, force: true })
host.dispose()
console.log(`\n${passed} 项通过（已清理测试配置）`)
