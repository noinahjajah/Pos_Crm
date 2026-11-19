import { useCallback, useEffect, useMemo, useState } from 'react'
import { listUsers } from '../../../api/identity'
import { createExpense, deleteExpense, EXPENSE_CATEGORIES, listExpenses, updateExpense } from '../../../api/payment'
import { thb, useToast } from '../../../lib/posUtils'
import { Toast } from '../../../components/ui/posUi'
import { errorText, todayTh, useBranchScope } from '../useBranchScope'
import '../../../styles/pos.css'

// หน้ารายจ่ายสาขา (หลังร้าน) — 1.32, 1.33
// ซ้าย: ฟอร์มบันทึก/แก้ไข · ขวา: ยอดแต่ละหมวดของเดือน + รายการ
// manager บันทึกของสาขาตัวเอง · owner ดูทุกสาขาได้ และต้องเลือกสาขาตอนบันทึก

const PAGE_SIZE = 20
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const CATEGORY_PILL = { labor: 'is-available', rent_utilities: 'is-muted', ingredients: 'is-occupied', other: 'is-muted' }
const SHORT = { labor: 'ค่าแรง', rent_utilities: 'ค่าเช่า/ไฟ/น้ำ', ingredients: 'วัตถุดิบ', other: 'อื่นๆ' }

/** เดือนนี้และย้อนหลัง 2 เดือน → [{ key:'2026-11', label:'พ.ย. 2026', from, to }] */
function recentMonths(today) {
  const [y, m] = today.split('-').map(Number)
  return [0, 1, 2].map((back) => {
    const d = new Date(Date.UTC(y, m - 1 - back, 1))
    const year = d.getUTCFullYear()
    const month = d.getUTCMonth()
    const key = `${year}-${String(month + 1).padStart(2, '0')}`
    const last = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10)
    return { key, label: `${MONTHS[month]} ${year}`, from: `${key}-01`, to: back === 0 ? today : last }
  })
}

const shortDate = (v) => `${v.slice(8, 10)}/${v.slice(5, 7)}`
const emptyForm = (branchId) => ({ id: null, branch_id: branchId, expense_date: todayTh(), amount: '', category: 'ingredients', note: '' })

export default function ExpensesPage() {
  const scope = useBranchScope({ allowAll: true })
  const { branchId, branches, isOwner, canManage, ready, branchName } = scope
  const months = useMemo(() => recentMonths(todayTh()), [])
  const [month, setMonth] = useState(months[0])
  const [page, setPage] = useState(1)
  const [result, setResult] = useState({ items: [], meta: { total: 0, sum: 0 } })
  const [sums, setSums] = useState({})
  const [names, setNames] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(() => emptyForm(''))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [toast, notify] = useToast()

  // ชื่อผู้บันทึก (ไม่มีสิทธิ์ดูรายชื่อก็แค่ไม่แสดงชื่อ)
  useEffect(() => {
    let cancelled = false
    listUsers({ include_inactive: true })
      .then((rows) => !cancelled && setNames(new Map((rows || []).map((u) => [u.id, u.full_name || u.username]))))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const range = { from: month.from, to: month.to, branch_id: branchId }
    Promise.all([
      listExpenses({ ...range, page, limit: PAGE_SIZE }),
      ...EXPENSE_CATEGORIES.map((c) => listExpenses({ ...range, category: c.value, limit: 1 })),
    ])
      .then(([list, ...byCat]) => {
        if (cancelled) return
        setResult({ items: list.data || [], meta: list.meta || {} })
        setSums(Object.fromEntries(EXPENSE_CATEGORIES.map((c, i) => [c.value, byCat[i].meta?.sum ?? 0])))
        setError('')
      })
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [ready, branchId, month, page, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const formBranch = form.branch_id || branchId || branches[0]?.id || ''

  function edit(row) {
    setForm({ id: row.id, branch_id: row.branch_id, expense_date: row.expense_date, amount: String(row.amount), category: row.category, note: row.note || '' })
    setFormError('')
  }

  async function submit(e) {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!(amount > 0)) return setFormError('จำนวนเงินต้องมากกว่า 0')
    if (!form.expense_date) return setFormError('กรุณาเลือกวันที่')
    if (isOwner && !formBranch) return setFormError('กรุณาเลือกสาขา')

    const body = { category: form.category, amount, expense_date: form.expense_date, note: form.note.trim() || null }
    if (isOwner) body.branch_id = formBranch
    setSaving(true)
    setFormError('')
    try {
      if (form.id) await updateExpense(form.id, body)
      else await createExpense(body)
      notify(form.id ? 'บันทึกการแก้ไขแล้ว' : `บันทึกรายจ่าย ${thb(amount)} แล้ว`)
      setForm(emptyForm(isOwner ? formBranch : ''))
      reload()
    } catch (err) {
      setFormError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!form.id || !window.confirm(`ลบรายจ่าย ${SHORT[form.category]} ${thb(form.amount)} วันที่ ${shortDate(form.expense_date)} ?`)) return
    setSaving(true)
    try {
      await deleteExpense(form.id)
      notify('ลบรายจ่ายแล้ว')
      setForm(emptyForm(''))
      reload()
    } catch (err) {
      setFormError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  if (scope.me && !canManage) {
    return (
      <div className="pos-page">
        <div className="pos-empty">หน้านี้สำหรับผู้จัดการและเจ้าของร้านเท่านั้น</div>
      </div>
    )
  }

  const { items, meta } = result
  const pages = Math.max(1, Math.ceil((meta.total || 0) / PAGE_SIZE))

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div>
          <h1 className="pos-title">รายจ่ายสาขา</h1>
          <p className="pos-subtitle">
            {branchId ? `สาขา${branchName(branchId)}` : 'ทุกสาขา'} · เดือน {month.label}
          </p>
        </div>
        {isOwner && (
          <select
            className="pos-input pos-select-sm"
            value={branchId}
            onChange={(e) => {
              setLoading(true)
              setPage(1)
              scope.setBranchId(e.target.value)
            }}
            aria-label="สาขา"
          >
            <option value="">ทุกสาขา</option>
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

      <div className="pos-exp-layout">
        {/* ---------- ฟอร์ม ---------- */}
        <form className="pos-panel pos-col-panel" onSubmit={submit} aria-label="บันทึกรายจ่าย">
          <h2 className="pos-panel-title">{form.id ? 'แก้ไขรายจ่าย' : 'บันทึกรายจ่าย'}</h2>
          {isOwner && (
            <label className="pos-field">
              <span>สาขา</span>
              <select className="pos-input" value={formBranch} onChange={set('branch_id')}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="pos-field">
            <span>วันที่</span>
            <input className="pos-input" type="date" value={form.expense_date} max={todayTh()} onChange={set('expense_date')} />
          </label>
          <label className="pos-field">
            <span>จำนวนเงิน (บาท)</span>
            <input className="pos-input" type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={set('amount')} placeholder="0.00" />
          </label>
          <fieldset className="pos-field" style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
            <legend className="pos-field-legend">หมวด</legend>
            <div className="pos-opt-list">
              {EXPENSE_CATEGORIES.map((c) => (
                <label key={c.value} className={`pos-opt ${form.category === c.value ? 'is-checked' : ''}`}>
                  <input type="radio" name="exp-category" checked={form.category === c.value} onChange={() => setForm((f) => ({ ...f, category: c.value }))} />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="pos-field">
            <span>หมายเหตุ</span>
            <input className="pos-input" value={form.note} onChange={set('note')} maxLength={500} placeholder="เช่น ซื้อกุ้งและปลาจากตลาด" />
          </label>

          {formError && <p className="pos-error">{formError}</p>}

          <div className="pos-side-actions" style={{ flexWrap: 'wrap' }}>
            {form.id && (
              <>
                <button type="button" className="pos-btn pos-btn-danger" onClick={remove} disabled={saving}>
                  ลบ
                </button>
                <button type="button" className="pos-btn" onClick={() => setForm(emptyForm(''))} disabled={saving}>
                  ยกเลิก
                </button>
              </>
            )}
            <button className="pos-btn pos-btn-primary pos-grow" disabled={saving || !ready}>
              {saving ? 'กำลังบันทึก…' : form.id ? 'บันทึกการแก้ไข' : 'บันทึกรายจ่าย'}
            </button>
          </div>
        </form>

        <div className="pos-refund-side" style={{ minWidth: 0 }}>
          {/* ---------- ยอดแต่ละหมวด ---------- */}
          <div className="pos-kpis is-4">
            {EXPENSE_CATEGORIES.map((c) => (
              <div key={c.value} className="pos-kpi">
                <span className="pos-kpi-label">{c.label}</span>
                <strong className="pos-kpi-value">{loading ? '–' : thb(sums[c.value] || 0)}</strong>
                <span className="pos-kpi-sub is-ok">รวมเดือน {month.label.split(' ')[0]}</span>
              </div>
            ))}
          </div>

          {/* ---------- รายการ ---------- */}
          <section className="pos-panel" aria-label="รายการรายจ่าย">
            <div className="pos-panel-head">
              <h2 className="pos-panel-title" style={{ margin: 0 }}>
                รายการรายจ่าย · รวม {thb(meta.sum || 0)}
              </h2>
              <div className="pos-chips">
                {months.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className={`pos-chip ${month.key === m.key ? 'is-active' : ''}`}
                    onClick={() => {
                      setLoading(true)
                      setPage(1)
                      setMonth(m)
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="pos-skeleton" />
            ) : items.length === 0 ? (
              <div className="pos-cart-empty">ไม่มีรายจ่ายในเดือนนี้</div>
            ) : (
              <div className="pos-rtable-wrap">
                <table className="pos-rtable">
                  <thead>
                    <tr>
                      <th>วันที่</th>
                      {isOwner && !branchId && <th>สาขา</th>}
                      <th>หมวด</th>
                      <th>หมายเหตุ</th>
                      <th>ผู้บันทึก</th>
                      <th className="is-num">จำนวนเงิน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <tr key={row.id} className={`pos-click-row ${form.id === row.id ? 'is-selected' : ''}`} onClick={() => edit(row)} title="คลิกเพื่อแก้ไข">
                        <td>{shortDate(row.expense_date)}</td>
                        {isOwner && !branchId && <td className="pos-muted">{branchName(row.branch_id)}</td>}
                        <td>
                          <span className={`pos-pill ${CATEGORY_PILL[row.category] || 'is-muted'}`}>{SHORT[row.category] || row.category}</span>
                        </td>
                        <td>{row.note || <span className="pos-muted">—</span>}</td>
                        <td className="pos-muted">{names.get(row.created_by) || '—'}</td>
                        <td className="is-num">
                          <strong>{thb(row.amount)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {pages > 1 && (
              <div className="pos-dialog-actions">
                <button type="button" className="pos-btn" disabled={page <= 1} onClick={() => (setLoading(true), setPage((p) => p - 1))}>
                  ก่อนหน้า
                </button>
                <span className="pos-muted" style={{ alignSelf: 'center' }}>
                  หน้า {page} / {pages}
                </span>
                <button type="button" className="pos-btn" disabled={page >= pages} onClick={() => (setLoading(true), setPage((p) => p + 1))}>
                  ถัดไป
                </button>
              </div>
            )}
          </section>
        </div>
      </div>

      <Toast toast={toast} />
    </div>
  )
}
