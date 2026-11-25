// ป้ายชื่อที่หน้าประวัติการขายและแดชบอร์ดใช้ร่วมกัน
export const TYPE_LABEL = { charge: 'รับเงิน', refund: 'คืนเงิน' }
export const METHOD_LABEL = { cash: 'เงินสด', promptpay: 'PromptPay', credit_card: 'บัตรเครดิต/เดบิต' }

export const dateTime = (value) => new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
