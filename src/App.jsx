import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { EVEN_COLS, colTotal, round6 } from './lib/compute.js'
import { analyze } from './lib/match.js'
import { saveBatch } from './lib/supabase.js'
import { DEMO_CELLS, DEMO_NAME } from './lib/demo.js'
import OcrTab from './components/OcrTab.jsx'
import LedgerTab from './components/LedgerTab.jsx'
import SummaryTab from './components/SummaryTab.jsx'
import HistoryTab from './components/HistoryTab.jsx'

const TABS = [
  { id: 1, th: 'OCR สแกนรูป', en: 'SCAN' },
  { id: 2, th: 'ตาราง + ตรวจเลข', en: 'LEDGER' },
  { id: 3, th: 'สรุปรายรับ', en: 'SUMMARY' },
  { id: 4, th: 'คลังข้อมูล', en: 'ARCHIVE' },
]

export default function App() {
  const [tab, setTab] = useState(1)
  const [cells, setCells] = useState([])
  const [batchName, setBatchName] = useState('')
  const [batchId, setBatchId] = useState(null)
  const [thumb, setThumb] = useState(null)
  const [computeCols, setComputeCols] = useState([2, 4, 6, 8, 10])
  const [aSets, setASets] = useState(Array(10).fill(''))
  const [includeBottom, setIncludeBottom] = useState(true) // include sub-value rows written below columns
  const [bThree, setBThree] = useState('')
  const [bTwos, setBTwos] = useState(['', ''])
  const [cellConf, setCellConf] = useState(null)
  const [toast, setToast] = useState(null)

  const say = useCallback((msg) => {
    setToast(msg)
    window.clearTimeout(say.t)
    say.t = window.setTimeout(() => setToast(null), 3800)
  }, [])

  const cols = useMemo(() => Math.max(0, ...cells.map((r) => r.length)), [cells])

  const setCell = useCallback((r, c, v) => {
    setCells((old) => {
      const next = old.map((row) => row.slice())
      while (next.length <= r) next.push(Array(cols).fill(''))
      const row = next[r]
      while (row.length <= c) row.push('')
      row[c] = v
      return next
    })
  }, [cols])

  const addRow = () => setCells((o) => [...o, Array(cols || 1).fill('')])
  const addCol = () => setCells((o) => (o.length ? o.map((r) => [...r, '']) : [[]]))
  const removeRow = (r) => setCells((o) => o.filter((_, i) => i !== r))
  const removeCol = (c) => setCells((o) => o.map((r) => r.filter((_, i) => i !== c)))
  const clearAll = () => { setCells([]); setBatchId(null); setBatchName(''); setThumb(null); setCellConf(null) }

  // demo sheet (mirrors the real user table) — reachable via #demo / ?seed=1 / buttons
  const loadDemo = useCallback(() => {
    setCells(DEMO_CELLS.map((r) => r.slice()))
    setBatchName(DEMO_NAME)
    setBatchId(null)
    setThumb(null)
    setComputeCols([2, 4, 6, 8, 10])
    setIncludeBottom(true)
    setTab(2)
    if (window.location.hash !== '#demo') window.history.replaceState(null, '', '#demo')
  }, [])
  useEffect(() => {
    if (/#demo|seed=1/.test(window.location.hash + window.location.search)) loadDemo()
  }, [loadDemo])

  const onOcrResult = ({ grid, name, image, cellConf: cc }) => {
    setCells(grid)
    setCellConf(cc || null)
    if (name) setBatchName(name)
    setThumb(image || null)
    setTab(2)
  }

  const onLoadBatch = ({ cells: cs, name, id, settings, image }) => {
    setCells(cs)
    setCellConf(null)
    setBatchName(name)
    setBatchId(id)
    setThumb(image || null)
    if (settings && Array.isArray(settings.computeCols) && settings.computeCols.length) {
      setComputeCols(settings.computeCols)
    }
    setTab(2)
  }

  // "values below the column" = sub-total rows written under each column.
  // When the toggle is off, the LAST row of the sheet is excluded from all totals.
  const totalsScope = useMemo(
    () => (!includeBottom && cells.length > 1 ? cells.slice(0, -1) : cells),
    [cells, includeBottom]
  )
  const totals = useMemo(() => {
    const map = {}
    for (const c of computeCols) {
      const idx = c - 1
      if (idx < cols) map[c] = colTotal(totalsScope.map((r) => r[idx]))
    }
    const grand = round6(Object.values(map).reduce((a, b) => a + (b || 0), 0))
    return { map, grand, net: round6(grand * 0.75) }
  }, [totalsScope, computeCols, cols])

  const analysis = useMemo(
    () => analyze(cells, { aSets, bThree, bTwos }),
    [cells, aSets, bThree, bTwos]
  )

  const saving = React.useRef(false)
  const doSave = async () => {
    if (saving.current) return
    if (!cells.length) { say('ยังไม่มีข้อมูลในตาราง'); return }
    saving.current = true
    say('กำลังบันทึกลงฐานข้อมูล…')
    try {
      const id = await saveBatch({
        id: batchId,
        name: batchName || 'ชุดข้อมูล ' + new Date().toLocaleString('th-TH'),
        cells,
        settings: { computeCols },
        thumb,
      })
      setBatchId(id)
      say('บันทึกลง Supabase เรียบร้อย ✓')
    } catch (e) {
      say('บันทึกไม่สำเร็จ: ' + (e?.message || e))
    } finally {
      saving.current = false
    }
  }

  const toggleComputeCol = (c) =>
    setComputeCols((o) => (o.includes(c) ? o.filter((x) => x !== c) : [...o, c].sort((a, b) => a - b)))

  return (
    <div className="app">
      <div className="topredrule" />
      <header className="masthead">
        <div className="mast-grid">
          <div className="brand">
            <div className="brand-stamp">ฟ</div>
            <div>
              <h1>FLUSTAK <em>OCR</em></h1>
              <span className="tag">Scan · Compute · Match — สแกนตารางเลข คำนวณ จับคู่</span>
            </div>
          </div>
          <div className="db-pill">
            <span className="pill">
              <i className={'dot ' + (batchId ? 'on' : 'off')} />
              {batchId ? 'เชื่อมต่อฐานข้อมูลแล้ว' : 'ยังไม่ได้บันทึก'}
            </span>
          </div>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <span className="no">{t.id}</span>
            {t.th}
          </button>
        ))}
      </nav>

      {tab === 1 && <OcrTab onResult={onOcrResult} defaultName={batchName} onDemo={loadDemo} />}
      {tab === 2 && (
        <LedgerTab
          cells={cells} cols={cols} setCell={setCell}
          addRow={addRow} addCol={addCol} removeRow={removeRow} removeCol={removeCol}
          clearAll={clearAll}
          batchName={batchName} setBatchName={setBatchName}
          computeCols={computeCols} toggleComputeCol={toggleComputeCol}
          analysis={analysis} totals={totals} cellConf={cellConf}
          aSets={aSets} setASets={setASets}
          bThree={bThree} setBThree={setBThree}
          bTwos={bTwos} setBTwos={setBTwos}
          includeBottom={includeBottom} setIncludeBottom={setIncludeBottom}
          onSave={doSave} saving={saving.current}
        />
      )}
      {tab === 3 && (
        <SummaryTab
          cells={cells} cols={cols} computeCols={computeCols}
          totals={totals} analysis={analysis} batchName={batchName}
          includeBottom={includeBottom} cellsForCsv={cells} colsForCsv={cols}
        />
      )}
      {tab === 4 && <HistoryTab onLoad={onLoadBatch} onSay={say} onDemo={loadDemo} />}

      <footer className="colophon">
        <span>FLUSTAK OCR · LEDGER ENGINE</span>
        <span>OCR: Tesseract.js eng+tha (95% number / 5% Thai) · DATA: Supabase · DEPLOY: Vercel</span>
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
