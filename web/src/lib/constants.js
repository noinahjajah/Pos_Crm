// ค่าคงที่ที่ใช้ทั้งแอป

export const ROLES = { STAFF: 'staff', MANAGER: 'manager', OWNER: 'owner' }

export const ROLE_LABELS = {
  staff: 'พนักงานหน้าร้าน',
  manager: 'ผู้จัดการ',
  owner: 'เจ้าของร้าน',
}

/** หน้าแรกหลัง login / เมื่อเข้าหน้าที่ไม่มีสิทธิ์ */
export const HOME_BY_ROLE = {
  staff: '/tables',
  manager: '/tables',
  owner: '/admin/reports',
}

export const BRANCH_TYPES = [
  { value: 'restaurant', label: 'ร้านอาหาร' },
  { value: 'drinks', label: 'ร้านเครื่องดื่ม' },
  { value: 'bar', label: 'บาร์' },
]

export const TABLE_STATUS = {
  available: 'ว่าง',
  occupied: 'มีลูกค้า',
  waiting_payment: 'รอชำระ',
}

export const ORDER_STATUS = {
  open: 'เปิดบิล',
  waiting_payment: 'รอชำระ',
  paid: 'ชำระแล้ว',
  refunded: 'คืนเงินแล้ว',
}

export const VAT_RATE = 0.07
