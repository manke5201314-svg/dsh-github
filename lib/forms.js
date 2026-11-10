// 面板表单提交值的宽容解析。App 端提交的 value 形状不固定（字段名、
// 嵌套层级都可能不同），这里按字段名后缀找值，单字段表单退化成「第一个字符串」。

export function readForm(event, keys) {
  const wanted = new Set(keys)
  const found = new Map()
  let firstString = ''
  const visit = (value, depth) => {
    if (value === null || value === undefined || depth > 6) return
    if (typeof value === 'string') {
      if (firstString === '') firstString = value
      return
    }
    if (typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    for (const [rawKey, child] of Object.entries(value)) {
      const key = String(rawKey).split('.').pop()
      if (wanted.has(key) && (typeof child === 'string' || typeof child === 'boolean' || typeof child === 'number')) {
        if (!found.has(key)) found.set(key, child)
      } else {
        visit(child, depth + 1)
      }
    }
  }
  visit(event?.value, 0)
  const out = {}
  for (const key of keys) {
    if (found.has(key)) out[key] = found.get(key)
  }
  if (out[keys[0]] === undefined && firstString !== '' && keys.length === 1) {
    out[keys[0]] = firstString
  }
  return out
}

export function boolOf(value, fallback) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return !/^(false|0|no|off|关|否)$/i.test(value.trim())
  return fallback
}

export function stringOf(value) {
  return typeof value === 'string' ? value.trim() : value === undefined ? '' : String(value)
}
