// =====================================================================
// access.config.js — ที่เดียวที่กำหนด "ใครทำอะไรได้" ของ gateway (Dev 1)
//
//   1) CLAIMS        claim ไหนใน JWT ที่เชื่อถือได้
//   2) ROLES         role ที่ระบบรู้จัก + กติกาสาขาของแต่ละ role
//   3) principal     แปลง JWT → ผู้ใช้ (ไม่มี role ที่รู้จัก = null → 403 ทุก route)
//   4) headers       ตัวสร้าง X-User-* / X-Branch-Id ที่ส่งต่อให้ service
//   5) SERVICES      prefix → service + ตารางสิทธิ์ { method, path, roles }
//
// หลักการ: ปฏิเสธไว้ก่อน (deny by default)
//   - JWT ถูกต้องอย่างเดียวไม่พอ ต้องมี role ที่ระบบกำหนดให้ และ route ต้องอยู่ในตาราง
//   - route ที่ไม่อยู่ในตาราง = 403 แม้เป็น owner
//
// เฟส 2 (เพิ่มลูกค้า) แก้แค่ไฟล์นี้:
//   - ROLES เพิ่ม customer: { branchScope: 'none', claims: { customerId: 'customer_id' } }
//   - identityHeaders เพิ่ม 'X-Customer-Id'
//   - ใส่ 'customer' ใน roles ของ route membership/coupon ที่ลูกค้าใช้ได้เท่านั้น
//   route POS เดิมไม่มี 'customer' อยู่แล้ว → ลูกค้าเข้า POS ไม่ได้โดยอัตโนมัติ
// =====================================================================

// ---------------------------------------------------------------------
// 1) claim ที่เชื่อถือได้
// ---------------------------------------------------------------------
// role และสาขามาจาก identity1.profiles เท่านั้น: custom access token hook
// (supabase/migrations/20261119000000_identity1.sql) อ่าน profiles แล้วใส่ลง JWT ตอนออก token
// ผู้ใช้แก้ claim ระดับบนสุดเองไม่ได้ (เหมือน app_metadata)
// ห้ามอ่าน role จาก user_metadata เด็ดขาด เพราะผู้ใช้แก้เองได้ด้วย supabase.auth.updateUser()
export const CLAIMS = {
  userId: 'sub',
  role: 'user_role',
  branchId: 'branch_id',
}

/** Supabase ใส่ role = 'authenticated' ให้ token ของผู้ใช้ที่ login (anon key จะเป็น 'anon') */
export const REQUIRED_SUPABASE_ROLE = 'authenticated'

// ---------------------------------------------------------------------
// 2) role ที่ระบบรู้จัก
// ---------------------------------------------------------------------
// branchScope:
//   'own' → ใช้สาขาจาก JWT เสมอ ไม่สน branch_id ที่ client ส่ง · token ไม่มีสาขา = 403 (1.3)
//   'any' → ไม่มีสาขาประจำ ส่ง ?branch_id= เพื่อดูสาขาเดียว ไม่ส่ง = ทุกสาขา (1.4)
export const ROLES = {
  staff: { branchScope: 'own' },
  manager: { branchScope: 'own' },
  owner: { branchScope: 'any' },
}

const S = 'staff'
const M = 'manager'
const O = 'owner'
const SM = [S, M]
const MO = [M, O]
const SMO = [S, M, O]

// ---------------------------------------------------------------------
// 3) JWT → principal
// ---------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v)

/**
 * คืน { userId, role, branchId } หรือ null ถ้า token ไม่มี role ที่ระบบกำหนด
 * null เมื่อ: ไม่ใช่ token ผู้ใช้ (anon/service), ไม่มี profile (ไม่มี user_role),
 *             role ไม่รู้จัก, หรือ role ที่ต้องมีสาขาแต่ไม่มี branch_id
 */
export function principalFromClaims(claims) {
  if (!claims || claims.role !== REQUIRED_SUPABASE_ROLE) return null

  const userId = claims[CLAIMS.userId]
  const role = claims[CLAIMS.role]
  if (!isUuid(userId) || typeof role !== 'string' || !Object.hasOwn(ROLES, role)) return null

  const def = ROLES[role]
  const branchId = claims[CLAIMS.branchId] ?? null
  if (def.branchScope === 'own' && !isUuid(branchId)) return null

  return { userId, role, branchId: def.branchScope === 'own' ? branchId : null }
}

/** สาขาที่ request นี้ทำงานได้ ('' = ทุกสาขา) — branch scope (1.3, 1.4) */
export function resolveBranch(principal, query) {
  const def = ROLES[principal.role]
  if (def.branchScope === 'own') return principal.branchId
  if (def.branchScope === 'any') {
    const requested = query?.branch_id
    return isUuid(requested) ? requested : ''
  }
  return ''
}

// ---------------------------------------------------------------------
// 4) header ที่ส่งต่อให้ service
// ---------------------------------------------------------------------
/** header ตัวตนผู้ใช้ — service เชื่อเฉพาะเมื่อ X-Internal-Key ถูก */
export function identityHeaders(principal, branchId) {
  if (!principal) return {}
  return {
    'X-User-Id': principal.userId,
    'X-User-Role': principal.role,
    'X-Branch-Id': branchId || '',
  }
}

/**
 * header ที่ gateway เป็นคนใส่เท่านั้น — ลบของที่ client ส่งมาทิ้งก่อนเสมอ
 * ใช้ prefix เพื่อให้ header ใหม่ (เช่น X-Customer-Id เฟส 2) ถูกลบด้วยโดยไม่ต้องจำมาแก้
 */
export const TRUSTED_HEADER_PREFIXES = ['x-user-', 'x-branch-', 'x-customer-', 'x-internal-']

// ---------------------------------------------------------------------
// 5) service + ตารางสิทธิ์ (ตามข้อ 4 ในเอกสาร/pos-crm-phase1-spec.md)
// ---------------------------------------------------------------------
// route: [method, path, roles, options?]
//   options.stream = true → ไม่ตัด timeout (SSE)
// public: [method, path, options?] — ไม่ต้องมี token
//   options.rateLimit = 'auth' → จำกัด 10 ครั้ง/นาที/IP
export const SERVICES = [
  {
    name: 'identity',
    prefix: '/api/v1/identity',
    targetEnv: 'IDENTITY_URL',
    defaultTarget: 'http://identity:3001',
    public: [
      ['POST', '/auth/login', { rateLimit: 'auth' }],
      ['POST', '/auth/refresh', { rateLimit: 'auth' }],
    ],
    routes: [
      ['POST', '/auth/logout', SMO],
      ['GET', '/me', SMO],
      ['GET', '/branches', SMO],
      ['POST', '/branches', [O]],
      ['PATCH', '/branches/:id', [O]],
      ['DELETE', '/branches/:id', [O]],
      ['GET', '/roles', MO],
      ['GET', '/users', MO],
      ['POST', '/users', [O]],
      ['PATCH', '/users/:id', [O]],
      ['DELETE', '/users/:id', [O]],
    ],
  },
  {
    name: 'catalog',
    prefix: '/api/v1/catalog',
    targetEnv: 'CATALOG_URL',
    defaultTarget: 'http://catalog:3002',
    routes: [
      ['GET', '/categories', SMO],
      ['POST', '/categories', [O]],
      ['PATCH', '/categories/:id', [O]],
      ['GET', '/menus', SMO],
      ['GET', '/menus/:id', SMO],
      ['POST', '/menus', MO],
      ['PATCH', '/menus/:id', MO],
      ['DELETE', '/menus/:id', MO],
      ['POST', '/menus/:id/copy', [O]],
      ['PATCH', '/menus/:id/availability', SMO],
      ['PUT', '/menus/:id/option-groups', MO],
      ['GET', '/option-groups', SMO],
      ['POST', '/option-groups', MO],
      ['PATCH', '/option-groups/:id', MO],
      ['POST', '/option-groups/:id/options', MO],
      ['PATCH', '/options/:id', MO],
      ['GET', '/stocks', MO],
      ['PATCH', '/stocks/:menuId', MO],
    ],
  },
  {
    name: 'pos',
    prefix: '/api/v1/pos',
    targetEnv: 'POS_URL',
    defaultTarget: 'http://pos:3003',
    routes: [
      ['GET', '/tables', SMO],
      ['POST', '/tables', MO],
      ['PATCH', '/tables/:id', MO],
      ['POST', '/orders', SMO],
      ['GET', '/orders', SMO],
      ['GET', '/orders/:id', SMO],
      ['POST', '/orders/:id/tables/move', SMO],
      ['POST', '/orders/:id/tables/merge', SMO],
      ['POST', '/orders/:id/tickets', SMO],
      ['POST', '/orders/:id/request-payment', SMO],
      ['POST', '/orders/:id/cancel', SMO],
      ['POST', '/orders/:id/items/:itemId/cancel', SMO],
      ['GET', '/kitchen/tickets', SM],
      ['PATCH', '/kitchen/tickets/:id', SM],
      ['POST', '/orders/:id/approvals', [S]],
      ['GET', '/approvals', SMO],
      ['GET', '/approvals/stream', MO, { stream: true }],
      ['POST', '/approvals/:id/approve', MO],
      ['POST', '/approvals/:id/reject', MO],
    ],
  },
  {
    name: 'payment',
    prefix: '/api/v1/payment',
    targetEnv: 'PAYMENT_URL',
    defaultTarget: 'http://payment:3004',
    routes: [
      ['POST', '/payments', SMO], // owner คิดเงินจากผังโต๊ะได้
      ['POST', '/refunds', SMO], // owner บันทึกคืนเงินตอนกดอนุมัติ
      ['GET', '/refunds/approved', SM],
      ['GET', '/orders', SM],
      ['GET', '/orders/:id', SMO],
      ['GET', '/payments', MO],
      ['GET', '/expenses', MO],
      ['POST', '/expenses', MO],
      ['PATCH', '/expenses/:id', MO],
      ['DELETE', '/expenses/:id', MO],
      ['GET', '/reports/stream', MO, { stream: true }], // SSE แดชบอร์ด realtime (รับเงิน/คืนเงิน/รายจ่าย)
      ['GET', '/reports/daily', MO],
      ['GET', '/reports/branches', [O]],
      ['GET', '/reports/profit', [O]],
    ],
  },
]
