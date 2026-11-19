import { thaiDateTime } from '../../lib/format'
import PrintSlip from './PrintSlip'

// ใบออร์เดอร์เข้าครัว (1.10): โต๊ะ เวลา รายการ ตัวเลือก หมายเหตุ — ไม่มีราคา
// ข้อมูลมาจาก POST /pos/orders/:id/tickets หรือ GET /pos/kitchen/tickets (Dev 3)
//
// ticket: {
//   round_no, created_at | printed_at, order_no?, tables?: [{ table_no }] | ['A1'], table_no?,
//   guest_count?, created_by_name?,
//   items: [{ menu_name, quantity, note?, options?: [{ option_name | name }] }]
// }
// order (ถ้ามี) ใช้เติม order_no / tables / guest_count ที่ ticket ไม่มี

const tableText = (src) =>
  (src?.tables || [])
    .map((t) => (typeof t === 'string' ? t : t.table_no))
    .filter(Boolean)
    .join(', ') ||
  src?.table_no ||
  ''

export default function KitchenTicketPrint({ ticket, order, branchName, ...slipProps }) {
  const tables = tableText(ticket) || tableText(order) || '-'
  const orderNo = ticket.order_no || order?.order_no
  const guests = ticket.guest_count ?? order?.guest_count
  const items = ticket.items || []
  const totalQty = items.reduce((s, it) => s + Number(it.quantity || 0), 0)

  return (
    <PrintSlip label="ใบออร์เดอร์เข้าครัว" {...slipProps}>
      <div className="ps-center">
        {branchName && <div className="ps-small">{branchName}</div>}
        <div className="ps-title">ใบสั่งอาหาร</div>
      </div>

      <div className="ps-table-no">
        <span>โต๊ะ</span>
        <strong>{tables}</strong>
      </div>

      <dl className="ps-meta">
        {ticket.round_no != null && (
          <div>
            <dt>รอบที่</dt>
            <dd>{ticket.round_no}</dd>
          </div>
        )}
        {orderNo && (
          <div>
            <dt>บิล</dt>
            <dd>{orderNo}</dd>
          </div>
        )}
        <div>
          <dt>เวลา</dt>
          <dd>{thaiDateTime(ticket.printed_at || ticket.created_at || new Date())}</dd>
        </div>
        {guests != null && (
          <div>
            <dt>ลูกค้า</dt>
            <dd>{guests} คน</dd>
          </div>
        )}
        {ticket.created_by_name && (
          <div>
            <dt>ผู้สั่ง</dt>
            <dd>{ticket.created_by_name}</dd>
          </div>
        )}
      </dl>

      <hr className="ps-rule" />

      <ul className="ps-kitchen-items">
        {items.map((it, i) => (
          <li key={it.id || i}>
            <div className="ps-kitchen-line">
              <span className="ps-qty">{it.quantity}×</span>
              <span className="ps-name">{it.menu_name}</span>
            </div>
            {(it.options || []).length > 0 && (
              <div className="ps-options">+ {it.options.map((o) => o.option_name || o.name).join(', ')}</div>
            )}
            {it.note && <div className="ps-note">** {it.note}</div>}
          </li>
        ))}
      </ul>

      <hr className="ps-rule" />
      <div className="ps-row ps-small">
        <span>{items.length} รายการ</span>
        <span>รวม {totalQty} ที่</span>
      </div>
    </PrintSlip>
  )
}
