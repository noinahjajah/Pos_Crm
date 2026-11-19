// คุยกับ catalog (Dev 2) ผ่าน internal API · ไม่ผ่าน gateway ต้องมี X-Internal-Key
//   POST /internal/menus/lookup    ชื่อ/ราคาเมนูและตัวเลือก (snapshot)
//   POST /internal/stocks/deduct   ตัดสต็อกตอนสั่ง
//   POST /internal/stocks/restore  คืนสต็อกเมื่อบันทึกการสั่งไม่สำเร็จ
import { AppError } from './helpers.js'

const CATALOG_URL = process.env.CATALOG_URL || 'http://localhost:3002'

async function call(path, body) {
  let res
  try {
    res = await fetch(`${CATALOG_URL}/internal${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Key': process.env.INTERNAL_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    throw new AppError(502, 'CATALOG_UNAVAILABLE', 'ติดต่อระบบเมนู (catalog) ไม่ได้')
  }
  const json = await res.json().catch(() => ({}))
  if (res.status >= 500) throw new AppError(502, 'CATALOG_ERROR', 'ระบบเมนู (catalog) ตอบผิดพลาด')
  if (!res.ok) throw new AppError(res.status, json.error?.code || 'CATALOG_ERROR', json.error?.message || 'ระบบเมนูปฏิเสธคำขอ', json.error?.details)
  return json.data
}

export const catalog = {
  lookup: (branchId, items) => call('/menus/lookup', { branch_id: branchId, items }),
  deduct: (branchId, items, reference) => call('/stocks/deduct', { branch_id: branchId, items, reference }),
  restore: (branchId, reference) => call('/stocks/restore', { branch_id: branchId, reference }),
}
