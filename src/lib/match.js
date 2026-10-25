import { digitsOf, isOddCol } from './compute.js'

/** distinct digit arrangements: 123 -> 6 perms, 112 -> 3, 24 -> 2 */
export function perms(s) {
  const d = String(s).replace(/\D/g, '')
  if (!d) return []
  const out = new Set([d])
  const rec = (arr, used, prefix) => {
    if (!arr.length) { out.add(prefix); return }
    const seen = new Set()
    for (let i = 0; i < arr.length; i++) {
      if (seen.has(arr[i])) continue
      seen.add(arr[i])
      const rest = arr.slice(0, i).concat(arr.slice(i + 1))
      rec(rest, used, prefix + arr[i])
    }
  }
  rec(d.split(''), [], '')
  return [...out].filter((p) => p.length === d.length)
}

/** suffix match: target (e.g. "24" or a perm) against cell digit string ("1234" -> tail 2 = "34") */
function hit(cellDigits, target) {
  const t = String(target)
  if (cellDigits.length < t.length) return false
  return cellDigits.slice(-t.length) === t
}

/**
 * Scan all ODD columns of the grid and find matches against
 * variantA (raw numbers, red) and variantB (permutation-expanded numbers, yellow).
 * @param cells string[][]   @param opts {aSets:string[], bThree:string, bTwos:string[]}
 */
export function analyze(cells, opts) {
  const aBuckets = (opts.aSets || [])
    .map((s, i) => ({ i, v: String(s).trim() }))
    .filter((x) => /^[0-9]{2,3}$/.test(x.v))
  const bVariants = []
  const bSources = []
  if (/^[0-9]{3}$/.test(String(opts.bThree || '').trim())) {
    const base = String(opts.bThree).trim()
    bVariants.push(...perms(base)); bSources.push(base)
  }
  for (const s of opts.bTwos || []) {
    const v = String(s).trim()
    if (/^[0-9]{2}$/.test(v)) { bVariants.push(...perms(v)); bSources.push(v) }
  }

  const A = new Map() // "r,c" -> Set of A set indexes
  const B = new Map() // "r,c" -> Set of B source numbers
  const seenB = new Set(bVariants)
  const aHitCount = new Map()
  const bHitCount = new Map()
  bSources.forEach((s) => bHitCount.set(s, 0))

  cells.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (!isOddCol(c + 1)) return
      const d = digitsOf(cell)
      if (!d) return
      for (const { i, v } of aBuckets) {
        if (hit(d, v)) {
          const k = r + ':' + c
          if (!A.has(k)) A.set(k, new Set())
          A.get(k).add(i)
          aHitCount.set(i, (aHitCount.get(i) || 0) + 1)
        }
      }
      if (bSources.length) {
        for (const s of bSources) {
          const L = s.length
          const tail = d.slice(-L)
          if (d.length >= L && seenB.has(tail)) {
            const k = r + ':' + c
            if (!B.has(k)) B.set(k, new Set())
            B.get(k).add(s)
            bHitCount.set(s, (bHitCount.get(s) || 0) + 1)
          }
        }
      }
    })
  })

  return {
    A, B,
    aSets: aBuckets.map(({ i, v }) => ({ i, v, hits: aHitCount.get(i) || 0 })),
    bSets: bSources.map((v) => ({ v, perms: perms(v), hits: bHitCount.get(v) || 0 })),
  }
}
