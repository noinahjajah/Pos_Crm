// ชิ้นส่วนพื้นฐานตาม Prototype ใน Figma: ปุ่ม ป้าย การ์ด ช่องกรอก แผงด้านข้าง

export function Button({ variant = 'primary', size, block, className = '', ...props }) {
  const cls = ['btn', `btn-${variant}`, size === 'sm' && 'btn-sm', block && 'btn-block', className].filter(Boolean).join(' ')
  return <button type="button" className={cls} {...props} />
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-header">
          {title && <h2>{title}</h2>}
          <div className="grow" />
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function Field({ label, hint, error, children }) {
  return (
    <label className="field">
      <span>
        {label} {hint && <em className="hint">{hint}</em>}
      </span>
      {children}
      {error && <em className="error">{error}</em>}
    </label>
  )
}

export function TextInput({ invalid, className = '', ...props }) {
  return <input className={`input ${invalid ? 'invalid' : ''} ${className}`} {...props} />
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={`select ${className}`} {...props}>
      {children}
    </select>
  )
}

export function Avatar({ name = '?', color = '#8a857c', size }) {
  return (
    <span className={`avatar ${size === 'sm' ? 'sm' : ''}`} style={{ background: color }}>
      {name.trim().match(/[ก-ฮA-Za-z0-9]/)?.[0] ?? '?'}
    </span>
  )
}

export function Alert({ tone = 'error', children }) {
  if (!children) return null
  return <div className={`alert alert-${tone}`}>{children}</div>
}

// แผงแก้ไขด้านขวา (หน้าผู้ใช้)
export function SidePanel({ title, onClose, footer, children }) {
  return (
    <aside className="side-panel" aria-label={title}>
      <div className="side-panel-head">
        <h3>{title}</h3>
        <button type="button" className="icon-close" onClick={onClose} aria-label="ปิด">
          ✕
        </button>
      </div>
      <div className="side-panel-body">{children}</div>
      {footer && <div className="side-panel-foot">{footer}</div>}
    </aside>
  )
}
export function BranchOptions({ branches }) {
  return branches.map((b) => (
    <option key={b.id} value={b.id}>
      {b.name} ({b.code})
    </option>
  ))
}

// ช่องบอกว่าส่วนนี้ทำในเฟส 2
export function PhaseNote({ title, children }) {
  return (
    <div className="alert alert-phase">
      <Badge tone="phase">เฟส 2</Badge> <b>{title}</b>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  )
}
