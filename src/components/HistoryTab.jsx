import React, { useEffect, useState } from 'react'
import { listBatches, loadBatch, deleteBatch } from '../lib/supabase.js'

const dtf = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' })

export default function HistoryTab({ onLoad, onSay, onDemo }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState('')

  const refresh = () =>
    listBatches()
      .then(setItems)
      .catch((e) => { setErr(String(e?.message || e)); setItems([]) })

  useEffect(() => { refresh() }, [])

  const openIt = async (id) => {
    try {
      const { batch, cells } = await loadBatch(id)
      onLoad({ cells, name: batch.name, id: batch.id, settings: batch.settings, image: batch.image_thumb })
      onSay('โหลด “' + (batch.name || id) + '” เข้ามาแล้ว')
    } catch (e) {
      onSay('โหลดไม่สำเร็จ: ' + (e?.message || e))
    }
  }

  const del = async (it) => {
    if (!confirm(`ลบชุดข้อมูล “${it.name}” ออกจากฐานข้อมูลถาวร?`)) return
    try {
      await deleteBatch(it.id)
      refresh()
      onSay('ลบแล้ว')
    } catch (e) {
      onSay('ลบไม่สำเร็จ: ' + (e?.message || e))
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>คลังข้อมูล · ARCHIVE (Supabase)</h2>
        <button className="btn ghost" onClick={refresh}>↻ รีเฟรช</button>
      </div>
      {err && <p className="warn">⚠ เชื่อมต่อ Supabase ไม่สำเร็จ: {err}</p>}
      {items === null && <p className="muted">กำลังโหลด…</p>}
      {items !== null && !items.length && (
        <div className="empty-state">ยังไม่มีชุดข้อมูลที่บันทึก — สแกนรูปแล้วกด “บันทึกลงฐานข้อมูล”<br />
          <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => onDemo && onDemo()}>▶ เปิดตารางตัวอย่างทดสอบระบบ</button>
        </div>
      )}
      {(items || []).map((it) => (
        <div className="hrow" key={it.id}>
          {it.image_thumb
            ? <img src={it.image_thumb} alt="" />
            : <div style={{ width: 56, height: 56, border: '1.5px dashed var(--ink-3)', display: 'grid', placeItems: 'center', fontSize: 20 }}>🗒</div>}
          <div className="hmeta">
            <b>{it.name}</b>
            <div className="muted">
              {dtf.format(new Date(it.created_at))} · คอลัมน์คำนวณ: {(it.settings?.computeCols || []).join(', ') || '—'}
            </div>
          </div>
          <button className="btn" onClick={() => openIt(it.id)}>เปิดใช้ต่อ</button>
          <button className="btn ghost" onClick={() => del(it)}>ลบ</button>
        </div>
      ))}
    </section>
  )
}
