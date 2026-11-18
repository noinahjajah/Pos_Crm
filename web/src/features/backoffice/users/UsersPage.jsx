import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { deleteUser, listBranches, listUsers, updateUser } from '../../../api/identity'
import { ROLE_LABELS } from '../../../lib/constants'
import { useAuth } from '../../auth/AuthContext'
import { errorText, thaiDate, useToast } from '../useBranchScope'
import BranchesPanel from './BranchesPanel'
import UserDialog from './UserDialog'
import '../menus/menus.css'
import '../backoffice.css'
import './users.css'

// หน้าพนักงานและสาขา (หลังร้าน) — 1.3–1.6 (Dev 1)
// owner: เพิ่ม/แก้/ลบผู้ใช้ทุกสาขา และจัดการสาขา (แท็บ "สาขา")
// manager: ดูรายชื่อพนักงานสาขาตัวเองได้อย่างเดียว (gateway กรองสาขาให้)

export default function UsersPage() {
  const { isOwner } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = isOwner && params.get('tab') === 'branches' ? 'branches' : 'users'
  const [toast, notify] = useToast()

  // รายชื่อสาขา (รวมที่ปิดแล้ว) ใช้ทั้ง 2 แท็บ
  const [branches, setBranches] = useState([])
  const [branchError, setBranchError] = useState('')
  const [branchKey, setBranchKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    listBranches(isOwner ? { include_inactive: true } : undefined)
      .then((data) => !cancelled && (setBranches(data || []), setBranchError('')))
      .catch((err) => !cancelled && setBranchError(errorText(err)))
    return () => {
      cancelled = true
    }
  }, [isOwner, branchKey])
  const reloadBranches = useCallback(() => setBranchKey((k) => k + 1), [])

  return (
    <div className="mm-page">
      <header className="mm-header">
        <div>
          <h1 className="mm-title">พนักงานและสาขา</h1>
          <p className="mm-subtitle">
            {isOwner ? 'เพิ่ม แก้ไข ลบ ผู้ใช้และสาขาทั้งหมด' : 'รายชื่อพนักงานสาขาของคุณ (ดูได้อย่างเดียว)'}
          </p>
        </div>
      </header>

      {isOwner && (
        <div className="bo-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'users'}
            className={`bo-tab ${tab === 'users' ? 'is-active' : ''}`}
            onClick={() => setParams({})}
          >
            พนักงาน
          </button>
          <button
            role="tab"
            aria-selected={tab === 'branches'}
            className={`bo-tab ${tab === 'branches' ? 'is-active' : ''}`}
            onClick={() => setParams({ tab: 'branches' })}
          >
            สาขา
          </button>
        </div>
      )}

      {branchError && <div className="mm-alert">โหลดรายชื่อสาขาไม่ได้: {branchError}</div>}

      {tab === 'branches' ? (
        <BranchesPanel branches={branches} onChanged={reloadBranches} notify={notify} />
      ) : (
        <UsersPanel branches={branches} notify={notify} />
      )}

      {toast && <div className={`mm-toast ${toast.type === 'error' ? 'is-error' : ''}`}>{toast.message}</div>}
    </div>
  )
}

function UsersPanel({ branches, notify }) {
  const { user: me, isOwner } = useAuth()
  const [filters, setFilters] = useState({ branch_id: '', role: '', q: '', showInactive: false })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // null | {} | user
  const [busyId, setBusyId] = useState(null)

  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    listUsers({
      branch_id: isOwner ? filters.branch_id : undefined,
      include_inactive: filters.showInactive || undefined,
    })
      .then((data) => !cancelled && (setRows(data || []), setError('')))
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [isOwner, filters.branch_id, filters.showInactive, reloadKey])

  const reload = useCallback(() => {
    setLoading(true)
    setReloadKey((k) => k + 1)
  }, [])

  function changeFilter(key, value) {
    if (key === 'branch_id' || key === 'showInactive') setLoading(true)
    setFilters((f) => ({ ...f, [key]: value }))
  }

  // ค้นหาและกรอง role ในเครื่อง (รายชื่อพนักงานต่อร้านไม่เยอะ)
  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return rows
      .filter((u) => filters.showInactive || u.is_active !== false)
      .filter((u) => !filters.role || u.role === filters.role)
      .filter((u) => !q || `${u.full_name || ''} ${u.username || ''}`.toLowerCase().includes(q))
      .sort((a, b) => (a.is_active === b.is_active ? 0 : a.is_active === false ? 1 : -1))
  }, [rows, filters])

  const branchName = (id) => (id ? branches.find((b) => b.id === id)?.name || '—' : 'ทุกสาขา')
  const activeBranches = branches.filter((b) => b.is_active !== false)

  async function remove(u) {
    if (!window.confirm(`ลบผู้ใช้ "${u.full_name || u.username}" ?\nบัญชีจะเข้าสู่ระบบไม่ได้และถูกออกจากระบบทันที`)) return
    setBusyId(u.id)
    try {
      await deleteUser(u.id)
      notify('ลบผู้ใช้แล้ว')
      reload()
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function restore(u) {
    setBusyId(u.id)
    try {
      await updateUser(u.id, { is_active: true })
      notify(`เปิดใช้บัญชี ${u.username} อีกครั้งแล้ว`)
      reload()
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <div className="us-toolbar">
        <div className="bo-filters">
          {isOwner && (
            <label className="mm-field">
              <span>สาขา</span>
              <select className="mm-select" value={filters.branch_id} onChange={(e) => changeFilter('branch_id', e.target.value)}>
                <option value="">ทุกสาขา</option>
                {activeBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="mm-field">
            <span>ตำแหน่ง</span>
            <select className="mm-select" value={filters.role} onChange={(e) => changeFilter('role', e.target.value)}>
              <option value="">ทุกตำแหน่ง</option>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="mm-field">
            <span>ค้นหา</span>
            <input
              className="mm-input"
              type="search"
              value={filters.q}
              onChange={(e) => changeFilter('q', e.target.value)}
              placeholder="ชื่อ หรือ ชื่อผู้ใช้"
            />
          </label>
          {isOwner && (
            <label className="us-check">
              <input type="checkbox" checked={filters.showInactive} onChange={(e) => changeFilter('showInactive', e.target.checked)} />
              แสดงบัญชีที่ลบแล้ว
            </label>
          )}
        </div>
        {isOwner && (
          <button className="mm-btn mm-btn-primary" onClick={() => setEditing({})} disabled={activeBranches.length === 0}>
            + เพิ่มพนักงาน
          </button>
        )}
      </div>

      {error && (
        <div className="mm-alert">
          {error}
          <button className="mm-link" onClick={reload}>
            ลองใหม่
          </button>
        </div>
      )}

      {loading ? (
        <div className="mm-card mm-skeleton" />
      ) : visible.length === 0 ? (
        <div className="mm-empty">{rows.length === 0 ? 'ยังไม่มีพนักงาน' : 'ไม่พบพนักงานที่ตรงกับตัวกรอง'}</div>
      ) : (
        <div className="bo-table-wrap">
          <table className="bo-table">
            <thead>
              <tr>
                <th>ชื่อ</th>
                <th>ชื่อผู้ใช้</th>
                <th>ตำแหน่ง</th>
                {isOwner && <th>สาขา</th>}
                <th>สถานะ</th>
                <th>เพิ่มเมื่อ</th>
                {isOwner && <th />}
              </tr>
            </thead>
            <tbody>
              {visible.map((u) => {
                const isMe = u.id === me?.id
                const inactive = u.is_active === false
                return (
                  <tr key={u.id} className={inactive ? 'us-inactive' : ''}>
                    <td>
                      <strong>{u.full_name || '—'}</strong>
                      {isMe && <span className="us-me">คุณ</span>}
                    </td>
                    <td className="bo-muted">{u.username}</td>
                    <td>
                      <span className={`us-role is-${u.role}`}>{ROLE_LABELS[u.role] || u.role}</span>
                    </td>
                    {isOwner && <td className="bo-muted">{branchName(u.branch_id)}</td>}
                    <td>
                      <span className={`bo-status ${inactive ? 'is-empty' : 'is-on'}`}>{inactive ? 'ลบแล้ว' : 'ใช้งาน'}</span>
                    </td>
                    <td className="bo-muted">{thaiDate(u.created_at)}</td>
                    {isOwner && (
                      <td>
                        <div className="bo-row-actions">
                          {inactive ? (
                            <button className="mm-btn" onClick={() => restore(u)} disabled={busyId === u.id}>
                              เปิดใช้อีกครั้ง
                            </button>
                          ) : (
                            <>
                              <button className="mm-btn" onClick={() => setEditing(u)} disabled={busyId === u.id}>
                                แก้ไข
                              </button>
                              {!isMe && (
                                <button className="mm-btn mm-btn-danger" onClick={() => remove(u)} disabled={busyId === u.id}>
                                  ลบ
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <UserDialog
          user={editing.id ? editing : null}
          isSelf={editing.id === me?.id}
          branches={activeBranches}
          defaultBranchId={filters.branch_id || activeBranches[0]?.id || ''}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null)
            notify(msg)
            reload()
          }}
        />
      )}
    </>
  )
}
