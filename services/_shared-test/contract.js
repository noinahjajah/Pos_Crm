// ชุดเทสต์ "สัญญา" ที่ทุก service ต้องทำเหมือนกัน (รูปแบบ error, ด่านสิทธิ์ที่ 2, X-Internal-Key, สาขา)
// แต่ละ service มี helpers.js ของตัวเอง (สำเนาแยกกันตามหลัก 1 service = 1 เจ้าของ) จึงรันชุดเดียวกันกับทุกตัว
// ใช้: import { runContract } from '../../_shared-test/contract.js' แล้วเรียก runContract('catalog', helpers, { branch: true })
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** res จำลองของ express */
function fakeRes() {
  return {
    code: 200,
    body: undefined,
    headersSent: false,
    status(c) {
      this.code = c
      return this
    },
    json(b) {
      this.body = b
      return this
    },
    end() {},
  }
}
const req = (user, extra = {}) => ({ user, query: {}, get: () => undefined, ...extra })
const runMw = (mw, r) => {
  let err
  let called = false
  mw(r, fakeRes(), (e) => {
    err = e
    called = true
  })
  return { err, called }
}

export function runContract(service, h, { branch = true } = {}) {
  describe(`${service}: สัญญากลางของ service`, () => {
    test('AppError และตัวช่วยสร้าง error ให้ status/code ถูกต้อง', () => {
      assert.equal(h.badRequest().status, 400)
      assert.equal(h.badRequest().code, 'VALIDATION_ERROR')
      assert.equal(h.forbidden().status, 403)
      assert.equal(h.forbidden().code, 'FORBIDDEN')
      assert.equal(h.notFound().status, 404)
      const c = h.conflict('X_CODE', 'msg', [{ a: 1 }])
      assert.deepEqual([c.status, c.code, c.message, c.details], [409, 'X_CODE', 'msg', [{ a: 1 }]])
      assert.ok(c instanceof Error)
    })

    test('send: { data } และ { data, meta } พร้อม status ที่กำหนด', () => {
      const r1 = fakeRes()
      h.send(r1, { x: 1 })
      assert.deepEqual([r1.code, r1.body], [200, { data: { x: 1 } }])
      const r2 = fakeRes()
      h.send(r2, [1], { status: 201, meta: { total: 1 } })
      assert.deepEqual([r2.code, r2.body], [201, { data: [1], meta: { total: 1 } }])
    })

    test('errorHandler: AppError → { error: { code, message, details } }', () => {
      const res = fakeRes()
      h.errorHandler(h.conflict('DUP', 'ซ้ำ'), req(null), res, () => {})
      assert.equal(res.code, 409)
      assert.deepEqual(res.body, { error: { code: 'DUP', message: 'ซ้ำ', details: [] } })
    })

    test('errorHandler: error ที่ไม่รู้จัก → 500 โดยไม่รั่วข้อความภายใน', () => {
      const res = fakeRes()
      const orig = console.error
      console.error = () => {}
      try {
        h.errorHandler(new Error('password=hunter2 ที่ db.internal'), req(null), res, () => {})
      } finally {
        console.error = orig
      }
      assert.equal(res.code, 500)
      assert.doesNotMatch(JSON.stringify(res.body), /hunter2|db\.internal/)
    })

    test('errorHandler: JSON พัง → 400', () => {
      const res = fakeRes()
      h.errorHandler(Object.assign(new Error('bad'), { type: 'entity.parse.failed' }), req(null), res, () => {})
      assert.equal(res.code, 400)
    })

    test('parse: ผ่านคืนค่า · ไม่ผ่านโยน 400 บอกช่องที่ผิด', () => {
      const schema = h.z.object({ id: h.uuid })
      assert.deepEqual(h.parse(schema, { id: A }), { id: A })
      assert.throws(
        () => h.parse(schema, { id: 'x' }),
        (e) => e.status === 400 && e.code === 'VALIDATION_ERROR' && e.details[0].field === 'id',
      )
      assert.throws(() => h.parse(schema, undefined), (e) => e.status === 400) // body ว่าง
    })

    test('uuid / idParam / atLeastOne', () => {
      assert.ok(h.uuid.safeParse(A).success)
      assert.ok(!h.uuid.safeParse('1').success)
      assert.ok(!h.idParam.safeParse({}).success)
      assert.equal(h.atLeastOne({}), false)
      assert.equal(h.atLeastOne({ a: 1 }), true)
    })

    test('allow: ไม่มี user → 401 · role ไม่ตรง → 403 · role ตรง → ผ่าน', () => {
      const mw = h.allow('manager', 'owner')
      assert.equal(runMw(mw, req(null)).err.status, 401)
      assert.equal(runMw(mw, req({ role: 'staff' })).err.status, 403)
      for (const role of ['manager', 'owner']) {
        const r = runMw(mw, req({ role }))
        assert.ok(r.called && r.err === undefined, role)
      }
    })

    describe('checkInternalKey', () => {
      const mw = h.checkInternalKey('secret-key')
      const withHeaders = (headers, path = '/x') => ({ path, get: (k) => headers[k.toLowerCase()] })

      test('/health ผ่านโดยไม่ต้องมี key', () => {
        const r = runMw(mw, withHeaders({}, '/health'))
        assert.ok(r.called && r.err === undefined)
      })
      test('ไม่มี key / key ผิด / key ยาวไม่เท่ากัน → 401 INTERNAL_KEY_INVALID', () => {
        for (const k of [undefined, 'wrong-key!!', 'secret-key-longer', '']) {
          const r = runMw(mw, withHeaders({ 'x-internal-key': k }))
          assert.equal(r.err?.status, 401, String(k))
          assert.equal(r.err?.code, 'INTERNAL_KEY_INVALID')
        }
      })
      test('key ถูก: อ่าน X-User-* เป็น req.user', () => {
        const rq = withHeaders({ 'x-internal-key': 'secret-key', 'x-user-id': 'u1', 'x-user-role': 'manager', 'x-branch-id': A })
        const r = runMw(mw, rq)
        assert.equal(r.err, undefined)
        assert.deepEqual(rq.user, { id: 'u1', role: 'manager', branchId: A })
      })
      test('key ถูกแต่ไม่มี X-User-* → user = null · owner ไม่มี branch → branchId null', () => {
        const a = withHeaders({ 'x-internal-key': 'secret-key' })
        runMw(mw, a)
        assert.equal(a.user, null)
        const b = withHeaders({ 'x-internal-key': 'secret-key', 'x-user-id': 'o', 'x-user-role': 'owner' })
        runMw(mw, b)
        assert.equal(b.user.branchId, null)
      })
    })

    if (branch) {
      describe('สาขา (branch scope)', () => {
        test('branchFilter: staff/manager ใช้สาขาตัวเองเสมอ แม้ส่ง ?branch_id= อื่นมา', () => {
          for (const role of ['staff', 'manager']) {
            assert.equal(h.branchFilter(req({ role, branchId: A }, { query: { branch_id: B } })), A)
          }
        })
        test('branchFilter: owner ไม่ส่ง = ทุกสาขา (null) · ส่ง uuid ถูก = สาขานั้น · ส่งมั่ว = null', () => {
          const owner = { role: 'owner', branchId: null }
          assert.equal(h.branchFilter(req(owner)), null)
          assert.equal(h.branchFilter(req(owner, { query: { branch_id: B } })), B)
          assert.equal(h.branchFilter(req(owner, { query: { branch_id: "x' or 1=1" } })), null)
          assert.equal(h.branchFilter(req(owner, { query: { branch_id: [B] } })), null)
        })
        test('branchForCreate: staff/manager = สาขาตัวเอง (เมินค่าที่ส่งมา) · owner ต้องระบุ', () => {
          assert.equal(h.branchForCreate(req({ role: 'manager', branchId: A }), B), A)
          assert.equal(h.branchForCreate(req({ role: 'owner', branchId: null }), B), B)
          assert.throws(() => h.branchForCreate(req({ role: 'owner', branchId: null }), undefined), (e) => e.status === 400)
        })
        test('mustBeMyBranch: สาขาอื่น → 403 FORBIDDEN_BRANCH · owner ผ่านทุกสาขา', () => {
          assert.doesNotThrow(() => h.mustBeMyBranch(req({ role: 'manager', branchId: A }), A))
          assert.throws(
            () => h.mustBeMyBranch(req({ role: 'manager', branchId: A }), B),
            (e) => e.status === 403 && e.code === 'FORBIDDEN_BRANCH',
          )
          assert.doesNotThrow(() => h.mustBeMyBranch(req({ role: 'owner', branchId: null }), B))
        })
      })
    }
  })
}
