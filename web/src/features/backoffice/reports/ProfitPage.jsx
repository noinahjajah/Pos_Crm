import { useEffect, useMemo, useState } from 'react'
import { EXPENSE_CATEGORIES, getProfitReport } from '../../../api/payment'
import { thb } from '../../../lib/posUtils'
import GroupedBarChart from '../GroupedBarChart'
import { OTHER_COLOR, SERIES_COLORS, branchColors } from '../seriesColors'
import { errorText, todayTh, useBranchScope } from '../useBranchScope'
import '../../../styles/pos.css'

// รายรับ รายจ่าย และกำไร (owner) — 1.37
// แยกตามสาขาและเดือน · รายรับ = ยอดขาย − เงินที่คืน · กำไร = รายรับ − รายจ่ายรวม
// ข้อมูลจาก GET /payment/reports/profit?year= (ช่วงข้ามปีเรียก 2 ปี)

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const monthShort = (key) => MONTHS[Number(key.slice(5, 7)) - 1]
const monthLong = (key) => `${monthShort(key)} ${key.slice(0, 4)}`
const CAT_SHORT = { labor: 'ค่าแรง', rent_utilities: 'เช่า/ไฟ/น้ำ', ingredients: 'วัตถุดิบ', other: 'อื่นๆ' }
const ZERO_CATS = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.value, 0]))

/** เดือนย้อนหลัง n เดือน (รวมเดือนนี้) → ['2026-06', …, '2026-11'] */
function lastMonths(n, today) {
  const [y, m] = today.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

const round2 = (n) => Math.round(n * 100) / 100
function addMonth(a, b) {
  const cats = { ...a.cats }
  for (const k of Object.keys(ZERO_CATS)) cats[k] = round2((cats[k] || 0) + Number(b.expenses_by_category?.[k] || 0))
  return { revenue: round2(a.revenue + Number(b.revenue || 0)), expenses: round2(a.expenses + Number(b.expenses || 0)), profit: round2(a.profit + Number(b.profit || 0)), cats }
}
const EMPTY = { revenue: 0, expenses: 0, profit: 0, cats: ZERO_CATS }

function DeltaPct({ now, before, label, invert = false }) {
  if (!before) return <span className="pos-kpi-sub">{label ? `ไม่มีข้อมูล ${label}` : ' '}</span>
  const pct = Math.round(((now - before) / Math.abs(before)) * 1000) / 10
  const good = invert ? pct <= 0 : pct >= 0
  return (
    <span className={`pos-kpi-sub ${good ? 'is-ok' : 'is-danger'}`}>
      {pct >= 0 ? '+' : ''}
      {pct}% จาก {label}
    </span>
  )
}

function downloadCsv(filename, rows) {
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const text = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n') // BOM ให้ Excel อ่านภาษาไทยได้
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ProfitPage() {
  const scope = useBranchScope({ allowAll: true })
  const { branches, branchId, isOwner, ready, branchName } = scope
  const today = todayTh()
  const thisYear = Number(today.slice(0, 4))
  const ranges = useMemo(
    () => [
      { key: '6', label: '6 เดือนล่าสุด', months: lastMonths(6, today) },
      { key: '12', label: '12 เดือนล่าสุด', months: lastMonths(12, today) },
      { key: `y${thisYear}`, label: `ปี ${thisYear}`, months: lastMonths(Number(today.slice(5, 7)), today) },
      { key: `y${thisYear - 1}`, label: `ปี ${thisYear - 1}`, months: MONTHS.map((_, i) => `${thisYear - 1}-${String(i + 1).padStart(2, '0')}`) },
    ],
    [today, thisYear],
  )
  const [rangeKey, setRangeKey] = useState('6')
  const range = ranges.find((r) => r.key === rangeKey) || ranges[0]
  const years = useMemo(() => [...new Set(range.months.map((m) => Number(m.slice(0, 4))))], [range])
  const [reports, setReports] = useState(null) // { [year]: data } ของทุกสาขา
  const [error, setError] = useState('')

  // ดึงทุกสาขาครั้งเดียว แล้วกรองสาขาในเครื่อง (ใช้ทำตารางแยกสาขาด้วย)
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    Promise.all(years.map((year) => getProfitReport({ year })))
      .then((rows) => !cancelled && (setReports(Object.fromEntries(years.map((y, i) => [y, rows[i]]))), setError('')))
      .catch((err) => !cancelled && setError(errorText(err)))
    return () => {
      cancelled = true
    }
  }, [ready, years])

  const loaded = reports && years.every((y) => reports[y])

  // แถวรายเดือน (สาขาที่เลือก หรือรวมทุกสาขา) + แยกสาขาต่อเดือน
  const { monthly, perBranch } = useMemo(() => {
    if (!loaded) return { monthly: [], perBranch: new Map() }
    const per = new Map() // branchId → Map(monthKey → row)
    for (const y of years) {
      for (const b of reports[y].branches || []) {
        if (!per.has(b.branch_id)) per.set(b.branch_id, new Map())
        for (const m of b.months) per.get(b.branch_id).set(m.month, m)
      }
    }
    const rows = range.months.map((key) => {
      const ids = branchId ? [branchId] : [...per.keys()]
      const sum = ids.reduce((acc, id) => (per.get(id)?.get(key) ? addMonth(acc, per.get(id).get(key)) : acc), EMPTY)
      return { key, ...sum }
    })
    return { monthly: rows, perBranch: per }
  }, [loaded, reports, years, range, branchId])

  const last = monthly[monthly.length - 1]
  const prev = monthly[monthly.length - 2]
  const margin = last && last.revenue ? Math.round((last.profit / last.revenue) * 1000) / 10 : null

  // ตารางแยกสาขาของเดือนล่าสุด (สีติดสาขาตามลำดับรายชื่อสาขา)
  const colors = useMemo(() => branchColors(branches), [branches])
  const branchRows = last
    ? [...perBranch.entries()].map(([id, months]) => {
        const m = months.get(last.key)
        return { id, name: branchName(id) || 'สาขาที่ปิดแล้ว', revenue: Number(m?.revenue || 0), expenses: Number(m?.expenses || 0), profit: Number(m?.profit || 0) }
      })
    : []

  function exportCsv() {
    const head = ['เดือน', 'รายรับ', ...EXPENSE_CATEGORIES.map((c) => c.label), 'รายจ่ายรวม', 'กำไร']
    const body = monthly.map((m) => [monthLong(m.key), m.revenue, ...EXPENSE_CATEGORIES.map((c) => m.cats[c.value] || 0), m.expenses, m.profit])
    const scopeName = branchId ? branchName(branchId) : 'ทุกสาขา'
    downloadCsv(`กำไร-${scopeName}-${range.months[0]}-ถึง-${range.months[range.months.length - 1]}.csv`, [head, ...body])
  }

  if (scope.me && !isOwner) {
    return (
      <div className="pos-page">
        <div className="pos-empty">หน้านี้สำหรับเจ้าของร้านเท่านั้น</div>
      </div>
    )
  }

  const prevLabel = prev ? monthShort(prev.key) : ''

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div>
          <h1 className="pos-title">รายรับ รายจ่าย และกำไร</h1>
          <p className="pos-subtitle">แยกตามสาขาและเดือน · กำไร = รายรับ − รายจ่ายรวม (1.37)</p>
        </div>
      </header>

      <div className="pos-menu-toolbar">
        <div className="pos-chips" style={{ alignItems: 'center' }}>
          <div className="pos-tabs" role="tablist" style={{ margin: 0 }} aria-label="สาขา">
            <button type="button" role="tab" aria-selected={!branchId} className={!branchId ? 'is-active' : ''} onClick={() => scope.setBranchId('')}>
              ทุกสาขา
            </button>
            {branches.map((b) => (
              <button key={b.id} type="button" role="tab" aria-selected={branchId === b.id} className={branchId === b.id ? 'is-active' : ''} onClick={() => scope.setBranchId(b.id)}>
                {b.name}
              </button>
            ))}
          </div>
          <label className="pos-select-label">
            <span className="pos-muted">ช่วงเดือน</span>
            <select className="pos-input pos-select-sm" value={rangeKey} onChange={(e) => setRangeKey(e.target.value)}>
              {ranges.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label} ({monthShort(r.months[0])} – {monthLong(r.months[r.months.length - 1])})
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="pos-btn" onClick={exportCsv} disabled={!loaded}>
          ส่งออก CSV
        </button>
      </div>

      {(error || scope.error) && <div className="pos-alert">{error || scope.error}</div>}

      <div className="pos-kpis is-4">
        <div className="pos-kpi">
          <span className="pos-kpi-label">รายรับ เดือน {last ? monthShort(last.key) : ''}</span>
          <strong className="pos-kpi-value">{last ? thb(last.revenue) : '–'}</strong>
          {last ? <DeltaPct now={last.revenue} before={prev?.revenue} label={prevLabel} /> : <span className="pos-kpi-sub">&nbsp;</span>}
        </div>
        <div className="pos-kpi">
          <span className="pos-kpi-label">รายจ่ายรวม</span>
          <strong className="pos-kpi-value">{last ? thb(last.expenses) : '–'}</strong>
          {last ? <DeltaPct now={last.expenses} before={prev?.expenses} label={prevLabel} invert /> : <span className="pos-kpi-sub">&nbsp;</span>}
        </div>
        <div className="pos-kpi">
          <span className="pos-kpi-label">กำไร</span>
          <strong className={`pos-kpi-value ${last && last.profit < 0 ? 'pos-danger-text' : ''}`}>{last ? thb(last.profit) : '–'}</strong>
          {last ? <DeltaPct now={last.profit} before={prev?.profit} label={prevLabel} /> : <span className="pos-kpi-sub">&nbsp;</span>}
        </div>
        <div className="pos-kpi">
          <span className="pos-kpi-label">อัตรากำไร</span>
          <strong className="pos-kpi-value">{margin == null ? '–' : `${margin}%`}</strong>
          <span className="pos-kpi-sub is-ok">กำไร ÷ รายรับ</span>
        </div>
      </div>

      <div className="pos-dash-layout">
        <section className="pos-panel" aria-label="รายเดือน">
          <h2 className="pos-panel-title">รายเดือน · {branchId ? branchName(branchId) : 'ทุกสาขา'}</h2>
          {!loaded ? (
            <div className="pos-skeleton" />
          ) : (
            <div className="pos-rtable-wrap">
              <table className="pos-rtable">
                <thead>
                  <tr>
                    <th>เดือน</th>
                    <th className="is-num">รายรับ</th>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <th key={c.value} className="is-num">
                        {CAT_SHORT[c.value]}
                      </th>
                    ))}
                    <th className="is-num">รายจ่ายรวม</th>
                    <th className="is-num">กำไร</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((m) => (
                    <tr key={m.key}>
                      <td>
                        <strong>{monthShort(m.key)}</strong> <span className="pos-muted pos-small">{m.key.slice(0, 4)}</span>
                      </td>
                      <td className="is-num">{thb(m.revenue)}</td>
                      {EXPENSE_CATEGORIES.map((c) => (
                        <td key={c.value} className="is-num">
                          {thb(m.cats[c.value] || 0)}
                        </td>
                      ))}
                      <td className="is-num">
                        <strong>{thb(m.expenses)}</strong>
                      </td>
                      <td className={`is-num ${m.profit < 0 ? 'pos-danger-text' : 'pos-ok-text'}`}>
                        <strong>{thb(m.profit)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="pos-refund-side">
          {!branchId && (
            <section className="pos-panel" aria-label="แยกตามสาขา">
              <h2 className="pos-panel-title">แยกตามสาขา · {last ? monthShort(last.key) : ''}</h2>
              {!loaded ? (
                <div className="pos-skeleton" style={{ height: 140 }} />
              ) : branchRows.length === 0 ? (
                <div className="pos-cart-empty">ยังไม่มีข้อมูล</div>
              ) : (
                <div className="pos-rtable-wrap">
                  <table className="pos-rtable">
                    <thead>
                      <tr>
                        <th>สาขา</th>
                        <th className="is-num">รายรับ</th>
                        <th className="is-num">รายจ่าย</th>
                        <th className="is-num">กำไร</th>
                      </tr>
                    </thead>
                    <tbody>
                      {branchRows.map((b) => (
                        <tr key={b.id}>
                          <td>
                            <span className="pos-dot-label">
                              <i style={{ background: colors.get(b.id) || OTHER_COLOR }} aria-hidden="true" />
                              <strong>{b.name}</strong>
                            </span>
                          </td>
                          <td className="is-num">{thb(b.revenue)}</td>
                          <td className="is-num">{thb(b.expenses)}</td>
                          <td className={`is-num ${b.profit < 0 ? 'pos-danger-text' : 'pos-ok-text'}`}>
                            <strong>{thb(b.profit)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <section className="pos-panel" aria-label="รายรับเทียบรายจ่าย">
            <h2 className="pos-panel-title">รายรับ vs รายจ่าย</h2>
            {!loaded ? (
              <div className="pos-skeleton" style={{ height: 180 }} />
            ) : (
              <GroupedBarChart
                categories={monthly.map((m) => ({ key: m.key, label: monthShort(m.key) }))}
                series={[
                  { key: 'revenue', label: 'รายรับ', color: SERIES_COLORS[0] },
                  { key: 'expenses', label: 'รายจ่าย', color: SERIES_COLORS[1] },
                ]}
                values={{ revenue: monthly.map((m) => m.revenue), expenses: monthly.map((m) => m.expenses) }}
                format={thb}
                height={160}
                caption="รายรับเทียบรายจ่ายรายเดือน"
              />
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
