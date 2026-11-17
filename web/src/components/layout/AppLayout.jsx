// โครงหน้า: แถบเมนูซ้าย + เนื้อหา

import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar.jsx'

export function AppLayout() {
  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <Outlet />
      </div>
    </div>
  )
}
