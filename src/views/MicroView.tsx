import { commonUnit, fmt, inUnit, pct, prob } from '../lib/format'
import { L, translate, useT } from '../lib/i18n'
import { profileWeights } from '../lib/engine'
import { seriesVar } from '../components/charts'
import { Card, GradeBadge } from '../components/common'
import { altName, bestIndex, ClinicalNotes, ExcludedNotice, ScoreIntervals, type ViewProps } from './shared'

export function MicroView(props: ViewProps) {
  const { p, res, alts, colorOf, situation, settings } = props
  const t = useT()
  const lang = t.lang
  const bi = bestIndex(res)
  const best = res.alts[bi]
  const maxP = Math.max(...res.alts.map((a) => a.pBest))
  const leader = res.alts.find((a) => a.pBest === maxP)!
  const clear = maxP >= 0.8
  const worst = res.alts.reduce((w, a) => (a.central > w.central ? a : w), res.alts[0])
  const carKm = Number(p.settings.car_kg_co2e_per_km ?? 0.17) || 0.17

  // drivers of the gap between best and worst
  const gap = worst.central - best.central
  const diffs = res.themesUsed.map((th) => ({ th, d: (worst.themeContrib[th] ?? 0) - (best.themeContrib[th] ?? 0) }))
  const posSum = diffs.reduce((a, x) => a + Math.max(0, x.d), 0)
  const drivers = diffs
    .filter((x) => x.d > 0)
    .sort((a, b) => b.d - a.d)
    .slice(0, 2)
  const themeName = (id: string) => L(p.themes.find((x) => x.theme_id === id), 'name', lang)
  const stageName = (id: string) => L(p.stages.find((x) => x.stage_id === id), 'name', lang)
  const topStage = (id: string) => {
    const a = res.alts.find((x) => x.id === id)
    if (!a?.stageKg) return null
    const tot = Object.values(a.stageKg).reduce((x, y) => x + y, 0)
    const [st, kg] = Object.entries(a.stageKg).sort((x, y) => y[1] - x[1])[0]
    return { st, share: kg / tot }
  }
  const pw = profileWeights(p, settings)
  const unit = commonUnit(res.alts.map((a) => a.median))

  return (
    <div className="view view-micro">
      <section className={`hero ${clear ? 'hero-clear' : 'hero-unclear'}`}>
        {clear ? (
          <>
            <div className="hero-kicker">{t('lowest')}</div>
            <div className="hero-title"><span className="swatch lg" style={{ background: seriesVar(colorOf(leader.id)) }} />{altName(alts, leader.id, lang)}</div>
            <div className="hero-sub">{t('inPctSims', { p: prob(leader.pBest, lang) })}</div>
          </>
        ) : (
          <>
            <div className="hero-kicker">{t('noClearWinner')}</div>
            <div className="hero-sub">{t('noClearWinnerText', { p: `${altName(alts, leader.id, lang)}: ${prob(leader.pBest, lang)}` })}</div>
          </>
        )}
      </section>

      <div className="alt-cards">
        {res.alts.map((a) => {
          const isExt = res.normalisation === 'external'
          const ratio = best.central > 0 ? a.central / best.central : NaN
          return (
            <article className="alt-card" key={a.id} style={{ borderTopColor: seriesVar(colorOf(a.id)) }}>
              <h3><span className="swatch" style={{ background: seriesVar(colorOf(a.id)) }} />{altName(alts, a.id, lang)}</h3>
              <div className="alt-score">
                {isExt ? (
                  <>
                    <span className="big">{fmt(inUnit(a.median, unit), lang, 2)}</span> <span>{translate(lang, unit)}</span>
                    <div className="muted small">{t('footprintOf')}</div>
                  </>
                ) : (
                  <><span className="big">{fmt(a.median, lang, 2)}</span> <span>{t('relativeScore')}</span></>
                )}
              </div>
              {a.id !== best.id && Number.isFinite(ratio) && ratio > 1.05 && (
                <div className="ratio">{t('times', { x: fmt(ratio, lang, 2) })}</div>
              )}
              <dl className="mini">
                <dt>{t('climate')}</dt>
                <dd>{fmt(a.cc.central, lang)} {t('kgCO2')} <span className="muted">{t('carKm', { km: fmt(a.cc.central / carKm, lang, 2) })}</span></dd>
                <dt>{t('dataConfidence')}</dt>
                <dd><GradeBadge grade={a.quality.grade} /> <span className="muted">{a.quality.sources.length === 1 ? t('sourcesN1') : t('sourcesN', { n: a.quality.sources.length })}</span></dd>
              </dl>
            </article>
          )
        })}
      </div>

      <Card title={t('score')} help={res.normalisation === 'external' ? t('scoreHelpExternal') : t('scoreHelpInternal')}>
        <ScoreIntervals res={res} alts={alts} colorOf={colorOf} />
      </Card>

      {res.alts.length > 1 && gap > 0 && (
        <Card title={t('whatDrives')}>
          <ul className="drivers">
            {drivers.map((d) => (
              <li key={d.th}>{t('drivesText', { theme: themeName(d.th), pct: pct(d.d / posSum, lang), a: altName(alts, worst.id, lang), b: altName(alts, best.id, lang) })}</li>
            ))}
            {[worst.id, best.id].map((id) => {
              const s = topStage(id)
              return s ? <li key={id}>{t('biggestStage', { a: altName(alts, id, lang), stage: stageName(s.st).toLowerCase(), pct: pct(s.share, lang) })}</li> : null
            })}
          </ul>
        </Card>
      )}

      <ExcludedNotice res={res} alts={alts} />
      <ClinicalNotes alts={alts} situation={situation} />
      <p className="muted small">{t('weightedWith')}: {lang === 'nl' ? pw.name.nl : pw.name.en} ({t('changeInMacro')}).</p>
    </div>
  )
}
