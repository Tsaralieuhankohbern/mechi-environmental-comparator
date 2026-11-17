/**
 * Reading and writing the data workbook (.xlsx). The workbook is the only thing a
 * maintainer needs to edit: one sheet per table, first row = column names.
 * Files are parsed in the browser; nothing is uploaded.
 */
import readXlsxFile from 'read-excel-file/browser'
import writeXlsxFile from 'write-excel-file/browser'
import type { Dataset } from '../types'

type Key = Exclude<keyof Dataset, 'meta'>

export const SHEETS: { sheet: string; key: Key; required: boolean; columns: string[]; numeric: string[] }[] = [
  { sheet: 'Situations', key: 'situations', required: true, numeric: ['nl_annual_volume'],
    columns: ['situation_id', 'clinical_area_en', 'clinical_area_nl', 'name_en', 'name_nl', 'description_en', 'description_nl',
      'functional_unit_en', 'functional_unit_nl', 'nl_annual_volume', 'volume_note', 'scope_note_en', 'scope_note_nl'] },
  { sheet: 'Interventions', key: 'interventions', required: true, numeric: ['nl_current_share'],
    columns: ['intervention_id', 'situation_id', 'name_en', 'name_nl', 'description_en', 'description_nl', 'nl_current_share',
      'clinical_note_en', 'clinical_note_nl'] },
  { sheet: 'Sources', key: 'sources', required: true,
    numeric: ['year', 'reliability', 'completeness', 'temporal', 'geographical', 'technological'],
    columns: ['source_id', 'title', 'source_type', 'method', 'country', 'year', 'reports', 'reliability', 'completeness',
      'temporal', 'geographical', 'technological', 'synthetic', 'calibration_note', 'url'] },
  { sheet: 'Data', key: 'data', required: true, numeric: ['value', 'low', 'high', 'electricity_share'],
    columns: ['intervention_id', 'source_id', 'indicator_id', 'value', 'low', 'high', 'electricity_share', 'note'] },
  { sheet: 'Contributions', key: 'contributions', required: false, numeric: ['share'],
    columns: ['intervention_id', 'source_id', 'stage_id', 'share'] },
  { sheet: 'Indicators', key: 'indicators', required: true, numeric: ['nf', 'subweight', 'hazard_factor'],
    columns: ['indicator_id', 'kind', 'theme_id', 'group', 'name_en', 'name_nl', 'unit', 'nf', 'subweight', 'hazard_factor',
      'description_en', 'description_nl'] },
  { sheet: 'Themes', key: 'themes', required: true, numeric: ['order'],
    columns: ['theme_id', 'name_en', 'name_nl', 'description_en', 'description_nl', 'order'] },
  { sheet: 'Stages', key: 'stages', required: false, numeric: ['order'], columns: ['stage_id', 'name_en', 'name_nl', 'order'] },
  { sheet: 'WeightProfiles', key: 'weightProfiles', required: true, numeric: ['panel_size', 'weight_mean', 'weight_sd'],
    columns: ['profile_id', 'name_en', 'name_nl', 'group_en', 'group_nl', 'panel_size', 'theme_id', 'weight_mean', 'weight_sd', 'synthetic'] },
  { sheet: 'GridFactors', key: 'gridFactors', required: false, numeric: ['kg_co2e_per_kwh'],
    columns: ['country', 'name_en', 'name_nl', 'kg_co2e_per_kwh', 'note'] },
  { sheet: 'Settings', key: 'settings', required: false, numeric: [], columns: ['key', 'value', 'note'] },
]

const ESSENTIAL: Record<string, string[]> = {
  Situations: ['situation_id', 'name_en', 'functional_unit_en'],
  Interventions: ['intervention_id', 'situation_id', 'name_en'],
  Sources: ['source_id', 'country', 'year'],
  Data: ['intervention_id', 'source_id', 'indicator_id', 'value'],
  Contributions: ['intervention_id', 'source_id', 'stage_id', 'share'],
  Indicators: ['indicator_id', 'kind', 'theme_id', 'nf', 'unit'],
  Themes: ['theme_id', 'name_en', 'order'],
  WeightProfiles: ['profile_id', 'theme_id', 'weight_mean'],
  GridFactors: ['country', 'kg_co2e_per_kwh'],
  Settings: ['key', 'value'],
}

export interface ImportResult { dataset?: Dataset; errors: string[]; warnings: string[] }

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export async function importWorkbook(file: File): Promise<ImportResult> {
  const errors: string[] = []
  const warnings: string[] = []
  let sheets: { sheet: string; data: unknown[][] }[]
  try {
    sheets = (await readXlsxFile(file)) as unknown as { sheet: string; data: unknown[][] }[]
  } catch (e) {
    return { errors: [`Could not read the file as .xlsx: ${(e as Error).message}`], warnings }
  }
  const byName = new Map(sheets.map((s) => [s.sheet.trim().toLowerCase(), s.data]))
  const ds: Partial<Dataset> = {}
  for (const spec of SHEETS) {
    const rows = byName.get(spec.sheet.toLowerCase())
    if (!rows) {
      if (spec.required) errors.push(`Missing sheet "${spec.sheet}".`)
      ;(ds as Record<string, unknown>)[spec.key] = []
      continue
    }
    const header = (rows[0] ?? []).map((h) => String(h ?? '').trim())
    const missingCols = (ESSENTIAL[spec.sheet] ?? []).filter((c) => !header.includes(c))
    if (missingCols.length) errors.push(`Sheet "${spec.sheet}" is missing column(s): ${missingCols.join(', ')}.`)
    const objs = rows.slice(1).filter((r) => r.some((c) => c !== null && c !== '')).map((r) => {
      const o: Record<string, unknown> = {}
      header.forEach((h, i) => {
        if (!h) return
        const v = r[i]
        o[h] = spec.numeric.includes(h) ? toNumber(v) : v === null || v === undefined ? '' : typeof v === 'number' ? v : String(v)
      })
      if (spec.key === 'settings') {
        const n = toNumber(o.value)
        if (n !== null && String(o.value).trim() !== '') o.value = n
      }
      return o
    })
    ;(ds as Record<string, unknown>)[spec.key] = objs
  }
  if (errors.length) return { errors, warnings }
  const d = ds as Dataset
  // referential checks
  const ivs = new Set(d.interventions.map((i) => i.intervention_id))
  const srcs = new Set(d.sources.map((s) => s.source_id))
  const inds = new Set(d.indicators.map((i) => i.indicator_id))
  const sits = new Set(d.situations.map((s) => s.situation_id))
  const themes = new Set(d.themes.map((t) => t.theme_id))
  const count = (pred: (r: Dataset['data'][number]) => boolean) => d.data.filter(pred).length
  const badIv = count((r) => !ivs.has(r.intervention_id))
  const badSrc = count((r) => !srcs.has(r.source_id))
  const badInd = count((r) => !inds.has(r.indicator_id))
  const badVal = count((r) => r.value === null || !Number.isFinite(Number(r.value)))
  if (badIv) warnings.push(`${badIv} data row(s) refer to an unknown intervention_id and are ignored.`)
  if (badSrc) warnings.push(`${badSrc} data row(s) refer to an unknown source_id (default quality assumed).`)
  if (badInd) warnings.push(`${badInd} data row(s) refer to an unknown indicator_id and are ignored.`)
  if (badVal) warnings.push(`${badVal} data row(s) have no numeric value and are ignored.`)
  const orphanIv = d.interventions.filter((i) => !sits.has(i.situation_id)).length
  if (orphanIv) warnings.push(`${orphanIv} intervention(s) refer to an unknown situation_id.`)
  const badTheme = d.indicators.filter((i) => i.kind === 'impact' && !themes.has(i.theme_id)).length
  if (badTheme) warnings.push(`${badTheme} impact indicator(s) refer to an unknown theme_id.`)
  d.data = d.data.filter((r) => ivs.has(r.intervention_id) && inds.has(r.indicator_id) && r.value !== null && Number.isFinite(Number(r.value)))
  if (!d.weightProfiles.length) errors.push('Sheet "WeightProfiles" has no rows.')
  if (!d.situations.length) errors.push('Sheet "Situations" has no rows.')
  const synthetic = String(d.settings.find((s) => s.key === 'synthetic')?.value ?? 'no').toLowerCase() === 'yes'
  d.meta = { name: file.name, synthetic, fileName: file.name }
  return { dataset: errors.length ? undefined : d, errors, warnings }
}

const README = [
  'MECH-I environmental decision tool — data workbook',
  '',
  'Edit the sheets and load the file in the app via Data → Load data workbook. Column names in row 1 must stay as they are.',
  'Data: one row per intervention × source × indicator (value, low, high; for climate change "cc" also electricity_share).',
  'Sources: pedigree scores 1 (best) – 5 (worst). WeightProfiles: weights per theme in % (mean and SD).',
  'Do not commit workbooks with real or licensed data to a public repository.',
]

export async function exportWorkbook(ds: Dataset, fileName: string) {
  const bold = { fontWeight: 'bold' as const }
  const sheets = [
    { sheet: 'README', data: README.map((r, i) => [i === 0 ? { value: r, ...bold } : r]), columns: [{ width: 110 }] },
    ...SHEETS.map((spec) => {
      const rows = (ds[spec.key] as unknown as Record<string, unknown>[]) ?? []
      const data = [
        spec.columns.map((c) => ({ value: c, ...bold })),
        ...rows.map((r) => spec.columns.map((c) => {
          const v = r[c]
          return v === null || v === undefined || v === '' ? null : typeof v === 'number' ? v : String(v)
        })),
      ]
      return { sheet: spec.sheet, data, columns: spec.columns.map((c) => ({ width: Math.min(40, Math.max(10, c.length + 4)) })), stickyRowsCount: 1 }
    }),
  ]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await writeXlsxFile(sheets as any).toBlob()
  downloadBlob(blob, fileName)
}

interface HostDownloads { save: (r: { filename: string; data: Blob }) => Promise<unknown> }
interface HostClaude { use: (name: string) => Promise<HostDownloads | null> }

/**
 * Save a generated file. Inside a claude.ai artifact frame, direct downloads are blocked,
 * so the host's `downloads` capability is used there (the viewer confirms the save).
 * Everywhere else (GitHub Pages, local dev) a normal browser download is started.
 */
export async function downloadBlob(blob: Blob, fileName: string) {
  const host = (window as unknown as { claude?: HostClaude }).claude
  if (host?.use) {
    try {
      const d = await host.use('downloads')
      if (d) {
        await d.save({ filename: fileName, data: blob }).catch((e: { code?: string }) => console.warn('download not saved:', e?.code ?? e))
        return
      }
    } catch (e) { console.warn(e) }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
