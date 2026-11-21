-- ชำระด้วยบัตรเครดิต/เดบิตผ่านเครื่อง EDC ของธนาคาร (แยกจากระบบ)
-- พนักงานรูดบัตรที่ EDC → กรอกเลขท้ายบัตร 4 หลัก + รหัสอนุมัติ (Approval code) จากสลิป EDC → บันทึกรับเงิน
-- ไม่เก็บเลขบัตรเต็ม · รันซ้ำได้

alter table payment.payments add column if not exists card_last4 text;
alter table payment.payments add column if not exists card_approval_code text;

-- เงินสด (รับเงิน) ต้องมี cash_received/change_amount · วิธีอื่นและการคืนเงินต้องไม่มี
alter table payment.payments drop constraint if exists payments_cash_fields;
alter table payment.payments add constraint payments_cash_fields check (
  method = 'cash'::payment.payment_method and type = 'charge'::payment.payment_type
    and cash_received is not null and change_amount is not null and cash_received = (amount + change_amount)
  or (method <> 'cash'::payment.payment_method or type = 'refund'::payment.payment_type)
    and cash_received is null and change_amount is null
);

-- บัตร (รับเงิน) ต้องมีเลขท้าย 4 หลัก + รหัสอนุมัติ · รายการอื่นต้องไม่มี
alter table payment.payments drop constraint if exists payments_card_fields;
alter table payment.payments add constraint payments_card_fields check (
  method = 'card'::payment.payment_method and type = 'charge'::payment.payment_type
    and card_last4 is not null and card_approval_code is not null
    and card_last4 ~ '^[0-9]{4}$' and card_approval_code ~ '^[A-Z0-9]{4,12}$'
  or not (method = 'card'::payment.payment_method and type = 'charge'::payment.payment_type)
    and card_last4 is null and card_approval_code is null
);

-- ให้ PostgREST (Supabase API) รู้จักคอลัมน์ใหม่ทันที
notify pgrst, 'reload schema';
