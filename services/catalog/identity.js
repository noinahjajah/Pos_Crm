// คุยกับ identity ผ่าน internal API — สาขาทั้งหมดอ้างอิงจาก identity1.branches
import { AppError, badRequest, branchForCreate } from './helpers.js'

const IDENTITY_URL = (process.env.IDENTITY_URL || 'http://localhost:3001').replace(/\/$/, '')

/** สาขาต้องมีจริงและยังเปิดใช้ ไม่งั้น 400 · ติดต่อ identity ไม่ได้ → 502 */
export async function mustBeActiveBranch(branchId, field = 'branch_id') {
  let res
  try {
    res = await fetch(`${IDENTITY_URL}/internal/branches/${branchId}`, {
      headers: { 'X-Internal-Key': process.env.INTERNAL_KEY },
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    throw new AppError(502, 'IDENTITY_UNAVAILABLE', 'ตรวจสอบสาขาไม่ได้ กรุณาลองใหม่')
  }
  const invalid = () => badRequest('สาขาไม่ถูกต้องหรือถูกปิดใช้', [{ field, message: 'ไม่พบสาขานี้ในระบบ' }])
  if (res.status === 404) throw invalid()
  if (!res.ok) throw new AppError(502, 'IDENTITY_ERROR', 'ตรวจสอบสาขาไม่ได้ กรุณาลองใหม่')
  const { data } = await res.json()
  if (!data?.is_active) throw invalid()
}

/** สาขาสำหรับสร้างข้อมูล · staff/manager ใช้สาขาจาก token · owner เลือกเอง จึงต้องตรวจกับ identity */
export async function branchForWrite(req, requested) {
  const branchId = branchForCreate(req, requested)
  if (req.user.role === 'owner') await mustBeActiveBranch(branchId)
  return branchId
}
