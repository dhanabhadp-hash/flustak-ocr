import React from 'react'
import { evalCell, fmt, isOddCol, ODD_COLS, EVEN_COLS } from '../lib/compute.js'
import { perms } from '../lib/match.js'

export default function LedgerTab(props) {
  const {
    cells, cols, setCell, addRow, addCol, removeRow, removeCol, clearAll,
    batchName, setBatchName, computeCols, toggleComputeCol,
    analysis, totals, cellConf, aSets, setASets, bThree, setBThree, bTwos, setBTwos,
    includeBottom, setIncludeBottom,
    onSave, saving,
  } = props

  if (!cells.length) {
    return (
      <section className="card">
        <div className="empty-state">
          ยังไม่มีข้อมูล — ไปที่แท็บ <b>1 · OCR สแกนรูป</b> เพื่อสแกนภาพตารางตัวเลข<br />
          หรือโหลดชุดข้อมูลเดิมจากแท็บ <b>4 · คลังข้อมูล</b>
        </div>
      </section>
    )
  }

  const setA = (i, v) => setASets((o) => o.map((x, j) => (j === i ? v.replace(/\D/g, '').slice(0, 3) : x)))
  const setTwo = (i, v) => setBTwos((o) => o.map((x, j) => (j === i ? v.replace(/\D/g, '').slice(0, 2) : x)))
  const bPerms = /^[0-9]{3}$/.test(bThree.trim()) ? perms(bThree.trim()) : []

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>ตารางข้อมูล · OCR LEDGER <span className="muted">(แก้ไขได้ทุกช่อง)</span></h2>
          <div className="row-actions">
            <button className="btn" onClick={onSave} disabled={saving}>{saving ? 'บันทึก…' : '⌘ บันทึกลงฐานข้อมูล'}</button>
            <button className="btn ghost" onClick={addRow}>+ แถว</button>
            <button className="btn ghost" onClick={addCol}>+ หลัก</button>
            <button className="btn ghost" onClick={() => { if (confirm('ล้างตารางทั้งหมด? (ข้อมูลใน Supabase ยังอยู่)')) clearAll() }}>✕ ล้าง</button>
          </div>
        </div>
        <div className="row-actions" style={{ margin: '10px 0' }}>
          <input
            className="field" style={{ maxWidth: 320 }} value={batchName}
            onChange={(e) => setBatchName(e.target.value)} placeholder="ชื่อชุดข้อมูล"
          />
          <span className="muted" style={{ alignSelf: 'center' }}>คอลัมน์คำนวณ (คู่):</span>
          {EVEN_COLS.filter((c) => c <= cols).map((c) => (
            <button
              key={c}
              onClick={() => toggleComputeCol(c)}
              style={{
                border: '1.5px solid var(--ink)', borderRadius: 999, padding: '4px 12px',
                font: '600 13px Chakra Petch', cursor: 'pointer',
                background: computeCols.includes(c) ? 'var(--green)' : 'transparent',
                color: computeCols.includes(c) ? '#12260a' : 'var(--ink-3)',
              }}
            >
              ค{c}
            </button>
          ))}
          <label className="muted" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontWeight: includeBottom ? 700 : 400 }}>
            <input type="checkbox" checked={includeBottom} onChange={(e) => setIncludeBottom(e.target.checked)} />
            นับรวมแถวค่าใต้คอลัมน์ (แถวท้ายสุด)
          </label>
        </div>
        <div className="tablewrap">
          <table className="ledger">
            <thead>
              <tr>
                <th className="rownum">#</th>
                {Array.from({ length: cols }, (_, c) => {
                  const n1 = c + 1
                  const odd = isOddCol(n1)
                  const comp = computeCols.includes(n1)
                  return (
                    <th key={c} className={'colhead' + (comp ? ' comp' : '')}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <span>
                          ค{n1}
                          <span style={{ fontSize: 10, marginLeft: 6, opacity: .8 }}>
                            {comp ? 'Σ คำนวณ' : odd ? '✦ จับคู่' : ''}
                          </span>
                        </span>
                        <button
                          className="mini-x" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.4)', background: 'transparent' }}
                          title={`ลบคอลัมน์ ${n1}`}
                          onClick={() => { if (confirm(`ลบคอลัมน์ ${n1}?`)) removeCol(c) }}
                        >✕</button>
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {cells.map((row, r) => (
                <tr key={r}>
                  <th className="rownum">
                    {r + 1}
                    {cellConf && r === 1 && <div title="ความเชื่อมเครื่องหัวของ OCR" style={{ fontSize: 9, color: '#7d8aa8', fontWeight: 400 }}>H{Math.round((cellConf[0] || []).reduce((a, v, i, arr) => a + (v || 0), 0) / Math.max(1, (cellConf[0] || []).filter(Boolean).length))}</div>}
                    <button
                      className="mini-x" style={{ display: 'block', margin: '2px auto 0', background: 'transparent', color: 'var(--paper-2)', borderColor: 'rgba(255,255,255,.35)' }}
                      title={`ลบแถว ${r + 1}`} onClick={() => removeRow(r)}
                    >✕</button>
                  </th>
                  {Array.from({ length: cols }, (_, c) => {
                    const k = r + ':' + c
                    const a = analysis.A.has(k)
                    const b = analysis.B.has(k)
                    const comp = computeCols.includes(c + 1)
                    const { value, expr } = comp ? evalCell(row[c]) : {}
                    const cf = cellConf && cellConf[r] ? cellConf[r][c] : null
                    const low = cf != null && cf < 62
                    return (
                      <td
                        key={c}
                        className={'cellbox' + (a ? ' matchA' : '') + (b ? ' matchB' : '') + (low ? ' lowconf' : '')}
                        title={[expr ? row[c] + ' → ' + expr : '', low ? 'OCR ความเชื่อมต่ำ (' + cf + '%) — กรุนแต่องนี้' : ''].filter(Boolean).join(' · ') || undefined}
                      >
                        <input
                          value={row[c] ?? ''}
                          onChange={(e) => setCell(r, c, e.target.value)}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr className="total-row">
                <td>Σ</td>
                {Array.from({ length: cols }, (_, c) => {
                  const n1 = c + 1
                  return <td key={c}>{computeCols.includes(n1) ? fmt(totals.map[n1]) : ''}</td>
                })}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span><i className="lg-a" /> กลุ่ม A “เลขที่ออก” ตรงกัน → <b style={{ color: 'var(--red)' }}>วงกลมแดง</b></span>
          <span><i className="lg-b" /> กลุ่ม B “เลข_outgoing_” (สลับหลัก) ตรงกัน → <b>ไฮไลต์เหลือง</b></span>
          <span>จับคู่เฉพาะ <b>คอลัมน์คี่ (1,3,5,7,9)</b> · เทียบเลขท้าย 2/3 หลัก</span>
          <span>เซลล์ที่คำนวณจะแสดง <code>5*7 → 5+7=12</code> ใน tooltip</span>
          <span><i className="lg-low" /> แถบส้มใต้ช่อง = OCR มั่นใจต่ำ &lt;62% (ตรวจทาน)</span>
        </div>
      </section>

      <div className="panels">
        <section className="card panel-card a-card">
          <div className="card-head">
            <h2>กลุ่ม A · “Extract number” <span className="muted">จับคู่ตรง → แดง</span></h2>
            <span className="muted">กรอก 10 ชุด (2–3 หลัก)</span>
          </div>
          <div className="num-grid">
            {aSets.map((v, i) => (
              <div className="numcell" key={i}>
                <span className="idx">A{i + 1}</span>
                <input
                  className="field" inputMode="numeric" value={v}
                  onChange={(e) => setA(i, e.target.value)} placeholder="—"
                />
                {analysis.aSets.some((s) => s.i === i) && (
                  <Hit n={analysis.aSets.find((s) => s.i === i).hits} />
                )}
              </div>
            ))}
          </div>
          <div className="statbar">
            เจอทั้งหมด <b className="stat">{analysis.aSets.reduce((a, s) => a + (s.hits ? 1 : 0), 0)}</b> / {analysis.aSets.length} ชุดที่ถูก · พบบ่อยสุด:{' '}
            {topOf(analysis.aSets)}
          </div>
        </section>

        <section className="card panel-card b-card">
          <div className="card-head">
            <h2>กลุ่ม B · “Outgoing number” <span className="muted">สลับหลัก → เหลือง</span></h2>
            <span className="muted">3 หลัก 1 ชุด (สลับทุกตำแหน่ง) + เลข 2 หลัก</span>
          </div>
          <div className="opt-row">
            <label>เลข 3 หลัก → สลับตำแหน่งอัตโนมัติ</label>
            <div className="add-two">
              <input
                className="field" style={{ width: 120, textAlign: 'center', letterSpacing: 6, fontWeight: 700 }}
                inputMode="numeric" value={bThree} placeholder="123"
                onChange={(e) => setBThree(e.target.value.replace(/\D/g, '').slice(0, 3))}
              />
              <div className="perm-row" style={{ margin: 0 }}>
                {bPerms.length === 0 && <span className="muted">— กรอกเลข 3 หลัก</span>}
                {bPerms.map((p) => <span className="perm" key={p}>{p}</span>)}
              </div>
            </div>
          </div>
          <div className="opt-row">
            <label>เลข 2 หลัก (แต่ละตัว = 1 ชุด)</label>
            <div className="add-two">
              {bTwos.map((v, i) => (
                <span key={i} style={{ display: 'inline-flex', gap: 4 }}>
                  <input
                    className="field" style={{ width: 84, textAlign: 'center', letterSpacing: 4, fontWeight: 700 }}
                    inputMode="numeric" value={v} placeholder="24"
                    onChange={(e) => setTwo(i, e.target.value)}
                  />
                  {v.length === 2 && <Hit n={analysis.bSets.find((s) => s.v === v)?.hits ?? 0} />}
                  {bTwos.length > 1 && (
                    <button className="mini-x" onClick={() => setBTwos((o) => o.filter((_, j) => j !== i))}>✕</button>
                  )}
                </span>
              ))}
              <button className="btn ghost" style={{ padding: '8px 12px' }} onClick={() => setBTwos((o) => [...o, ''])}>+ เพิ่ม</button>
            </div>
          </div>
          <div className="statbar">
            ชุดที่ถูก: <b className="stat">{analysis.bSets.filter((s) => s.hits > 0).length}</b> จาก {analysis.bSets.length} ชุด
          </div>
        </section>
      </div>
    </>
  )
}

function Hit({ n }) {
  return <span className={'hitcount' + (n ? ' ok' : '')}>{n ? '✓ ' + n + ' จุด' : 'ยังไม่ตรง'}</span>
}

function topOf(list) {
  if (!list.length) return '—'
  const t = list.reduce((a, b) => (b.hits > a.hits ? b : a))
  return t.hits ? <span style={{ color: 'var(--red)' }}>{t.v} ({t.hits} จุด)</span> : '—'
}
