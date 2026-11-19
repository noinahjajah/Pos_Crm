// /approvals — คำขอส่วนลด/คืนเงิน: ดูรายการ แจ้งเตือน realtime อนุมัติ/ปฏิเสธ (1.29–1.31)
// การส่งคำขออยู่ที่ POST /orders/:id/approvals (orders.js)
import { Router } from 'express'
import { db, rpc, run } from './db.js'
import { approvalStream, publishApproval } from './events.js'
import { allow, branchFilter, idParam, mustBeMyBranch, parse, send, uuid, z } from './helpers.js'
import { APPROVAL_FULL, loadApproval, toApprovals } from './views.js'

const listSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  type: z.enum(['discount', 'refund']).optional(),
  order_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})
const decideSchema = z.object({ note: z.string().trim().max(200).nullish() })

const router = Router()

// GET /approvals?status=&type=&order_id= — staff เห็นเฉพาะของตัวเอง · manager ของสาขา · owner ทุกสาขา (หรือ ?branch_id=)
router.get('/', allow('staff', 'manager', 'owner'), async (req, res) => {
  const q = parse(listSchema, req.query)
  let query = db.from('approvals').select(APPROVAL_FULL).order('requested_at', { ascending: false }).limit(q.limit)
  if (req.user.role === 'staff') query = query.eq('requested_by', req.user.id)
  const branchId = branchFilter(req)
  if (branchId) query = query.eq('branch_id', branchId)
  if (q.status) query = query.eq('status', q.status)
  if (q.type) query = query.eq('type', q.type)
  if (q.order_id) query = query.eq('order_id', q.order_id)
  const rows = await toApprovals(await run(query))
  send(res, rows, { meta: { total: rows.length } })
})

// GET /approvals/stream — SSE แจ้งคำขอใหม่/เปลี่ยนสถานะ (gateway ไม่ตัด timeout ให้ route นี้)
router.get('/stream', allow('manager', 'owner'), approvalStream)

async function decide(req, res, status) {
  const { id } = parse(idParam, req.params)
  const { note } = parse(decideSchema, req.body)
  const before = await loadApproval(id)
  mustBeMyBranch(req, before.branch_id)
  await rpc('decide_approval', { p_approval_id: id, p_status: status, p_actor: req.user.id, p_note: note ?? null })
  const approval = await loadApproval(id)
  publishApproval(approval)
  send(res, approval)
}

// POST /approvals/:id/approve · /reject { note? } — บันทึกผู้ตัดสินและเวลา (1.31) · ส่วนลดเข้าบิลทันที (1.30)
router.post('/:id/approve', allow('manager', 'owner'), (req, res) => decide(req, res, 'approved'))
router.post('/:id/reject', allow('manager', 'owner'), (req, res) => decide(req, res, 'rejected'))

export default router
