import { useState, type ReactNode } from 'react'
import { niceTicks } from '../lib/format'

export const seriesVar = (i: number) => `var(--s${(i % 8) + 1})`

// ------------------------------------------------------------------ tooltip
interface Tip { x: number; y: number; content: ReactNode }
export function useTooltip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const bind = (content: ReactNode) => ({
    onMouseEnter: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, content }),
    onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, content }),
    onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent) => {
      const r = (e.target as HTMLElement).getBoundingClientRect()
      setTip({ x: r.right, y: r.top, content })
    },
    onBlur: () => setTip(null),
    tabIndex: 0,
  })
  const node = tip ? (
    <div className="tooltip" role="tooltip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 280), top: tip.y + 14 }}>
      {tip.content}
    </div>
  ) : null
  return { bind, node }
}

export function Legend({ items }: { items: { label: string; colorIdx: number }[] }) {
  if (items.length < 2) return null
  return (
    <div className="legend" aria-label="legend">
      {items.map((it) => (
        <span key={it.label} className="legend-item">
          <span className="swatch" style={{ background: seriesVar(it.colorIdx) }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

function Axis({ ticks, max, format }: { ticks: number[]; max: number; format: (v: number) => string }) {
  return (
    <div className="axis">
      {ticks.map((t) => (
        <span key={t} className="tick" style={{ left: `${(t / max) * 100}%` }}>{format(t)}</span>
      ))}
    </div>
  )
}
function Grid({ ticks, max }: { ticks: number[]; max: number }) {
  return (
    <>
      {ticks.map((t) => (
        <span key={t} className={t === 0 ? 'baseline' : 'gridline'} style={{ left: `${(t / max) * 100}%` }} />
      ))}
    </>
  )
}

// ------------------------------------------------------------------ interval (forest) chart
export interface IntervalRow { id: string; label: string; colorIdx: number; mid: number; lo: number; hi: number; valueText: string; tip: ReactNode }

export function IntervalChart({ rows, format, axisLabel }: { rows: IntervalRow[]; format: (v: number) => string; axisLabel: string }) {
  const { bind, node } = useTooltip()
  const maxRaw = Math.max(...rows.map((r) => (Number.isFinite(r.hi) ? r.hi : r.mid)), 0) * 1.05
  const ticks = niceTicks(maxRaw || 1)
  const max = ticks[ticks.length - 1]
  const x = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`
  return (
    <div className="chart interval-chart">
      {rows.map((r) => (
        <div className="ic-row" key={r.id} {...bind(r.tip)} aria-label={`${r.label}: ${r.valueText}`}>
          <div className="ic-label"><span className="swatch" style={{ background: seriesVar(r.colorIdx) }} />{r.label}</div>
          <div className="plot">
            <Grid ticks={ticks} max={max} />
            {Number.isFinite(r.lo) && Number.isFinite(r.hi) && (
              <span className="ic-range" style={{ left: x(r.lo), width: `calc(${x(r.hi)} - ${x(r.lo)})`, background: seriesVar(r.colorIdx) }} />
            )}
            <span className="ic-dot" style={{ left: x(r.mid), background: seriesVar(r.colorIdx) }} />
          </div>
          <div className="ic-value">{r.valueText}</div>
        </div>
      ))}
      <div className="ic-row axis-row">
        <div />
        <div className="plot"><Axis ticks={ticks} max={max} format={format} /></div>
        <div />
      </div>
      <div className="axis-label">{axisLabel}</div>
      {node}
    </div>
  )
}

// ------------------------------------------------------------------ grouped horizontal bars
export interface BarSeries { id: string; label: string; colorIdx: number }
export function GroupedBars({ rows, series, value, format, axisLabel, rowTip }: {
  rows: { key: string; label: string; sub?: string }[]
  series: BarSeries[]
  value: (rowKey: string, seriesId: string) => number
  format: (v: number) => string
  axisLabel: string
  rowTip?: (rowKey: string, seriesId: string) => ReactNode
}) {
  const { bind, node } = useTooltip()
  let maxRaw = 0
  for (const r of rows) for (const s of series) { const v = value(r.key, s.id); if (Number.isFinite(v)) maxRaw = Math.max(maxRaw, v) }
  const ticks = niceTicks(maxRaw * 1.02 || 1)
  const max = ticks[ticks.length - 1]
  return (
    <div className="chart grouped-bars">
      <Legend items={series.map((s) => ({ label: s.label, colorIdx: s.colorIdx }))} />
      {rows.map((r) => (
        <div className="gb-row" key={r.key}>
          <div className="gb-label">{r.label}{r.sub && <span className="muted"> {r.sub}</span>}</div>
          <div className="plot">
            <Grid ticks={ticks} max={max} />
            <div className="gb-bars">
              {series.map((s) => {
                const v = value(r.key, s.id)
                const w = Number.isFinite(v) && v > 0 ? Math.max(0.4, (v / max) * 100) : 0
                return (
                  <div className="gb-bar-hit" key={s.id}
                    {...bind(rowTip ? rowTip(r.key, s.id) : (<><b>{s.label}</b><br />{r.label}: {Number.isFinite(v) ? format(v) : '–'}</>))}>
                    {Number.isFinite(v)
                      ? <span className="gb-bar" style={{ width: `${w}%`, background: seriesVar(s.colorIdx) }} />
                      : <span className="gb-missing">–</span>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ))}
      <div className="gb-row axis-row">
        <div />
        <div className="plot"><Axis ticks={ticks} max={max} format={format} /></div>
      </div>
      <div className="axis-label">{axisLabel}</div>
      {node}
    </div>
  )
}

/** Tiny inline probability bar used in tables */
export function ProbBar({ p, colorIdx }: { p: number; colorIdx: number }) {
  return (
    <span className="probbar" aria-hidden>
      <span style={{ width: `${Math.max(0, Math.min(1, p)) * 100}%`, background: seriesVar(colorIdx) }} />
    </span>
  )
}
