// /expenses — รายจ่ายของแต่ละสาขา 4 หมวด (1.32, 1.33)
// manager บันทึกของสาขาตัวเอง · owner ดูทุกสาขาได้ และต้องเลือกสาขาตอนบันทึก
import { Router } from 'express'
import { db, run } from './db.js'
import {
  allow,
  atLeastOne,
  branchFilter,
  branchForCreate,
  dateRange,
  dateString,
  dbError,
  forbidden,
  idParam,
  mustBeMyBranch,
  notFound,
  parse,
  round2,
  send,
  uuid,
  z,
} from './helpers.js'

// labor = ค่าแรง · rent_utilities = ค่าเช่า/ค่าไฟ/ค่าน้ำ · ingredients = วัตถุดิบ · other = อื่นๆ
const category = z.enum(['labor', 'rent_utilities', 'ingredients', 'other'], {
  message: 'หมวดต้องเป็น labor, rent_utilities, ingredients หรือ other',
})
const amount = z
  .number({ invalid_type_error: 'ต้องเป็นตัวเลข' })
  .positive('ต้องมากกว่า 0')
  .max(10_000_000)
  .transform((v) => round2(v))
const note = z.string().trim().max(500).nullish().transform((v) => v || null)

const createSchema = z.object({ branch_id: uuid.optional(), category, amount, expense_date: dateString, note })
const updateSchema = z
  .object({
    branch_id: uuid.optional(),
    category: category.optional(),
    amount: amount.optional(),
    expense_date: dateString.optional(),
    note: note.optional(),
  })
  .refine(atLeastOne, 'ต้องส่งอย่างน้อย 1 ช่อง')

const toExpense = (e) => ({ ...e, amount: Number(e.amount) })

async function loadExpense(req, id) {
  const row = await run(db.from('expenses').select('*').eq('id', id).maybeSingle())
  if (!row) throw notFound('ไม่พบรายจ่าย', 'EXPENSE_NOT_FOUND')
  mustBeMyBranch(req, row.branch_id)
  return row
}

const router = Router()

// GET /expenses?from=&to=&category=&page=&limit= (ค่าเริ่มต้น = ต้นเดือนถึงวันนี้) · meta.sum = ยอดรวมทั้งช่วง
router.get('/', allow('manager', 'owner'), async (req, res) => {
  const { from, to } = dateRange(req.query)
  const q = parse(
    z.object({
      category: category.optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
    { category: req.query.category, page: req.query.page, limit: req.query.limit },
  )
  const branchId = branchFilter(req)

  const filter = (query) => {
    query = query.gte('expense_date', from).lte('expense_date', to)
    if (branchId) query = query.eq('branch_id', branchId)
    if (q.category) query = query.eq('category', q.category)
    return query
  }

  const { data, error, count } = await filter(db.from('expenses').select('*', { count: 'exact' }))
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range((q.page - 1) * q.limit, q.page * q.limit - 1)
  if (error) throw dbError(error)

  const amounts = await run(filter(db.from('expenses').select('amount')))
  const sum = round2(amounts.reduce((s, e) => s + Number(e.amount), 0))
  send(res, data.map(toExpense), { meta: { page: q.page, limit: q.limit, total: count ?? data.length, sum, from, to } })
})

// POST /expenses — manager สาขาตัวเอง · owner ต้องส่ง branch_id
router.post('/', allow('manager', 'owner'), async (req, res) => {
  const { branch_id, ...data } = parse(createSchema, req.body)
  const row = await run(
    db
      .from('expenses')
      .insert({ ...data, branch_id: branchForCreate(req, branch_id), created_by: req.user.id })
      .select()
      .single(),
  )
  send(res, toExpense(row), { status: 201 })
})

// PATCH /expenses/:id — manager แก้ได้เฉพาะสาขาตัวเอง และย้ายสาขาไม่ได้
router.patch('/:id', allow('manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const body = parse(updateSchema, req.body)
  const row = await loadExpense(req, id)
  if (body.branch_id && body.branch_id !== row.branch_id && req.user.role !== 'owner') {
    throw forbidden('ย้ายรายจ่ายไปสาขาอื่นได้เฉพาะ owner', 'FORBIDDEN_BRANCH')
  }
  send(res, toExpense(await run(db.from('expenses').update(body).eq('id', id).select().single())))
})

// DELETE /expenses/:id
router.delete('/:id', allow('manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  await loadExpense(req, id)
  await run(db.from('expenses').delete().eq('id', id))
  send(res, { id, deleted: true })
})

export default router
