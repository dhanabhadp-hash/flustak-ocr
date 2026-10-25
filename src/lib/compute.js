// ---- expression parsing / arithmetic engine ----
// All operators (* , x , × , + , - , − , ÷ , /) are treated as "+" per spec.
// 5*7 -> 5+7=12 ; 5-5 -> 5+5=10 ; 3+4*5 -> 3+4+5=12
const SEP = /[\s*xX×+\/\-−–—÷]/

export function tokens(raw) {
  if (!raw) return []
  return String(raw)
    .split(SEP)
    .map((t) => t.replace(/[^\d.]/g, ''))
    .filter((t) => /\d/.test(t))
    .map(Number)
    .filter((n) => Number.isFinite(n))
}

export function evalRaw(raw) {
  const t = tokens(raw)
  if (!t.length) return null
  const v = t.reduce((a, b) => a + b, 0) // every operator becomes +
  return { value: round6(v), expanded: t.join(' + '), n: t.length }
}

export function evalCell(raw) {
  const t = tokens(raw)
  if (!t.length) return { value: null }
  const v = t.reduce((a, b) => a + b, 0)
  return {
    value: round6(v),
    expr: t.length > 1 ? t.join('+') + '=' + round6(v) : null,
  }
}

export function colTotal(rawCells) {
  let s = 0
  let any = false
  for (const c of rawCells || []) {
    const e = evalRaw(c)
    if (e) {
      s += e.value
      any = true
    }
  }
  return any ? round6(s) : null
}

export function round6(n) {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6
}

// ---- column helpers (1-based) ----
export const ODD_COLS = [1, 3, 5, 7, 9, 11, 13, 15]
export const EVEN_COLS = [2, 4, 6, 8, 10, 12, 14, 16]
export const isOddCol = (n1) => n1 % 2 === 1
export const isEvenCol = (n1) => n1 % 2 === 0

export function fmt(n) {
  return n == null ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

// ---- number matching (Thai-lottery style suffix match) ----
// "1234" matches 3-digit "234" (last three) and 2-digit "34" (last two).
export function digitsOf(cell) {
  const m = String(cell ?? '').match(/\d+/g)
  return m ? m.join('') : ''
}

export function matchTarget(digits, target) {
  const t = String(target).replace(/\D/g, '')
  if (!t) return false
  const tail = digits.slice(-t.length)
  return tail.length === t.length && tail === t
}

// ---- Group B: 3-digit -> all distinct rearrangements (123 -> 213|231|312|321|132|123) ----
export function perms3(s) {
  const d = String(s).replace(/\D/g, '')
  if (d.length !== 3) return []
  const out = new Set()
  for (const a of d) {
    const rest = d.split('')
    rest.splice(rest.indexOf(a), 1)
    for (const b of rest) {
      const r2 = rest.slice()
      r2.splice(r2.indexOf(b), 1)
      out.add(a + b + r2[0])
    }
  }
  return [...out]
}
