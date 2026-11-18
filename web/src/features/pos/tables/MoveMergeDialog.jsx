import { useMemo, useState } from 'react'
import { mergeTables, moveTable } from '../../../api/pos'
import { errorText } from '../../../lib/format'
import { TABLE_STATUS, hhmm, thb } from '../posUtils'
import { Dialog } from '../posUi'

// ย้ายโต๊ะ (1.11) / รวมโต๊ะเป็นบิลเดียว (1.12) — ไม่มีแยกบิล (1.13)
// ขั้นตอน: แตะโต๊ะที่มีลูกค้าเป็น "ต้นทาง" → แตะโต๊ะปลายทาง → ยืนยัน

const orderSummary = (o) => `${o.guest_count} คน · ${o.item_count ?? 0} รายการ · ${thb(o.subtotal ?? o.total)}`

export default function MoveMergeDialog({ tables, initialMode = 'move', onClose, onDone }) {
  const [mode, setMode] = useState(initialMode)
  const [sourceId, setSourceId] = useState(null)
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const source = tables.find((t) => t.id === sourceId) || null
  const sourceOrderId = source?.order?.id

  function switchMode(next) {
    setMode(next)
    setPicked([])
    setError('')
  }

  /** โต๊ะนี้แตะได้ไหมในขั้นตอนตอนนี้ */
  function canPick(t) {
    if (!source) return t.status === 'occupied'
    if (t.id === source.id) return true // แตะซ้ำ = ยกเลิกต้นทาง
    if (t.order?.id && t.order.id === sourceOrderId) return false // อยู่บิลเดียวกันแล้ว
    if (mode === 'move') return t.status === 'available'
    return t.status === 'available' || t.status === 'occupied'
  }

  function tap(t) {
    setError('')
    if (!source) {
      setSourceId(t.id)
      return
    }
    if (t.id === source.id) {
      setSourceId(null)
      setPicked([])
      return
    }
    if (mode === 'move') setPicked([t.id])
    else setPicked((p) => (p.includes(t.id) ? p.filter((id) => id !== t.id) : [...p, t.id]))
  }

  // สรุปผลการรวม: นับคน รายการ ยอด จากทุกบิลที่เกี่ยวข้อง (บิลเดียวกันนับครั้งเดียว)
  const merged = useMemo(() => {
    if (mode !== 'merge' || !source || picked.length === 0) return null
    const chosen = [source, ...tables.filter((t) => picked.includes(t.id))]
    const orders = new Map()
    for (const t of chosen) if (t.order) orders.set(t.order.id, t.order)
    const list = [...orders.values()]
    const first = list.map((o) => o.opened_at).filter(Boolean).sort()[0]
    return {
      names: chosen.map((t) => t.table_no).join(' + '),
      guests: list.reduce((s, o) => s + Number(o.guest_count || 0), 0),
      items: list.reduce((s, o) => s + Number(o.item_count || 0), 0),
      amount: list.reduce((s, o) => s + Number(o.subtotal ?? o.total ?? 0), 0),
      openedAt: first,
    }
  }, [mode, source, picked, tables])

  const target = mode === 'move' && picked[0] ? tables.find((t) => t.id === picked[0]) : null

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      if (mode === 'move') {
        await moveTable(sourceOrderId, { from_table_id: source.id, to_table_id: target.id })
        onDone(`ย้าย ${source.table_no} ไป ${target.table_no} แล้ว`)
      } else {
        await mergeTables(sourceOrderId, { table_ids: picked })
        onDone(`รวมโต๊ะ ${merged.names} เป็นบิลเดียวแล้ว`)
      }
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const prompt = !source
    ? 'แตะโต๊ะที่มีลูกค้าเพื่อเลือกเป็นโต๊ะต้นทาง'
    : mode === 'move'
      ? `เลือกโต๊ะว่างที่จะย้าย ${source.table_no} ไป`
      : `เลือกโต๊ะที่จะรวมกับ ${source.table_no}`

  const ready = source && picked.length > 0

  return (
    <Dialog
      title="ย้าย / รวมโต๊ะ"
      subtitle={source ? `โต๊ะต้นทาง: ${source.table_no} · ${orderSummary(source.order)}` : 'ยังไม่ได้เลือกโต๊ะต้นทาง'}
      onClose={onClose}
      busy={busy}
      size="md"
    >
      <div className="pos-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'move'} className={mode === 'move' ? 'is-active' : ''} onClick={() => switchMode('move')}>
          ย้ายโต๊ะ
        </button>
        <button type="button" role="tab" aria-selected={mode === 'merge'} className={mode === 'merge' ? 'is-active' : ''} onClick={() => switchMode('merge')}>
          รวมโต๊ะ
        </button>
      </div>

      <span className="pos-label">{prompt}</span>
      <div className="pos-tile-grid">
        {tables.map((t) => {
          const isSource = source && (t.id === source.id || (t.order?.id && t.order.id === sourceOrderId))
          const isPicked = picked.includes(t.id)
          return (
            <button
              key={t.id}
              type="button"
              className={`pos-tile ${TABLE_STATUS[t.status]?.cls || ''} ${isSource ? 'is-source' : ''} ${isPicked ? 'is-picked' : ''}`}
              onClick={() => tap(t)}
              disabled={busy || (!isSource && !canPick(t))}
              aria-pressed={isSource || isPicked}
              title={`${t.table_no} · ${TABLE_STATUS[t.status]?.label || ''}`}
            >
              {t.table_no}
              {t.id === source?.id && <small>ต้นทาง</small>}
              {isPicked && <small>{mode === 'move' ? 'ปลายทาง' : 'เลือกแล้ว'}</small>}
            </button>
          )
        })}
      </div>

      {merged && (
        <div className="pos-note is-brand">
          <strong>รวมเป็นบิลเดียว: {merged.names}</strong>
          {merged.guests} คน · {merged.items} รายการ · {thb(merged.amount)}
          {merged.openedAt && ` · นับเวลาจากโต๊ะที่เปิดก่อน (${hhmm(merged.openedAt)})`}
        </div>
      )}
      {target && (
        <div className="pos-note is-brand">
          <strong>
            ย้าย {source.table_no} → {target.table_no}
          </strong>
          {orderSummary(source.order)} · โต๊ะ {source.table_no} จะกลับเป็นว่าง
        </div>
      )}

      {mode === 'merge' ? (
        <p className="pos-note is-warn">ระบบไม่รองรับการแยกบิล เมื่อรวมแล้วจะคิดเงินเป็นบิลเดียว (1.12–1.13)</p>
      ) : (
        <p className="pos-note is-muted">ย้ายโต๊ะเลือกได้เฉพาะโต๊ะว่าง และออร์เดอร์ทั้งหมดย้ายตามไป (1.11)</p>
      )}

      {error && <p className="pos-error">{error}</p>}

      <div className="pos-dialog-actions">
        <button type="button" className="pos-btn" onClick={onClose} disabled={busy}>
          ยกเลิก
        </button>
        <button type="button" className="pos-btn pos-btn-primary" onClick={confirm} disabled={!ready || busy}>
          {busy ? 'กำลังบันทึก…' : mode === 'move' ? 'ยืนยันย้ายโต๊ะ' : 'ยืนยันรวมโต๊ะ'}
        </button>
      </div>
    </Dialog>
  )
}
