// ค่าคงที่ที่ใช้ทั้งเว็บ: role, ป้ายชื่อ, สี, เมนูตาม role

export const ROLES = { STAFF: 'staff', MANAGER: 'manager', OWNER: 'owner' }
export const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', staff: 'Staff' }
export const ROLE_TONE = { owner: 'phase', manager: 'info', staff: 'neutral' }
export const AVATAR_COLOR = { owner: '#6b3fd6', manager: '#2e6b5a', staff: '#8a857c' }
export const BRANCH_TYPE_LABEL = { restaurant: 'ร้านอาหาร', drinks: 'เครื่องดื่ม', bar: 'บาร์' }

// เมนูด้านซ้ายตาม role
export const MENU = [
  { path: '/dashboard', label: 'แดชบอร์ด', labelByRole: { owner: 'ภาพรวมทุกสาขา', manager: 'แดชบอร์ดสาขา' }, roles: ['manager', 'owner'], dev: 'dev2', reqs: '1.34–1.37' },
  { path: '/menus', label: 'จัดการเมนู', roles: ['manager', 'owner'], dev: 'dev2', reqs: '1.14' },
  { path: '/categories', label: 'หมวดหมู่', roles: ['manager', 'owner'], dev: 'dev2', reqs: '1.14' },
  { path: '/option-groups', label: 'กลุ่มตัวเลือก', roles: ['manager', 'owner'], dev: 'dev2', reqs: '1.16–1.18' },
  { path: '/stocks', label: 'สต็อก', roles: ['manager', 'owner'], dev: 'dev2', reqs: '1.19–1.22' },
  { path: '/menu-availability', label: 'เปิด/ปิดขายเมนู', roles: ['staff'], dev: 'dev2', reqs: '1.15' },
  { path: '/expenses', label: 'รายจ่าย', roles: ['manager', 'owner'], dev: 'dev2', reqs: '1.32–1.33' },

  { path: '/branches', label: 'จัดการสาขา', roles: ['owner'], dev: 'dev1' },
  { path: '/users', label: 'ผู้ใช้งาน', labelByRole: { manager: 'พนักงานในสาขา' }, roles: ['manager', 'owner'], dev: 'dev1' },

  { path: '/tables', label: 'ผังโต๊ะ', roles: ['staff', 'manager'], dev: 'dev3', reqs: '1.7–1.13' },
  { path: '/kitchen', label: 'จอครัว', roles: ['staff', 'manager'], dev: 'dev3', reqs: '1.9–1.10' },
  { path: '/checkout', label: 'รับเงิน', roles: ['staff', 'manager'], dev: 'dev2', reqs: '1.23–1.25', hidden: true }, // เปิดจากบิล: /checkout?order_id=...
  { path: '/approvals', label: 'คำขออนุมัติ', labelByRole: { staff: 'คำขอของฉัน' }, roles: ['staff', 'manager', 'owner'], dev: 'dev3', reqs: '1.27–1.31' },

  { path: '/print', label: 'ตัวอย่างใบพิมพ์', roles: ['staff', 'manager', 'owner'], dev: 'dev1' },
]

export const DEV_LABEL = { dev1: 'Dev 1', dev2: 'Dev 2', dev3: 'Dev 3' }

export function menuFor(role) {
  return MENU.filter((m) => !m.hidden && m.roles.includes(role)).map((m) => ({ ...m, label: m.labelByRole?.[role] ?? m.label }))
}

export const HOME_BY_ROLE = { owner: '/dashboard', manager: '/dashboard', staff: '/tables' }
