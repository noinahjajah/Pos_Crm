-- เปลี่ยนชื่อวิธีชำระ card → credit_card ให้อ่านชัดว่า "จ่ายด้วยบัตรเครดิต" (รวมบัตรเดบิตที่รูดผ่าน EDC)
-- rows เดิมที่เป็น card เปลี่ยนตามอัตโนมัติ · constraint ใช้ enum เดิมจึงไม่ต้องแก้ · รันซ้ำได้

do $$ begin
  if exists (select 1 from pg_enum where enumtypid = 'payment.payment_method'::regtype and enumlabel = 'card') then
    alter type payment.payment_method rename value 'card' to 'credit_card';
  end if;
  if exists (select 1 from pg_enum where enumtypid = 'pos.payment_method'::regtype and enumlabel = 'card') then
    alter type pos.payment_method rename value 'card' to 'credit_card';
  end if;
end $$;

notify pgrst, 'reload schema';
