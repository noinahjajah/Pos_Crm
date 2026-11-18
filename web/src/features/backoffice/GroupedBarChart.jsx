import { useMemo, useState } from 'react'

// กราฟแท่งแบบกลุ่ม (หลายชุดข้อมูล) — ใช้ในแดชบอร์ดเจ้าของและหน้ากำไร
// - สีตามลำดับชุดข้อมูลจาก --app-series-1..4 (ผ่านตัวตรวจ dataviz) · ชุดเกิน 4 ให้ผู้เรียกรวมเป็น "อื่น ๆ" เอง
// - มี legend เสมอ · ชี้/โฟกัสกลุ่มเพื่อดูค่าทุกชุด · มีตารางซ่อนสำหรับโปรแกรมอ่านหน้าจอ
//
// categories: [{ key, label }] · series: [{ key, label, color }] · values: { [seriesKey]: number[] }
// สีให้ใช้จาก seriesColors.js

export default function GroupedBarChart({ categories, series, values, format = String, height = 200, caption }) {
  const [active, setActive] = useState(null)
  const max = useMemo(() => Math.max(1, ...series.flatMap((s) => values[s.key] || [])), [series, values])
  const hasData = series.some((s) => (values[s.key] || []).some((v) => v > 0))

  if (!hasData) return <div className="pos-cart-empty">ยังไม่มีข้อมูลในช่วงนี้</div>

  return (
    <div className="pos-chart">
      <div className="pos-chart-head">
        <div className="pos-chart-tip" aria-hidden="true">
          {active != null ? (
            <>
              <strong>{categories[active].label}</strong>
              {series.map((s) => (
                <span key={s.key} className="pos-chart-tip-item">
                  <i style={{ background: s.color }} />
                  {s.label} {format(values[s.key]?.[active] ?? 0)}
                </span>
              ))}
            </>
          ) : (
            <span className="pos-muted">ชี้ที่กลุ่มแท่งเพื่อดูตัวเลข</span>
          )}
        </div>
        <ul className="pos-legend" aria-label="คำอธิบายสี">
          {series.map((s) => (
            <li key={s.key}>
              <i style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="pos-chart-plot" style={{ height }} onMouseLeave={() => setActive(null)} role="img" aria-label={caption}>
        {categories.map((c, i) => (
          <button
            key={c.key}
            type="button"
            className={`pos-chart-col is-group ${active === i ? 'is-active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            aria-label={`${c.label}: ${series.map((s) => `${s.label} ${format(values[s.key]?.[i] ?? 0)}`).join(', ')}`}
          >
            {series.map((s) => (
              <span key={s.key} className="pos-chart-bar" style={{ height: `${((values[s.key]?.[i] ?? 0) / max) * 100}%`, background: s.color }} />
            ))}
          </button>
        ))}
      </div>
      <div className="pos-chart-axis" aria-hidden="true">
        {categories.map((c) => (
          <span key={c.key}>{c.label}</span>
        ))}
      </div>

      <table className="pos-sr-only">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            <th scope="col">ช่วง</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((c, i) => (
            <tr key={c.key}>
              <th scope="row">{c.label}</th>
              {series.map((s) => (
                <td key={s.key}>{format(values[s.key]?.[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
