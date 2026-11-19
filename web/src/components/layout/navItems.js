// เมนูข้างตาม role (1.2) — ให้ตรงกับ role ของแต่ละ path ใน app/router.jsx
// S = staff, M = manager, O = owner

const O = 'owner'
const SM = ['staff', 'manager']
const MO = ['manager', 'owner']
const SMO = ['staff', 'manager', 'owner']

export const NAV_SECTIONS = [
  {
    title: 'หน้าร้าน',
    items: [
      { to: '/tables', label: 'ผังโต๊ะ', icon: '▦', roles: SMO },
      // { to: '/kitchen', label: 'จอครัว', icon: '♨', roles: SM }, // ยังไม่เปิดใช้
      { to: '/cashier', label: 'คิดเงิน', icon: '฿', roles: SM },
      { to: '/refunds/request', label: 'ขอคืนเงิน', icon: '↺', roles: ['staff'] },
      { to: '/menus/availability', label: 'เปิด/ปิดขายเมนู', icon: '◉', roles: SM },
      { to: '/approvals', label: 'คำขออนุมัติ', icon: '✓', roles: MO },
    ],
  },
  {
    title: 'หลังร้าน',
    items: [
      { to: '/admin/reports', label: 'แดชบอร์ด', icon: '▤', roles: MO },
      { to: '/admin/profit', label: 'กำไร-ขาดทุน', icon: '↗', roles: [O] },
      { to: '/admin/menus', label: 'เมนู', icon: '☰', roles: MO, end: true },
      { to: '/admin/menus/option-groups', label: 'กลุ่มตัวเลือก', icon: '◇', roles: MO },
      { to: '/admin/menus/categories', label: 'หมวดหมู่', icon: '◫', roles: [O] },
      { to: '/admin/stocks', label: 'สต็อก', icon: '▣', roles: MO },
      { to: '/admin/payments', label: 'รายการรับเงิน', icon: '≡', roles: MO },
      { to: '/admin/expenses', label: 'รายจ่าย', icon: '฿', roles: MO },
      { to: '/admin/users', label: 'ผู้ใช้', icon: '☺', roles: MO },
      { to: '/admin/branches', label: 'สาขา', icon: '⌂', roles: [O] },
    ],
  },
]

/** เมนูที่ role นี้เห็น (ตัดหัวข้อที่ไม่มีเมนูเหลือ) */
export function navFor(role) {
  return NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => i.roles.includes(role)) })).filter(
    (s) => s.items.length > 0,
  )
}
