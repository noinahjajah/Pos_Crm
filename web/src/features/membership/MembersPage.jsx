// สมาชิกลูกค้า: ค้นหา สมัคร สะสม/แลกแต้ม ระดับสมาชิก (ทุก role · ปรับแต้ม/แก้ข้อมูล = manager, owner · ตั้งระดับ = owner)

import { useCallback, useEffect, useState } from 'react'
import { membershipApi } from '../../api/membership.js'
import { useBranch } from '../../app/providers.jsx'
import { PageHeader } from '../../components/layout/Topbar.jsx'
import { useNotice } from '../../components/ui/Notice.jsx'
import { Alert, Badge, BranchOptions, Button, Card, Field, Select, SidePanel, TextInput } from '../../components/ui/index.jsx'
import { useForm } from '../../hooks/useForm.js'
import { baht, dateTime } from '../../lib/format.js'
import { useAuth } from '../auth/AuthContext.jsx'

const LIMIT = 20
const TIER_TONE = { Member: 'neutral', Silver: 'info', Gold: 'warning' }
const TYPE_LABEL = { earn: 'ได้แต้ม', redeem: 'แลกแต้ม', adjust: 'ปรับแต้ม', expire: 'หมดอายุ' }
const points = (n) => Number(n ?? 0).toLocaleString('th-TH')

function TierBadge({ tier }) {
  return tier ? <Badge tone={TIER_TONE[tier.name] || 'phase'}>{tier.name}</Badge> : null
}

export function MembersPage() {
  const { user: me } = useAuth()
  const { toast } = useNotice()
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ total: 0 })
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [panel, setPanel] = useState(null) // 'new' | customer id
  const [tiers, setTiers] = useState([])

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await membershipApi.listCustomers({ q: q || undefined, page, limit: LIMIT })
      setRows(res.data)
      setMeta(res.meta)
    } catch (e) {
      setError(e.message)
    }
  }, [q, page])

  const loadTiers = useCallback(() => membershipApi.listTiers().then((r) => setTiers(r.data)).catch(() => {}), [])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])
  useEffect(() => {
    const t = setTimeout(loadTiers, 0)
    return () => clearTimeout(t)
  }, [loadTiers])

  const pages = Math.max(1, Math.ceil((meta.total || 0) / LIMIT))
  const saved = (msg) => {
    toast(msg)
    load()
  }

  return (
    <>
      <PageHeader
        title="สมาชิก"
        subtitle="สมัครสมาชิกด้วยเบอร์โทร สะสมแต้มจากยอดซื้อ แลกแต้มได้ทุกสาขา"
        actions={<Button onClick={() => setPanel('new')}>+ สมัครสมาชิก</Button>}
      />
      <div className="content">
        <div className={panel ? 'with-panel' : ''}>
          <div>
            <Alert>{error}</Alert>
            <Card
              title={`สมาชิกทั้งหมด (${meta.total ?? 0})`}
              actions={
                <div className="toolbar">
                  <TextInput
                    placeholder="ค้นหาเบอร์โทรหรือชื่อ…"
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value)
                      setPage(1)
                    }}
                  />
                </div>
              }
            >
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>สมาชิก</th>
                      <th>เบอร์โทร</th>
                      <th>ระดับ</th>
                      <th style={{ textAlign: 'right' }}>แต้มคงเหลือ</th>
                      <th>สมัครเมื่อ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id} className={`clickable ${panel === c.id ? 'selected' : ''}`} onClick={() => setPanel(c.id)}>
                        <td>{c.full_name}</td>
                        <td>{c.phone}</td>
                        <td>
                          <TierBadge tier={c.tier} />
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <b>{points(c.points_balance)}</b>
                        </td>
                        <td className="muted">{dateTime(c.created_at)}</td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr>
                        <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                          {q ? 'ไม่พบสมาชิก' : 'ยังไม่มีสมาชิก กด “+ สมัครสมาชิก” เพื่อเริ่ม'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="pager">
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    ก่อนหน้า
                  </Button>
                  <span className="muted">
                    หน้า {page} / {pages}
                  </span>
                  <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                    ถัดไป
                  </Button>
                </div>
              )}
            </Card>
            <TiersCard tiers={tiers} canEdit={me.role === 'owner'} onSaved={loadTiers} />
          </div>
          {panel === 'new' && (
            <RegisterPanel
              isOwner={me.role === 'owner'}
              onClose={() => setPanel(null)}
              onSaved={(c) => {
                saved(`สมัครสมาชิก ${c.full_name} แล้ว`)
                setPanel(c.id)
              }}
            />
          )}
          {panel && panel !== 'new' && (
            <MemberPanel key={panel} id={panel} me={me} onClose={() => setPanel(null)} onChanged={load} />
          )}
        </div>
      </div>
    </>
  )
}

function RegisterPanel({ isOwner, onClose, onSaved }) {
  const { branches } = useBranch()
  const { form, set, errors, error, busy, submit } = useForm({ phone: '', full_name: '', birth_date: '', branch_id: '' })
  const save = () =>
    submit(async () => {
      const body = { phone: form.phone, full_name: form.full_name, birth_date: form.birth_date || null }
      if (isOwner && form.branch_id) body.branch_id = form.branch_id
      const res = await membershipApi.register(body)
      onSaved(res.data)
    })
  return (
    <SidePanel
      title="สมัครสมาชิก"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={save} disabled={busy || !form.phone.trim() || !form.full_name.trim()}>
            {busy ? 'กำลังบันทึก…' : 'สมัคร'}
          </Button>
        </>
      }
    >
      <Alert>{error}</Alert>
      <Field label="เบอร์โทร" hint="ใช้ค้นหาตอนคิดเงิน" error={errors.phone}>
        <TextInput value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="08xxxxxxxx" invalid={!!errors.phone} autoFocus />
      </Field>
      <Field label="ชื่อ-นามสกุล" error={errors.full_name}>
        <TextInput value={form.full_name} onChange={set('full_name')} invalid={!!errors.full_name} />
      </Field>
      <Field label="วันเกิด" hint="ไม่บังคับ" error={errors.birth_date}>
        <TextInput type="date" value={form.birth_date} onChange={set('birth_date')} />
      </Field>
      {isOwner && (
        <Field label="สาขาที่สมัคร" hint="ไม่บังคับ">
          <Select value={form.branch_id} onChange={set('branch_id')}>
            <option value="">ไม่ระบุ</option>
            <BranchOptions branches={branches} />
          </Select>
        </Field>
      )}
    </SidePanel>
  )
}

function MemberPanel({ id, me, onClose, onChanged }) {
  const { toast } = useNotice()
  const { branches, selectedBranchId } = useBranch()
  const [c, setC] = useState(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('visit')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [branchId, setBranchId] = useState(selectedBranchId || '')
  const [busy, setBusy] = useState(false)
  const canAdjust = me.role !== 'staff'
  const isOwner = me.role === 'owner'

  const reload = useCallback(
    () =>
      membershipApi
        .getCustomer(id)
        .then((r) => setC(r.data))
        .catch((e) => setError(e.message)),
    [id],
  )
  useEffect(() => {
    const t = setTimeout(reload, 0)
    return () => clearTimeout(t)
  }, [reload])

  async function act() {
    setBusy(true)
    setError('')
    try {
      const n = Number(value)
      const extra = isOwner && branchId ? { branch_id: branchId } : {}
      if (mode === 'visit') {
        const r = await membershipApi.addVisit(id, { amount: n, ...extra })
        toast(`ได้ ${points(r.data.points_earned)} แต้ม จากยอด ${baht(n)} บาท`)
      } else if (mode === 'redeem') {
        await membershipApi.redeem(id, { points: n, note: note || undefined, ...extra })
        toast(`แลก ${points(n)} แต้มแล้ว`)
      } else {
        await membershipApi.adjust(id, { points: n, note, ...extra })
        toast(`ปรับแต้ม ${n > 0 ? '+' : ''}${points(n)} แล้ว`)
      }
      setValue('')
      setNote('')
      await reload()
      onChanged()
    } catch (e) {
      setError(e.details?.[0]?.message ? `${e.message} — ${e.details[0].message}` : e.message)
    } finally {
      setBusy(false)
    }
  }

  const ownerNeedsBranch = isOwner && mode !== 'adjust' && !branchId
  const valid = mode === 'adjust' ? Number(value) !== 0 && Number.isInteger(Number(value)) && note.trim() : Number(value) > 0

  return (
    <SidePanel title={c ? c.full_name : 'สมาชิก'} onClose={onClose}>
      <Alert>{error}</Alert>
      {c && (
        <>
          <div className="member-summary">
            <div>
              <div className="muted">แต้มคงเหลือ</div>
              <div className="member-points">{points(c.points_balance)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <TierBadge tier={c.tier} />
              <div className="muted" style={{ marginTop: 4 }}>
                สะสมทั้งหมด {points(c.total_earned)} แต้ม
              </div>
            </div>
          </div>
          <p className="muted" style={{ margin: '0 0 12px' }}>
            {c.phone} {c.birth_date ? `· วันเกิด ${c.birth_date}` : ''} · ได้ {Number(c.tier?.point_rate ?? 0) * 100} แต้มต่อ 100 บาท
          </p>

          <div className="seg">
            <button type="button" className={mode === 'visit' ? 'on' : ''} onClick={() => setMode('visit')}>
              บันทึกยอดซื้อ
            </button>
            <button type="button" className={mode === 'redeem' ? 'on' : ''} onClick={() => setMode('redeem')}>
              แลกแต้ม
            </button>
            {canAdjust && (
              <button type="button" className={mode === 'adjust' ? 'on' : ''} onClick={() => setMode('adjust')}>
                ปรับแต้ม
              </button>
            )}
          </div>
          <Field label={mode === 'visit' ? 'ยอดซื้อ (บาท)' : mode === 'redeem' ? 'จำนวนแต้มที่แลก' : 'แต้ม (+ เพิ่ม / − ลด)'}>
            <TextInput type="number" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
          </Field>
          {mode !== 'visit' && (
            <Field label={mode === 'adjust' ? 'เหตุผล' : 'หมายเหตุ'} hint={mode === 'adjust' ? 'บังคับ' : 'ไม่บังคับ'}>
              <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          )}
          {isOwner && (
            <Field label="สาขา">
              <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">เลือกสาขา</option>
                <BranchOptions branches={branches} />
              </Select>
            </Field>
          )}
          <Button block onClick={act} disabled={busy || !valid || ownerNeedsBranch}>
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>

          <h4 style={{ margin: '20px 0 8px' }}>ประวัติแต้ม</h4>
          {c.transactions.length ? (
            <ul className="history">
              {c.transactions.map((t) => (
                <li key={t.id}>
                  <span>
                    {TYPE_LABEL[t.type]}
                    {t.note ? <span className="muted"> · {t.note}</span> : null}
                    <div className="muted">{dateTime(t.created_at)}</div>
                  </span>
                  <b className={t.points > 0 ? 'plus' : 'minus'}>
                    {t.points > 0 ? '+' : ''}
                    {points(t.points)}
                  </b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">ยังไม่มีรายการ</p>
          )}
        </>
      )}
    </SidePanel>
  )
}

function TiersCard({ tiers, canEdit, onSaved }) {
  const { toast } = useNotice()
  const [edit, setEdit] = useState({})
  async function save(t) {
    const e = edit[t.id] || {}
    try {
      await membershipApi.updateTier(t.id, {
        ...(e.min_points !== undefined ? { min_points: Number(e.min_points) } : {}),
        ...(e.rate !== undefined ? { point_rate: Number(e.rate) / 100 } : {}),
      })
      toast(`บันทึกระดับ ${t.name} แล้ว`)
      setEdit((s) => ({ ...s, [t.id]: undefined }))
      onSaved()
    } catch (err) {
      toast(err.message, 'error')
    }
  }
  if (!tiers.length) return null
  return (
    <Card title="ระดับสมาชิก" className="tiers-card">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>ระดับ</th>
              <th>แต้มสะสมขั้นต่ำ</th>
              <th>แต้มต่อ 100 บาท</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => {
              const e = edit[t.id]
              return (
                <tr key={t.id}>
                  <td>
                    <TierBadge tier={t} />
                  </td>
                  <td>
                    {canEdit ? (
                      <TextInput type="number" value={e?.min_points ?? t.min_points} onChange={(ev) => setEdit((s) => ({ ...s, [t.id]: { ...e, min_points: ev.target.value } }))} style={{ width: 120 }} />
                    ) : (
                      points(t.min_points)
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <TextInput type="number" step="0.5" value={e?.rate ?? Number(t.point_rate) * 100} onChange={(ev) => setEdit((s) => ({ ...s, [t.id]: { ...e, rate: ev.target.value } }))} style={{ width: 100 }} />
                    ) : (
                      Number(t.point_rate) * 100
                    )}
                  </td>
                  {canEdit && (
                    <td>
                      <Button size="sm" variant="secondary" disabled={!e} onClick={() => save(t)}>
                        บันทึก
                      </Button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
