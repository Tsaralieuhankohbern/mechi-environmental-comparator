import type { Lang } from '../types'

const loc = (lang: Lang) => (lang === 'nl' ? 'nl-NL' : 'en-GB')

/** Number with ~3 significant digits, locale-aware, scientific for very small/large values. */
export function fmt(x: number, lang: Lang, sig = 3): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '–'
  if (x === 0) return '0'
  const ax = Math.abs(x)
  if (ax < 1e-3 || ax >= 1e9) {
    const [m, e] = x.toExponential(sig - 1).split('e')
    const mm = lang === 'nl' ? m.replace('.', ',') : m
    return `${mm}×10${superscript(Number(e))}`
  }
  if (ax >= 1000) return new Intl.NumberFormat(loc(lang), { maximumFractionDigits: 0 }).format(x)
  return new Intl.NumberFormat(loc(lang), { maximumSignificantDigits: sig }).format(x)
}

function superscript(n: number) {
  const map: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
  return String(n).split('').map((c) => map[c] ?? c).join('')
}

export function pct(x: number, lang: Lang, digits = 0) {
  if (!Number.isFinite(x)) return '–'
  return new Intl.NumberFormat(loc(lang), { style: 'percent', maximumFractionDigits: digits }).format(x)
}

/** Probability as percentage; Monte Carlo cannot show certainty, so cap at <1% / >99%. */
export function prob(p: number, lang: Lang) {
  if (!Number.isFinite(p)) return '–'
  if (p >= 0.995) return '>99%'
  if (p <= 0.005) return '<1%'
  return pct(p, lang)
}

/** Prettier unit strings for display */
export function unitLabel(u: string) {
  return (u ?? '').replace(/\bm3\b/g, 'm³').replace(/CO2/g, 'CO₂')
}

export function int(x: number, lang: Lang) {
  if (!Number.isFinite(x)) return '–'
  return new Intl.NumberFormat(loc(lang), { maximumFractionDigits: 0 }).format(x)
}

export type TimeUnit = 'personYears' | 'personDays' | 'personHours' | 'personMinutes'

/** Express person-equivalents (fraction of one person's annual footprint) in a readable time unit. */
export function personTime(pe: number): { value: number; unit: TimeUnit } {
  const days = pe * 365
  if (days >= 365 * 2) return { value: pe, unit: 'personYears' }
  if (days >= 1) return { value: days, unit: 'personDays' }
  if (days * 24 >= 1) return { value: days * 24, unit: 'personHours' }
  return { value: days * 24 * 60, unit: 'personMinutes' }
}

/** Convert a value in person-equivalents into a given unit. */
export function inUnit(pe: number, unit: TimeUnit) {
  const days = pe * 365
  return unit === 'personYears' ? pe : unit === 'personDays' ? days : unit === 'personHours' ? days * 24 : days * 1440
}

/** Pick one unit that suits a set of values (based on the smallest positive one). */
export function commonUnit(values: number[]): TimeUnit {
  const pos = values.filter((v) => v > 0)
  if (!pos.length) return 'personDays'
  return personTime(Math.min(...pos)).unit
}

/** "Nice" axis maximum and ticks */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1]
  const raw = max / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const ticks: number[] = []
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(+v.toPrecision(12))
  return ticks
}
