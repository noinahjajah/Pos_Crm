// หัวหน้า + ตัวเลือกสาขา (owner)

import { useLocation } from 'react-router-dom'
import { useBranch } from '../../app/providers.jsx'
import { Badge, BranchOptions, Select } from '../ui/index.jsx'
import { useAuth } from '../../features/auth/AuthContext.jsx'

export function PageHeader({ title, subtitle, actions, showBranchSwitch = false }) {
  const { user } = useAuth()
  const { branches, selectedBranchId, selectBranch, canSwitch } = useBranch()
  const { pathname } = useLocation()
  return (
    <header className="topbar" data-path={pathname}>
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="grow" />
      {showBranchSwitch && canSwitch && (
        <Select
          value={selectedBranchId}
          onChange={(e) => selectBranch(e.target.value)}
          style={{ width: 200 }}
          aria-label="เลือกสาขา"
        >
          <option value="">ทุกสาขา</option>
          <BranchOptions branches={branches} />
        </Select>
      )}
      {showBranchSwitch && !canSwitch && user.branch && <Badge tone="info">{user.branch.name}</Badge>}
      {actions}
    </header>
  )
}
