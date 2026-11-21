-- เพิ่มวิธีชำระ "บัตรเครดิต/เดบิต" (card) ให้ทุกสาขา
-- แยกไฟล์จาก 20261121000100 เพราะค่า enum ใหม่ใช้ใน transaction เดียวกับที่เพิ่มไม่ได้
-- รันซ้ำได้

alter type payment.payment_method add value if not exists 'card';
alter type pos.payment_method add value if not exists 'card';
