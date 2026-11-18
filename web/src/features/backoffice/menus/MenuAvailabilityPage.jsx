import { useCallback, useEffect, useMemo, useState } from 'react'
import { listMenus, setMenuAvailability } from '../../../api/catalog'
import { baht, errorText, useToast } from '../useBranchScope'
import './menus.css'
import '../backoffice.css'

// หน้าเปิด/ปิดขายเมนูของพนักงานหน้าร้าน — 1.15 · สต็อกเป็น 0 เปิดขายไม่ได้

export default function MenuAvailabilityPage() {
  const [menus, setMenus] = useState([])
  const [search, setSearch] = useState('')
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
        setMenus(rows)
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

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return menus.filter((m) => !q || m.name.toLowerCase().includes(q))
  }, [menus, search])

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
    <div className="mm-page">
      <header className="mm-header">
        <div>
          <h1 className="mm-title">เปิด/ปิดขายเมนู</h1>
          <p className="mm-subtitle">ปิดเมนูเมื่อของไม่พร้อม · เมนูที่สต็อกเป็น 0 ต้องให้ผู้จัดการเติมก่อน</p>
        </div>
      </header>

      <div className="mm-toolbar">
        <input className="mm-input mm-search" placeholder="ค้นหาชื่อเมนู" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {error && (
        <div className="mm-alert">
          {error}
          <button className="mm-link" onClick={reload}>
            ลองใหม่
          </button>
        </div>
      )}

      {loading ? (
        <div className="mm-card mm-skeleton" />
      ) : shown.length === 0 ? (
        <div className="mm-empty">{menus.length ? 'ไม่พบเมนูที่ค้นหา' : 'ยังไม่มีเมนูในสาขานี้'}</div>
      ) : (
        <div className="bo-table-wrap">
          <table className="bo-table">
            <thead>
              <tr>
                <th>เมนู</th>
                <th>หมวด</th>
                <th className="bo-num">ราคา (บาท)</th>
                <th className="bo-num">คงเหลือ</th>
                <th>เปิดขาย</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const empty = m.quantity <= 0
                return (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                    </td>
                    <td className="bo-muted">{m.category_name}</td>
                    <td className="bo-num">{baht(m.price)}</td>
                    <td className={`bo-num ${empty ? 'bo-neg' : ''}`}>
                      <strong>{m.quantity}</strong>
                    </td>
                    <td>
                      <label className="mm-switch" title={empty && !m.is_available ? 'สต็อกเป็น 0 ต้องเติมก่อน' : ''}>
                        <input
                          type="checkbox"
                          aria-label={`เปิดขาย ${m.name}`}
                          checked={m.is_available}
                          disabled={busyId === m.id || (empty && !m.is_available)}
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

      {toast && <div className={`mm-toast ${toast.type === 'error' ? 'is-error' : ''}`}>{toast.message}</div>}
    </div>
  )
}
