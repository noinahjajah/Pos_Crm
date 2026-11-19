// ส่ง request ต่อให้ service (stream body ตรง ๆ ไม่ parse)
// - ใส่ header จาก req.gw.forwardHeaders (สร้างใน app.js จาก access.config.js)
// - timeout 10 วินาที → 504 · ต่อ service ไม่ได้ → 502 (ยกเว้น route stream เช่น SSE)

import http from 'node:http'
import https from 'node:https'
import { sendError } from './errors.js'

// header ระหว่าง hop ที่ไม่ส่งต่อ
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
])

export function proxyTo({ timeoutMs }) {
  return (req, res) => {
    const { service, path, rule, forwardHeaders } = req.gw
    const target = new URL(service.target)
    const search = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''

    const headers = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(key)) headers[key] = value
    }
    headers['x-forwarded-for'] = [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ')
    headers['x-forwarded-host'] = req.headers.host || ''
    headers['x-forwarded-proto'] = req.protocol
    Object.assign(headers, lowerKeys(forwardHeaders))

    const client = target.protocol === 'https:' ? https : http
    let timedOut = false
    const upstream = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: `${target.pathname.replace(/\/$/, '')}${path}${search}`,
        headers,
      },
      (upRes) => {
        const outHeaders = {}
        for (const [key, value] of Object.entries(upRes.headers)) {
          if (!HOP_BY_HOP.has(key)) outHeaders[key] = value
        }
        res.writeHead(upRes.statusCode, outHeaders)
        upRes.pipe(res)
      },
    )

    if (!rule.options.stream) {
      upstream.setTimeout(timeoutMs, () => {
        timedOut = true
        upstream.destroy(new Error('upstream timeout'))
      })
    }

    upstream.on('error', (err) => {
      if (res.headersSent) return res.destroy()
      if (timedOut) return sendError(req, res, 504, 'UPSTREAM_TIMEOUT', `${service.name} ตอบช้าเกินไป`)
      req.log?.warn?.({ msg: 'upstream error', service: service.name, error: err.code || err.message })
      sendError(req, res, 502, 'UPSTREAM_UNAVAILABLE', `${service.name} ไม่พร้อมให้บริการ`)
    })

    // client ปิดก่อน (เช่น ปิดหน้า SSE) → ปิดฝั่ง service ด้วย
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy()
    })

    req.pipe(upstream)
  }
}

function lowerKeys(obj) {
  return Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k.toLowerCase(), v]))
}
