// รูปแบบ error มาตรฐาน { error: { code, message, details }, request_id }

export class GatewayError extends Error {
  constructor(status, code, message, details = []) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function sendError(req, res, status, code, message, details = []) {
  if (res.headersSent) return res.destroy()
  res.status(status).json({ error: { code, message, details }, request_id: req.id })
}

/** middleware สุดท้าย — แปลงทุก error เป็นรูปแบบมาตรฐาน */
export function errorFormat(err, req, res, _next) {
  if (err instanceof GatewayError) return sendError(req, res, err.status, err.code, err.message, err.details)
  req.log?.error?.(err)
  sendError(req, res, 500, 'INTERNAL_ERROR', 'เกิดข้อผิดพลาดในระบบ')
}
