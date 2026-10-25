// In-browser OCR via Tesseract.js (loaded from CDN at runtime).
import { consensusFixGrid } from './consensus.js'
// Pipeline A (ruled tables): quad-detect -> warp to orthogonal binary bitmap ->
//   detect row/col rules -> crop each cell -> psm-7 OCR per cell.
// Pipeline B (fallback): grayscale/contrast -> full-page psm-6 OCR ->
//   cluster word boxes into rows/columns (grid-aware when rules found).

let cdnP = null
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract)
  if (!cdnP) {
    cdnP = new Promise((res, rej) => {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'
      s.onload = () => res(window.Tesseract)
      s.onerror = () => rej(new Error('โหลด Tesseract.js ไม่ได้ (ตรวจสอบอินเทอร์เน็ต)'))
      document.head.appendChild(s)
    })
  }
  return cdnP
}

async function toImage(fileOrUrl) {
  const url = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    if (typeof fileOrUrl !== 'string') URL.revokeObjectURL(url)
  }
}

/* -------- worker factory (cached: repeated scans reuse loaded models) -------- */

const workerCache = new Map()

/**
 * getWorker(TESS, spec) spec: { lang, best }
 * best=true loads the higher-accuracy "best" LSTM traineddata (better for
 * handwriting). Falls back to the default model automatically on network failure.
 */
async function getWorker(TESS, { lang = 'eng+tha', best = false } = {}) {
  const key = lang + '|' + (best ? 'best' : 'fast') + (window.__bestFailed ? '|demoted' : '')
  if (workerCache.get(key)) return workerCache.get(key)
  const build = (opts) => {
    const w = TESS.createWorker(lang, 1, opts)
    let to
    const guard = new Promise((_, rej) => { to = setTimeout(() => rej(new Error('worker init timeout')), 45000) })
    return Promise.race([w, guard]).finally(() => clearTimeout(to))
  }
  let w
  try {
    w = await build(best && !window.__bestFailed ? { langPath: 'https://tessdata.projectnaptha.com/4.0.0_best' } : {})
  } catch (e) {
    if (best && !window.__bestFailed) {
      window.__bestFailed = true
      w = await build({})
    } else throw e
  }
  workerCache.set(key, w)
  return w
}

/**
 * Convert Thai/Lao/fullwidth digits to ASCII and clean numeric cell text.
 * Letters are dropped (data cells are all numbers per spec).
 */
export function sanitizeNumeric(text) {
  let t = String(text ?? '')
  t = t.replace(/[\u0E50-\u0E59]/g, (c) => String(c.charCodeAt(0) - 0x0e50)) // ไทย ๐-๙
  t = t.replace(/[\u0ED0-\u0ED9]/g, (c) => String(c.charCodeAt(0) - 0x0ed0)) //ลาว
  t = t.replace(/[\uFF10-\uFF19]/g, (c) => String(c.charCodeAt(0) - 0xff10)) // ۰-۹ fullwidth
  t = t.replace(/[✕✖✗×⨯]/g, 'x')
  t = t.replace(/[−–—‐‑]/g, '-')
  t = t.replace(/[∙•·]/g, '*')
  t = t.replace(/(\d)[.,](?=\d{3}\b)/g, '$1')   // 1,234 -> 1234
  t = t.replace(/[^\d+\-*/x]/g, '')              // keep digits + operators only
  t = t.replace(/[xX]/g, '*')                    // "9x2" means 9*2
  return t
}

/**
 * Spec: table data columns contain numbers only. If a column's body is mostly
 * numeric, force every cell in it numeric — OCR letter-noise ("ง", "ส่", …)
 * inside digit columns becomes impossible to carry into totals/matching.
 * The header row (row 0) is left untouched so labels keep their letters.
 */
export function enforceNumericColumns(grid) {
  if (grid.length < 2) return grid
  const nCols = Math.max(...grid.map((r) => r.length))
  const looksNumeric = (v) => {
    const t = String(v).trim()
    return t !== '' && /^[\d\s.,+\-*/x()]+$/.test(t) && /\d/.test(t)
  }
  for (let c = 0; c < nCols; c++) {
    let body = 0
    let num = 0
    for (let r = 1; r < grid.length; r++) {
      const v = String((grid[r] || [])[c] ?? '').trim()
      if (!v) continue
      body++
      if (looksNumeric(v) || digitCount(sanitizeNumeric(v)) > 0) num++
    }
    if (body < 3 || num / body < 0.66) continue
    for (let r = 1; r < grid.length; r++) {
      const v = String((grid[r] || [])[c] ?? '').trim()
      if (!v) continue
      if (looksNumeric(v)) grid[r][c] = sanitizeNumeric(v) || v
      else {
        const sn = sanitizeNumeric(v)
        if (digitCount(sn) > 0) grid[r][c] = sn
        else grid[r][c] = ''   // stray letters in a numeric column: clear
      }
    }
  }
  return grid
}

const digitCount = (s) => (String(s).match(/\d/g) || []).length

/** rough blank test: nearly-uniform crop => empty cell, skip OCR (speed win) */
function isBlankCv(cv) {
  const ctx = cv.getContext('2d')
  const { width: w, height: h } = cv
  const d = ctx.getImageData(0, 0, w, h).data
  let sum = 0, sum2 = 0, hits = 0
  const step = Math.max(1, Math.floor((w * h) / 3000))
  let n = 0
  for (let i = 0; i < w * h; i += step) {
    const g = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
    sum += g
    sum2 += g * g
    n++
    if (g < 200) hits++
  }
  if (!n) return true
  if (hits === 0) return true
  const m = sum / n
  const varr = sum2 / n - m * m
  return varr < 45 && m > 250 // a single dark glyph stroke disqualifies
}

function newCanvas(w, h) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  return cv
}

function drawScaled(img, w, h) {
  const cv = newCanvas(w, h)
  const ctx = cv.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return { cv, ctx }
}

function lumaOf(data, n) {
  const g = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }
  return g
}

function otsu(gray, n) {
  const hist = new Uint32Array(256)
  for (let i = 0; i < n; i++) hist[gray[i] | 0]++
  const cum = new Float64Array(256)
  for (let v = 0; v < 256; v++) cum[v] = v * hist[v]
  const total = cum[255]
  let wB = 0, sB = 0, best = -1, bestT = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wW = n - wB
    if (wW === 0) break
    sB += cum[t]
    const mB = sB / wB, mW = (total - sB) / wW
    const varB = wB * wW * (mB - mW) * (mB - mW)
    if (varB > best) { best = varB; bestT = t }
  }
  return Math.min(230, Math.max(50, bestT + 8))
}

function binarize(cv, ctx) {
  const { width: w, height: h } = cv
  const id = ctx.getImageData(0, 0, w, h)
  const g = lumaOf(id.data, w * h)
  const T = otsu(g, w * h)
  for (let i = 0; i < w * h; i++) {
    const v = g[i] > T ? 255 : 0
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v
    id.data[i * 4 + 3] = 255
  }
  ctx.putImageData(id, 0, 0)
  return { g, T }
}

function boxBlurPass(src, dst, w, h, r, horizontal) {
  const win = r + r + 1
  const line = horizontal ? w : h   // pixels along the running axis
  const lanes = horizontal ? h : w
  for (let lane = 0; lane < lanes; lane++) {
    let sum = 0
    const idx = (i) => horizontal ? lane * w + i : i * w + lane
    for (let i = -r; i <= r; i++) sum += i >= 0 && i < line ? src[idx(i)] : src[idx(Math.max(0, Math.min(line - 1, i)))]
    for (let i = 0; i < line; i++) {
      dst[idx(i)] = sum / win
      const add = i + r + 1 < line ? src[idx(i + r + 1)] : src[idx(line - 1)]
      const sub = i - r >= 0 ? src[idx(i - r)] : src[idx(0)]
      sum += add - sub
    }
  }
}
function blurGray(g, w, h, r) {
  const a = new Float32Array(g); const b = new Float32Array(g.length)
  boxBlurPass(a, b, w, h, r, true); boxBlurPass(b, a, w, h, r, false)
  boxBlurPass(a, b, w, h, r, true); boxBlurPass(b, a, w, h, r, false)
  return a
}
/** undo photo shading: bounded ratio to a normalized plane; fixed sane cuts */
function flattenLight(cv, ctx, hard) {
  const w = cv.width, h = cv.height
  const id = ctx.getImageData(0, 0, w, h)
  const d = id.data
  const g = lumaOf(d, w * h)
  const r = Math.max(24, Math.round(Math.min(w, h) / 7))
  const bg = blurGray(g, w, h, r)
  const ratio = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) ratio[i] = g[i] / Math.max(28, bg[i])
  if (hard) {
    const T = 0.70 // paper ~1.0, ink ~0.3-0.6 even under heavy shadow
    for (let i = 0; i < w * h; i++) {
      const v = ratio[i] > T ? 255 : 0
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255
    }
  } else {
    for (let i = 0; i < w * h; i++) {
      const v = Math.min(255, Math.max(0, (ratio[i] - 0.12) * 255 / 0.95))
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(id, 0, 0)
}

function contrastStretch(cv, ctx) {
  const { width: w, height: h } = cv
  const id = ctx.getImageData(0, 0, w, h)
  const g = lumaOf(id.data, w * h)
  let min = 255, max = 0
  for (let i = 0; i < w * h; i++) {
    if (g[i] < min) min = g[i]
    if (g[i] > max) max = g[i]
  }
  const rng = Math.max(1, max - min)
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(40, ((g[i] - min) * 255) / rng)
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v
    id.data[i * 4 + 3] = 255
  }
  ctx.putImageData(id, 0, 0)
}

/* ================= pipeline B helpers: words -> grid ================= */

function collectWords(data) {
  const words = []
  const push = (wd) => {
    const t = String(wd.text ?? wd.word ?? '').trim()
    const conf = wd.confidence ?? wd.conf ?? 0
    if (t && wd.bbox && conf > 20) words.push({ text: t, bbox: wd.bbox, conf })
  }
  if (Array.isArray(data.words) && data.words.length && data.words[0].bbox) {
    data.words.forEach(push)
    return words
  }
  for (const b of data.blocks || [])
    for (const p of b.paragraphs || [])
      for (const l of p.lines || [])
        for (const wd of l.words || []) push(wd)
  return words
}

function mergeTokens(parts) {
  const numericish = parts.every((p) => /^[\d.,+\-*/x×()%]+$/.test(p))
  return numericish ? parts.join('') : parts.join(' ')
}

function median(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function clusterAxis(values, gap) {
  const sorted = [...values].sort((a, b) => a - b)
  const groups = []
  let cur = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - cur[cur.length - 1] <= gap) cur.push(sorted[i])
    else { groups.push(cur); cur = [sorted[i]] }
  }
  groups.push(cur)
  const cents = groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length).sort((a, b) => a - b)
  const edges = []
  for (let i = 1; i < cents.length; i++) edges.push((cents[i - 1] + cents[i]) / 2)
  return {
    center(v) {
      let i = 0
      while (i < edges.length && v >= edges[i]) i++
      return Math.min(i, edges.length)
    },
  }
}

/** detect long dark runs (table rules) on a drawn canvas */
function detectRules(cv, ctx, minFrac, step = 2) {
  const { width: W, height: H } = cv
  const d = ctx.getImageData(0, 0, W, H).data
  const darkAt = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4] < 185
  // a line may be hand-drawn (wandering a few px): count positions along the
  // line where a dark pixel exists within a +-10px window perpendicular to it
  const covRow = (y) => {
    let c = 0
    const win = Math.max(4, Math.round(H * 0.004))
    for (let x = 0; x < W; x += 4) {
      let hitp = false
      for (let dy = -win; dy <= win; dy += 2) if (darkAt(x, y + dy)) { hitp = true; break }
      if (hitp) c++
    }
    return c / (W / 4)
  }
  const covCol = (x) => {
    let c = 0
    const win = Math.max(4, Math.round(W * 0.004))
    for (let y = 0; y < H; y += 4) {
      let hitp = false
      for (let dx = -win; dx <= win; dx += 2) if (darkAt(x + dx, y)) { hitp = true; break }
      if (hitp) c++
    }
    return c / (H / 4)
  }
  const hLines = [], vLines = []
  for (let y = 0; y < H; y += step) if (covRow(y) > minFrac) hLines.push([y, y])
  for (let x = 0; x < W; x += step) if (covCol(x) > minFrac) vLines.push([x, x])
  const group = (lines) => {
    const out = []
    for (const [a] of lines) {
      const l = out[out.length - 1]
      if (l && a - l[1] <= step * 2 + 2) l[1] = a
      else out.push([a, a])
    }
    const pad = step * 3
    return out.map(([a, b]) => [Math.max(0, a - pad), Math.min((lines === hLines ? H : W) - 1, b + pad)])
  }
  const hBands = group(hLines), vBands = group(vLines)
  return { h: hBands, v: vBands, W, H }
}

function intervalsFor(bands, len) {
  const rules = bands.map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0])
  if (!rules.length) return null
  const ivs = []
  let cur = 0
  for (const [a, b] of rules) {
    if (a - cur >= Math.max(8, len * 0.015)) ivs.push([cur, a - 3])
    cur = b + 4
  }
  if (len - cur >= Math.max(8, len * 0.015)) ivs.push([cur, len])
  return ivs.length >= 2 ? ivs : null
}

/** threshold a density profile, take runs, split too-tall bands at valleys */
function profileBands(sm, n, minSize, maxSize) {
  const H2 = new Uint32Array(256)
  for (let i = 0; i < n; i++) H2[Math.min(255, Math.round(sm[i] * 1000 / 1.6))]++
  let T = otsuH(H2, n) * 1.6 / 1000
  T = Math.min(0.35, Math.max(0.004, T))
  const runs = []
  let st = -1
  for (let i = 0; i < n; i++) {
    if (sm[i] > T) { if (st < 0) st = i }
    else if (st >= 0) { if (i - st >= minSize * 0.4) runs.push([st, i]); st = -1 }
  }
  if (st >= 0) runs.push([st, n])
  // split oversized bands at internal valleys into ~maxSize slices
  const out = []
  for (const [a, b] of runs) {
    const span = b - a
    if (maxSize && span > maxSize * 1.45) {
      const parts = Math.round(span / maxSize)
      const edges = [a]
      for (let k = 1; k < parts; k++) {
        const target = a + (span * k) / parts
        let bi = Math.round(target), bd = 1e18
        for (let q = Math.max(a + 2, target - maxSize * 0.3); q < Math.min(b - 2, target + maxSize * 0.3); q++) {
          if (sm[q] < bd) { bd = sm[q]; bi = q }
        }
        edges.push(bi)
      }
      edges.push(b)
      for (let k = 0; k < edges.length - 1; k++) out.push([edges[k], edges[k + 1]])
    } else out.push([a, b])
  }
  return out
}
function otsuH(hist, n) {
  const cum = new Float64Array(256)
  for (let v = 0; v < 256; v++) cum[v] = v * hist[v]
  const total = cum[255]
  let wB = 0, sB = 0, best = -1, bestT = 80
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (wB === 0) continue
    const wW = n - wB; if (wW === 0) break
    sB += cum[t]
    const mB = sB / wB, mW = (total - sB) / wW
    const varB = wB * wW * (mB - mW) * (mB - mW)
    if (varB > best) { best = varB; bestT = t }
  }
  return bestT
}

/** segment columns by ink-density gaps (free grids where rules are absent/wandering) */
function projectionCols(ctx, W, H, y0, y1) {
  const yy0 = Math.max(0, y0)
  const h = Math.min(H, y1) - yy0
  if (h < 20) return null
  const d = ctx.getImageData(0, yy0, W, h).data
  const frac = new Float32Array(W)
  for (let x = 0; x < W; x++) {
    let c = 0
    for (let y = 0; y < h; y += 3) if (d[(y * W + x) * 4] < 128) c++
    frac[x] = c / (h / 3)
  }
  const sm = new Float32Array(W)
  const R = 6
  for (let x = 0; x < W; x++) { let a = 0, n = 0; for (let k = -R; k <= R; k++) { const q = x + k; if (q >= 0 && q < W) { a += frac[q]; n++ } } sm[x] = a / n }
  const sorted = [...sm].sort((x, y) => x - y)
  const top10 = sorted[Math.floor(sorted.length * 0.9)]
  const thr = Math.max(0.004, top10 * 0.12)
  const ivs = []
  let st = -1
  for (let x = 0; x < W; x++) {
    if (sm[x] > thr) { if (st < 0) st = x }
    else if (st >= 0) { if (x - st >= W * 0.07) ivs.push([st, x]); st = -1 }
  }
  if (st >= 0 && W - st >= W * 0.07) ivs.push([st, W])
  const merged = []
  for (const [a, b] of ivs) {
    const l = merged[merged.length - 1]
    if (l && a - l[1] < W * 0.05) l[1] = b
    else merged.push([Math.max(0, a - 4), Math.min(W, b + 4)])
  }
  return merged.length >= 2 && merged.length <= 24 ? merged : null
}

/** segment rows by ink-density gaps (hand-ledgers without horizontal rules) */
function projectionRows(ctx, pageW, pageH, colIv, maxRows) {
  if (!colIv || !colIv.length) return null
  // NOTE: sample only WITHIN the column bands — the hand-drawn vertical rule
  // columns themselves would otherwise make every row look "inked".
  const frac = new Float32Array(pageH)
  for (const [x0, x1] of colIv) {
    const bw = x1 - x0
    if (bw < 8) continue
    const d = ctx.getImageData(x0, 0, bw, pageH).data
    for (let y = 0; y < pageH; y++) {
      let c = 0
      const row = y * bw * 4
      for (let x = 0; x < bw; x += 3) if (d[row + x * 4] < 128) c++
      frac[y] += c / (bw / 3)
    }
  }
  for (let y = 0; y < pageH; y++) frac[y] /= colIv.length
  const sm = new Float32Array(pageH)
  const R = 4
  for (let y = 0; y < pageH; y++) { let a = 0, n = 0; for (let k = -R; k <= R; k++) { const q = y + k; if (q >= 0 && q < pageH) { a += frac[q]; n++ } } sm[y] = a / n }
  const minH = Math.max(16, Math.min(46, pageH / 240))
  // valleys = white gaps between rows; peaks = baselines of digit lines
  const valleys = [...sm].sort((a, b) => a - b)
  const base = valleys[Math.floor(pageH * 0.30)]
  const inkLvl = valleys[Math.floor(pageH * 0.85)]
  const thr = Math.max(0.0022, Math.min(0.02, base + (inkLvl - base) * 0.27))
  const cuts = [0]
  let inGap = false
  for (let y = 0; y < pageH; y++) {
    if (sm[y] <= thr) { if (!inGap) { inGap = true; cuts.push(y + 1) } }
    else inGap = false
  }
  if (cuts.length >= 3) {
    const ivs = []
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1]
      if (b - a >= minH * 0.5) ivs.push([a, b])
    }
    if (ivs.length >= 2 && ivs.length <= (maxRows || 90)) return ivs.map(([a, b]) => [Math.max(0, a - 2), Math.min(pageH, b + 2)])
  }
  const ivs = profileBands(sm, pageH, minH, pageH / 6)
  const pad = minH * 0.22
  const banded = ivs.map(([a, b]) => [Math.max(0, a - pad), Math.min(pageH, b + pad)])
  const merged = []
  for (const iv of banded) {
    const l = merged[merged.length - 1]
    if (l && iv[0] - l[1] < pad) { l[1] = Math.max(l[1], iv[1]) } else merged.push(iv)
  }
  return merged.length >= 2 && merged.length <= (maxRows || 90) ? merged : null
}

export function wordsToGrid(words, rules) {
  const toks = words.map((w) => ({
    t: String(w.text ?? '').trim(),
    x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1,
  })).filter((w) => w.t)
  if (!toks.length) return []

  let nR, nC, assign
  const rowIv = rules && rules.rowIv ? rules.rowIv : (rules && intervalsFor(rules.h, rules.H))
  const colIv = rules && rules.colIv ? rules.colIv : (rules && intervalsFor(rules.v, rules.W))
  if (rowIv && colIv) {
    nR = rowIv.length
    nC = colIv.length
    const pick = (ivs, v) => {
      for (let i = 0; i < ivs.length; i++) if (v >= ivs[i][0] && v <= ivs[i][1]) return i
      let best = 0, bd = 1e15
      for (let i = 0; i < ivs.length; i++) {
        const c = (ivs[i][0] + ivs[i][1]) / 2
        if (Math.abs(v - c) < bd) { bd = Math.abs(v - c); best = i }
      }
      return best
    }
    assign = (tk) => [pick(rowIv, (tk.y0 + tk.y1) / 2), pick(colIv, (tk.x0 + tk.x1) / 2)]
  } else {
    const hh = median(toks.map((w) => w.y1 - w.y0)) || 20
    const bandW = median(toks.map((w) => w.x1 - w.x0)) || 40
    const rows = clusterAxis(toks.map((w) => (w.y0 + w.y1) / 2), hh * 0.7)
    const cols = clusterAxis(toks.map((w) => (w.x0 + w.x1) / 2), bandW * 1.7)
    assign = (tk) => [rows.center((tk.y0 + tk.y1) / 2), cols.center((tk.x0 + tk.x1) / 2)]
  }

  const cells = toks.map((tk) => {
    const [r, c] = assign(tk)
    return { r, c, sort: tk.x0, t: tk.t }
  })
  const maxR = Math.max(...cells.map((x) => x.r))
  const maxC = Math.max(...cells.map((x) => x.c))
  const grid = Array.from({ length: maxR + 1 }, () => Array(maxC + 1).fill(''))
  const byRowCol = new Map()
  for (const c of cells) {
    const k = c.r + ':' + c.c
    if (!byRowCol.has(k)) byRowCol.set(k, [])
    byRowCol.get(k).push(c)
  }
  for (const [k, list] of byRowCol) {
    list.sort((a, b) => a.sort - b.sort)
    const [r, c] = k.split(':').map(Number)
    grid[r][c] = mergeTokens(list.map((x) => x.t))
  }
  return grid.filter((row) => row.some((v) => v !== ''))
}

/* ================= pipeline A: per-cell OCR with quad warp ================= */

const PAGE_W = 2400
const TARGET_CELL = 200

/** locate the dark-rectangle border of the table; returns null when unclear */
/** estimate skew: angle that maximizes row-ink-profile variance (text lines crisply separated) */
function deskewAngle(cv) {
  const w0 = Math.max(120, Math.round(cv.width / 2.5)), h0 = Math.max(120, Math.round(cv.height / 2.5))
  const small = newCanvas(w0, h0)
  const sctx = small.getContext('2d')
  sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, w0, h0)
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(cv, 0, 0, w0, h0)
  const scoreCurve = []
  const score = (deg) => {
    const rad = (deg * Math.PI) / 180
    const rw = Math.ceil(w0 * Math.abs(Math.cos(rad)) + h0 * Math.abs(Math.sin(rad)))
    const rh = Math.ceil(w0 * Math.abs(Math.sin(rad)) + h0 * Math.abs(Math.cos(rad)))
    const rc = newCanvas(rw, rh)
    const rctx = rc.getContext('2d')
    rctx.fillStyle = '#fff'; rctx.fillRect(0, 0, rw, rh)
    rctx.translate(rw / 2, rh / 2); rctx.rotate(-rad); rctx.translate(-w0 / 2, -h0 / 2)
    rctx.drawImage(small, 0, 0)
    const d = rctx.getImageData(0, 0, rw, rh).data
    const n = rh
    const prof = new Float32Array(n)
    for (let y = 0; y < n; y++) {
      let c = 0
      const row = y * rw * 4
      for (let x = 0; x < rw; x += 2) if (d[row + x * 4] < 150) c++
      prof[y] = c / (rw / 2)
    }
    let m = 0
    for (let i = 0; i < n; i++) m += prof[i]
    m /= n
    let v = 0
    for (let i = 0; i < n; i++) { const dd = prof[i] - m; v += dd * dd }
    const varScore = v / n
    // concentration of a long straight vertical rule at this angle:
    const col = new Float32Array(rw)
    for (let y = 0; y < n; y++) {
      const row = y * rw * 4
      for (let x = 0; x < rw; x += 2) if (d[row + x * 4] < 150) col[x] += 1 / n
    }
    let cm = 0
    for (let x = 0; x < rw; x++) cm += col[x]
    cm /= rw
    let mc = 0
    for (let x = 0; x < rw; x++) if (col[x] > mc) mc = col[x]
    return varScore * 900000 + Math.max(0, mc - cm) * 40
  }
  let best = { deg: 0, s: -1 }
  let sum0 = 0
  for (let deg = -16; deg <= 16; deg += 1.5) {
    const sc = score(deg)
    scoreCurve.push([deg, Math.round(sc)])
    sum0 += sc
    if (sc > best.s) best = { deg, s: sc }
  }
  for (let d = best.deg - 1.4; d <= best.deg + 1.4; d += 0.2) {
    const sc = score(d)
    scoreCurve.push([Math.round(d * 10) / 10, Math.round(sc)])
    if (sc > best.s) best = { deg: d, s: sc }
  }
  const mean = sum0 / Math.max(1, scoreCurve.length)
  deskewAngle.curve = scoreCurve
  // trust only a genuinely SHARP peak (flat curve = noise-driven, don't rotate)
  deskewAngle.info = { best: best.s, mean }
  return best.deg
}
function rotatePage(cv, deg) {
  const rad = Math.abs((deg * Math.PI) / 180)
  const ow = Math.ceil(cv.width * Math.cos(rad) + cv.height * Math.sin(rad))
  const oh = Math.ceil(cv.width * Math.sin(rad) + cv.height * Math.cos(rad))
  const out = newCanvas(ow, oh)
  const ctx = out.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ow, oh)
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(ow / 2, oh / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.translate(-cv.width / 2, -cv.height / 2)
  ctx.drawImage(cv, 0, 0)
  return { cv: out, ctx, W: ow, H: oh }
}

function findFrame(img) {
  const scale = Math.min(1, 1500 / img.width)
  const W = Math.round(img.width * scale), H = Math.round(img.height * scale)
  const { cv, ctx } = drawScaled(img, W, H)
  flattenLight(cv, ctx, true)
  const d = ctx.getImageData(0, 0, W, H).data
  const dark = (x, y) => d[(y * W + x) * 4] < 200
  // content bounds by ink projection
  let cy0 = -1, cy1 = -1
  for (let y = 0; y < H; y += 2) {
    let c = 0
    for (let x = 0; x < W; x += 5) if (dark(x, y)) c++
    if (c > (W / 5) * 0.02) { if (cy0 < 0) cy0 = y; cy1 = y }
  }
  if (cy0 < 0) return null
  let cx0 = -1, cx1 = -1
  for (let x = 0; x < W; x += 5) {
    let c = 0
    for (let y = cy0; y <= cy1; y += 5) if (dark(x, y)) c++
    if (c > ((cy1 - cy0) / 5) * 0.015) { if (cx0 < 0) cx0 = x; cx1 = x }
  }
  if (cx0 < 0) return null
  const padY = (cy1 - cy0) * 0.01, padX = (cx1 - cx0) * 0.008
  return {
    x0: Math.max(0, (cx0 - padX) / W), x1: Math.min(1, (cx1 + padX) / W),
    y0: Math.max(0, (cy0 - padY) / H), y1: Math.min(1, (cy1 + padY) / H),
  }
}

/** normalize table region to a clean binary page (aspect preserved!) */
function makePage(img, frame, handwriting) {
  const fh = frame.y1 - frame.y0, fw = frame.x1 - frame.x0
  // true pixel aspect of the cropped region (old code used the NORMALIZED ratio,
  // which crushed any non-square photo into a distorted page)
  const aspect = (fh * img.height) / (fw * img.width)
  let pw = PAGE_W
  let ph = Math.round(pw * aspect)
  const MAX_SIDE = 3400
  if (ph > MAX_SIDE) { const q = MAX_SIDE / ph; pw = Math.round(pw * q); ph = MAX_SIDE }
  if (ph < 420) { ph = 420 }
  const cv = newCanvas(pw, ph)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, pw, ph)
  ctx.drawImage(
    img,
    frame.x0 * img.width - 2, frame.y0 * img.height - 2,
    fw * img.width + 4, fh * img.height + 4,
    0, 0, pw, ph
  )
  flattenLight(cv, ctx, true)
  return { cv, ctx, W: pw, H: ph }
}


/**
 * Per-cell OCR of a ruled table.  Data cells are recognized digit-first
 * (a second "eng" worker + numeric sanitizing); when a cell keeps letters or
 * yields nothing, the eng+tha text worker retries it — so header/label cells
 * automatically end up on the text model with a confidence boost.
 */
/**
 * Per-cell OCR of a ruled table.
 * 1) rules are found on a cleaned binary page (fast, accurate geometry)
 * 2) ink bounds are measured per cell from the page
 * 3) the actual crop is re-read from the ORIGINAL image pixels (no resample
 *    loss, no binarisation) at ~200px digit height — verified best quality
 * 4) recognition: eng digit pass first; eng+tha text pass rescues labels.
 *    Candidates are scored digits + 4*operators (losing a "*" silently
 *    changes every total), confidence breaks ties.
 */
async function runCellMode(img, opts, onProgress) {
  const frame = findFrame(img)
  if (!frame) return null
  const handwriting = !!opts.handwriting
  let page = makePage(img, frame, handwriting)
  let rules = detectRules(page.cv, page.ctx, 0.55)
  let rotated = false
  const skew = handwriting || page.H / page.W > 1.6 ? deskewAngle(page.cv) : 0
  if (Math.abs(skew) >= 0.5) {
    const cand = rotatePage(page.cv, skew)
    const cr = detectRules(cand.cv, cand.ctx, 0.55)
    const si = deskewAngle.info
    const before = rules.h.length + rules.v.length
    const after = cr.h.length + cr.v.length
    // rotate only if the angle measurably CREATES structure and the peak is sharp
    if (after > before && si && si.best > si.mean * 1.3) { page = cand; rules = cr; rotated = true }
  }
  let rowIv = intervalsFor(rules.h, page.H)
  let colIv = intervalsFor(rules.v, page.W)
  if (colIv) colIv = colIv.filter((iv) => iv[1] - iv[0] >= page.W * 0.055)   // drop margin slivers
  if (!colIv || colIv.length < 2) colIv = projectionCols(page.ctx, page.W, page.H, 0, page.H)
  if (rowIv && colIv && colIv.length >= 2 && rowIv.length > Math.max(30, colIv.length * 30)) rowIv = null
  if ((!rowIv || rowIv.length < 2) && colIv && colIv.length >= 2 && colIv.length <= 24) {
    // hand-drawn ledgers often have NO horizontal rules: segment rows by ink gaps
    rowIv = projectionRows(page.ctx, page.W, page.H, colIv, 90)
  }
  if (!rowIv || !colIv || rowIv.length < 2 || colIv.length < 2 || colIv.length > 24) return null
  if (colIv.length > 3 && rowIv.length >= 2 && colIv.length > rowIv.length * 2) {
    const asRows = projectionRows(page.ctx, page.W, page.H, colIv, 90)
    if (asRows && asRows.length >= 2) colIv = null
  }
  if (!colIv) return null

  const pd = page.ctx.getImageData(0, 0, page.W, page.H).data
  const lumaP = (x, y) => { const i = (y * page.W + x) * 4; return 0.299 * pd[i] + 0.587 * pd[i + 1] + 0.114 * pd[i + 2] }
  const inkBox = (x0, y0, x1, y1) => {
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, hits = 0
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        if (lumaP(x, y) < 205) {
          hits++
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }
    if (hits < 3) return null
    return [minX, minY, maxX, maxY]
  }
  // page px -> original image px (inverse of makePage draw transform)
  const sx = ((frame.x1 - frame.x0) * img.width + 4) / page.W
  const sy = ((frame.y1 - frame.y0) * img.height + 4) / page.H
  const ox = frame.x0 * img.width - 2
  const oy = frame.y0 * img.height - 2

  const TESS = await loadTesseract()
  const wText = await getWorker(TESS, { lang: opts.lang || 'eng+tha', best: handwriting })
  const wDigit = await getWorker(TESS, { lang: 'eng', best: handwriting })
  await wText.setParameters({ tessedit_pageseg_mode: '7' })
  await wDigit.setParameters({ tessedit_pageseg_mode: '7' })
  const digitMode = opts.digitCells !== false

  const grid = []
  const cellConf = []
  let confSum = 0, confN = 0, skipped = 0
  const total = rowIv.length * colIv.length
  let done = 0

  const ocrOnce = async (worker, cv) => {
    const { data } = await worker.recognize(cv, {}, { blocks: true })
    const words = collectWords(data)
    const text = mergeTokens(words.map((w) => w.text))
    const cs = words.map((x) => x.conf).filter((c) => c > 0)
    const conf = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : 0
    return { text, conf }
  }

  for (let ri = 0; ri < rowIv.length; ri++) {
    const [ry0, ry1] = rowIv[ri]
    const row = []
    const crow = []
    for (const [cx0, cx1] of colIv) {
      done++
      let text = '', conf = 0
      const box = inkBox(cx0 + 3, ry0 + 3, Math.max(cx0 + 3, cx1 - 3), Math.max(ry0 + 3, ry1 - 3))
      if (!box) {
        row.push(''); crow.push(null); skipped++
      } else {
        const padx = Math.max(4, (cx1 - cx0) * 0.06), pady = Math.max(5, (ry1 - ry0) * 0.15)
        let x0 = Math.max(cx0 + 1, box[0] - padx), x1 = Math.min(cx1 - 1, box[2] + padx)
        let y0 = Math.max(ry0 + 1, box[1] - pady), y1 = Math.min(ry1 - 1, box[3] + pady)
        let ix0, iy0, iw, ihh
        if (rotated) {
          const xe = Math.min(page.W, Math.ceil(x1)), ye = Math.min(page.H, Math.ceil(y1))
          ix0 = Math.max(0, Math.floor(x0)); iy0 = Math.max(0, Math.floor(y0))
          iw = xe - ix0; ihh = Math.max(8, ye - iy0)
        } else {
          const ix1 = Math.min(img.width, Math.ceil(ox + x1 * sx)), iy1 = Math.min(img.height, Math.ceil(oy + y1 * sy))
          ix0 = Math.max(0, Math.floor(ox + x0 * sx)); iy0 = Math.max(0, Math.floor(oy + y0 * sy))
          iw = ix1 - ix0; ihh = Math.max(8, iy1 - iy0)
        }
        if (iw > 6 && ihh >= 6) {
          const zoom = Math.max(2, Math.min(8, (handwriting ? 320 : 220) / ihh))
          const pad = 16
          const cv = newCanvas(Math.round(iw * zoom) + pad * 2, Math.round(ihh * zoom) + pad * 2)
          const ctx = cv.getContext('2d')
          ctx.fillStyle = '#fff'
          ctx.fillRect(0, 0, cv.width, cv.height)
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(rotated ? page.cv : img, ix0, iy0, iw, ihh, pad, pad, cv.width - pad * 2, cv.height - pad * 2)
          if (!rotated) {
            if (handwriting) flattenLight(cv, ctx, false)
            else contrastStretch(cv, ctx)
          }

          if (!digitMode) {
            const r = await ocrOnce(wText, cv)
            text = r.text; conf = r.conf
          } else {
            const d = await ocrOnce(wDigit, cv)
            const ds = sanitizeNumeric(d.text)
            const rawClean = d.text.replace(/[\s,]/g, '')
            const opsOf = (v) => (v.match(/[+\-*/]/g) || []).length
            const score = (v) => digitCount(v) + 4 * opsOf(v)
            // trust the digit pass immediately ONLY for a well-formed value:
            // a long plain number, or operands on BOTH sides of every operator.
            const wellFormed = /^\d{3,}$/.test(ds) || /^\d+([*+\-/x]\d+)+$/.test(ds)
            if (ds && wellFormed && /^[\d+\-*/x๐-๙０-９]+$/.test(rawClean)) {
              text = ds; conf = d.conf
            } else {
              const t = await ocrOnce(wText, cv)
              const ts = sanitizeNumeric(t.text)
              if (ri === 0) { text = t.text; conf = t.conf }
              else if (!ds && !ts) { text = t.text; conf = t.conf }
              else {
                const sd = score(ds), st = score(ts)
                if (st > sd) { text = ts; conf = t.conf }
                else if (sd > st) { text = ds; conf = d.conf }
                else if (d.conf >= t.conf) { text = ds; conf = d.conf }
                else { text = ts; conf = t.conf }
              }
            }
          }
          text = mapDigits(text)
        }
        row.push(text)
        crow.push(text ? Math.round(conf) : null)
        if (text && conf > 0) { confSum += conf; confN++ }
      }
      if (done % 6 === 0 || done === total) onProgress('cell ' + done + '/' + total + (skipped ? ' · ข้ามช่องว่าง ' + skipped : ''), Math.round((done / total) * 100))
    }
    grid.push(row)
    cellConf.push(crow)
  }
  const keep = grid.map((r) => r.some((v) => v !== ''))
  const trimmed = grid.filter((r) => r.some((v) => v !== ''))
  const trimConf = cellConf.filter((_, i) => keep[i])
  if (!trimmed.length) return null
  return { grid: trimmed, conf: trimConf, confidence: confN ? Math.round(confSum / confN) : 0 }
}

/* ================= main entry ================= */

/** map Thai/Lao/fullwidth digits to ASCII everywhere (keeps letters intact) */
function mapDigits(t) {
  return String(t)
    .replace(/[\u0E50-\u0E59]/g, (c) => String(c.charCodeAt(0) - 0x0e50))
    .replace(/[\u0ED0-\u0ED9]/g, (c) => String(c.charCodeAt(0) - 0x0ed0))
    .replace(/[\uFF10-\uFF19]/g, (c) => String(c.charCodeAt(0) - 0xff10))
}

/**
 * ocrImage(file|url, opts, onProgress) -> { grid, confidence, cellConf, mode }
 * opts: { lang, psm, preprocess: 'bin'|'raw', handwriting, digitCells }
 */
export async function ocrImage(fileOrUrl, opts = {}, onProgress = () => {}) {
  const TESS = await loadTesseract()
  const img = await toImage(fileOrUrl)
  const prep = opts.handwriting ? 'raw' : opts.preprocess

  const cell = await runCellMode(img, { ...opts, preprocess: prep }, onProgress)
  if (cell && cell.grid.length >= 2) {
    let grid = enforceNumericColumns(cell.grid.map((r) => r.map(mapDigits)))
    if (opts.digitCells !== false) grid = consensusFixGrid(grid)
    return { grid, cellConf: cell.conf, confidence: cell.confidence, mode: 'cell' }
  }

  onProgress('word-mode', 5)
  const scale = Math.max(0.4, Math.min(2, 1600 / img.width))
  const W = Math.round(img.width * scale), H = Math.round(img.height * scale)
  const { cv, ctx } = drawScaled(img, W, H)
  if (prep !== 'raw') flattenLight(cv, ctx, true)
  else contrastStretch(cv, ctx)
  const sk = opts.handwriting || H / W > 1.6 ? deskewAngle(cv) : 0
  const skTrust = deskewAngle.info ? deskewAngle.info.best > deskewAngle.info.mean * 1.3 && deskewAngle.info.best > 200 : true
  const rp = Math.abs(sk) >= 0.5 && skTrust ? rotatePage(cv, sk) : { cv, ctx, W, H }
  const rules = detectRules(rp.cv, rp.ctx, 0.4)
  const pass = await runPass(TESS, rp.cv, { ...opts, preprocess: prep }, onProgress)
  let grid = wordsToGrid(pass.words, { h: rules.h, v: rules.v, W: rp.W, H: rp.H })
  grid = enforceNumericColumns(grid.map((r) => r.map(mapDigits)))
  if (opts.digitCells !== false) grid = consensusFixGrid(grid)
  return { grid, confidence: pass.conf, cellConf: null, mode: 'words' }
}

async function runPass(TESS, canvas, opts, onProgress) {
  const worker = await getWorker(TESS, { lang: opts.lang || 'eng+tha', best: !!opts.handwriting })
  await worker.setParameters({ tessedit_pageseg_mode: String(opts.psm || 6) })
  const { data } = await worker.recognize(canvas, {}, { blocks: true })
  const words = collectWords(data)
  const cs = words.map((w) => w.conf).filter((c) => Number.isFinite(c) && c > 0)
  const conf = cs.length ? Math.round(cs.reduce((a, b) => a + b, 0) / cs.length) : Math.round(data.confidence || 0)
  return { words, conf }
}

/** Small thumbnail (data URL) for DB storage */
export async function makeThumb(fileOrUrl, maxW = 420, quality = 0.62) {
  const img = await toImage(fileOrUrl)
  const s = Math.min(1, maxW / img.width)
  const { cv, ctx } = drawScaled(img, Math.round(img.width * s), Math.round(img.height * s))
  return cv.toDataURL('image/jpeg', quality)
}
