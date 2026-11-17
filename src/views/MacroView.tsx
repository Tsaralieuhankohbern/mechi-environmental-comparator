import { useMemo, useState } from 'react'
import { fmt, int, pct, prob, unitLabel } from '../lib/format'
import { L, useT } from '../lib/i18n'
import { gradeFromMean, pedigreeMean, profileWeights, robustness } from '../lib/engine'
import { METHODS } from '../lib/methods'
import { GroupedBars, ProbBar, seriesVar } from '../components/charts'
import { Card, GradeBadge, Info } from '../components/common'
import { altName, bestIndex, ClinicalNotes, ExcludedNotice, ScoreIntervals, type ViewProps } from './shared'

export function MacroView(props: ViewProps) {
  const { p, res, alts, colorOf, situation, settings, setSettings } = props
  const t = useT()
  const lang = t.lang
  const altIds = res.alts.map((a) => a.id)
  const robust = useMemo(() => robustness(p, altIds, settings, Math.min(800, settings.iterations)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p, altIds.join(','), settings])
  const [showNorm, setShowNorm] = useState(false)
  const [target, setTarget] = useState<string>('')
  const isExt = res.normalisation === 'external'
  const best = res.alts[bestIndex(res)]
  const targetId = altIds.includes(target) ? target : best.id
  const pw = profileWeights(p, settings)

  // national scaling
  const V = Number(situation.nl_annual_volume) || 0
  const shareSum = alts.reduce((a, x) => a + (Number(x.nl_current_share) || 0), 0)
  const shareOf = (id: string) => (shareSum > 0 ? (Number(alts.find((a) => a.intervention_id === id)?.nl_current_share) || 0) / shareSum : 1 / alts.length)
  const mixScore = res.alts.reduce((s, a) => s + shareOf(a.id) * a.central, 0)
  const mixCc = res.alts.reduce((s, a) => s + shareOf(a.id) * (a.values.cc || 0), 0)
  const tgt = res.alts.find((a) => a.id === targetId)!
  const robustSame = new Set(robust.map((r) => r.ranking[0])).size === 1

  const setS = (patch: Partial<typeof settings>) => setSettings({ ...settings, ...patch })
  const toCustom = () => setS({ profileId: 'custom', customWeights: { ...pw.mean } })
  const weightSum = p.themes.reduce((a, th) => a + (settings.customWeights[th.theme_id] ?? 0), 0)

  const srcIds = [...new Set(res.alts.flatMap((a) => a.quality.sources))]
  const ctx = { p, situation, alts, res, settings, lang, robust }
  const allInd = [...p.impactIndicators, ...p.inventoryIndicators]

  return (
    <div className="view view-macro">
      <aside className="settings-panel">
        <Card title={t('analysisSettings')}>
          <label className="field">
            <span>{t('weightProfile')}</span>
            <select value={settings.profileId} onChange={(e) => setS({ profileId: e.target.value })}>
              {p.profiles.map((pr) => <option key={pr.id} value={pr.id}>{L(pr, 'name', lang)}</option>)}
              <option value="custom">{t('custom')}</option>
            </select>
          </label>
          <div className="weights">
            <div className="weights-head"><b>{t('editWeights')}</b> <Info text={t('weightsHelp')} /></div>
            {p.themes.map((th) => {
              const id = th.theme_id
              const used = res.themesUsed.includes(id)
              const mean = settings.profileId === 'custom' ? settings.customWeights[id] ?? 0 : pw.mean[id] ?? 0
              const sd = pw.sd[id] ?? 0
              return (
                <div className={`w-row ${used ? '' : 'w-unused'}`} key={id} title={L(th, 'description', lang)}>
                  <span className="w-name">{L(th, 'name', lang)}</span>
                  {settings.profileId === 'custom' ? (
                    <input type="range" min={0} max={50} step={0.5} value={mean} aria-label={L(th, 'name', lang)}
                      onChange={(e) => setS({ customWeights: { ...settings.customWeights, [id]: Number(e.target.value) } })} />
                  ) : (
                    <span className="w-bar"><span style={{ width: `${Math.min(100, mean * 2)}%` }} /></span>
                  )}
                  <span className="w-val">{fmt(mean, lang, 3)}%{sd > 0 && <span className="muted"> ±{fmt(sd, lang, 2)}</span>}</span>
                </div>
              )
            })}
            {settings.profileId === 'custom'
              ? <div className="muted small">{t('sum')}: {fmt(weightSum, lang)}% → 100%</div>
              : <button className="btn btn-small" onClick={toCustom}>{t('resetWeights')} → {t('custom')}</button>}
          </div>
          <fieldset className="field">
            <legend>{t('normalisation')}</legend>
            <label className="radio"><input type="radio" checked={settings.normalisation === 'external'} onChange={() => setS({ normalisation: 'external' })} /> {t('normExternal')}</label>
            <label className="radio"><input type="radio" checked={settings.normalisation === 'internal'} onChange={() => setS({ normalisation: 'internal' })} /> {t('normInternal')}</label>
          </fieldset>
          <label className="check"><input type="checkbox" checked={settings.harmonise} onChange={(e) => setS({ harmonise: e.target.checked })} /> {t('harmonise')} <Info text={t('harmoniseHelp')} /></label>
          <label className="check"><input type="checkbox" checked={settings.weightUncertainty} onChange={(e) => setS({ weightUncertainty: e.target.checked })} /> {t('weightUncertainty')}</label>
          <label className="field">
            <span>{t('sourceWeighting')}</span>
            <select value={settings.sourceWeighting} onChange={(e) => setS({ sourceWeighting: e.target.value as typeof settings.sourceWeighting })}>
              <option value="inverse_variance">{t('invVar')}</option>
              <option value="equal">{t('equalW')}</option>
            </select>
          </label>
          <div className="field-row">
            <label className="field">
              <span>{t('iterations')}</span>
              <select value={settings.iterations} onChange={(e) => setS({ iterations: Number(e.target.value) })}>
                {[500, 1000, 2000, 5000, 10000].map((n) => <option key={n} value={n}>{int(n, lang)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t('seed')}</span>
              <input type="number" value={settings.seed} onChange={(e) => setS({ seed: Number(e.target.value) || 1 })} />
            </label>
          </div>
        </Card>
        <Card title={t('exports')}>
          <div className="btn-col">
            <button className="btn" onClick={() => import('../lib/exporters').then((m) => m.exportPdf(ctx))}>{t('exportPdf')}</button>
            <button className="btn" onClick={() => import('../lib/exporters').then((m) => m.exportResultsXlsx(ctx))}>{t('exportXlsx')}</button>
            <button className="btn" onClick={() => import('../lib/exporters').then((m) => m.exportCsv(ctx))}>{t('exportCsv')}</button>
          </div>
        </Card>
      </aside>

      <div className="macro-main">
        <Card title={t('score')} help={isExt ? t('scoreHelpExternal') : t('scoreHelpInternal')}>
          <ScoreIntervals res={res} alts={alts} colorOf={colorOf} />
        </Card>
        <ExcludedNotice res={res} alts={alts} />

        <div className="stack">
          <Card title={t('probabilities')}>
            <table className="table">
              <thead><tr><th /><th className="num">{t('pBest')}</th>{res.alts.map((_, r) => <th key={r} className="num">{t('rank')} {r + 1}</th>)}</tr></thead>
              <tbody>
                {res.alts.map((a) => (
                  <tr key={a.id}>
                    <td><span className="swatch" style={{ background: seriesVar(colorOf(a.id)) }} />{altName(alts, a.id, lang)}</td>
                    <td className="num"><ProbBar p={a.pBest} colorIdx={colorOf(a.id)} /> {prob(a.pBest, lang)}</td>
                    {a.rankProbs.map((rp, r) => <td key={r} className="num">{prob(rp, lang)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {res.alts.length > 2 && (
              <>
                <h4 className="sub-h">{t('pairwise')}</h4>
                <table className="table">
                  <thead><tr><th />{res.alts.map((a) => <th key={a.id} className="num"><span className="swatch" style={{ background: seriesVar(colorOf(a.id)) }} /></th>)}</tr></thead>
                  <tbody>
                    {res.alts.map((a, i) => (
                      <tr key={a.id}>
                        <td><span className="swatch" style={{ background: seriesVar(colorOf(a.id)) }} />{altName(alts, a.id, lang)}</td>
                        {res.alts.map((b, j) => <td key={b.id} className="num">{i === j ? '–' : prob(res.pairwise[i][j], lang)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Card>
          <Card title={t('robustness')} help={t('robustnessHelp')}>
            <p className={robustSame ? 'ok-text' : 'warn-text'}>{robustSame ? `✓ ${t('robustYes', { n: robust.length })}` : `▲ ${t('robustNo')}`}</p>
            <table className="table">
              <thead><tr><th>{t('profile')}</th><th>{t('ranking')}</th></tr></thead>
              <tbody>
                {robust.map((r) => (
                  <tr key={r.profile.id} className={r.profile.id === settings.profileId ? 'row-active' : ''}>
                    <td>{L(r.profile, 'name', lang)}</td>
                    <td>{r.ranking.map((id, k) => (
                      <span key={id} className="rank-chip">
                        <span className="swatch" style={{ background: seriesVar(colorOf(id)) }} />
                        {k === 0 ? <b>{altName(alts, id, lang)}</b> : altName(alts, id, lang)}
                        {k === 0 && <span className="muted"> ({prob(r.pBest[id], lang)})</span>}
                        {k < r.ranking.length - 1 && <span className="muted"> &lt; </span>}
                      </span>
                    ))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        <Card title={t('national')} help={t('nationalHelp')}>
          <div className="national">
            <table className="table">
              <thead><tr><th /><th className="num">{t('currentShare')}</th><th className="num">{t('climate')} ({t('tCO2')}/{lang === 'nl' ? 'jaar' : 'yr'})</th>{isExt && <th className="num">{t('personYears')}/{lang === 'nl' ? 'jaar' : 'yr'}</th>}</tr></thead>
              <tbody>
                {res.alts.map((a) => (
                  <tr key={a.id}>
                    <td><span className="swatch" style={{ background: seriesVar(colorOf(a.id)) }} />{altName(alts, a.id, lang)}</td>
                    <td className="num">{pct(shareOf(a.id), lang)}</td>
                    <td className="num">{fmt((V * (a.values.cc || 0)) / 1000, lang)}</td>
                    {isExt && <td className="num">{fmt(V * a.central, lang)}</td>}
                  </tr>
                ))}
                <tr className="row-total"><td>{t('currentMix')} ({t('annualVolume').toLowerCase()} {int(V, lang)})</td><td className="num">100%</td>
                  <td className="num">{fmt((V * mixCc) / 1000, lang)}</td>{isExt && <td className="num">{fmt(V * mixScore, lang)}</td>}</tr>
              </tbody>
            </table>
            <div className="scenario">
              <label className="field inline">
                <span>{t('scenarioAll')}</span>
                <select value={targetId} onChange={(e) => setTarget(e.target.value)}>
                  {res.alts.map((a) => <option key={a.id} value={a.id}>{altName(alts, a.id, lang)}</option>)}
                </select>
              </label>
              <div className="scenario-out">
                <div>{t('change')}: <b>{fmt((V * ((tgt.values.cc || 0) - mixCc)) / 1000, lang)} {t('tCO2')}</b> {lang === 'nl' ? 'per jaar' : 'per year'}</div>
                {isExt && <div><b>{fmt(V * (tgt.central - mixScore), lang)} {t('personYears')}</b> — {t('personsEquiv', { n: int(Math.abs(V * (tgt.central - mixScore)), lang) })}</div>}
              </div>
            </div>
          </div>
        </Card>

        <Card title={t('themeContrib')} help={t('themeContribHelp')}>
          <GroupedBars rows={res.themesUsed.map((th) => ({ key: th, label: L(p.themes.find((x) => x.theme_id === th), 'name', lang), sub: `· ${pct(res.weights[th], lang, 1)}` }))}
            series={res.alts.map((a) => ({ id: a.id, label: altName(alts, a.id, lang), colorIdx: colorOf(a.id) }))}
            value={(th, id) => { const c = res.alts.find((a) => a.id === id)?.themeContrib[th] ?? NaN; return isExt ? c * 365 : c }}
            format={(x) => fmt(x, lang)} axisLabel={isExt ? t('personDays') : t('relativeScore')} />
        </Card>

        <Card title={t('indicatorTable')} actions={
          <label className="check small"><input type="checkbox" checked={showNorm} onChange={(e) => setShowNorm(e.target.checked)} /> {t('showNormalised')}</label>
        }>
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>{t('indicator')}</th><th>{t('unit')}</th><th /> {res.alts.map((a) => <th key={a.id} className="num"><span className="swatch" style={{ background: seriesVar(colorOf(a.id)) }} />{altName(alts, a.id, lang)}</th>)}</tr></thead>
              <tbody>
                {allInd.map((i) => {
                  const inc = res.included.some((x) => x.indicator_id === i.indicator_id)
                  const norm = showNorm && i.kind === 'impact' && inc
                  return (
                    <tr key={i.indicator_id} className={i.kind === 'inventory' ? 'row-inv' : inc ? '' : 'row-excl'}>
                      <td>{L(i, 'name', lang)}</td>
                      <td className="muted">{norm ? 'mPE' : unitLabel(i.unit)}</td>
                      <td><span className={`tag ${i.kind === 'inventory' ? 'tag-muted' : inc ? 'tag-on' : 'tag-off'}`}>{i.kind === 'inventory' ? t('inventoryOnly') : inc ? t('included') : '×'}</span></td>
                      {res.alts.map((a) => {
                        const v = norm ? (a.pe[i.indicator_id] ?? NaN) * 1000 : a.values[i.indicator_id]
                        return <td key={a.id} className="num">{Number.isFinite(v) ? fmt(v, lang) : <span className="muted">–</span>}</td>
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={t('sourcesTable')}>
          <div className="table-scroll">
            <table className="table sources">
              <thead><tr><th>{t('source')}</th><th>{t('type')}</th><th>{t('country')}</th><th className="num">{t('year')}</th><th>{t('pedigree')}</th><th>{t('grade')}</th><th>{t('harmonisedCol')}</th></tr></thead>
              <tbody>
                {srcIds.map((sid) => {
                  const s = p.sourceById.get(sid)
                  const harm = res.alts.some((a) => a.quality.harmonised.includes(sid))
                  const nonH = res.alts.some((a) => a.quality.nonHarmonisable.includes(sid))
                  return (
                    <tr key={sid}>
                      <td title={s?.calibration_note}><div className="src-title">{s?.title ?? sid}</div><div className="muted small">{sid} · {s?.method} · {s?.reports}</div></td>
                      <td>{s?.source_type}</td>
                      <td>{s?.country}</td>
                      <td className="num">{s?.year}</td>
                      <td className="mono">{s ? [s.reliability, s.completeness, s.temporal, s.geographical, s.technological].join(' ') : '–'}</td>
                      <td><GradeBadge grade={gradeFromMean(pedigreeMean(s))} /></td>
                      <td>{s?.country === p.baseCountry ? t('harmNA') : harm ? t('harmYes') : nonH ? t('harmNo') : '–'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <ClinicalNotes alts={alts} situation={situation} />

        <Card title={t('methods')} className="methods">
          {METHODS[lang].map((m) => (
            <div key={m.h} className="method"><h4>{m.h}</h4><p>{m.p}</p></div>
          ))}
        </Card>
      </div>
    </div>
  )
}
