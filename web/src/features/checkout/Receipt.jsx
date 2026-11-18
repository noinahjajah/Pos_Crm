import { useCallback, useState } from 'react'
import ReceiptPrint from '../../components/print/ReceiptPrint'
import { tableLabel, thb2 } from './checkoutUtils'

// หลังรับเงินสำเร็จ (1.23, 1.26): สรุปการชำระ + ตัวอย่างใบเสร็จ (ใบพิมพ์ของ Dev 1) · พิมพ์ใบเสร็จได้

const METHOD = { cash: 'เงินสด', promptpay: 'PromptPay' }

export default function Receipt({ order, payment, changeAmount, branchName, staffName, onDone }) {
  const [printing, setPrinting] = useState(false)
  const donePrinting = useCallback(() => setPrinting(false), [])
  const pay = { cashier_name: staffName, change_amount: changeAmount, ...payment }

  return (
    <div className="pos-success-layout">
      <section className="pos-panel pos-success">
        <div className="pos-success-icon" aria-hidden="true">
          ✓
        </div>
        <h2 className="pos-success-title">ชำระเงินสำเร็จ</h2>
        <p className="pos-muted" style={{ margin: '0 0 16px' }}>
          โต๊ะ {tableLabel(order)} ปิดแล้ว และกลับเป็นสถานะ “ว่าง” ในผังโต๊ะ (1.26)
        </p>
        {payment.order_status_synced === false && (
          <p className="pos-note is-warn">บันทึกเงินแล้ว ระบบกำลังอัปเดตสถานะโต๊ะ (ลองใหม่อัตโนมัติ)</p>
        )}

        <div className="pos-infobox">
          <div>
            <span>วิธีชำระ</span>
            <strong>{METHOD[payment.method] || payment.method}</strong>
          </div>
          <div>
            <span>ยอดสุทธิ</span>
            <strong>{thb2(payment.amount)}</strong>
          </div>
          {payment.method === 'cash' && (
            <>
              <div>
                <span>รับเงิน</span>
                <strong>{thb2(payment.cash_received)}</strong>
              </div>
              <div>
                <span>เงินทอน</span>
                <strong>{thb2(changeAmount)}</strong>
              </div>
            </>
          )}
        </div>

        <div className="pos-side-actions" style={{ marginTop: 16, justifyContent: 'flex-start' }}>
          <button type="button" className="pos-btn" onClick={() => setPrinting(true)}>
            พิมพ์ใบเสร็จ
          </button>
          {onDone && (
            <button type="button" className="pos-btn pos-btn-primary" onClick={onDone}>
              กลับไปหน้าโต๊ะ
            </button>
          )}
        </div>
      </section>

      <aside className="pos-receipt-preview" aria-label="ตัวอย่างใบเสร็จ">
        <ReceiptPrint order={order} payment={pay} branch={branchName ? { name: branchName } : null} preview />
      </aside>

      {printing && (
        <ReceiptPrint order={order} payment={pay} branch={branchName ? { name: branchName } : null} autoPrint onAfterPrint={donePrinting} />
      )}
    </div>
  )
}
