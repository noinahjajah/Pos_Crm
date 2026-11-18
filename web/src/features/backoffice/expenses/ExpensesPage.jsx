import { useCallback, useEffect, useState } from 'react'
import { createExpense, deleteExpense, EXPENSE_CATEGORIES, listExpenses, updateExpense } from '../../../api/payment'
import { useBranchScope, useNotify } from '../useBranchScope'
import { baht, errorText, thaiDate, todayTh } from '../../../lib/format.js'
import '../backoffice.css'

// หน้ารายจ่าย (หลังร้าน) — 1.32, 1.33
// manager บันทึกรายจ่ายของสาขาตัวเอง · owner ดูทุกสาขาได้ และต้องเลือกสาขาตอนบันทึก

const categoryLabel = (value) => EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? value
const PAGE_SIZE = 20

export default function ExpensesPage() {
  const scope = useBranchScope({ allowAll: true })
  const { branchId, branches, isOwner, canManage, ready, branchName } = scope
  const today = todayTh()
  const [filters, setFilters] = useState({ from: `${today.slice(0, 7)}-01`, to: today, category: '' })
  const [page, setPage] = useState(1)
  const [result, setResult] = useState({ items: [], meta: { total: 0, sum: 0 } })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // null | {} | expense
  const notify = useNotify()

  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    listExpenses({ ...filters, branch_id: branchId, page, limit: PAGE_SIZE })
      .then((res) => !cancelled && (setResult({ items: res.data, meta: res.meta || {} }), setError('')))
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [ready, branchId, filters, page, reloadKey])

  const reload = useCallback(() => {
    setLoading(true)
    setReloadKey((k) => k + 1)
  }, [])

  function changeFilter(key, value) {
    setLoading(true)
    setPage(1)
    setFilters((f) => ({ ...f, [key]: value }))
  }

  async function remove(row) {
    if (!window.confirm(`ลบรายจ่าย ${categoryLabel(row.category)} ${baht(row.amount)} บาท วันที่ ${thaiDate(row.expense_date)} ?`)) return
    try {
      await deleteExpense(row.id)
      notify('ลบรายจ่ายแล้ว')
      reload()
    } catch (err) {
      notify(errorText(err), 'error')
    }
  }

  if (scope.me && !canManage) {
    return (
      <div className="mm-page">
        <div className="mm-empty">หน้านี้สำหรับผู้จัดการและเจ้าของร้านเท่านั้น</div>
      </div>
    )
  }

  const { items, meta } = result
  const pages = Math.max(1, Math.ceil((meta.total || 0) / PAGE_SIZE))

  return (
    <div className="mm-page">
      <header className="mm-header">
        <div>
          <h1 className="mm-title">รายจ่าย</h1>
          <p className="mm-subtitle">{isOwner ? 'ดูได้ทุกสาขา หรือเลือกทีละสาขา' : `สาขา ${branchName(branchId)}`}</p>
        </div>
        <button className="mm-btn mm-btn-primary" onClick={() => setEditing({})} disabled={!ready}>
          + บันทึกรายจ่าย
        </button>
      </header>

      <div className="bo-filters">
        {isOwner && (
          <label className="mm-field">
            <span>สาขา</span>
            <select
              className="mm-select"
              value={branchId}
              onChange={(e) => {
                setLoading(true)
                setPage(1)
                scope.setBranchId(e.target.value)
              }}
            >
              <option value="">ทุกสาขา</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="mm-field">
          <span>ตั้งแต่</span>
          <input className="mm-input" type="date" value={filters.from} max={filters.to} onChange={(e) => changeFilter('from', e.target.value)} />
        </label>
        <label className="mm-field">
          <span>ถึง</span>
          <input className="mm-input" type="date" value={filters.to} min={filters.from} onChange={(e) => changeFilter('to', e.target.value)} />
        </label>
        <label className="mm-field">
          <span>หมวด</span>
          <select className="mm-select" value={filters.category} onChange={(e) => changeFilter('category', e.target.value)}>
            <option value="">ทุกหมวด</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="bo-kpis">
        <div className="bo-kpi is-main">
          <div className="bo-kpi-label">รวมรายจ่ายช่วงนี้</div>
          <div className="bo-kpi-value">฿{baht(meta.sum)}</div>
          <div className="bo-kpi-sub">
            {thaiDate(filters.from)} – {thaiDate(filters.to)}
          </div>
        </div>
        <div className="bo-kpi">
          <div className="bo-kpi-label">จำนวนรายการ</div>
          <div className="bo-kpi-value">{meta.total || 0}</div>
          <div className="bo-kpi-sub">{filters.category ? categoryLabel(filters.category) : 'ทุกหมวด'}</div>
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

      {loading ? (
        <div className="mm-card mm-skeleton" />
      ) : items.length === 0 ? (
        <div className="mm-empty">ไม่มีรายจ่ายในช่วงนี้</div>
      ) : (
        <div className="bo-table-wrap">
          <table className="bo-table">
            <thead>
              <tr>
                <th>วันที่</th>
                {isOwner && !branchId && <th>สาขา</th>}
                <th>หมวด</th>
                <th>หมายเหตุ</th>
                <th className="bo-num">จำนวนเงิน (บาท)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>{thaiDate(row.expense_date)}</td>
                  {isOwner && !branchId && <td className="bo-muted">{branchName(row.branch_id)}</td>}
                  <td>{categoryLabel(row.category)}</td>
                  <td className="bo-wrap bo-muted">{row.note || '—'}</td>
                  <td className="bo-num">
                    <strong>{baht(row.amount)}</strong>
                  </td>
                  <td>
                    <div className="bo-row-actions">
                      <button className="mm-btn" onClick={() => setEditing(row)}>
                        แก้ไข
                      </button>
                      <button className="mm-btn mm-btn-danger" onClick={() => remove(row)}>
                        ลบ
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="mm-dialog-actions">
          <button className="mm-btn" disabled={page <= 1} onClick={() => (setLoading(true), setPage((p) => p - 1))}>
            ก่อนหน้า
          </button>
          <span className="bo-muted" style={{ alignSelf: 'center' }}>
            หน้า {page} / {pages}
          </span>
          <button className="mm-btn" disabled={page >= pages} onClick={() => (setLoading(true), setPage((p) => p + 1))}>
            ถัดไป
          </button>
        </div>
      )}

      {editing && (
        <ExpenseDialog
          expense={editing.id ? editing : null}
          isOwner={isOwner}
          branches={branches}
          defaultBranchId={branchId || branches[0]?.id || ''}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null)
            notify(msg)
            reload()
          }}
        />
      )}
    </div>
  )
}

function ExpenseDialog({ expense, isOwner, branches, defaultBranchId, onClose, onSaved }) {
  const [form, setForm] = useState({
    branch_id: expense?.branch_id ?? defaultBranchId,
    category: expense?.category ?? 'ingredients',
    amount: expense?.amount ?? '',
    expense_date: expense?.expense_date ?? todayTh(),
    note: expense?.note ?? '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!(amount > 0)) return setError('จำนวนเงินต้องมากกว่า 0')
    if (!form.expense_date) return setError('กรุณาเลือกวันที่')
    if (isOwner && !form.branch_id) return setError('กรุณาเลือกสาขา')

    const body = { category: form.category, amount, expense_date: form.expense_date, note: form.note.trim() || null }
    if (isOwner) body.branch_id = form.branch_id

    setSaving(true)
    try {
      if (expense) await updateExpense(expense.id, body)
      else await createExpense(body)
      onSaved(expense ? 'บันทึกการแก้ไขแล้ว' : `บันทึกรายจ่าย ${baht(amount)} บาทแล้ว`)
    } catch (err) {
      setError(errorText(err))
      setSaving(false)
    }
  }

  return (
    <div className="mm-overlay" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <form className="mm-dialog mm-dialog-sm" onSubmit={submit}>
        <h2 className="mm-dialog-title">{expense ? 'แก้ไขรายจ่าย' : 'บันทึกรายจ่าย'}</h2>
        <div className="mm-fields" style={{ marginTop: 16 }}>
          {isOwner && (
            <label className="mm-field">
              <span>สาขา *</span>
              <select className="mm-select" value={form.branch_id} onChange={set('branch_id')}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="mm-field">
            <span>หมวด *</span>
            <select className="mm-select" value={form.category} onChange={set('category')}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <div className="mm-two">
            <label className="mm-field">
              <span>จำนวนเงิน (บาท) *</span>
              <input className="mm-input" type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} autoFocus />
            </label>
            <label className="mm-field">
              <span>วันที่ *</span>
              <input className="mm-input" type="date" value={form.expense_date} onChange={set('expense_date')} />
            </label>
          </div>
          <label className="mm-field">
            <span>หมายเหตุ</span>
            <input className="mm-input" value={form.note} onChange={set('note')} maxLength={500} placeholder="เช่น ซื้อผักตลาดเช้า" />
          </label>
        </div>
        {error && <div className="mm-alert" style={{ marginTop: 16 }}>{error}</div>}
        <div className="mm-dialog-actions">
          <button type="button" className="mm-btn" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button className="mm-btn mm-btn-primary" disabled={saving}>
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </form>
    </div>
  )
}
