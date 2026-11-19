import { useCallback, useEffect, useMemo, useState } from 'react'
import { listMenus, setMenuAvailability } from '../../../api/catalog'
import { thb, useToast } from '../../../lib/posUtils'
import { Toast } from '../../../components/ui/posUi'
import { errorText } from '../useBranchScope'
import '../../../styles/pos.css'

// หน้าเปิด/ปิดขายเมนูของพนักงานหน้าร้าน — 1.15 · มีผลทันทีกับหน้ารับออร์เดอร์ของสาขานี้
// สต็อกเป็น 0 ระบบปิดขายให้อัตโนมัติ (1.21) และเปิดขายไม่ได้จนกว่าผู้จัดการ/เจ้าของจะเติม (1.22)

const ALL = '__all__'
const LOW_STOCK = 5 // เหลือไม่เกินเท่านี้ = ใกล้หมด

function menuStatus(m) {
  if (Number(m.quantity) <= 0) return { label: 'ปิดอัตโนมัติ · สต็อกหมด', cls: 'is-waiting' }
  if (!m.is_available) return { label: 'ปิดโดยพนักงาน', cls: 'is-muted' }
  if (Number(m.quantity) <= LOW_STOCK) return { label: 'ใกล้หมด', cls: 'is-occupied' }
  return { label: 'เปิดขาย', cls: 'is-available' }
}

export default function MenuAvailabilityPage() {
  const [menus, setMenus] = useState([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState(ALL)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [toast, notify] = useToast()

  useEffect(() => {
    let cancelled = false
    listMenus()
      .then((rows) => {
        if (cancelled) return
        setMenus(rows || [])
        setError('')
      })
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const reload = useCallback(() => {
    setLoading(true)
    setReloadKey((k) => k + 1)
  }, [])

  const categories = useMemo(() => {
    const seen = new Map()
    for (const m of menus) if (m.category_id && !seen.has(m.category_id)) seen.set(m.category_id, m.category_name || 'อื่น ๆ')
    return [...seen.entries()]
  }, [menus])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return menus.filter((m) => (category === ALL || m.category_id === category) && (!q || m.name.toLowerCase().includes(q)))
  }, [menus, search, category])

  const closedCount = menus.filter((m) => !m.is_available || Number(m.quantity) <= 0).length

  async function toggle(menu) {
    setBusyId(menu.id)
    try {
      const res = await setMenuAvailability(menu.id, !menu.is_available)
      setMenus((list) => list.map((m) => (m.id === menu.id ? { ...m, is_available: res.is_available } : m)))
      notify(res.is_available ? `เปิดขาย ${menu.name}` : `ปิดขาย ${menu.name}`)
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div>
          <h1 className="pos-title">เปิด/ปิดการขายเมนู</h1>
          <p className="pos-subtitle">มีผลทันทีกับหน้ารับออร์เดอร์ของสาขานี้ (1.15)</p>
        </div>
      </header>

      <div className="pos-menu-toolbar">
        <div className="pos-chips" style={{ alignItems: 'center' }}>
          <input className="pos-search" type="search" placeholder="ค้นหาเมนู" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="ค้นหาเมนู" />
          <button type="button" className={`pos-chip ${category === ALL ? 'is-active' : ''}`} onClick={() => setCategory(ALL)}>
            ทั้งหมด
          </button>
          {categories.map(([id, name]) => (
            <button key={id} type="button" className={`pos-chip ${category === id ? 'is-active' : ''}`} onClick={() => setCategory(id)}>
              {name}
            </button>
          ))}
        </div>
        {!loading && closedCount > 0 && <span className="pos-pill is-waiting">ปิดขายอยู่ {closedCount} เมนู</span>}
      </div>

      {error && (
        <div className="pos-alert">
          {error}
          <button className="pos-link" onClick={reload}>
            ลองใหม่
          </button>
        </div>
      )}

      {loading ? (
        <div className="pos-skeleton" />
      ) : shown.length === 0 ? (
        <div className="pos-empty">{menus.length ? 'ไม่พบเมนูที่ค้นหา' : 'ยังไม่มีเมนูในสาขานี้'}</div>
      ) : (
        <div className="pos-rtable-wrap" style={{ background: 'var(--app-card)' }}>
          <table className="pos-rtable pos-avail-table">
            <thead>
              <tr>
                <th aria-label="รูป" />
                <th>เมนู</th>
                <th>หมวด</th>
                <th className="is-num">ราคา</th>
                <th className="is-num">คงเหลือ</th>
                <th>สถานะ</th>
                <th className="is-center">เปิดขาย</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const empty = Number(m.quantity) <= 0
                const status = menuStatus(m)
                return (
                  <tr key={m.id}>
                    <td style={{ width: 56 }}>
                      <div className="pos-thumb-sm">{m.image_url ? <img src={m.image_url} alt="" loading="lazy" /> : <span aria-hidden="true">▧</span>}</div>
                    </td>
                    <td>
                      <strong>{m.name}</strong>
                    </td>
                    <td className="pos-muted">{m.category_name}</td>
                    <td className="is-num">{thb(m.price)}</td>
                    <td className={`is-num ${empty ? 'pos-danger-text' : ''}`}>
                      <strong>{m.quantity}</strong>
                    </td>
                    <td>
                      <span className={`pos-pill ${status.cls}`}>{status.label}</span>
                    </td>
                    <td className="is-center">
                      <label className="pos-switch" title={empty && !m.is_available ? 'สต็อกเป็น 0 ต้องให้ผู้จัดการเติมก่อน' : ''}>
                        <input
                          type="checkbox"
                          aria-label={`เปิดขาย ${m.name}`}
                          checked={m.is_available && !empty}
                          disabled={busyId === m.id || empty}
                          onChange={() => toggle(m)}
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

      <p className="pos-note is-muted" style={{ marginTop: 14 }}>
        เมนูที่สต็อกเหลือ 0 ระบบปิดขายให้อัตโนมัติ (1.21) · การเติมสต็อกทำได้โดยผู้จัดการและเจ้าของ (1.22)
      </p>

      <Toast toast={toast} />
    </div>
  )
}
