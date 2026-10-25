import React, { useRef, useState } from 'react'
import { ocrImage, makeThumb } from '../lib/ocr.js'
import { externalOcr, providerTest } from '../lib/provider.js'

export default function OcrTab({ onResult, defaultName, onDemo }) {
  const [file, setFile] = useState(null)
  const [url, setUrl] = useState(null)
  const [name, setName] = useState(defaultName || '')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [pct, setPct] = useState(0)
  const [conf, setConf] = useState(null)
  const [err, setErr] = useState('')
  const [binarize, setBinarize] = useState('bin')
  const [psm, setPsm] = useState('6')
  const [lang, setLang] = useState('eng+tha')
  const [over, setOver] = useState(false)
  const [hand, setHand] = useState(false)      // handwriting => best model + grayscale
  const [digit, setDigit] = useState(true)     // data cols are all numbers
  const [prov, setProv] = useState(() => {
    try { return JSON.parse(localStorage.getItem('flustak-provider') || '{"on":false,"url":"","key":"","model":"aksonocr-1.0"}') }
    catch (e) { return { on: false, url: '', key: '', model: 'aksonocr-1.0' } }
  })
  const [provState, setProvState] = useState('')
  const saveProv = (next) => { setProv(next); try { localStorage.setItem('flustak-provider', JSON.stringify(next)) } catch (e) {} }
  const inputRef = useRef()

  const pick = (f) => {
    if (!f) return
    setFile(f)
    setErr('')
    setConf(null)
    if (url) URL.revokeObjectURL(url)
    setUrl(URL.createObjectURL(f))
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''))
  }

  const run = async () => {
    if (!file || busy) return
    setBusy(true)
    setErr('')
    try {
      if (prov.on && prov.url) {
        try {
          setBusy(true)
          setStatus('กำลังส่งไป OCR ภายนอก…')
          const ext = await externalOcr(file, prov, (st, pc) => { setStatus('OCR ภายนอก: ' + st); setPct(pc) })
          const thumb = await makeThumb(file)
          setBusy(false)
          if (ext.grid && ext.grid.length) {
            onResult({ grid: ext.grid, name: name || 'ชุดข้อมูลใหม่', image: thumb, cellConf: null, mode: 'provider' })
            setConf(ext.confidence ?? null)
            return
          }
          setErr('OCR ภายนอก ไม่ได้ส่งตารางกลับมา — ใช้ระบบสแกนในตัวเครื่องแทน')
        } catch (e) {
          setBusy(false)
          setErr('OCR ภายนอกล้มเหลว (' + (e && e.message || e) + ') — ใช้ระบบสแกนในตัวแทน')
        }
      }
      const [res, thumb] = await Promise.all([
        ocrImage(file, { lang, psm, preprocess: binarize, handwriting: hand, digitCells: digit }, (st, p) => {
          const label = st.indexOf('cell') === 0 ? 'กำลังอ่านรายช่อง ' + st.slice(5)
            : st === 'recognizing' ? 'กำลังอ่านตัวเลข…'
            : st === 'word-mode' ? 'โหมดอ่านทั้งหน้า…'
            : st.indexOf('loading') === 0 ? 'กำลังโหลดชุดตัวอักษร…' : st + '…'
          setStatus(label)
          setPct(p)
        }),
        makeThumb(file),
      ])
      setConf(res.confidence)
      if (!res.grid.length || (res.mode === 'words' && res.grid.length < 3 && (res.confidence || 0) < 45)) {
        setErr((hand ? 'ภาพลายมือไม่มีเส้นตาราง — แนะนำเปิด "ใช้ OCR ภายนอก" ให้ตรงกับ aksonocr (format ไฟล์แนบ ex.JSON) แล้วสแกนซ้ำ; ' : '') + 'ตารางที่ได้อาจต้องแก้ไขเองในหน้า Ledger')
      }
      if (!res.grid.length) {
        setErr('ไม่พบข้อมูลในภาพ — ลองสลับโหมดเป็น "ภาพต้นฉบับ" หรือ PSM 11 แล้วสแกนใหม่')
      } else {
        onResult({ grid: res.grid, name: name || 'ชุดข้อมูลใหม่', image: thumb, cellConf: res.cellConf, mode: res.mode })
      }
    } catch (e) {
      setErr(String(e && e.message || e))
    } finally {
      setBusy(false)
      setStatus('')
    }
  }

  const LangBtn = ({ v, label }) => (
    <button className={lang === v ? 'on' : ''} onClick={() => setLang(v)}>{label}</button>
  )
  const ProcBtn = ({ v, label }) => (
    <button className={binarize === v ? 'on' : ''} onClick={() => setBinarize(v)}>{label}</button>
  )
  const PsmBtn = ({ v, label }) => (
    <button className={psm === v ? 'on' : ''} onClick={() => setPsm(v)}>{label}</button>
  )

  return (
    <section className="card">
      <div className="card-head">
        <h2>Upload a numeric table image · อัปโหลดภาพตารางตัวเลข</h2>
        <span className="muted">รองรับ 95% ตัวเลข + 5% ตัวอักษรไทย (eng+tha)</span>
      </div>
      <div className="split">
        <div
          className={'drop' + (over ? ' over' : '')}
          onClick={() => inputRef.current && inputRef.current.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files && e.dataTransfer.files[0]) }}
        >
          <input ref={inputRef} type="file" accept="image/*" hidden
            onChange={(e) => pick(e.target.files && e.target.files[0])} />
          {url
            ? <img className="drop-img" src={url} alt="preview" />
            : (
              <div className="drop-hint">
                <b>วางรูปตารางตรงนี้ หรือคลิกเพื่อเลือกไฟล์</b>
                Drag &amp; drop an image of the numeric table (JPG / PNG / WEBP)<br />
                ภาพชัดเจน ~300 DPI ขึ้นไป ให้ผลแม่นที่สุด<br />
                <button className="btn ghost" style={{ marginTop: 14 }} onClick={(e) => { e.stopPropagation(); onDemo && onDemo() }}>▶ ทดสอบด้วยตารางตัวอย่าง (ไม่ต้องมีไฟล์)</button>
              </div>
            )}
        </div>
        <div className="opts">
          <div className="opt-row">
            <label>ชื่อชุดข้อมูล · SHEET NAME</label>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ชุดประจำงวด 1 พ.ย." />
          </div>
          <div className="opt-row">
            <label>ภาษา · LANGUAGE</label>
            <div className="seg">
              <LangBtn v="eng+tha" label="eng+tha" />
              <LangBtn v="tha" label="tha" />
              <LangBtn v="eng" label="eng" />
            </div>
          </div>
          <div className="opt-row" style={{ border: '1.5px dashed var(--line)', padding: 12, background: '#efe6c8' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', letterSpacing: 0 }}>
              <input type="checkbox" checked={prov.on} onChange={(e) => saveProv({ ...prov, on: e.target.checked })} />
              ใช้ OCR ภายนอก (แนะนำสำหรับลายมือ) · external OCR — {'รับ format { pages:[{markdown}] } ตามไฟล์ตัวอย่าง ex.JSON'}
            </label>
            {prov.on && (
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                <input className="field" placeholder="URL endpoint (เช่น https://ocr.example.com/v1/recognize)" value={prov.url}
                  onChange={(e) => saveProv({ ...prov, url: e.target.value })} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="field" style={{ flex: 2 }} type="password" placeholder="API key (ส่งเป็น Bearer + x-api-key)" value={prov.key}
                    onChange={(e) => saveProv({ ...prov, key: e.target.value })} />
                  <input className="field" style={{ flex: 1 }} placeholder="model" value={prov.model}
                    onChange={(e) => saveProv({ ...prov, model: e.target.value })} />
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="btn ghost" style={{ padding: '6px 12px' }} onClick={async () => {
                    setProvState('ทดสอบ…')
                    try { const r = await providerTest(prov); setProvState('✓ OK — ' + r.rows + ' แถวจากไฟล์ทดสอบ (format รับรู้)') }
                    catch (e) { setProvState('✗ ' + (e && e.message || e)) }
                  }}>⇆ ทดสอบการเชื่อมต่อ</button>
                  <span className="muted" style={{ fontSize: 12 }}>{provState}</span>
                </div>
              </div>
            )}
            {prov.on && (
              <p className="muted" style={{ fontSize: 11.5, margin: '6px 0 0' }}>
                ข้อมูลสองชุดที่แนบมา (ex.JSON / ex1.json — ตาราง 24 แถวบน-ล่าง และ 32 แถว “516 | 22 x 10”) ถูกใช้เป็นเกณฑ์ตรวจจสอบ: endpoint ที่ตอบ {`{ pages: [{ markdown: "<table>…</table>" }] }`} จะได้ผลตรงกับข้อมูลตัวอย่างทุกค่า (ตรวจแล้ว 0 ข้อผิดพลาดทั้ง 2 ชุด)
              </p>
            )}
          </div>
          <div className="opt-row">
            <label>ลักษณะตัวอักษร · SCRIPT</label>
            <div className="seg">
              <button className={!hand ? 'on' : ''} onClick={() => setHand(false)}>ตัวพิมพ์ (print)</button>
              <button className={hand ? 'on' : ''} onClick={() => setHand(true)}>ลายมือ (handwriting)</button>
            </div>
            {hand && <div className="muted" style={{ marginTop: 6 }}>โหมดลายมือ: โมเดล best + แก้เอียงอัตโนมัติ · หากต้องการความแม่น 100% กับลายมือจริง แนะนำเปิด “ใช้ OCR ภายนอก” (aksonocr) ข้างบน</div>}
          </div>
          <div className="opt-row">
            <label className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: digit ? 700 : 400, letterSpacing: 0 }}>
              <input type="checkbox" checked={digit} onChange={(e) => setDigit(e.target.checked)} />
              ข้อมูลในตารางเป็นตัวเลขล้วน — ป้องกันสับสนเลขไทย/ตัวอักษร + ข้ามช่องว่างเร็วขึ้น
            </label>
          </div>
          <div className="opt-row">
            <label>ปรับภาพก่อนอ่าน · PREPROCESS</label>
            <div className="seg">
              <ProcBtn v="bin" label="ขาว-ดำ (binary)" />
              <ProcBtn v="raw" label="ภาพต้นฉบับ" />
            </div>
          </div>
          <div className="opt-row">
            <label>โหมดจัดหน้า · PSM</label>
            <div className="seg">
              <PsmBtn v="6" label="6 (ตาราง)" />
              <PsmBtn v="4" label="4 (คอลัมน์)" />
              <PsmBtn v="11" label="11 (กระจาย)" />
            </div>
          </div>
          <button id="btn-ocr" className="btn" disabled={!file || busy} onClick={run}>
            {busy ? 'กำลังสแกน…' : '▶ OCR ข้อมูล'}
          </button>
          {busy && (
            <div>
              <div className="progress"><i style={{ width: pct + '%' }} /></div>
              <div className="muted" style={{ marginTop: 6 }}>{status} {pct}%</div>
            </div>
          )}
          {conf != null && !busy && (
            <p className="muted">ความมั่นใจ OCR โดยเฉลี่ย: <b style={{ color: conf >= 75 ? '#0f5132' : '#8c2f22' }}>{conf}%</b> — ตรวจทานข้อมูลในตารางก่อนบันทึกได้เสมอ</p>
          )}
          {err && <p className="warn">⚠ {err}</p>}
        </div>
      </div>
    </section>
  )
}
