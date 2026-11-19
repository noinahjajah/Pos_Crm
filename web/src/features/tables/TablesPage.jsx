import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { listBranches } from '../../api/identity'
import { POS_MOCK, listTables } from '../../api/pos'
import { errorText } from '../../lib/format'
import { useAuth } from '../auth/AuthContext'
import { TABLE_STATUS, hhmm, thb, todayLabel, useNow, useToast } from '../../lib/posUtils'
import { MockBanner, Toast } from '../../components/ui/posUi'
import AddTableDialog from './AddTableDialog'
import MoveMergeDialog from './MoveMergeDialog'
import OpenTableDialog from './OpenTableDialog'
import '../../styles/pos.css'

// ผังโต๊ะ (1.7, 1.8, 1.11, 1.12)
// - โต๊ะว่าง → เปิดโต๊ะ · มีลูกค้า → ไปหน้ารับออร์เดอร์ · รอชำระ → ไปหน้าคิดเงินของ Dev 2
// - รีเฟรชเองทุก 20 วินาที ให้เห็นโต๊ะที่เครื่องอื่นเปิด/ปิด
// - manager (สาขาตัวเอง) / owner (เลือกสาขา) เพิ่มโต๊ะได้ · owner ดูผังได้แต่เปิดโต๊ะ/ย้าย/รวมไม่ได้ (เป็นงานของ staff, manager)

const REFRESH_MS = 20_000

export default function TablesPage() {
  const navigate = useNavigate()
  const now = useNow()
  const { isOwner, isManager } = useAuth()
  const canAddTable = isOwner || isManager
  const [branches, setBranches] = useState([])
  const [branchId, setBranchId] = useState('') // เฉพาะ owner
  const [adding, setAdding] = useState(false)
  const [tables, setTables] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [opening, setOpening] = useState(null) // โต๊ะที่กำลังเปิด
  const [moveMode, setMoveMode] = useState(null) // 'move' | 'merge'
  const [toast, notify] = useToast()

  // owner ไม่มีสาขาประจำ: โหลดรายการสาขาแล้วเลือกสาขาแรก
  useEffect(() => {
    if (!isOwner) return undefined
    let cancelled = false
    listBranches()
      .then((rows) => {
        if (cancelled) return
        setBranches(rows || [])
        setBranchId((cur) => cur || rows?.[0]?.id || '')
        if (!rows?.length) setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(errorText(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOwner])

  useEffect(() => {
    if (isOwner && !branchId) return undefined
    let cancelled = false
    const load = () =>
      listTables(isOwner ? { branch_id: branchId } : undefined)
        .then((rows) => {
          if (cancelled) return
          setTables(rows || [])
          setError('')
        })
        .catch((err) => !cancelled && setError(errorText(err)))
        .finally(() => !cancelled && setLoading(false))
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [reloadKey, isOwner, branchId])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  // จัดกลุ่มตามโซน (ถ้า backend ไม่ส่ง zone มา = กลุ่มเดียว)
  const zones = useMemo(() => {
    const map = new Map()
    for (const t of tables) {
      const zone = t.zone || 'โต๊ะทั้งหมด'
      if (!map.has(zone)) map.set(zone, [])
      map.get(zone).push(t)
    }
    return [...map.entries()]
  }, [tables])

  const counts = useMemo(() => {
    const c = { available: 0, occupied: 0, waiting_payment: 0 }
    for (const t of tables) c[t.status] = (c[t.status] || 0) + 1
    return c
  }, [tables])

  function tap(t) {
    if (isOwner) return // owner ดูผัง/จัดการโต๊ะเท่านั้น ไม่ได้รับออร์เดอร์
    if (t.status === 'available') setOpening(t)
    else if (t.status === 'occupied' && t.order) navigate(`/orders/${t.order.id}`)
    else if (t.status === 'waiting_payment' && t.order) navigate(`/checkout/${t.order.id}`)
  }

  const hasOccupied = counts.occupied > 0
  const branchName = branches.find((b) => b.id === branchId)?.name || ''
  const zoneNames = zones.map(([z]) => z)

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div>
          <h1 className="pos-title">ผังโต๊ะ</h1>
          <p className="pos-subtitle">
            {todayLabel(now)}
            {isOwner ? ' · ดูผังโต๊ะและเพิ่มโต๊ะของแต่ละสาขา' : ' · แตะโต๊ะว่างเพื่อเปิดโต๊ะ · แตะโต๊ะที่มีลูกค้าเพื่อสั่งเพิ่ม'}
          </p>
        </div>
        {isOwner && branches.length > 0 && (
          <select
            className="pos-input pos-select-sm"
            value={branchId}
            onChange={(e) => {
              setLoading(true)
              setTables([])
              setBranchId(e.target.value)
            }}
            aria-label="สาขา"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </header>

      <MockBanner show={POS_MOCK} />

      {error && (
        <div className="pos-alert">
          {error}
          <button className="pos-link" onClick={reload}>
            ลองใหม่
          </button>
        </div>
      )}

      <div className="pos-toolbar">
        <div className="pos-pills" aria-label="สรุปสถานะโต๊ะ">
          <span className="pos-pill is-available">ว่าง {counts.available}</span>
          <span className="pos-pill is-occupied">มีลูกค้า {counts.occupied}</span>
          <span className="pos-pill is-waiting">รอชำระ {counts.waiting_payment}</span>
        </div>
        <div className="pos-header-actions">
          {canAddTable && (
            <button className="pos-btn pos-btn-primary" onClick={() => setAdding(true)} disabled={isOwner && !branchId}>
              + เพิ่มโต๊ะ
            </button>
          )}
          {!isOwner && (
            <>
              <button className="pos-btn" onClick={() => setMoveMode('move')} disabled={!hasOccupied}>
                ย้ายโต๊ะ
              </button>
              <button className="pos-btn" onClick={() => setMoveMode('merge')} disabled={!hasOccupied}>
                รวมโต๊ะ
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="pos-skeleton" />
      ) : tables.length === 0 ? (
        !error && (
          <div className="pos-empty">
            {canAddTable ? 'สาขานี้ยังไม่มีโต๊ะ กด “+ เพิ่มโต๊ะ” เพื่อเริ่มสร้างผังโต๊ะ' : 'สาขานี้ยังไม่มีโต๊ะ ให้ผู้จัดการเพิ่มโต๊ะก่อน'}
          </div>
        )
      ) : (
        zones.map(([zone, list]) => (
          <section key={zone} className="pos-zone">
            <h2 className="pos-zone-title">
              {zone} · {list.length} โต๊ะ
            </h2>
            <div className="pos-table-grid">
              {list.map((t) => (
                <TableCard key={t.id} table={t} onClick={() => tap(t)} />
              ))}
            </div>
          </section>
        ))
      )}

      {opening && (
        <OpenTableDialog
          table={opening}
          onClose={() => setOpening(null)}
          onOpened={(order) => navigate(`/orders/${order.id}`)}
        />
      )}

      {adding && (
        <AddTableDialog
          branchId={isOwner ? branchId : undefined}
          branchName={isOwner ? branchName : undefined}
          zones={zoneNames}
          onClose={() => setAdding(false)}
          onCreated={(t) => {
            setAdding(false)
            notify(`เพิ่มโต๊ะ ${t.table_no} แล้ว`)
            reload()
          }}
        />
      )}

      {moveMode && (
        <MoveMergeDialog
          tables={tables}
          initialMode={moveMode}
          onClose={() => setMoveMode(null)}
          onDone={(message) => {
            setMoveMode(null)
            notify(message)
            reload()
          }}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}

function TableCard({ table: t, onClick }) {
  const status = TABLE_STATUS[t.status] || TABLE_STATUS.available
  const o = t.order
  const action =
    t.status === 'available' ? 'เปิดโต๊ะ' : t.status === 'occupied' ? 'สั่งอาหาร' : 'ไปคิดเงิน'

  return (
    <button type="button" className={`pos-table ${status.cls}`} onClick={onClick} aria-label={`โต๊ะ ${t.table_no} ${status.label} — ${action}`}>
      <div className="pos-table-top">
        <span className="pos-table-no">{t.table_no}</span>
        <span className="pos-table-status">{status.label}</span>
      </div>
      {o ? (
        <>
          <span className="pos-table-meta">
            {o.guest_count} คน · เปิด {hhmm(o.opened_at)}
          </span>
          <span className="pos-table-amount">
            {t.status === 'waiting_payment' ? `รอชำระ: ${thb(o.total)}` : thb(o.subtotal ?? o.total)}
          </span>
        </>
      ) : (
        <span className="pos-table-meta">{t.seats ? `${t.seats} ที่นั่ง` : ''}</span>
      )}
    </button>
  )
}
