import { useCallback, useEffect, useMemo, useState } from 'react'
import { adjustStock, listStocks, setMenuAvailability } from '../../../api/catalog'
import { useBranchScope, useNotify } from '../useBranchScope'
import { errorText } from '../../../lib/format.js'
import '../menus/menus.css'
import '../backoffice.css'

// หน้าสต็อก (หลังร้าน) — 1.19–1.22
// เติม (+) หรือตั้งค่าจำนวน · เหลือ 0 ระบบปิดขายให้ · เติมจาก 0 ระบบไม่เปิดขายให้ ต้องกดเปิดเอง

const LOW_STOCK = 5

export default function StocksPage() {
  const scope = useBranchScope()
  const { branchId, isOwner, canManage, branches, ready } = scope
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all') // all | low | off
  const [search, setSearch] = useState('')
  const [inputs, setInputs] = useState({}) // menu_id → ตัวเลขที่พิมพ์
  const [busyId, setBusyId] = useState(null)
  const notify = useNotify()

  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    if (!branchId) return
    let cancelled = false
    listStocks({ branch_id: branchId })
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setError('')
      })
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [branchId, reloadKey])

  const reload = useCallback(() => {
    setLoading(true)
    setReloadKey((k) => k + 1)
  }, [])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => (filter === 'low' ? r.quantity <= LOW_STOCK : filter === 'off' ? !r.is_available : true))
      .filter((r) => !q || r.menu_name.toLowerCase().includes(q))
  }, [rows, filter, search])

  const counts = useMemo(
    () => ({
      all: rows.length,
      low: rows.filter((r) => r.quantity <= LOW_STOCK).length,
      off: rows.filter((r) => !r.is_available).length,
    }),
    [rows],
  )

  const replaceRow = (menuId, patch) => setRows((list) => list.map((r) => (r.menu_id === menuId ? { ...r, ...patch } : r)))

  async function submitQty(row, mode) {
    const value = Number(inputs[row.menu_id])
    if (!Number.isInteger(value) || value < (mode === 'add' ? 1 : 0)) {
      notify(mode === 'add' ? 'จำนวนที่เติมต้องเป็นจำนวนเต็มตั้งแต่ 1' : 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 0', 'error')
      return
    }
    setBusyId(row.menu_id)
    try {
      const res = await adjustStock(row.menu_id, mode === 'add' ? { add: value } : { quantity: value })
      replaceRow(row.menu_id, { quantity: res.quantity, is_available: res.is_available })
      setInputs((s) => ({ ...s, [row.menu_id]: '' }))
      const hint = row.quantity === 0 && res.quantity > 0 && !res.is_available ? ' · กดเปิดขายเมื่อพร้อม' : ''
      notify(`${row.menu_name} เหลือ ${res.quantity}${hint}`)
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function toggle(row) {
    setBusyId(row.menu_id)
    try {
      const res = await setMenuAvailability(row.menu_id, !row.is_available)
      replaceRow(row.menu_id, { is_available: res.is_available })
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  if (scope.me && !canManage) {
    return (
      <div className="mm-page">
        <div className="mm-empty">หน้านี้สำหรับผู้จัดการและเจ้าของร้านเท่านั้น</div>
      </div>
    )
  }

  const status = (r) =>
    r.quantity === 0 ? ['is-empty', 'หมด'] : !r.is_available ? ['', 'ปิดขาย'] : r.quantity <= LOW_STOCK ? ['is-low', 'ใกล้หมด'] : ['is-on', 'ขายอยู่']

  return (
    <div className="mm-page">
      <header className="mm-header">
        <div>
          <h1 className="mm-title">สต็อก</h1>
          <p className="mm-subtitle">
            เติมของหรือตั้งจำนวนใหม่ · เหลือ 0 ระบบปิดขายให้อัตโนมัติ · เติมแล้วต้องกดเปิดขายเอง
          </p>
        </div>
        {isOwner && (
          <div className="mm-header-actions">
            <select
              className="mm-select"
              value={branchId}
              onChange={(e) => {
                setLoading(true)
                scope.setBranchId(e.target.value)
              }}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      <div className="mm-toolbar">
        <input className="mm-input mm-search" placeholder="ค้นหาชื่อเมนู" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="mm-chips">
          {[
            ['all', 'ทั้งหมด'],
            ['low', `ใกล้หมด (≤ ${LOW_STOCK})`],
            ['off', 'ปิดขาย'],
          ].map(([key, label]) => (
            <button key={key} className={`mm-chip ${filter === key ? 'is-active' : ''}`} onClick={() => setFilter(key)}>
              {label} <span>{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {(error || scope.error) && (
        <div className="mm-alert">
          {error || scope.error}
          <button className="mm-link" onClick={reload}>
            ลองใหม่
          </button>
        </div>
      )}

      {loading && !(ready && !branchId) ? (
        <div className="mm-card mm-skeleton" />
      ) : shown.length === 0 ? (
        <div className="mm-empty">{rows.length ? 'ไม่พบเมนูที่ค้นหา' : 'ยังไม่มีเมนูในสาขานี้'}</div>
      ) : (
        <div className="bo-table-wrap">
          <table className="bo-table">
            <thead>
              <tr>
                <th>เมนู</th>
                <th>หมวด</th>
                <th className="bo-num">คงเหลือ</th>
                <th>สถานะ</th>
                <th>เติม / ตั้งจำนวน</th>
                <th>เปิดขาย</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const [cls, label] = status(r)
                const busy = busyId === r.menu_id
                return (
                  <tr key={r.menu_id}>
                    <td>
                      <strong>{r.menu_name}</strong>
                    </td>
                    <td className="bo-muted">{r.category_name}</td>
                    <td className={`bo-num ${r.quantity === 0 ? 'bo-neg' : ''}`}>
                      <strong>{r.quantity}</strong>
                    </td>
                    <td>
                      <span className={`bo-status ${cls}`}>{label}</span>
                    </td>
                    <td>
                      <form
                        className="bo-qty-form"
                        onSubmit={(e) => {
                          e.preventDefault()
                          submitQty(r, 'add')
                        }}
                      >
                        <input
                          className="mm-input"
                          type="number"
                          min="0"
                          step="1"
                          placeholder="จำนวน"
                          value={inputs[r.menu_id] ?? ''}
                          onChange={(e) => setInputs((s) => ({ ...s, [r.menu_id]: e.target.value }))}
                          disabled={busy}
                        />
                        <button className="mm-btn mm-btn-primary" disabled={busy || !inputs[r.menu_id]}>
                          + เติม
                        </button>
                        <button
                          type="button"
                          className="mm-btn"
                          disabled={busy || inputs[r.menu_id] === undefined || inputs[r.menu_id] === ''}
                          onClick={() => submitQty(r, 'set')}
                          title="ตั้งจำนวนคงเหลือเป็นตัวเลขนี้ (ใช้ตอนนับสต็อกจริง)"
                        >
                          ตั้งเป็น
                        </button>
                      </form>
                    </td>
                    <td>
                      <label className="mm-switch" title={r.quantity === 0 ? 'สต็อกเป็น 0 ต้องเติมก่อน' : ''}>
                        <input
                          type="checkbox"
                          checked={r.is_available}
                          disabled={busy || (r.quantity === 0 && !r.is_available)}
                          onChange={() => toggle(r)}
                        />
                        <span />
                      </label>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
