import { useCallback, useEffect, useMemo, useState } from 'react'
import { adjustStock, listStocks, setMenuAvailability } from '../../../api/catalog'
import { hhmm, useToast } from '../../../lib/posUtils'
import { Toast } from '../../../components/ui/posUi'
import { errorText, useBranchScope } from '../useBranchScope'
import '../../../styles/pos.css'

// หน้าสต็อกพร้อมขาย (หลังร้าน) — 1.19–1.22
// เก็บเป็นจำนวนที่พร้อมขาย ต่อเมนู ต่อสาขา · เติม (+) หรือตั้งจำนวนใหม่
// เหลือ 0 ระบบปิดขายให้ (1.21) · เติมจาก 0 ระบบไม่เปิดขายให้ ต้องกดเปิดเอง (1.22)

const LOW_STOCK = 5

function stockStatus(r) {
  if (r.quantity <= 0) return { label: 'หมด · ปิดขายอัตโนมัติ', cls: 'is-waiting' }
  if (!r.is_available) return { label: 'ปิดขาย', cls: 'is-muted' }
  if (r.quantity <= LOW_STOCK) return { label: 'ใกล้หมด', cls: 'is-occupied' }
  return { label: 'ปกติ', cls: 'is-available' }
}

export default function StocksPage() {
  const scope = useBranchScope()
  const { branchId, branches, isOwner, canManage, branchName, ready } = scope
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [log, setLog] = useState([]) // ความเคลื่อนไหวที่ปรับจากหน้านี้ (ล่าสุดก่อน)
  const [reloadKey, setReloadKey] = useState(0)
  const [toast, notify] = useToast()

  useEffect(() => {
    if (!branchId) return
    let cancelled = false
    listStocks({ branch_id: branchId })
      .then((data) => {
        if (cancelled) return
        setRows(data || [])
        setError('')
      })
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [branchId, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  // เรียงตามคงเหลือน้อยไปมาก ของที่ต้องเติมอยู่บนสุด
  const sorted = useMemo(() => [...rows].sort((a, b) => a.quantity - b.quantity || a.menu_name.localeCompare(b.menu_name, 'th')), [rows])
  const low = rows.filter((r) => r.quantity > 0 && r.quantity <= LOW_STOCK)
  const out = rows.filter((r) => r.quantity <= 0)
  const selected = rows.find((r) => r.menu_id === selectedId) || sorted[0] || null

  const replaceRow = (menuId, patch) => setRows((list) => list.map((r) => (r.menu_id === menuId ? { ...r, ...patch } : r)))
  const addLog = (text) => setLog((l) => [{ at: new Date().toISOString(), text }, ...l].slice(0, 8))

  if (scope.me && !canManage) {
    return (
      <div className="pos-page">
        <div className="pos-empty">หน้านี้สำหรับผู้จัดการและเจ้าของร้านเท่านั้น</div>
      </div>
    )
  }

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div>
          <h1 className="pos-title">สต็อกพร้อมขาย</h1>
          <p className="pos-subtitle">เก็บเป็นจำนวนที่พร้อมขาย ต่อเมนู ต่อสาขา</p>
        </div>
        {isOwner && (
          <select
            className="pos-input pos-select-sm"
            value={branchId}
            onChange={(e) => {
              setLoading(true)
              setSelectedId(null)
              setLog([])
              scope.setBranchId(e.target.value)
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

      {(error || scope.error) && (
        <div className="pos-alert">
          {error || scope.error}
          <button className="pos-link" onClick={reload}>
            ลองใหม่
          </button>
        </div>
      )}

      <div className="pos-kpis is-3">
        <div className="pos-kpi">
          <span className="pos-kpi-label">เมนูที่ติดตามสต็อก</span>
          <strong className="pos-kpi-value">{loading ? '–' : rows.length}</strong>
          <span className="pos-kpi-sub is-ok">{branchName(branchId) ? `สาขา${branchName(branchId)}` : ' '}</span>
        </div>
        <div className="pos-kpi">
          <span className="pos-kpi-label">ใกล้หมด ({LOW_STOCK} หรือน้อยกว่า)</span>
          <strong className="pos-kpi-value">{loading ? '–' : low.length}</strong>
          <span className="pos-kpi-sub is-warn">{low.length ? 'ควรเติมวันนี้' : 'ยังพอขาย'}</span>
        </div>
        <div className="pos-kpi">
          <span className="pos-kpi-label">หมด / ปิดขายอัตโนมัติ</span>
          <strong className="pos-kpi-value">{loading ? '–' : out.length}</strong>
          <span className="pos-kpi-sub is-danger">{out.length ? out.map((r) => r.menu_name).join(', ') : 'ไม่มีเมนูที่หมด'}</span>
        </div>
      </div>

      <div className="pos-bo-layout">
        <section style={{ minWidth: 0 }} aria-label="สต็อกแต่ละเมนู">
          {loading && !(ready && !branchId) ? (
            <div className="pos-skeleton" />
          ) : sorted.length === 0 ? (
            <div className="pos-empty">ยังไม่มีเมนูในสาขานี้</div>
          ) : (
            <div className="pos-rtable-wrap" style={{ background: 'var(--app-card)' }}>
              <table className="pos-rtable">
                <thead>
                  <tr>
                    <th>เมนู</th>
                    <th>หมวด</th>
                    <th className="is-num">คงเหลือ</th>
                    <th>สถานะ</th>
                    <th aria-label="ปรับ" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const st = stockStatus(r)
                    return (
                      <tr key={r.menu_id} className={selected?.menu_id === r.menu_id ? 'is-selected' : ''}>
                        <td>
                          <button type="button" className="pos-row-link" onClick={() => setSelectedId(r.menu_id)}>
                            {r.menu_name}
                          </button>
                        </td>
                        <td className="pos-muted">{r.category_name}</td>
                        <td className={`is-num pos-qty ${r.quantity <= 0 ? 'pos-danger-text' : ''}`}>{r.quantity}</td>
                        <td>
                          <span className={`pos-pill ${st.cls}`}>{st.label}</span>
                        </td>
                        <td className="is-num">
                          <button type="button" className="pos-link-btn" onClick={() => setSelectedId(r.menu_id)}>
                            ปรับ
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="pos-note is-warn" style={{ marginTop: 14 }}>
            ตัดสต็อกอัตโนมัติตอนส่งออร์เดอร์เข้าครัว · เหลือ 0 ระบบปิดขายให้ · เติมจาก 0 ระบบไม่เปิดขายให้ ต้องกดเปิดเอง · คืนเงินไม่คืนสต็อก
          </p>
        </section>

        <aside className="pos-panel pos-side-panel" aria-label="เติม/แก้ไขสต็อก">
          {selected ? (
            <StockEditor
              key={selected.menu_id}
              row={selected}
              onChanged={(patch, text) => {
                replaceRow(selected.menu_id, patch)
                addLog(text)
              }}
              notify={notify}
            />
          ) : (
            <div className="pos-cart-empty">เลือกเมนูในตารางเพื่อเติมสต็อก</div>
          )}

          {log.length > 0 && (
            <div className="pos-log">
              <h3 className="pos-log-title">ความเคลื่อนไหวล่าสุด (จากหน้านี้)</h3>
              {log.map((l, i) => (
                <div key={i} className="pos-log-row">
                  <span className="pos-muted">{hhmm(l.at)}</span>
                  <span>{l.text}</span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      <Toast toast={toast} />
    </div>
  )
}

function StockEditor({ row, onChanged, notify }) {
  const [mode, setMode] = useState('add') // add | set
  const [value, setValue] = useState(20)
  const [busy, setBusy] = useState(false)

  const after = mode === 'add' ? row.quantity + value : value
  const min = mode === 'add' ? 1 : 0

  function switchMode(next) {
    setMode(next)
    setValue(next === 'add' ? 20 : row.quantity)
  }

  async function save() {
    setBusy(true)
    try {
      const res = await adjustStock(row.menu_id, mode === 'add' ? { add: value } : { quantity: value })
      onChanged(
        { quantity: res.quantity, is_available: res.is_available },
        mode === 'add' ? `${row.menu_name} เติม +${value} (เหลือ ${res.quantity})` : `${row.menu_name} ตั้งเป็น ${res.quantity}`,
      )
      const hint = row.quantity === 0 && res.quantity > 0 && !res.is_available ? ' · ยังปิดขายอยู่ กดเปิดขายเมื่อพร้อม' : ''
      notify(`${row.menu_name} เหลือ ${res.quantity}${hint}`)
      setValue(mode === 'add' ? 20 : res.quantity)
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function toggle() {
    setBusy(true)
    try {
      const res = await setMenuAvailability(row.menu_id, !row.is_available)
      onChanged({ is_available: res.is_available }, `${row.menu_name} ${res.is_available ? 'เปิดขาย' : 'ปิดขาย'}`)
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pos-editor">
      <h2 className="pos-panel-title">เติม / แก้ไขสต็อก</h2>
      <strong>{row.menu_name}</strong>
      <span className="pos-dialog-sub" style={{ marginBottom: 12 }}>
        คงเหลือ {row.quantity} · {row.is_available ? 'เปิดขายอยู่' : 'ปิดขายอยู่'}
      </span>

      <div className="pos-tabs" role="radiogroup" style={{ alignSelf: 'flex-start' }}>
        <button type="button" role="radio" aria-checked={mode === 'add'} className={mode === 'add' ? 'is-active' : ''} onClick={() => switchMode('add')}>
          เติมเพิ่ม
        </button>
        <button type="button" role="radio" aria-checked={mode === 'set'} className={mode === 'set' ? 'is-active' : ''} onClick={() => switchMode('set')} title="ใช้ตอนนับสต็อกจริง">
          ตั้งจำนวนใหม่
        </button>
      </div>

      <div className="pos-center">
        <div className="pos-stepper is-lg" role="group" aria-label={mode === 'add' ? 'จำนวนที่เติม' : 'จำนวนใหม่'}>
          <button type="button" onClick={() => setValue((v) => Math.max(min, v - 1))} disabled={value <= min} aria-label="ลด">
            −
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={min}
            max={100000}
            value={value}
            onChange={(e) => setValue(Math.max(0, Math.min(100000, Math.floor(Number(e.target.value) || 0))))}
            aria-label={mode === 'add' ? 'จำนวนที่เติม' : 'จำนวนใหม่'}
          />
          <button type="button" onClick={() => setValue((v) => Math.min(100000, v + 1))} aria-label="เพิ่ม">
            +
          </button>
        </div>
      </div>
      <div className="pos-field-row">
        <span className="pos-muted">คงเหลือหลังบันทึก</span>
        <strong>{after}</strong>
      </div>

      <button type="button" className="pos-btn pos-btn-primary pos-btn-block" onClick={save} disabled={busy || value < min || (mode === 'set' && value === row.quantity)}>
        {busy ? 'กำลังบันทึก…' : 'บันทึกสต็อก'}
      </button>

      <div className="pos-field-row">
        <span className="pos-muted">เปิดขาย{row.quantity <= 0 ? ' (สต็อก 0 ต้องเติมก่อน)' : ''}</span>
        <label className="pos-switch">
          <input type="checkbox" aria-label={`เปิดขาย ${row.menu_name}`} checked={row.is_available && row.quantity > 0} disabled={busy || row.quantity <= 0} onChange={toggle} />
          <span />
        </label>
      </div>
    </div>
  )
}
