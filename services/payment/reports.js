// /reports — แดชบอร์ด (1.34–1.37) · ตัวเลขคำนวณในฐานข้อมูลด้วยฟังก์ชันจากขั้น S5
// ยอดขาย = เงินที่รับ (รวม VAT) · หน้ากำไร: เงินที่คืนนับเป็นรายจ่ายหมวด refund · กำไร = ยอดขาย − รายจ่าย (รวมเงินคืน)
// คืนเงินหักรายได้ตั้งแต่ "อนุมัติ": refunds_pending = อนุมัติแล้วแต่ยังไม่ได้จ่ายคืน (นับตามวันที่อนุมัติ)
// จ่ายคืนแล้ว → นับจากรายการคืนเงินของ payment แทน (วันที่จ่ายคืน) ไม่นับซ้ำ
import { Router } from 'express'
import { db, run } from './db.js'
import { reportStream } from './events.js'
import { pos } from './pos.js'
import { allow, branchFilter, dateRange, dateString, parse, round2, send, todayTh, z } from './helpers.js'

const CATEGORIES = ['labor', 'rent_utilities', 'ingredients', 'other']

/** ยอดขายจากแถวของฟังก์ชันรายงาน + คืนเงินที่อนุมัติแล้วแต่ยังไม่ได้จ่ายคืน */
function figures(rows, pending = []) {
  const sales = round2(rows.reduce((s, r) => s + Number(r.sales), 0))
  const refunds = round2(rows.reduce((s, r) => s + Number(r.refunds), 0))
  const refundsPending = round2(pending.reduce((s, a) => s + Number(a.amount), 0))
  const bills = rows.reduce((s, r) => s + Number(r.bill_count), 0)
  return {
    sales,
    refunds,
    refunds_pending: refundsPending,
    net_sales: round2(sales - refunds - refundsPending),
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

/**
 * คืนเงินที่อนุมัติในช่วงวันนั้นแต่ยังไม่ได้จ่ายคืน → [{ id, branch_id, amount, decided_at }]
 * ตัดคำขอที่ payment จ่ายคืนแล้ว (กันนับซ้ำช่วงที่ pos ยังไม่ได้บันทึก refunded_at) · pos ล่ม → [] + warning
 */
async function pendingRefunds({ from, to = from, branchId }, warnings) {
  let rows
  try {
    rows = await pos.approvedRefunds({ branchId, from, to })
  } catch {
    warnings.push({ code: 'PENDING_REFUNDS_UNAVAILABLE', message: 'ดึงคำขอคืนเงินที่อนุมัติแล้วจากระบบบิลไม่ได้ชั่วคราว (ยอดยังไม่หักส่วนนี้)' })
    return []
  }
  if (!rows.length) return []
  const paid = await run(db.from('payments').select('approval_id').eq('type', 'refund').in('approval_id', rows.map((a) => a.id)))
  const done = new Set(paid.map((p) => p.approval_id))
  return rows.filter((a) => !done.has(a.id))
}

/** เดือน (1–12) ตามเวลาไทย */
const monthTh = (iso) => new Date(new Date(iso).getTime() + 7 * 3600 * 1000).getUTCMonth() + 1

const router = Router()

// GET /reports/stream — SSE แจ้งแดชบอร์ดเมื่อมีรับเงิน/คืนเงิน/รายจ่ายใหม่ (gateway ไม่ตัด timeout ให้ route นี้)
router.get('/stream', allow('manager', 'owner'), reportStream)

// GET /reports/daily?date= — ยอดขาย จำนวนบิล เฉลี่ยต่อบิล เมนูขายดี รายจ่าย (1.34, 1.35)
router.get('/daily', allow('manager', 'owner'), async (req, res) => {
  const { date = todayTh() } = parse(z.object({ date: dateString.optional() }), { date: req.query.date })
  const branchId = branchFilter(req)
  const args = { p_from: date, p_to: date, p_branch: branchId }
  // เมนูขายดี/คืนเงินที่อนุมัติอยู่ที่ pos ถ้า pos ล่ม ตัวเลขส่วนอื่นยังแสดงได้
  const warnings = []
  const [sales, expenses, pending] = await Promise.all([
    run(db.rpc('report_sales', args)),
    run(db.rpc('report_expenses', args)),
    pendingRefunds({ from: date, branchId }, warnings),
  ])

  let topMenus = null
  try {
    topMenus = await pos.topMenus({ branchId, from: date, to: date, limit: 5 })
  } catch {
    warnings.push({ code: 'TOP_MENUS_UNAVAILABLE', message: 'ดึงเมนูขายดีจากระบบบิลไม่ได้ชั่วคราว' })
  }

  send(res, {
    date,
    branch_id: branchId,
    ...figures(sales, pending),
    // ใช้หักในกราฟรายชั่วโมง (ตามเวลาที่อนุมัติ)
    pending_refunds: pending.map((a) => ({ id: a.id, amount: Number(a.amount), decided_at: a.decided_at })),
    expenses: expenseFigures(expenses),
    top_menus: topMenus,
    warnings,
  })
})

// GET /reports/branches?from=&to= — owner เปรียบเทียบยอดขายทุกสาขา (1.36)
router.get('/branches', allow('owner'), async (req, res) => {
  const { from, to } = dateRange(req.query)
  const warnings = []
  const [rows, pending] = await Promise.all([
    run(db.rpc('report_sales', { p_from: from, p_to: to, p_branch: null })),
    pendingRefunds({ from, to, branchId: null }, warnings),
  ])
  // สาขาที่มีแต่คืนเงินที่อนุมัติ (ไม่มีรายการรับเงิน) ก็ต้องขึ้นด้วย
  const ids = [...new Set([...rows.map((r) => r.branch_id), ...pending.map((a) => a.branch_id)])]
  const branches = ids
    .map((id) => ({
      branch_id: id,
      ...figures(
        rows.filter((r) => r.branch_id === id),
        pending.filter((a) => a.branch_id === id),
      ),
    }))
    .sort((a, b) => b.net_sales - a.net_sales)
  send(res, { from, to, branches, total: figures(rows, pending), warnings })
})

// GET /reports/profit?year=&branch_id= — owner ดูรายรับ รายจ่าย กำไร แยกสาขาแยกเดือน (1.37)
router.get('/profit', allow('owner'), async (req, res) => {
  const { year = Number(todayTh().slice(0, 4)) } = parse(
    z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
    { year: req.query.year },
  )
  const branchId = branchFilter(req)
  const warnings = []
  const [salesRows, expenseRows, pending] = await Promise.all([
    run(db.rpc('report_monthly_sales', { p_year: year, p_branch: branchId })),
    run(db.rpc('report_monthly_expenses', { p_year: year, p_branch: branchId })),
    pendingRefunds({ from: `${year}-01-01`, to: `${year}-12-31`, branchId }, warnings),
  ])

  const branchIds = [...new Set([...salesRows, ...expenseRows, ...pending].map((r) => r.branch_id))].sort()
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
      // เงินที่คืนลูกค้า (จ่ายคืนแล้ว + อนุมัติแล้วรอจ่ายคืน) นับเป็นรายจ่าย (หมวด refund) · รายรับ = ยอดขายก่อนหักคืน
      const approved = pending.filter((a) => a.branch_id === b && monthTh(a.decided_at) === i + 1).reduce((sum, a) => sum + Number(a.amount), 0)
      const revenue = round2(Number(s?.sales ?? 0))
      const refund = round2(Number(s?.refunds ?? 0) + approved)
      const total = round2(e.total + refund)
      return { month: monthKey(i + 1), revenue, expenses: total, expenses_by_category: { ...e.by_category, refund }, profit: round2(revenue - total) }
    })
    return { branch_id: b, months, total: months.reduce(add, zero) }
  })
  const totals_by_month = Array.from({ length: 12 }, (_, i) => ({
    month: monthKey(i + 1),
    ...branches.reduce((acc, br) => add(acc, br.months[i]), zero),
  }))

  send(res, { year, branch_id: branchId, branches, totals_by_month, total: totals_by_month.reduce(add, zero), warnings })
})

export default router
