// ตารางสิทธิ์ (spec ข้อ 4) — แก้สิทธิ์ที่ไฟล์นี้ไฟล์เดียว
// path เป็น path ฝั่ง service (หลังตัด prefix) ใช้ :param แทนค่าใน path
// roles: 'public' = ไม่ต้อง login · S = staff, M = manager, O = owner
// endpoint ที่ไม่อยู่ในตาราง → 404 (ปฏิเสธไว้ก่อน)

const S = 'staff';
const M = 'manager';
const O = 'owner';
const SMO = [S, M, O];
const MO = [M, O];
const SM = [S, M];
const PUBLIC = 'public';

export const PERMISSIONS = {
  identity: [
    { method: 'POST', path: '/auth/login', roles: PUBLIC }, // 1.2
    { method: 'POST', path: '/auth/refresh', roles: PUBLIC },
    { method: 'POST', path: '/auth/logout', roles: SMO },
    { method: 'GET', path: '/me', roles: SMO }, // 1.2
    { method: 'GET', path: '/branches', roles: SMO },
    { method: 'GET', path: '/branches/:id', roles: SMO },
    { method: 'POST', path: '/branches', roles: [O] }, // 1.6
    { method: 'PATCH', path: '/branches/:id', roles: [O] },
    { method: 'DELETE', path: '/branches/:id', roles: [O] }, // 1.6
    { method: 'GET', path: '/roles', roles: MO },
    { method: 'GET', path: '/users', roles: MO }, // 1.3
    { method: 'GET', path: '/users/:id', roles: MO },
    { method: 'POST', path: '/users', roles: [O] }, // 1.5
    { method: 'PATCH', path: '/users/:id', roles: [O] }, // 1.5
    { method: 'DELETE', path: '/users/:id', roles: [O] }, // 1.5
  ],

  catalog: [
    { method: 'GET', path: '/categories', roles: SMO },
    { method: 'POST', path: '/categories', roles: [O] },
    { method: 'PATCH', path: '/categories/:id', roles: [O] },
    { method: 'GET', path: '/menus', roles: SMO },
    { method: 'GET', path: '/menus/:id', roles: SMO },
    { method: 'POST', path: '/menus', roles: MO }, // 1.14
    { method: 'PATCH', path: '/menus/:id', roles: MO },
    { method: 'DELETE', path: '/menus/:id', roles: MO },
    { method: 'POST', path: '/menus/:id/copy', roles: [O] },
    { method: 'PATCH', path: '/menus/:id/availability', roles: SMO }, // 1.15
    { method: 'PUT', path: '/menus/:id/option-groups', roles: MO }, // 1.18
    { method: 'GET', path: '/option-groups', roles: SMO },
    { method: 'POST', path: '/option-groups', roles: MO }, // 1.16
    { method: 'PATCH', path: '/option-groups/:id', roles: MO },
    { method: 'POST', path: '/option-groups/:id/options', roles: MO }, // 1.17
    { method: 'PATCH', path: '/options/:id', roles: MO },
    { method: 'GET', path: '/stocks', roles: MO },
    { method: 'PATCH', path: '/stocks/:menuId', roles: MO }, // 1.22
  ],

  pos: [
    { method: 'GET', path: '/tables', roles: SMO }, // 1.8
    { method: 'POST', path: '/tables', roles: MO },
    { method: 'PATCH', path: '/tables/:id', roles: MO },
    { method: 'POST', path: '/orders', roles: SM }, // 1.7
    { method: 'GET', path: '/orders', roles: SMO },
    { method: 'GET', path: '/orders/:id', roles: SMO }, // 1.23
    { method: 'POST', path: '/orders/:id/tables/move', roles: SM }, // 1.11
    { method: 'POST', path: '/orders/:id/tables/merge', roles: SM }, // 1.12
    { method: 'POST', path: '/orders/:id/tickets', roles: SM }, // 1.9, 1.10
    { method: 'POST', path: '/orders/:id/request-payment', roles: SM }, // 1.24
    { method: 'GET', path: '/kitchen/tickets', roles: SM },
    { method: 'PATCH', path: '/kitchen/tickets/:id', roles: SM },
    // ประเด็นที่ยังเปิด (spec ข้อ 9.4): ถ้าทีมเลือกใช้ SSE แทน Realtime สำหรับจอครัว
    { method: 'GET', path: '/kitchen/stream', roles: SM, stream: true },
    { method: 'POST', path: '/orders/:id/approvals', roles: [S] }, // 1.27, 1.28
    { method: 'GET', path: '/approvals', roles: SMO }, // 1.29
    { method: 'GET', path: '/approvals/stream', roles: MO, stream: true }, // 1.29
    { method: 'POST', path: '/approvals/:id/approve', roles: MO }, // 1.29
    { method: 'POST', path: '/approvals/:id/reject', roles: MO },
  ],

  payment: [
    { method: 'POST', path: '/payments', roles: SM }, // 1.23, 1.25
    { method: 'POST', path: '/refunds', roles: SM }, // 1.30
    { method: 'GET', path: '/payments', roles: MO },
    { method: 'GET', path: '/expenses', roles: MO },
    { method: 'POST', path: '/expenses', roles: MO }, // 1.32
    { method: 'PATCH', path: '/expenses/:id', roles: MO },
    { method: 'DELETE', path: '/expenses/:id', roles: MO },
    { method: 'GET', path: '/reports/daily', roles: MO }, // 1.34, 1.35
    { method: 'GET', path: '/reports/branches', roles: [O] }, // 1.36
    { method: 'GET', path: '/reports/profit', roles: [O] }, // 1.37
  ],
};

/** แปลง '/users/:id' → regex ที่ match ทั้ง path */
function compile(path) {
  const pattern = path
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${pattern}/?$`);
}

/** เตรียมตารางสิทธิ์ให้ค้นเร็ว */
export function compilePermissions(table = PERMISSIONS) {
  const compiled = {};
  for (const [service, rules] of Object.entries(table)) {
    compiled[service] = rules.map((rule) => ({ ...rule, regex: compile(rule.path) }));
  }
  return compiled;
}

/**
 * หา rule ของ request
 * @returns {{ rule?: object, methodMismatch?: boolean }}
 */
export function findRule(compiled, service, method, path) {
  const rules = compiled[service] || [];
  const byPath = rules.filter((r) => r.regex.test(path));
  if (!byPath.length) return {};
  const rule = byPath.find((r) => r.method === method);
  return rule ? { rule } : { methodMismatch: true };
}
