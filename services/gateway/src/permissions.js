// ตารางสิทธิ์ { method, path, roles } ตาม spec ข้อ 4 (path public อยู่ใน buildRoutes ของ app.js) · Dev 2/3 เพิ่มของตัวเองที่นี่

const S = 'staff';
const M = 'manager';
const O = 'owner';
const SMO = [S, M, O];
const MO = [M, O];
const SM = [S, M];

export const PERMISSIONS = {
  identity: [
    { method: 'POST', path: '/auth/logout', roles: SMO },
    { method: 'POST', path: '/auth/change-password', roles: SMO },
    { method: 'GET', path: '/me', roles: SMO },
    { method: 'GET', path: '/branches', roles: SMO },
    { method: 'GET', path: '/branches/:id', roles: SMO },
    { method: 'POST', path: '/branches', roles: [O] },
    { method: 'PATCH', path: '/branches/:id', roles: [O] },
    { method: 'DELETE', path: '/branches/:id', roles: [O] },
    { method: 'GET', path: '/roles', roles: MO },
    { method: 'GET', path: '/users', roles: MO },
    { method: 'GET', path: '/users/:id', roles: MO },
    { method: 'POST', path: '/users', roles: [O] },
    { method: 'PATCH', path: '/users/:id', roles: [O] },
    { method: 'DELETE', path: '/users/:id', roles: [O] },
  ],

  catalog: [
    { method: 'GET', path: '/categories', roles: SMO },
    { method: 'POST', path: '/categories', roles: [O] },
    { method: 'PATCH', path: '/categories/:id', roles: [O] },
    { method: 'GET', path: '/menus', roles: SMO },
    { method: 'GET', path: '/menus/:id', roles: SMO },
    { method: 'POST', path: '/menus', roles: MO },
    { method: 'PATCH', path: '/menus/:id', roles: MO },
    { method: 'DELETE', path: '/menus/:id', roles: MO },
    { method: 'POST', path: '/menus/:id/copy', roles: [O] },
    { method: 'PATCH', path: '/menus/:id/availability', roles: SMO },
    { method: 'PUT', path: '/menus/:id/option-groups', roles: MO },
    { method: 'GET', path: '/option-groups', roles: SMO },
    { method: 'POST', path: '/option-groups', roles: MO },
    { method: 'PATCH', path: '/option-groups/:id', roles: MO },
    { method: 'POST', path: '/option-groups/:id/options', roles: MO },
    { method: 'PATCH', path: '/options/:id', roles: MO },
    { method: 'GET', path: '/stocks', roles: MO },
    { method: 'PATCH', path: '/stocks/:menuId', roles: MO },
  ],

  pos: [
    { method: 'GET', path: '/tables', roles: SMO },
    { method: 'POST', path: '/tables', roles: MO },
    { method: 'PATCH', path: '/tables/:id', roles: MO },
    { method: 'POST', path: '/orders', roles: SM },
    { method: 'GET', path: '/orders', roles: SMO },
    { method: 'GET', path: '/orders/:id', roles: SMO },
    { method: 'POST', path: '/orders/:id/tables/move', roles: SM },
    { method: 'POST', path: '/orders/:id/tables/merge', roles: SM },
    { method: 'POST', path: '/orders/:id/tickets', roles: SM },
    { method: 'POST', path: '/orders/:id/request-payment', roles: SM },
    { method: 'GET', path: '/kitchen/tickets', roles: SM },
    { method: 'PATCH', path: '/kitchen/tickets/:id', roles: SM },
    { method: 'GET', path: '/kitchen/stream', roles: SM, stream: true },
    { method: 'POST', path: '/orders/:id/approvals', roles: [S] },
    { method: 'GET', path: '/approvals', roles: SMO },
    { method: 'GET', path: '/approvals/stream', roles: MO, stream: true },
    { method: 'POST', path: '/approvals/:id/approve', roles: MO },
    { method: 'POST', path: '/approvals/:id/reject', roles: MO },
  ],

  payment: [
    { method: 'POST', path: '/payments', roles: SM },
    { method: 'POST', path: '/refunds', roles: SM },
    { method: 'GET', path: '/payments', roles: MO },
    { method: 'GET', path: '/expenses', roles: MO },
    { method: 'POST', path: '/expenses', roles: MO },
    { method: 'PATCH', path: '/expenses/:id', roles: MO },
    { method: 'DELETE', path: '/expenses/:id', roles: MO },
    { method: 'GET', path: '/reports/daily', roles: MO },
    { method: 'GET', path: '/reports/branches', roles: [O] },
    { method: 'GET', path: '/reports/profit', roles: [O] },
  ],
};

function compile(path) {
  const pattern = path
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${pattern}/?$`);
}

// แปลง path แบบ /users/:id เป็น regex ไว้จับคู่ตอนรัน
export function compilePermissions(table = PERMISSIONS) {
  const compiled = {};
  for (const [service, rules] of Object.entries(table)) {
    compiled[service] = rules.map((rule) => ({ ...rule, regex: compile(rule.path) }));
  }
  return compiled;
}

export function findRule(compiled, service, method, path) {
  const rules = compiled[service] || [];
  const byPath = rules.filter((r) => r.regex.test(path));
  if (!byPath.length) return {};
  const rule = byPath.find((r) => r.method === method);
  return rule ? { rule } : { methodMismatch: true };
}
