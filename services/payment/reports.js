// /reports — แดชบอร์ด (1.34–1.37) · ตัวเลขคำนวณในฐานข้อมูลด้วยฟังก์ชันจากขั้น S5
// ยอดขาย = เงินที่รับ (รวม VAT) · รายรับ = ยอดขาย − เงินที่คืน · กำไร = รายรับ − รายจ่าย
import { Router } from 'express'
import { db, run } from './db.js'
import { pos } from './pos.js'
import { allow, branchFilter, dateRange, dateString, parse, round2, send, todayTh, z } from './helpers.js'

const CATEGORIES = ['labor', 'rent_utilities', 'ingredients', 'other']

/** ยอดขายจากแถวของฟังก์ชันรายงาน */
function figures(rows) {
  const sales = round2(rows.reduce((s, r) => s + Number(r.sales), 0))
  const refunds = round2(rows.reduce((s, r) => s + Number(r.refunds), 0))
  const bills = rows.reduce((s, r) => s + Number(r.bill_count), 0)
  return {
    sales,
    refunds,
    net_sales: round2(sales - refunds),
    bill_count: bills,
    avg_per_bill: bills ? round2(sales / bills) : 0,
  }
}

/** รายจ่ายแยกหมวด */
function expenseFigures(rows) {
  const by = Object.fromEntries(CATEGORIES.map((c) => [c, 0]))
  for (const r of rows) by[r.category] = round2(by[r.category] + Number(r.amount))
  return { total: round2(Object.values(by).reduce((s, v) => s + v, 0)), by_category: by }
}

const router = Router()

// GET /reports/daily?date= — ยอดขาย จำนวนบิล เฉลี่ยต่อบิล เมนูขายดี รายจ่าย (1.34, 1.35)
router.get('/daily', allow('manager', 'owner'), async (req, res) => {
  const { date = todayTh() } = parse(z.object({ date: dateString.optional() }), { date: req.query.date })
  const branchId = branchFilter(req)
  const args = { p_from: date, p_to: date, p_branch: branchId }
  const [sales, expenses] = await Promise.all([run(db.rpc('report_sales', args)), run(db.rpc('report_expenses', args))])

  // เมนูขายดีอยู่ที่ pos ถ้า pos ล่ม ตัวเลขส่วนอื่นยังแสดงได้
  const warnings = []
  let topMenus = null
  try {
    topMenus = await pos.topMenus({ branchId, from: date, to: date, limit: 5 })
  } catch {
    warnings.push({ code: 'TOP_MENUS_UNAVAILABLE', message: 'ดึงเมนูขายดีจากระบบบิลไม่ได้ชั่วคราว' })
  }

  send(res, { date, branch_id: branchId, ...figures(sales), expenses: expenseFigures(expenses), top_menus: topMenus, warnings })
})

// GET /reports/branches?from=&to= — owner เปรียบเทียบยอดขายทุกสาขา (1.36)
router.get('/branches', allow('owner'), async (req, res) => {
  const { from, to } = dateRange(req.query)
  const rows = await run(db.rpc('report_sales', { p_from: from, p_to: to, p_branch: null }))
  const branches = rows
    .map((r) => ({ branch_id: r.branch_id, ...figures([r]) }))
    .sort((a, b) => b.net_sales - a.net_sales)
  send(res, { from, to, branches, total: figures(rows) })
})

// GET /reports/profit?year=&branch_id= — owner ดูรายรับ รายจ่าย กำไร แยกสาขาแยกเดือน (1.37)
router.get('/profit', allow('owner'), async (req, res) => {
  const { year = Number(todayTh().slice(0, 4)) } = parse(
    z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
    { year: req.query.year },
  )
  const branchId = branchFilter(req)
  const [salesRows, expenseRows] = await Promise.all([
    run(db.rpc('report_monthly_sales', { p_year: year, p_branch: branchId })),
    run(db.rpc('report_monthly_expenses', { p_year: year, p_branch: branchId })),
  ])

  const branchIds = [...new Set([...salesRows, ...expenseRows].map((r) => r.branch_id))].sort()
  if (branchId && !branchIds.includes(branchId)) branchIds.push(branchId)
  const monthKey = (m) => `${year}-${String(m).padStart(2, '0')}`
  const add = (a, b) => ({
    revenue: round2(a.revenue + b.revenue),
    expenses: round2(a.expenses + b.expenses),
    profit: round2(a.profit + b.profit),
  })
  const zero = { revenue: 0, expenses: 0, profit: 0 }

  const branches = branchIds.map((b) => {
    const months = Array.from({ length: 12 }, (_, i) => {
      const s = salesRows.find((r) => r.branch_id === b && r.month === i + 1)
      const e = expenseFigures(expenseRows.filter((r) => r.branch_id === b && r.month === i + 1))
      const revenue = round2(Number(s?.sales ?? 0) - Number(s?.refunds ?? 0))
      return { month: monthKey(i + 1), revenue, expenses: e.total, expenses_by_category: e.by_category, profit: round2(revenue - e.total) }
    })
    return { branch_id: b, months, total: months.reduce(add, zero) }
  })
  const totals_by_month = Array.from({ length: 12 }, (_, i) => ({
    month: monthKey(i + 1),
    ...branches.reduce((acc, br) => add(acc, br.months[i]), zero),
  }))

  send(res, { year, branch_id: branchId, branches, totals_by_month, total: totals_by_month.reduce(add, zero) })
})

export default router
