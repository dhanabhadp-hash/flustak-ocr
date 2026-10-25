// Last-mile repair for hand-OCR digit grids:
// 1) safe letter->digit confusions seen in LSTM handwriting output
//    (O/o/Q/๐→0, l/I/|/J→1, Z→2, S→5, B→8, g/q→9, b→6 is TOO RISKY alone —
//     it is allowed but only rescues via column consensus, never forced)
// 2) per-column agreement: values that appear >=2x become "vocabulary";
//    other tokens snap to the closest vocabulary word (edit distance 1).
// Only touches digits-only-ish columns; text columns are left alone.
// Never invents data: anything unresolvable becomes '' (empty + user edits).

const SAFE = {
  o: '0', O: '0', Q: '0', D: '0', '๐': '0', '〇': '0', '০': '0', '0': '0',
  l: '1', I: '1', '|': '1', i: '1', '¡': '1', J: '1', j: '1', 'ı': '1', '¹': '1',
  Z: '2', z: '2', '۲': '2', '๒': '2',
  j: '1',
  's': '5', S: '5', '๕': '5',
  B: '8', '๘': '8',
  g: '9', q: '9', '๙': '9',
  '6': '6', '8': '8', '9': '9', '3': '3', '2': '2', '4': '4', '5': '5', '7': '7', '1': '1', '0': '0',
}
// extra, riskier confusions used ONLY when plain SAFE leaves a token unusable
const RISKY = { b: '6', B: '8', g: '9', q: '9', P: '9', p: '9', a: '4', s: '5', Z: '2', z: '2', ด: '1', ค: '1', ญ: '2' }

function normToken(raw, map) {
  let out = ''
  for (const ch of String(raw)) {
    if (/[\d+\-*/().]/.test(ch)) { out += ch; continue }
    const c = map[ch]
    if (c === undefined) return null
    out += c
  }
  return out
}

function editLe1(a, b) {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, diff = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++diff > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return diff + (a.length - i) + (b.length - j) <= 1
}

/** @param grid string[][] @returns same grid, repaired in place */
export function consensusFixGrid(grid) {
  if (!grid || grid.length < 2) return grid
  const nCols = Math.max(...grid.map((r) => r.length))
  for (let c = 0; c < nCols; c++) {
    const bodyRows = []
    for (let r = 1; r < grid.length; r++) {
      const v = String((grid[r] || [])[c] ?? '').trim()
      if (v) bodyRows.push([r, v])
    }
    if (bodyRows.length < 4) continue
    // column must look digit-ish overall to be touched
    const digitish = bodyRows.filter(([, v]) => /[0-9๐-๙]/.test(v)).length
    if (digitish / bodyRows.length < 0.7) continue
    const freq = new Map()
    for (const [, v] of bodyRows) {
      const t = normToken(v.replace(/[\s,.]/g, ''), SAFE) || normToken(v.replace(/[\s,.]/g, ''), { ...SAFE, ...RISKY })
      if (t === null || !t) continue
      freq.set(t, (freq.get(t) || 0) + 1)
    }
    const vocab = [...freq.entries()].filter(([, n]) => n >= 2 && n / bodyRows.length >= 0.1).map(([t]) => t)
    for (const [r, v] of bodyRows) {
      const stripped = v.replace(/[\s,.]/g, '')
      let t = normToken(stripped, SAFE)
      if (t === null) t = normToken(stripped, { ...SAFE, ...RISKY })
      if (t && /[+\-*/]/.test(t) && /\d/.test(t) && /^[\d+\-*/.()]+$/.test(t)) { grid[r][c] = t; continue }  // valid expression: keep
      if (t && (vocab.length === 0 || vocab.includes(t) || /^\d+$/.test(t) && (freq.get(t) || 0) >= 2)) { grid[r][c] = t || ''; continue }
      if (t) {
        const near = vocab.find((w) => editLe1(w, t))
        if (near) { grid[r][c] = near; continue }
      }
      const digits = stripped.replace(/[^0-9]/g, '')
      if (digits && (!vocab.length || vocab.includes(digits))) { grid[r][c] = digits; continue }
      if (digits) {
        const near = vocab.find((w) => editLe1(w, digits))
        grid[r][c] = near || digits
        continue
      }
      grid[r][c] = ''    // unresolvable letters in a digit column -> empty (flagged for user)
    }
  }
  return grid
}
