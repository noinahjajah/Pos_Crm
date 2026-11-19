import { tablesText } from '../../lib/posUtils'
import { Dialog } from '../../components/ui/posUi'

// หลังส่งเข้าครัว: แสดงตัวอย่างใบออร์เดอร์ที่พิมพ์ (1.10) · พิมพ์ซ้ำได้

const dateTime = (v) =>
  new Date(v || Date.now()).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function TicketSentDialog({ ticket, order, branchName, staffName, onPrint, onBack, onClose }) {
  const items = ticket.items || []
  const totalQty = items.reduce((s, it) => s + Number(it.quantity || 0), 0)
  const tables = ticket.tables?.length ? tablesText(ticket) : tablesText(order)

  return (
    <Dialog title="ส่งเข้าครัวแล้ว" subtitle="พิมพ์ใบออร์เดอร์ที่เครื่องพิมพ์ครัวทุกครั้งที่สั่ง (1.10)" onClose={onClose}>
      <div className="pos-ticket">
        <h3>ใบออร์เดอร์ครัว</h3>
        {branchName && <div className="pos-dialog-sub">{branchName}</div>}
        <div className="pos-ticket-meta">
          <div>
            <span>โต๊ะ</span>
            <strong>
              {tables} · รอบ {ticket.round_no}
            </strong>
          </div>
          <div>
            <span>เวลา</span>
            <span style={{ color: 'inherit' }}>{dateTime(ticket.printed_at || ticket.created_at)}</span>
          </div>
          <div>
            <span>พนักงาน</span>
            <span style={{ color: 'inherit' }}>{ticket.created_by_name || staffName || '—'}</span>
          </div>
        </div>
        <ul>
          {items.map((it, i) => (
            <li key={it.id || i}>
              <strong>
                {it.quantity}x {it.menu_name}
              </strong>
              {(it.options || []).length > 0 && (
                <div className="pos-ticket-sub">- {it.options.map((o) => o.option_name || o.name).join(', ')}</div>
              )}
              {it.note && <div className="pos-ticket-note">* {it.note}</div>}
            </li>
          ))}
        </ul>
        <div className="pos-ticket-foot">รวม {totalQty} รายการ</div>
      </div>

      <div className="pos-dialog-actions">
        <button type="button" className="pos-btn" onClick={onPrint}>
          พิมพ์ซ้ำ
        </button>
        <button type="button" className="pos-btn pos-btn-primary" onClick={onBack}>
          กลับไปผังโต๊ะ
        </button>
      </div>
    </Dialog>
  )
}
