/**
 * Calculation engine.
 *
 * Pipeline per comparison:
 *  1. Collect data rows per alternative × indicator (several sources per cell possible).
 *  2. Harmonise climate change to the base-country electricity grid (if the row reports
 *     its on-site electricity share and the source country has a grid factor).
 *  3. Turn every row into a lognormal distribution: median = reported value, log-SD from
 *     the reported range plus the Weidema pedigree variance of its source.
 *  4. Central value per cell = (inverse-variance) weighted mean of rows.
 *  5. Monte Carlo: per iteration and alternative, pick a source (mixture weighted by quality),
 *     sample correlated values, normalise, aggregate to themes, weight, and sum.
 *     Optionally the stakeholder weights are sampled too (SMAA-style).
 *  6. Report score percentiles, probability of lowest impact, pairwise probabilities,
 *     and theme contributions.
 */
import type {
  AnalysisSettings, ContributionRow, DataRow, Dataset, Indicator, Source, Stage, Theme, WeightProfile,
} from '../types'

// ---------------------------------------------------------------- random numbers
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function makeNormal(rand: () => number) {
  let spare: number | null = null
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s }
    let u = 0, v = 0, s = 0
    do { u = rand() * 2 - 1; v = rand() * 2 - 1; s = u * u + v * v } while (s >= 1 || s === 0)
    const m = Math.sqrt((-2 * Math.log(s)) / s)
    spare = v * m
    return u * m
  }
}

// ---------------------------------------------------------------- pedigree
/** Variances of ln (ecoinvent v3 / Weidema et al. 2013) for scores 1..5 */
export const PEDIGREE_VAR: Record<string, number[]> = {
  reliability: [0, 0.0006, 0.002, 0.008, 0.04],
  completeness: [0, 0.0001, 0.0006, 0.002, 0.008],
  temporal: [0, 0.0002, 0.002, 0.008, 0.04],
  geographical: [0, 0.000025, 0.0001, 0.0006, 0.002],
  technological: [0, 0.0006, 0.008, 0.04, 0.12],
}
export const PEDIGREE_KEYS = ['reliability', 'completeness', 'temporal', 'geographical', 'technological'] as const

function clampScore(x: unknown) {
  const n = Math.round(Number(x))
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3
}
export function pedigreeVariance(s?: Source) {
  if (!s) return PEDIGREE_KEYS.reduce((a, k) => a + PEDIGREE_VAR[k][2], 0)
  return PEDIGREE_KEYS.reduce((a, k) => a + PEDIGREE_VAR[k][clampScore(s[k]) - 1], 0)
}
export type Grade = 'A' | 'B' | 'C' | 'D' | 'E'
export function pedigreeMean(s?: Source) {
  if (!s) return 3
  return PEDIGREE_KEYS.reduce((a, k) => a + clampScore(s[k]), 0) / PEDIGREE_KEYS.length
}
export function gradeFromMean(m: number): Grade {
  return m <= 1.5 ? 'A' : m <= 2.25 ? 'B' : m <= 3 ? 'C' : m <= 3.75 ? 'D' : 'E'
}

// ---------------------------------------------------------------- prepared dataset
export interface Prepared {
  ds: Dataset
  indicatorById: Map<string, Indicator>
  sourceById: Map<string, Source>
  gridByCountry: Map<string, number>
  rows: Map<string, Map<string, DataRow[]>> // intervention -> indicator -> rows
  contributions: Map<string, ContributionRow[]>
  profiles: WeightProfile[]
  settings: Record<string, string | number>
  baseCountry: string
  baseGrid: number
  impactIndicators: Indicator[]
  inventoryIndicators: Indicator[]
  themes: Theme[]
  stages: Stage[]
  defaultSigma: number
}

export function prepare(ds: Dataset): Prepared {
  const indicatorById = new Map(ds.indicators.map((i) => [i.indicator_id, i]))
  const sourceById = new Map(ds.sources.map((s) => [s.source_id, s]))
  const gridByCountry = new Map(ds.gridFactors.map((g) => [g.country, Number(g.kg_co2e_per_kwh)]))
  const settings: Record<string, string | number> = {}
  for (const s of ds.settings) settings[s.key] = s.value
  const baseCountry = String(settings.base_country ?? 'NL')
  const baseGrid = gridByCountry.get(baseCountry) ?? NaN

  const rows = new Map<string, Map<string, DataRow[]>>()
  const push = (r: DataRow) => {
    if (!rows.has(r.intervention_id)) rows.set(r.intervention_id, new Map())
    const m = rows.get(r.intervention_id)!
    if (!m.has(r.indicator_id)) m.set(r.indicator_id, [])
    m.get(r.indicator_id)!.push(r)
  }
  for (const r of ds.data) {
    if (r.value === null || r.value === undefined || !Number.isFinite(Number(r.value))) continue
    push({ ...r, value: Number(r.value) })
  }

  // Derived indicator: hazard-weighted waste = sum(stream kg × hazard factor), per source
  const wasteStreams = ds.indicators.filter((i) => i.kind === 'inventory' && i.hazard_factor != null && Number.isFinite(Number(i.hazard_factor)))
  if (indicatorById.has('waste_hw')) {
    for (const [iid, m] of rows) {
      const bySource = new Map<string, { v: number; lo: number; hi: number }>()
      for (const ws of wasteStreams) {
        for (const r of m.get(ws.indicator_id) ?? []) {
          const h = Number(ws.hazard_factor)
          const acc = bySource.get(r.source_id) ?? { v: 0, lo: 0, hi: 0 }
          acc.v += h * r.value
          acc.lo += h * (r.low != null && Number.isFinite(Number(r.low)) ? Number(r.low) : r.value)
          acc.hi += h * (r.high != null && Number.isFinite(Number(r.high)) ? Number(r.high) : r.value)
          bySource.set(r.source_id, acc)
        }
      }
      for (const [sid, a] of bySource) {
        push({ intervention_id: iid, source_id: sid, indicator_id: 'waste_hw', value: a.v, low: a.lo, high: a.hi, note: 'derived' })
      }
    }
  }

  const contributions = new Map<string, ContributionRow[]>()
  for (const c of ds.contributions) {
    if (!contributions.has(c.intervention_id)) contributions.set(c.intervention_id, [])
    contributions.get(c.intervention_id)!.push({ ...c, share: Number(c.share) })
  }

  const byProfile = new Map<string, WeightProfile>()
  for (const w of ds.weightProfiles) {
    let p = byProfile.get(w.profile_id)
    if (!p) {
      p = { id: w.profile_id, name_en: w.name_en, name_nl: w.name_nl, group_en: w.group_en, group_nl: w.group_nl,
        panelSize: Number(w.panel_size) || 0, mean: {}, sd: {}, synthetic: String(w.synthetic).toLowerCase() === 'yes' }
      byProfile.set(w.profile_id, p)
    }
    p.mean[w.theme_id] = Number(w.weight_mean) || 0
    p.sd[w.theme_id] = Number(w.weight_sd) || 0
  }

  const themes = [...ds.themes].sort((a, b) => Number(a.order) - Number(b.order))
  const themeOrder = new Map(themes.map((t, i) => [t.theme_id, i]))
  const impactIndicators = ds.indicators
    .filter((i) => i.kind === 'impact')
    .sort((a, b) => (themeOrder.get(a.theme_id) ?? 99) - (themeOrder.get(b.theme_id) ?? 99))
  const inventoryIndicators = ds.indicators.filter((i) => i.kind === 'inventory')
  const stages = [...ds.stages].sort((a, b) => Number(a.order) - Number(b.order))
  const defaultSigma = Number(settings.default_sigma ?? 0.35) || 0.35

  return { ds, indicatorById, sourceById, gridByCountry, rows, contributions, profiles: [...byProfile.values()], settings,
    baseCountry, baseGrid, impactIndicators, inventoryIndicators, themes, stages, defaultSigma }
}

// ---------------------------------------------------------------- rows -> distributions
export interface ProcRow {
  sourceId: string
  value: number
  low: number | null
  high: number | null
  sigma: number
  weight: number
  harmonised: boolean
  harmonisable: boolean
  factor: number
}

export function processRow(p: Prepared, r: DataRow, opts: Pick<AnalysisSettings, 'harmonise' | 'sourceWeighting'>): ProcRow {
  const src = p.sourceById.get(r.source_id)
  let value = Number(r.value)
  let low = r.low != null && Number.isFinite(Number(r.low)) ? Number(r.low) : null
  let high = r.high != null && Number.isFinite(Number(r.high)) ? Number(r.high) : null
  let harmonised = false
  let harmonisable = false
  let factor = 1
  if (r.indicator_id === 'cc' && src) {
    if (src.country === p.baseCountry) harmonisable = true
    else {
      const g = p.gridByCountry.get(src.country)
      const e = r.electricity_share
      if (e != null && Number.isFinite(Number(e)) && g && g > 0 && Number.isFinite(p.baseGrid)) {
        harmonisable = true
        if (opts.harmonise) {
          factor = 1 - Number(e) + (Number(e) * p.baseGrid) / g
          value *= factor
          if (low != null) low *= factor
          if (high != null) high *= factor
          harmonised = true
        }
      }
    }
  }
  let sigma = p.defaultSigma
  if (low != null && high != null && low > 0 && high > low) sigma = (Math.log(high) - Math.log(low)) / (2 * 1.645)
  const s2 = sigma * sigma + pedigreeVariance(src)
  return { sourceId: r.source_id, value, low, high, sigma: Math.sqrt(s2), weight: opts.sourceWeighting === 'equal' ? 1 : 1 / s2,
    harmonised, harmonisable, factor }
}

export function centralOf(rows: ProcRow[]) {
  const w = rows.reduce((a, r) => a + r.weight, 0)
  return w > 0 ? rows.reduce((a, r) => a + r.weight * r.value, 0) / w : NaN
}

// ---------------------------------------------------------------- weights
export function profileWeights(p: Prepared, s: AnalysisSettings): { mean: Record<string, number>; sd: Record<string, number>; name: { en: string; nl: string } } {
  if (s.profileId === 'custom') {
    const sd: Record<string, number> = {}
    for (const t of p.themes) sd[t.theme_id] = 0
    return { mean: { ...s.customWeights }, sd, name: { en: 'Custom weights', nl: 'Eigen gewichten' } }
  }
  const prof = p.profiles.find((x) => x.id === s.profileId) ?? p.profiles[0]
  return { mean: prof?.mean ?? {}, sd: prof?.sd ?? {}, name: { en: prof?.name_en ?? '', nl: prof?.name_nl ?? '' } }
}

// ---------------------------------------------------------------- comparison
export interface AltResult {
  id: string
  central: number
  themeContrib: Record<string, number> // weighted contribution to the score
  pe: Record<string, number> // normalised value per included indicator
  values: Record<string, number> // central value per indicator (impact + inventory), NaN if missing
  median: number
  p05: number
  p95: number
  pBest: number
  rankProbs: number[]
  cc: { central: number; p05: number; p95: number }
  stageKg: Record<string, number> | null
  quality: { grade: Grade; meanPedigree: number; sources: string[]; nonHarmonisable: string[]; harmonised: string[] }
}

export interface ComparisonResult {
  alts: AltResult[]
  included: Indicator[]
  excluded: { indicator: Indicator; missingFor: string[] }[]
  themesUsed: string[]
  weights: Record<string, number> // fraction, normalised over used themes
  weightsRaw: Record<string, number>
  pairwise: number[][] // P(row alt has lower score than column alt)
  normalisation: 'external' | 'internal'
  iterations: number
  rowsByAlt: Map<string, Map<string, ProcRow[]>>
}

function quantile(sorted: Float64Array, q: number) {
  if (sorted.length === 0) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function compare(p: Prepared, altIds: string[], s: AnalysisSettings, opts: { iterations?: number; withDetails?: boolean } = {}): ComparisonResult {
  const N = Math.max(50, Math.round(opts.iterations ?? s.iterations))
  const rand = mulberry32(s.seed || 1)
  const normal = makeNormal(rand)

  // processed rows per alt × indicator
  const rowsByAlt = new Map<string, Map<string, ProcRow[]>>()
  for (const a of altIds) {
    const m = new Map<string, ProcRow[]>()
    for (const [ind, rs] of p.rows.get(a) ?? []) m.set(ind, rs.map((r) => processRow(p, r, s)))
    rowsByAlt.set(a, m)
  }

  // included / excluded impact indicators
  const included: Indicator[] = []
  const excluded: ComparisonResult['excluded'] = []
  for (const ind of p.impactIndicators) {
    const missing = altIds.filter((a) => !(rowsByAlt.get(a)?.get(ind.indicator_id)?.length))
    const nfOk = s.normalisation === 'internal' || (ind.nf != null && Number(ind.nf) > 0)
    if (missing.length === 0 && nfOk) included.push(ind)
    else if (missing.length > 0) excluded.push({ indicator: ind, missingFor: missing })
  }

  // themes and weights
  const pw = profileWeights(p, s)
  const themesUsed = p.themes.map((t) => t.theme_id).filter((t) => included.some((i) => i.theme_id === t))
  const rawSum = themesUsed.reduce((a, t) => a + Math.max(0, pw.mean[t] ?? 0), 0)
  const weights: Record<string, number> = {}
  for (const t of themesUsed) weights[t] = rawSum > 0 ? Math.max(0, pw.mean[t] ?? 0) / rawSum : 1 / themesUsed.length
  const sdFrac: Record<string, number> = {}
  for (const t of themesUsed) sdFrac[t] = rawSum > 0 ? (pw.sd[t] ?? 0) / rawSum : 0

  // indicator layout
  const nInd = included.length
  const themeIdx = included.map((i) => themesUsed.indexOf(i.theme_id))
  const sub = included.map((i) => (i.subweight != null && Number(i.subweight) > 0 ? Number(i.subweight) : 1))
  const subSum = themesUsed.map((_, t) => included.reduce((a, _i, k) => a + (themeIdx[k] === t ? sub[k] : 0), 0))
  const nf = included.map((i) => Number(i.nf) || 1)
  const ccIdx = included.findIndex((i) => i.indicator_id === 'cc')

  const scoreOf = (vals: number[][], w: number[], themeOut?: number[][]) => {
    const nA = vals.length
    const totals = new Array(nA).fill(0)
    const maxv = new Array(nInd).fill(0)
    if (s.normalisation === 'internal') for (let k = 0; k < nInd; k++) for (let a = 0; a < nA; a++) maxv[k] = Math.max(maxv[k], vals[a][k])
    for (let a = 0; a < nA; a++) {
      const th = new Array(themesUsed.length).fill(0)
      for (let k = 0; k < nInd; k++) {
        const pe = s.normalisation === 'internal' ? (maxv[k] > 0 ? vals[a][k] / maxv[k] : 0) : vals[a][k] / nf[k]
        th[themeIdx[k]] += (sub[k] * pe) / subSum[themeIdx[k]]
      }
      for (let t = 0; t < th.length; t++) { th[t] *= w[t]; totals[a] += th[t] }
      if (themeOut) themeOut[a] = th
    }
    return totals
  }

  // central
  const centralVals = altIds.map((a) => included.map((i) => centralOf(rowsByAlt.get(a)!.get(i.indicator_id)!)))
  const wMean = themesUsed.map((t) => weights[t])
  const themeOut: number[][] = []
  const centralTotals = scoreOf(centralVals, wMean, themeOut)

  // Monte Carlo
  const nA = altIds.length
  const samples = altIds.map(() => new Float64Array(N))
  const ccSamples = altIds.map(() => new Float64Array(N))
  const best = new Array(nA).fill(0)
  const rankCounts = altIds.map(() => new Array(nA).fill(0))
  const pair = altIds.map(() => new Array(nA).fill(0))
  const rho = 0.7, rho2 = Math.sqrt(1 - rho * rho)
  const cells = altIds.map((a) => included.map((i) => rowsByAlt.get(a)!.get(i.indicator_id)!))
  const cellCum = cells.map((row) => row.map((rs) => {
    const tot = rs.reduce((x, r) => x + r.weight, 0)
    let c = 0
    return rs.map((r) => (c += r.weight / tot))
  }))
  const ccCells = altIds.map((a) => rowsByAlt.get(a)!.get('cc') ?? [])
  const ccCum = ccCells.map((rs) => { const tot = rs.reduce((x, r) => x + r.weight, 0); let c = 0; return rs.map((r) => (c += r.weight / tot)) })
  const vals: number[][] = altIds.map(() => new Array(nInd).fill(0))
  const w = new Array(themesUsed.length).fill(0)
  const pick = (cum: number[], u: number) => { for (let j = 0; j < cum.length; j++) if (u <= cum[j]) return j; return cum.length - 1 }

  for (let it = 0; it < N; it++) {
    if (s.weightUncertainty) {
      let sum = 0
      for (let t = 0; t < w.length; t++) { w[t] = Math.max(0, wMean[t] + sdFrac[themesUsed[t]] * normal()); sum += w[t] }
      for (let t = 0; t < w.length; t++) w[t] = sum > 0 ? w[t] / sum : wMean[t]
    } else for (let t = 0; t < w.length; t++) w[t] = wMean[t]
    for (let a = 0; a < nA; a++) {
      const u = rand()
      const zc = normal()
      for (let k = 0; k < nInd; k++) {
        const r = cells[a][k][pick(cellCum[a][k], u)]
        const z = rho * zc + rho2 * normal()
        vals[a][k] = r.value > 0 ? r.value * Math.exp(r.sigma * z) : 0
      }
      if (ccIdx >= 0) ccSamples[a][it] = vals[a][ccIdx]
      else if (ccCells[a].length) {
        const r = ccCells[a][pick(ccCum[a], u)]
        ccSamples[a][it] = r.value > 0 ? r.value * Math.exp(r.sigma * zc) : 0
      } else ccSamples[a][it] = NaN
    }
    const tot = scoreOf(vals, w)
    const order = tot.map((v, i) => [v, i] as [number, number]).sort((x, y) => x[0] - y[0])
    best[order[0][1]]++
    order.forEach(([, i], rank) => rankCounts[i][rank]++)
    for (let a = 0; a < nA; a++) {
      samples[a][it] = tot[a]
      for (let b = 0; b < nA; b++) if (a !== b && tot[a] < tot[b]) pair[a][b]++
    }
  }

  const alts: AltResult[] = altIds.map((id, a) => {
    const sorted = Float64Array.from(samples[a]).sort()
    const ccs = Float64Array.from(ccSamples[a]).filter((x) => Number.isFinite(x)).sort()
    const m = rowsByAlt.get(id)!
    const values: Record<string, number> = {}
    for (const ind of [...p.impactIndicators, ...p.inventoryIndicators]) {
      const rs = m.get(ind.indicator_id)
      values[ind.indicator_id] = rs && rs.length ? centralOf(rs) : NaN
    }
    const pe: Record<string, number> = {}
    included.forEach((ind, k) => { pe[ind.indicator_id] = centralVals[a][k] / nf[k] })
    const themeContrib: Record<string, number> = {}
    themesUsed.forEach((t, k) => (themeContrib[t] = themeOut[a][k]))
    // quality
    const srcIds = [...new Set([...m.values()].flat().map((r) => r.sourceId))]
    const meanPed = srcIds.length ? srcIds.reduce((x, sid) => x + pedigreeMean(p.sourceById.get(sid)), 0) / srcIds.length : 5
    const ccRows = m.get('cc') ?? []
    return {
      id,
      central: centralTotals[a],
      themeContrib,
      pe,
      values,
      median: quantile(sorted, 0.5),
      p05: quantile(sorted, 0.05),
      p95: quantile(sorted, 0.95),
      pBest: best[a] / N,
      rankProbs: rankCounts[a].map((c) => c / N),
      cc: { central: values.cc, p05: quantile(ccs, 0.05), p95: quantile(ccs, 0.95) },
      stageKg: stageBreakdown(p, id, values.cc, s),
      quality: {
        grade: gradeFromMean(meanPed), meanPedigree: meanPed, sources: srcIds,
        nonHarmonisable: ccRows.filter((r) => !r.harmonisable).map((r) => r.sourceId),
        harmonised: ccRows.filter((r) => r.harmonised).map((r) => r.sourceId),
      },
    }
  })

  return {
    alts, included, excluded, themesUsed, weights, weightsRaw: pw.mean,
    pairwise: pair.map((row) => row.map((c) => c / N)), normalisation: s.normalisation, iterations: N, rowsByAlt,
  }
}

/** Climate change per life-cycle stage (kg CO2-eq), from the sources' contribution analyses. */
export function stageBreakdown(p: Prepared, altId: string, ccCentral: number, s: AnalysisSettings): Record<string, number> | null {
  const cs = p.contributions.get(altId)
  if (!cs || !cs.length || !Number.isFinite(ccCentral)) return null
  const bySrc = new Map<string, Record<string, number>>()
  for (const c of cs) {
    const r = bySrc.get(c.source_id) ?? {}
    r[c.stage_id] = (r[c.stage_id] ?? 0) + c.share
    bySrc.set(c.source_id, r)
  }
  const acc: Record<string, number> = {}
  let wsum = 0
  for (const [sid, shares] of bySrc) {
    const src = p.sourceById.get(sid)
    const ccRow = (p.rows.get(altId)?.get('cc') ?? []).find((r) => r.source_id === sid)
    const proc = ccRow ? processRow(p, ccRow, s) : null
    const sh = { ...shares }
    if (s.harmonise && proc?.harmonised && src && sh.electricity != null) {
      const g = p.gridByCountry.get(src.country)
      if (g) sh.electricity = (sh.electricity * p.baseGrid) / g
    }
    const tot = Object.values(sh).reduce((a, b) => a + b, 0) || 1
    const w = proc ? proc.weight : 1
    for (const k of Object.keys(sh)) acc[k] = (acc[k] ?? 0) + (w * sh[k]) / tot
    wsum += w
  }
  const out: Record<string, number> = {}
  for (const k of Object.keys(acc)) out[k] = (acc[k] / wsum) * ccCentral
  return out
}

/** Re-run the comparison for every weight profile (robustness to the choice of weights). */
export function robustness(p: Prepared, altIds: string[], s: AnalysisSettings, iterations = 600) {
  return p.profiles.map((prof) => {
    const r = compare(p, altIds, { ...s, profileId: prof.id }, { iterations })
    const ranking = [...r.alts].sort((a, b) => a.central - b.central).map((a) => a.id)
    return { profile: prof, ranking, pBest: Object.fromEntries(r.alts.map((a) => [a.id, a.pBest])), central: Object.fromEntries(r.alts.map((a) => [a.id, a.central])) }
  })
}
