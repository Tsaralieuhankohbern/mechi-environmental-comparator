import { useEffect, useState } from 'react'
import { fmt, int, prob, unitLabel } from '../lib/format'
import { L, useT } from '../lib/i18n'
import { GroupedBars, ProbBar, seriesVar } from '../components/charts'
import { Card, GradeBadge } from '../components/common'
import { altName, bestIndex, ClinicalNotes, ExcludedNotice, ScoreIntervals, type ViewProps } from './shared'

export function MesoView(props: ViewProps) {
  const { p, res, alts, colorOf, situation } = props
  const t = useT()
  const lang = t.lang
  const defaultVol = Math.max(1, Math.round(Number(situation.nl_annual_volume || 0) / 70))
  const [volume, setVolume] = useState(defaultVol)
  useEffect(() => setVolume(defaultVol), [situation.situation_id, defaultVol])

  const series = res.alts.map((a) => ({ id: a.id, label: altName(alts, a.id, lang), colorIdx: colorOf(a.id) }))
  const best = res.alts[bestIndex(res)]
  const current = [...alts].sort((a, b) => Number(b.nl_current_share) - Number(a.nl_current_share))[0]
  const curRes = res.alts.find((a) => a.id === current.intervention_id)!
  const v = (id: string, ind: string) => res.alts.find((a) => a.id === id)?.values[ind] ?? NaN
  const wasteIds = p.inventoryIndicators.filter((i) => i.group === 'waste').map((i) => i.indicator_id)
  const wasteTotal = (id: string) => {
    const vals = wasteIds.map((w) => v(id, w)).filter(Number.isFinite)
    return vals.length ? vals.reduce((a, b) => a + b, 0) : NaN
  }
  const isExt = res.normalisation === 'external'

  const totals = [
    ...(isExt ? [{ key: 'score', label: `${t('score')} (${t('personYears')})`, f: (id: string) => (res.alts.find((a) => a.id === id)?.central ?? NaN) * volume }] : []),
    { key: 'cc', label: `${t('climate')} (${t('tCO2')})`, f: (id: string) => (v(id, 'cc') * volume) / 1000 },
    { key: 'water', label: `${L(p.indicatorById.get('water_withdrawal'), 'name', lang)} (m³)`, f: (id: string) => v(id, 'water_withdrawal') * volume },
    { key: 'waste', label: `${lang === 'nl' ? 'Afval totaal' : 'Total waste'} (kg)`, f: (id: string) => wasteTotal(id) * volume },
    { key: 'travel', label: `${L(p.indicatorById.get('travel_km'), 'name', lang)} (km)`, f: (id: string) => v(id, 'travel_km') * volume },
  ]

  const themeRows = res.themesUsed.map((th) => ({ key: th, label: L(p.themes.find((x) => x.theme_id === th), 'name', lang) }))
  const stageRows = p.stages.map((s) => ({ key: s.stage_id, label: L(s, 'name', lang) }))
    .filter((s) => res.alts.some((a) => (a.stageKg?.[s.key] ?? 0) > 0))
  const noStage = res.alts.filter((a) => !a.stageKg)
  const invRows = (group: string) => p.inventoryIndicators.filter((i) => i.group === group).map((i) => ({ key: i.indicator_id, label: L(i, 'name', lang) }))
  // all energy carriers in MJ (1 kWh = 3.6 MJ) so they share one axis
  const mj = (id: string, k: string) => { const x = v(id, k); return p.indicatorById.get(k)?.unit === 'kWh' ? x * 3.6 : x }
  const opIds = p.inventoryIndicators.filter((i) => ['water', 'waste', 'travel', 'api'].includes(i.group))

  const deltaCc = (v(best.id, 'cc') - v(curRes.id, 'cc')) * volume / 1000
  const deltaScore = (best.central - curRes.central) * volume

  return (
    <div className="view view-meso">
      <div className="grid-2">
        <Card title={t('score')} help={isExt ? t('scoreHelpExternal') : t('scoreHelpInternal')}>
          <ScoreIntervals res={res} alts={alts} colorOf={colorOf} />
          <table className="table compact-table">
            <thead><tr><th /><th>{t('pBest')}</th><th>{t('dataConfidence')}</th></tr></thead>
            <tbody>
              {res.alts.map((a) => (
                <tr key={a.id}>
                  <td><span className="swatch" style={{ background: seriesVar(colorOf(a.id)) }} />{altName(alts, a.id, lang)}</td>
                  <td className="num"><ProbBar p={a.pBest} colorIdx={colorOf(a.id)} /> {prob(a.pBest, lang)}</td>
                  <td><GradeBadge grade={a.quality.grade} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title={t('annualTotals')}>
          <label className="field inline">
            <span>{t('yourVolume')} <span className="muted">({L(situation, 'functional_unit', lang).toLowerCase()})</span></span>
            <input type="number" min={1} value={volume} onChange={(e) => setVolume(Math.max(0, Number(e.target.value) || 0))} />
            <span className="muted">{t('perYear')}</span>
          </label>
          <table className="table">
            <thead><tr><th /> {res.alts.map((a) => <th key={a.id} className="num"><span className="swatch" style={{ background: seriesVar(colorOf(a.id)) }} />{altName(alts, a.id, lang)}</th>)}</tr></thead>
            <tbody>
              {totals.map((row) => (
                <tr key={row.key}><td>{row.label}</td>{res.alts.map((a) => <td key={a.id} className="num">{fmt(row.f(a.id), lang)}</td>)}</tr>
              ))}
            </tbody>
          </table>
          {curRes.id !== best.id && (
            <p className="callout">
              {t('switchSaving', { n: int(volume, lang), from: altName(alts, curRes.id, lang), to: altName(alts, best.id, lang) })}:{' '}
              <b>{deltaCc > 0 ? '+' : ''}{fmt(deltaCc, lang)} {t('tCO2')}</b>
              {isExt && <> · <b>{deltaScore > 0 ? '+' : ''}{fmt(deltaScore, lang)} {t('personYears')}</b></>}
            </p>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title={t('themeContrib')} help={t('themeContribHelp')}>
          <GroupedBars rows={themeRows} series={series}
            value={(th, id) => {
              const c = res.alts.find((a) => a.id === id)?.themeContrib[th] ?? NaN
              return isExt ? c * 365 : c
            }}
            format={(x) => fmt(x, lang)} axisLabel={isExt ? t('personDays') : t('relativeScore')} />
        </Card>
        <Card title={t('hotspots')} help={t('hotspotsHelp')}>
          {stageRows.length > 0 && (
            <GroupedBars rows={stageRows} series={series}
              value={(st, id) => { const a = res.alts.find((x) => x.id === id); return a?.stageKg ? a.stageKg[st] ?? 0 : NaN }}
              format={(x) => fmt(x, lang)} axisLabel={t('kgCO2')} />
          )}
          {noStage.map((a) => <p key={a.id} className="muted small">{t('noStageData', { a: altName(alts, a.id, lang) })}</p>)}
        </Card>
      </div>

      <div className="grid-2">
        <Card title={t('energyCarrier')}>
          <GroupedBars rows={invRows('energy_carrier')} series={series} value={(k, id) => mj(id, k)}
            format={(x) => fmt(x, lang)} axisLabel={lang === 'nl' ? 'MJ (elektriciteit: 1 kWh = 3,6 MJ)' : 'MJ (electricity: 1 kWh = 3.6 MJ)'} />
        </Card>
        <Card title={t('energySource')}>
          <GroupedBars rows={invRows('energy_source')} series={series} value={(k, id) => v(id, k)}
            format={(x) => fmt(x, lang)} axisLabel="MJ" />
        </Card>
      </div>

      <Card title={t('operational')}>
        <table className="table">
          <thead><tr><th>{t('indicator')}</th><th>{t('unit')}</th>{res.alts.map((a) => <th key={a.id} className="num"><span className="swatch" style={{ background: seriesVar(colorOf(a.id)) }} />{altName(alts, a.id, lang)}</th>)}</tr></thead>
          <tbody>
            {opIds.map((i) => (
              <tr key={i.indicator_id}>
                <td>{L(i, 'name', lang)}</td><td className="muted">{unitLabel(i.unit)}</td>
                {res.alts.map((a) => <td key={a.id} className="num">{Number.isFinite(a.values[i.indicator_id]) ? fmt(a.values[i.indicator_id], lang) : <span className="muted">{t('noData')}</span>}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ExcludedNotice res={res} alts={alts} />
      <ClinicalNotes alts={alts} situation={situation} />
    </div>
  )
}
