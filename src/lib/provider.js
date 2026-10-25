// External OCR provider (e.g. your "aksonocr" service).
// Contract taken 1:1 from the attached ex.JSON example:
//   { model, confidence, pages: [ { index, confidence, markdown } ] }
//   markdown holds an HTML <table> (th/td, em-dash = empty cell)
// Any endpoint returning that JSON shape works. Response may also carry
// { grid: [["68","","20"], ...] } or { table: ... } directly.

export function parseProviderGrid(body) {
  if (!body) return null
  // highest priority: pages[].markdown (the example format)
  const pages = Array.isArray(body.pages) ? body.pages : []
  for (const pg of pages) {
    const md = pg && (pg.markdown || pg.table || pg.html)
    const g = typeof md === 'string' ? parseHtmlTable(md) : Array.isArray(md) ? md : null
    if (g && g.length) return { grid: cleanGrid(g), confidence: pick(body, pg) }
  }
  for (const key of ['grid', 'table', 'rows', 'data']) {
    const v = body[key]
    if (Array.isArray(v) && v.length && Array.isArray(v[0]) && v[0].every((x) => x === null || typeof x !== 'object')) {
      return { grid: cleanGrid(v), confidence: pick(body, null) }
    }
    if (key === 'data' && v && typeof v === 'object' && Array.isArray(v.pages)) return parseProviderGrid(v)
  }
  return null
}

function pick(body, pg) {
  const c = (pg && pg.confidence) ?? body.confidence
  const n = Number(c)
  return Number.isFinite(n) ? Math.round(n) : null
}

function parseHtmlTable(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const rows = [...doc.querySelectorAll('tr')]
  const out = []
  for (const tr of rows) {
    const cells = [...tr.querySelectorAll('td,th')].map((c) => (c.textContent || '').trim())
    if (cells.length) out.push(cells)
  }
  if (!out.length) {
    // tolerate plain TSV/markdown-pipe tables too
    for (const line of html.split('\n')) {
      const t = line.trim()
      if (!t) continue
      const cells = t.includes('|') ? t.replace(/^\||\|$/g, '').split('|').map((s) => s.trim()) : null
      if (cells) out.push(cells)
    }
  }
  return out
}

const EMPTIES = new Set(['', '-', '–', '—', '－', '‐', '_', '.'])
function cleanGrid(g) {
  return g.map((row) => row.map((v) => {
    const t = String(v ?? '').trim().replace(/[\u0E50-\u0E59]/g, (c) => String(c.charCodeAt(0) - 0x0e50))
    return EMPTIES.has(t) ? '' : t
  }))
}

/**
 * Call an external OCR endpoint. cfg: { url, key, model }
 * Sends JSON { image: dataURL, filename, model } by default; a common
 * alternative (multipart) is tried automatically on a 4xx shape error.
 */
export async function externalOcr(file, cfg, onProgress = () => {}) {
  if (!cfg || !cfg.url) throw new Error('no provider url')
  onProgress('requesting provider', 15)
  const dataUrl = await fileToDataURL(file)
  const headers = { 'Content-Type': 'application/json' }
  if (cfg.key) { headers.Authorization = 'Bearer ' + cfg.key; headers['x-api-key'] = cfg.key }
  let res = await fetch(cfg.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ image: dataUrl, filename: file.name || 'table.jpg', model: cfg.model || 'aksonocr-1.0' }),
  })
  if (!res.ok) {
    onProgress('retrying multipart', 30)
    const fd = new FormData()
    fd.append('file', file, file.name || 'table.jpg')
    if (cfg.model) fd.append('model', cfg.model)
    const h2 = {}
    if (cfg.key) h2.Authorization = 'Bearer ' + cfg.key
    res = await fetch(cfg.url, { method: 'POST', headers: h2, body: fd })
  }
  if (!res.ok) throw new Error('provider HTTP ' + res.status)
  let body
  try { body = await res.json() } catch (e) { throw new Error('provider response is not JSON') }
  onProgress('parsing result', 85)
  const parsed = parseProviderGrid(body)
  if (!parsed) throw new Error('provider response shape unrecognized (expected { pages:[{markdown}] } or { grid })')
  parsed.providerModel = body.model || cfg.model || 'external'
  return parsed
}

export function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result))
    fr.onerror = () => rej(new Error('file read failed'))
    fr.readAsDataURL(file)
  })
}


/** tiny probe request so the Settings button can show "connected / bad shape" instantly */
export async function providerTest(cfg) {
  const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGP8z8Dwn4EakhihkZBQFAUAVHYGCGCXMY0AAAAASUVORK5CYII='
  const headers = { 'Content-Type': 'application/json' }
  if (cfg.key) { headers.Authorization = 'Bearer ' + cfg.key; headers['x-api-key'] = cfg.key }
  const res = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify({ image: px, filename: 'test.png', model: cfg.model || 'aksonocr-1.0' }) })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  let body
  try { body = await res.json() } catch (e) { throw new Error('response is not JSON') }
  const parsed = parseProviderGrid(body)
  if (!parsed) throw new Error('shape unrecognized (expect { pages:[{markdown}] })')
  return { ok: true, rows: parsed.grid.length }
}
