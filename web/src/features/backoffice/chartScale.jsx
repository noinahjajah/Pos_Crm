// แกน Y ร่วมของกราฟแท่งในหน้า backoffice (เส้นกริด + ป้ายค่า เช่น 0 / 12k / 24k)

/** เพดานแกน Y ที่หารสองลงตัว เช่น 4,200 → 6,000 · 20,000 → 24,000 */
export function niceMax(v) {
  const base = 10 ** Math.floor(Math.log10(Math.max(1, v)))
  const step = [1, 1.2, 1.6, 2, 2.4, 3, 4, 6, 8, 10].find((m) => m * base >= v) ?? 10
  return step * base
}

export const axisLabel = (v) => {
  const a = Math.abs(v)
  const t = a >= 1000 ? `${Math.round((a / 1000) * 10) / 10}k` : String(Math.round(a))
  return v < 0 ? `–${t}` : t
}

/** ticks: [{ value, pct }] · pct = ตำแหน่งจากขอบล่างของพื้นที่กราฟ (0–100) · วางใน .pos-chart-plotwrap */
export function YGrid({ ticks }) {
  return (
    <div className="pos-chart-grid" aria-hidden="true">
      {ticks.map((t) => (
        <span key={t.value} style={{ bottom: `${t.pct}%` }}>
          <b>{axisLabel(t.value)}</b>
        </span>
      ))}
    </div>
  )
}
