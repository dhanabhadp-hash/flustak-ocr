import React from 'react'
import { evalRaw, fmt, isOddCol } from '../lib/compute.js'
import { analyze } from '../lib/match.js'

export default function SummaryTab({ cells, cols, computeCols, totals, analysis, batchName, includeBottom }) {
  if (!cells.length) {
    return (
      <section className="card">
        <div className="empty-state">ยังไม่มีข้อมูลให้สรุป — สแกนรูปและกรอกตารางก่อน</div>
      </section>
    )
  }

  const counts = {}
  for (const c of computeCols) {
    counts[c] = cells.filter((r) => evalRaw(r[c - 1])).length
  }

  const downloadCsv = () => {
    const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
    const lines = []
    lines.push(['ชื่อชุด', q(batchName || 'flustak'), '', 'คอลัมน์คำนวณ', computeCols.join('|')].join(','))
    lines.push(Array.from({ length: cols }, (_, i) => q('ค' + (i + 1))).join(','))
    cells.forEach((r) => lines.push(r.slice(0, cols).map(q).join(',')))
    lines.push('รวมแต่ละคอลัมน์ (แปลงตัวดำเนินการเป็น +),,' +
      computeCols.map((c) => q(fmt(totals.map[c]))).join(','))
    lines.push('รวมทั้งหมด,,' + q(fmt(totals.grand)))
    lines.push('หลังหัก 25%,,' + q(fmt(totals.net)))
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (batchName || 'flustak') + '-summary.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const aMatched = analysis.aSets.filter((s) => s.hits > 0)
  const bMatched = analysis.bSets.filter((s) => s.hits > 0)

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>สรุปรายรับรวม · DATA SUMMARY</h2>
          <span className="muted">ทุกนิพจน์ในคอลัมน์คู่ถูกแปลงเป็น + ก่อนรวม (5*7 → 5+7 = 12, 5-5 → 5+5 = 10) · แถวค่าใต้คอลัมน์: {includeBottom ? 'นับรวมแล้ว' : 'ไม่นับรวม (ปิดสวิตช์ในแท็บ 2)'}</span>
        </div>
        <div className="sum-grid">
          <div>
            <table className="sumtable">
              <thead>
                <tr><th>คอลัมน์</th><th>จำนวนช่องที่คำนวณได้</th><th>รวม</th></tr>
              </thead>
              <tbody>
                {computeCols.filter((c) => c <= cols).map((c) => (
                  <tr key={c}>
                    <td style={{ textAlign: 'left' }}>ค{c}</td>
                    <td>{counts[c] || 0}</td>
                    <td><b>{fmt(totals.map[c])}</b></td>
                  </tr>
                ))}
                {!computeCols.length && <tr><td colSpan={3} className="muted">เลือกคอลัมน์คำนวณในแท็บที่ 2</td></tr>}
              </tbody>
            </table>
            <div className="grand">
              <div><span>รวมทั้งหมด · GRAND TOTAL</span><b className="stat" style={{ fontSize: 24 }}>{fmt(totals.grand)}</b></div>
              <div style={{ borderTop: '1.5px dashed rgba(43,30,15,.35)' }}>
                <span>หัก 25%</span><span style={{ color: '#8c2f22', fontWeight: 700 }}>− {fmt(Math.round(totals.grand * 25) / 100)}</span>
              </div>
              <div style={{ borderTop: '1.5px dashed rgba(43,30,15,.35)' }}>
                <span className="display" style={{ fontWeight: 700 }}>สุทธิหลังหัก 25% · NET</span>
                <span className="stamp-net"><em>NET −25%</em><b>{fmt(totals.net)}</b></span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="display" style={{ marginTop: 0 }}>การจับคู่ · NUMBER MATCHING</h3>
            <table className="sumtable">
              <thead><tr><th>กลุ่ม</th><th>ชุดที่ถูก</th><th>จำนวนจุด</th></tr></thead>
              <tbody>
                {aMatched.length === 0 && bMatched.length === 0 && (
                  <tr><td colSpan={3} className="muted">ยังไม่มีเลขที่ตรง — กรอกตัวเลขในกลุ่ม A/B ที่แท็บที่ 2</td></tr>
                )}
                {aMatched.map((s) => (
                  <tr key={'a' + s.i}>
                    <td style={{ textAlign: 'left', color: 'var(--red)', fontWeight: 700 }}>A · {s.v}</td>
                    <td>Extract</td><td>{s.hits}</td>
                  </tr>
                ))}
                {bMatched.map((s) => (
                  <tr key={'b' + s.v}>
                    <td style={{ textAlign: 'left', fontWeight: 700 }}>B · {s.v}</td>
                    <td>Outgoing ({s.perms.join('|')})</td><td>{s.hits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mini-sum" style={{ marginTop: 14 }}>
              <div>คอลัมน์ที่จับคู่<br /><b>คี่ فقط (1,3,5,7,9)</b></div>
              <div>รวมเซลล์ในตาราง<br /><b>{cells.length} แถว × {cols} หลัก</b></div>
            </div>
            <div style={{ marginTop: 16 }}>
              <button className="btn" onClick={downloadCsv}>⤓ ส่งออก CSV (เปิดใน Excel)</button>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
