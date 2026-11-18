import { getMenu, setMenuOptionGroups } from '../../api/catalog'

// เมนูไหนผูกกับกลุ่มตัวเลือกไหน (1.18) — ใช้ในหน้าจัดการเมนูและหน้ากลุ่มตัวเลือก
// GET /catalog/menus ไม่ส่งกลุ่มมา จึงเรียก GET /catalog/menus/:id ทีละเมนู (พร้อมกันไม่เกิน 6)
// ถ้าเมนูเยอะมากควรให้ catalog เพิ่ม ?with=option_groups ในรายการเมนูแทน

const CONCURRENCY = 6

/** → Map(menuId → [{ id, name }]) เรียงตามลำดับที่ผูก */
export async function loadMenuGroupLinks(menus) {
  const links = new Map()
  const queue = [...menus]
  async function worker() {
    while (queue.length) {
      const m = queue.shift()
      try {
        const detail = await getMenu(m.id)
        links.set(
          m.id,
          (detail.option_groups || []).map((g) => ({ id: g.id, name: g.name })),
        )
      } catch {
        links.set(m.id, [])
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
  return links
}

/** แทนที่กลุ่มทั้งชุดของเมนู (ลำดับตาม array) */
export const saveMenuGroups = (menuId, groupIds) =>
  setMenuOptionGroups(
    menuId,
    groupIds.map((id, i) => ({ option_group_id: id, sort_order: i + 1 })),
  )
