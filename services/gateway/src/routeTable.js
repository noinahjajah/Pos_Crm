// แปลงตารางใน access.config.js เป็นตัวจับคู่ method + path
// ไม่มีตรรกะสิทธิ์ในไฟล์นี้ — แค่หาแถวที่ตรง

import { SERVICES } from './access.config.js'

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

function compile(path) {
  const pattern = path
    .split('/')
    .map((part) => (part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/')
  return new RegExp(`^${pattern}/?$`)
}

/**
 * services: SERVICES จาก config · targets: { identity: 'http://...' }
 * คืน { services, match(method, url) }
 */
export function buildRouteTable(targets = {}, services = SERVICES) {
  const compiled = services.map((svc) => {
    const routes = (svc.routes || []).map(([method, path, roles, options = {}]) => {
      if (!METHODS.has(method)) throw new Error(`method ไม่ถูกต้อง: ${method} ${svc.prefix}${path}`)
      if (!Array.isArray(roles) || roles.length === 0) throw new Error(`ไม่ได้กำหนด roles: ${method} ${svc.prefix}${path}`)
      return { method, path, roles, options, isPublic: false, re: compile(path) }
    })
    const publicRoutes = (svc.public || []).map(([method, path, options = {}]) => ({
      method,
      path,
      roles: [],
      options,
      isPublic: true,
      re: compile(path),
    }))
    return {
      name: svc.name,
      prefix: svc.prefix,
      target: targets[svc.name] || svc.defaultTarget,
      routes: [...publicRoutes, ...routes],
    }
  })

  /** คืน { service, path, rule } · service = null ถ้า prefix ไม่ตรง · rule = null ถ้าไม่อยู่ในตาราง */
  function match(method, pathname) {
    const service = compiled.find((s) => pathname === s.prefix || pathname.startsWith(`${s.prefix}/`))
    if (!service) return { service: null, path: pathname, rule: null }
    const path = pathname.slice(service.prefix.length) || '/'
    const rule = service.routes.find((r) => r.method === method && r.re.test(path)) || null
    return { service, path, rule }
  }

  return { services: compiled, match }
}
