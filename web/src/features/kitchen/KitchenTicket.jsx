// ใบออร์เดอร์เข้าครัว 80 มม. (พิมพ์ได้)

import { time } from '../../lib/format.js'

export function KitchenTicket({ ticket, printTarget = false }) {
  const totalQty = ticket.items.reduce((s, i) => s + i.quantity, 0)
  return (
    <div className={`slip ${printTarget ? 'print-target' : ''}`}>
      <div className="center title">*** ใบสั่งอาหารเข้าครัว ***</div>
      <div className="center big">โต๊ะ {ticket.table_names.join(' + ')}</div>
      <div className="center">
        รอบที่ {ticket.round} · {ticket.ticket_no}
      </div>
      <hr />
      <div className="row">
        <span>เวลา</span>
        <span>{time(ticket.created_at)}</span>
      </div>
      {ticket.staff_name && (
        <div className="row">
          <span>พนักงาน</span>
          <span>{ticket.staff_name}</span>
        </div>
      )}
      {ticket.guest_count != null && (
        <div className="row">
          <span>จำนวนลูกค้า</span>
          <span>{ticket.guest_count} ท่าน</span>
        </div>
      )}
      <hr />
      {ticket.items.map((item, i) => (
        <div key={i}>
          <div className="k-item">
            <span className="qty">{item.quantity} x</span>
            <span>{item.name}</span>
          </div>
          <div className="indent">
            {(item.options || []).map((o, j) => (
              <div key={j} className="k-opt">
                + {o.name}
              </div>
            ))}
            {item.note && <div className="k-note">** {item.note} **</div>}
          </div>
        </div>
      ))}
      <hr />
      <div className="center">
        รวม {ticket.items.length} รายการ / {totalQty} ที่
      </div>
    </div>
  )
}
