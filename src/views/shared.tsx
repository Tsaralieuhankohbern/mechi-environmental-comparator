import type { ReactNode } from 'react'
import type { AnalysisSettings, Intervention, Lang, Situation } from '../types'
import type { ComparisonResult, Prepared } from '../lib/engine'
import { commonUnit, fmt, inUnit, prob, type TimeUnit } from '../lib/format'
import { L, translate, useT } from '../lib/i18n'
import { IntervalChart } from '../components/charts'
import { Notice } from '../components/common'

export interface ViewProps {
  p: Prepared
  situation: Situation
  alts: Intervention[]
  res: ComparisonResult
  settings: AnalysisSettings
  setSettings: (s: AnalysisSettings) => void
  colorOf: (id: string) => number
}

export function altName(alts: Intervention[], id: string, lang: Lang) {
  return L(alts.find((a) => a.intervention_id === id), 'name', lang)
}

/** Formatting of the overall score in a unit that suits the comparison. */
export function useScoreFormat(res: ComparisonResult) {
  const t = useT()
  if (res.normalisation === 'internal') {
    return {
      unit: null as TimeUnit | null,
      unitLabel: t('relativeScore'),
      fmt: (v: number) => fmt(v, t.lang, 2),
      conv: (v: number) => v,
    }
  }
  const unit = commonUnit(res.alts.map((a) => a.median))
  return {
    unit,
    unitLabel: translate(t.lang, unit),
    fmt: (v: number) => fmt(inUnit(v, unit), t.lang),
    conv: (v: number) => inUnit(v, unit),
  }
}

export function ScoreIntervals({ res, alts, colorOf }: Pick<ViewProps, 'res' | 'alts' | 'colorOf'>) {
  const t = useT()
  const sf = useScoreFormat(res)
  const rows = res.alts.map((a) => ({
    id: a.id,
    label: altName(alts, a.id, t.lang),
    colorIdx: colorOf(a.id),
    mid: sf.conv(a.median),
    lo: sf.conv(a.p05),
    hi: sf.conv(a.p95),
    valueText: `${sf.fmt(a.median)} (${sf.fmt(a.p05)}–${sf.fmt(a.p95)})`,
    tip: (
      <>
        <b>{altName(alts, a.id, t.lang)}</b><br />
        {t('median')}: {sf.fmt(a.median)} {sf.unitLabel}<br />
        {t('interval')}: {sf.fmt(a.p05)}–{sf.fmt(a.p95)}<br />
        {t('pBest')}: {prob(a.pBest, t.lang)}
      </>
    ),
  }))
  return (
    <IntervalChart rows={rows} format={(v) => fmt(v, t.lang)}
      axisLabel={`${t('score')} (${sf.unitLabel}) — ${t('median')} & ${t('interval')}`} />
  )
}

export function ExcludedNotice({ res, alts }: Pick<ViewProps, 'res' | 'alts'>) {
  const t = useT()
  if (!res.excluded.length) return null
  return (
    <Notice kind="warn">
      <b>{t('excludedTitle')}</b> — {t('excludedText', { n: res.excluded.length })}
      <details>
        <summary>{t('showCategories')}</summary>
        <ul className="compact">
          {res.excluded.map((e) => (
            <li key={e.indicator.indicator_id}>
              {L(e.indicator, 'name', t.lang)} — {t('missingFor')} {e.missingFor.map((id) => altName(alts, id, t.lang)).join(', ')}
            </li>
          ))}
        </ul>
      </details>
    </Notice>
  )
}

export function ClinicalNotes({ alts, situation }: { alts: Intervention[]; situation: Situation }) {
  const t = useT()
  const notes = [...new Set(alts.map((a) => L(a, 'clinical_note', t.lang)).filter(Boolean))]
  const scope = L(situation, 'scope_note', t.lang)
  if (!notes.length && !scope) return null
  return (
    <div className="clinical">
      <h4>{t('clinicalContext')}</h4>
      <ul className="compact">
        {scope && <li>{scope}</li>}
        {notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </div>
  )
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

/** Index of the alternative with the lowest central score */
export function bestIndex(res: ComparisonResult) {
  let b = 0
  res.alts.forEach((a, i) => { if (a.central < res.alts[b].central) b = i })
  return b
}
