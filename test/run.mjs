// 插件自测：不联网也能跑的部分（表单解析、目标解析、本地 git 身份/所有权）。
// 用法：node test/run.mjs

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { boolOf, readForm, stringOf } from '../lib/forms.js'
import { checkRepoName, parseTarget, localPath } from '../lib/ops.js'
import * as git from '../lib/git.js'

const run = promisify(execFile)
let passed = 0

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`ok   ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`ok   ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

// ── 目标解析 ───────────────────────────────────────────────
test('parseTarget: owner/repo', () => {
  assert.deepEqual(parseTarget('octocat/Hello-World').full, 'octocat/Hello-World')
})
test('parseTarget: 带 .git 的链接', () => {
  assert.equal(parseTarget('https://github.com/octocat/Hello-World.git').full, 'octocat/Hello-World')
})
test('parseTarget: git@ 形式', () => {
  assert.equal(parseTarget('git@github.com:octocat/Hello-World.git').full, 'octocat/Hello-World')
})
test('parseTarget: 省略协议的 github.com', () => {
  assert.equal(parseTarget('github.com/octocat/Hello-World').full, 'octocat/Hello-World')
})
test('parseTarget: 无效输入返回 null', () => {
  assert.equal(parseTarget(''), null)
  assert.equal(parseTarget('just-a-name'), null)
  assert.equal(parseTarget('a/b/c'), null)
  assert.equal(parseTarget('https://gitlab.com/a/b'), null)
})

// ── 仓库名校验 ─────────────────────────────────────────────
test('checkRepoName: 合法名', () => {
  assert.equal(checkRepoName(' my-project_1.0 '), 'my-project_1.0')
})
test('checkRepoName: 非法名抛错', () => {
  assert.throws(() => checkRepoName('我的仓库'), /字母、数字/)
  assert.throws(() => checkRepoName('   '), /仓库名/)
  assert.throws(() => checkRepoName('..'), /换个/)
})

// ── 表单值宽容解析 ─────────────────────────────────────────
test('readForm: 直接平铺字段', () => {
  const out = readForm({ value: { repoName: 'demo', private: false } }, ['repoName', 'private'])
  assert.equal(out.repoName, 'demo')
  assert.equal(out.private, false)
})
test('readForm: 嵌套 bind 路径', () => {
  const out = readForm({ value: { 'data.form.addTarget': 'a/b' } }, ['addTarget'])
  assert.equal(out.addTarget, 'a/b')
})
test('readForm: 深一层的 values 对象', () => {
  const out = readForm({ value: { values: { form: { token: 'ghp_x' } } } }, ['token'])
  assert.equal(out.token, 'ghp_x')
})
test('readForm: 单字段表单直接给字符串', () => {
  const out = readForm({ value: 'ghp_abc' }, ['token'])
  assert.equal(out.token, 'ghp_abc')
})
test('readForm: 读不到时为空', () => {
  assert.deepEqual(readForm(undefined, ['token']), {})
})

// ── 布尔/字符串工具 ────────────────────────────────────────
test('boolOf/stringOf', () => {
  assert.equal(boolOf(undefined, true), true)
  assert.equal(boolOf('false', true), false)
  assert.equal(boolOf(false, true), false)
  assert.equal(stringOf('  x  '), 'x')
  assert.equal(stringOf(undefined), '')
})

// ── 本地路径 ───────────────────────────────────────────────
test('localPath 拼接', () => {
  assert.equal(localPath({ baseDir: '/tmp/base' }, 'a/b'), join('/tmp/base', 'a', 'b'))
})

// ── 本地 git：身份 + 手机存储所有权（不联网） ───────────────
const config = { token: '', login: 'tester', baseDir: '/tmp', current: '' }
const dir = '/sdcard/DeepSeek/tmp/git-identity-test'

await testAsync('git: 在手机存储目录提交成功（safe.directory + 身份）', async () => {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  await run('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  await writeFile(join(dir, 'README.md'), '# test\n')
  const result = await git.commitAll(config, dir, '初次提交')
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.committed, true)
  const log = await run('git', ['log', '--format=%an <%ae> %s', '-1'], { cwd: dir })
  assert.match(log.stdout, /tester/)
})

await testAsync('git: 无改动时 committed=false', async () => {
  const result = await git.commitAll(config, dir, '第二次')
  assert.equal(result.ok, true)
  assert.equal(result.committed, false)
})

await testAsync('git: remoteFullName 解析 owner/repo', async () => {
  await run('git', ['remote', 'add', 'origin', 'https://github.com/octocat/Hello-World.git'], { cwd: dir })
  const full = await git.remoteFullName(config, dir)
  assert.equal(full, 'octocat/Hello-World')
})

await testAsync('git: dirtyCount 统计改动', async () => {
  await writeFile(join(dir, 'new.txt'), 'x\n')
  const count = await git.dirtyCount(config, dir)
  assert.ok(count >= 1, String(count))
})

await rm(dir, { recursive: true, force: true })
console.log(`\n${passed} 项通过`)
