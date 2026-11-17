// Sanity checks for the calculation engine. Run with: npm run check
import assert from 'node:assert/strict'
import ds from '../src/data/synthetic.json' with { type: 'json' }
import { compare, prepare, processRow, robustness } from '../src/lib/engine'
import type { AnalysisSettings, Dataset } from '../src/types'

const data = ds as unknown as Dataset
const p = prepare(data)
const s: AnalysisSettings = { profileId: 'combined', customWeights: {}, normalisation: 'external', harmonise: true,
  weightUncertainty: true, iterations: 2000, seed: 2026, sourceWeighting: 'inverse_variance' }

// 1. Every situation computes, probabilities are consistent
for (const sit of p.ds.situations) {
  const alts = p.ds.interventions.filter((i) => i.situation_id === sit.situation_id).map((i) => i.intervention_id)
  const r = compare(p, alts, s)
  const pSum = r.alts.reduce((a, x) => a + x.pBest, 0)
  assert.ok(Math.abs(pSum - 1) < 1e-9, `${sit.situation_id}: P(best) sums to ${pSum}`)
  for (const a of r.alts) {
    assert.ok(Number.isFinite(a.central) && a.central > 0, `${a.id}: central score ${a.central}`)
    assert.ok(a.p05 <= a.median && a.median <= a.p95, `${a.id}: percentiles out of order`)
    const contrib = Object.values(a.themeContrib).reduce((x, y) => x + y, 0)
    assert.ok(Math.abs(contrib - a.central) < 1e-12, `${a.id}: theme contributions do not add up to the score`)
  }
  const wSum = Object.values(r.weights).reduce((x, y) => x + y, 0)
  assert.ok(Math.abs(wSum - 1) < 1e-9, `${sit.situation_id}: weights sum ${wSum}`)
  console.log(sit.situation_id, r.alts.map((a) => `${a.id} ${(a.median * 365).toPrecision(3)} d, P=${a.pBest.toFixed(2)}`).join(' | '),
    r.excluded.length ? `(excluded ${r.excluded.length})` : '')
}

// 2. Score definition: an "average person" (value = NF in every category) scores exactly 1 person-year
{
  const d: Dataset = JSON.parse(JSON.stringify(data))
  const impact = d.indicators.filter((i) => i.kind === 'impact' && i.indicator_id !== 'waste_hw')
  d.data = []
  for (const iv of ['X1', 'X2']) {
    for (const ind of impact) d.data.push({ intervention_id: iv, source_id: 'T', indicator_id: ind.indicator_id, value: Number(ind.nf), low: null, high: null })
    d.data.push({ intervention_id: iv, source_id: 'T', indicator_id: 'waste_residual', value: 510, low: null, high: null })
  }
  const pp = prepare(d)
  const r = compare(pp, ['X1', 'X2'], { ...s, weightUncertainty: false })
  for (const a of r.alts) assert.ok(Math.abs(a.central - 1) < 1e-9, `average person should score 1, got ${a.central}`)
  console.log('✓ average person = 1 person-year under the combined profile')
}

// 3. Harmonisation: an FR study (low-carbon grid) is scaled up, an NL study is untouched
{
  const fr = p.ds.data.find((r) => r.source_id === 'SYN-S10-B' && r.indicator_id === 'cc')!
  const pr = processRow(p, fr, s)
  assert.ok(pr.harmonised && pr.value > fr.value, 'FR climate value should increase when harmonised to NL')
  const nl = p.ds.data.find((r) => r.source_id === 'SYN-S11-A' && r.indicator_id === 'cc')!
  assert.equal(processRow(p, nl, s).value, nl.value)
  console.log(`✓ harmonisation FR→NL factor ${pr.factor.toFixed(3)}`)
}

// 4. Determinism: same seed → same result
{
  const a = compare(p, ['I01a', 'I01b'], s).alts[0].median
  const b = compare(p, ['I01a', 'I01b'], s).alts[0].median
  assert.equal(a, b)
  console.log('✓ reproducible with a fixed seed')
}

// 5. Robustness runs for all profiles
console.log('robustness S03:', robustness(p, ['I03a', 'I03b', 'I03c', 'I03d'], s, 300).map((r) => `${r.profile.id}:${r.ranking[0]}`).join(' '))
console.log('\nAll checks passed.')
