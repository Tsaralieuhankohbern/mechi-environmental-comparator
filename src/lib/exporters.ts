import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import writeXlsxFile from 'write-excel-file/browser'
import type { AnalysisSettings, Intervention, Lang, Situation } from '../types'
import { pedigreeMean, gradeFromMean, profileWeights, robustness, type ComparisonResult, type Prepared } from './engine'
import { L, translate } from './i18n'
import { downloadBlob } from './workbook'
import { METHODS } from './methods'

export interface ReportCtx {
  p: Prepared
  situation: Situation
  alts: Intervention[]
  res: ComparisonResult
  settings: AnalysisSettings
  lang: Lang
  robust?: ReturnType<typeof robustness>
}

const SERIES_RGB: [number, number, number][] = [[42, 120, 214], [235, 104, 52], [27, 175, 122], [237, 161, 0], [232, 123, 164], [0, 131, 0], [98, 80, 214], [227, 73, 72]]

const n3 = (x: number) => {
  if (!Number.isFinite(x)) return ''
  const ax = Math.abs(x)
  if (ax === 0) return '0'
  if (ax < 1e-3) return x.toExponential(2)
  return ax >= 1000 ? Math.round(x).toString() : Number(x.toPrecision(3)).toString()
}
const pr = (p: number) => (p >= 0.995 ? '>99%' : p <= 0.005 ? '<1%' : `${Math.round(p * 100)}%`)

function model(ctx: ReportCtx) {
  const { p, res, alts, lang, settings } = ctx
  const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate(lang, k, v)
  const name = (id: string) => L(alts.find((a) => a.intervention_id === id), 'name', lang)
  const ext = res.normalisation === 'external'
  const pw = profileWeights(p, settings)
  const scoreRows = res.alts.map((a) => [
    name(a.id),
    ext ? n3(a.median * 365) : n3(a.median),
    ext ? `${n3(a.p05 * 365)}–${n3(a.p95 * 365)}` : `${n3(a.p05)}–${n3(a.p95)}`,
    pr(a.pBest),
    n3(a.cc.central),
    a.quality.grade,
  ])
  const scoreHead = [t('alternatives'), `${t('median')} (${ext ? t('personDays') : t('relativeScore')})`, t('interval'), t('pBest'), t('kgCO2'), t('grade')]
  const themeHead = [t('theme'), t('weight'), ...res.alts.map((a) => name(a.id))]
  const themeRows = res.themesUsed.map((th) => [
    L(p.themes.find((x) => x.theme_id === th), 'name', lang),
    `${(res.weights[th] * 100).toFixed(1)}%`,
    ...res.alts.map((a) => n3((a.themeContrib[th] ?? 0) * (ext ? 365 : 1))),
  ])
  const allInd = [...p.impactIndicators, ...p.inventoryIndicators]
  const indHead = [t('indicator'), t('unit'), lang === 'nl' ? 'Status' : 'Status', ...res.alts.map((a) => name(a.id))]
  const indRows = allInd.map((i) => [
    L(i, 'name', lang), i.unit,
    i.kind === 'inventory' ? t('inventoryOnly') : res.included.some((x) => x.indicator_id === i.indicator_id) ? t('included') : (lang === 'nl' ? 'uitgesloten' : 'excluded'),
    ...res.alts.map((a) => n3(a.values[i.indicator_id])),
  ])
  const srcIds = [...new Set(res.alts.flatMap((a) => a.quality.sources))]
  const srcHead = [t('source'), t('type'), t('method'), t('country'), t('year'), t('pedigree'), t('grade')]
  const srcRows = srcIds.map((sid) => {
    const s = p.sourceById.get(sid)
    return [s?.title ?? sid, s?.source_type ?? '', s?.method ?? '', s?.country ?? '', String(s?.year ?? ''),
      s ? [s.reliability, s.completeness, s.temporal, s.geographical, s.technological].join(' ') : '',
      gradeFromMean(pedigreeMean(s))]
  })
  const robHead = [t('profile'), t('ranking'), t('pBest')]
  const robRows = (ctx.robust ?? []).map((r) => [L(r.profile, 'name', lang), r.ranking.map(name).join(' < '),
    r.ranking.map((id) => pr(r.pBest[id] ?? 0)).join(' / ')])
  const settingsRows = [
    [t('weightProfile'), lang === 'nl' ? pw.name.nl : pw.name.en],
    [t('normalisation'), ext ? t('normExternal') : t('normInternal')],
    [t('harmonise'), settings.harmonise ? t('yes') : t('no')],
    [t('weightUncertainty'), settings.weightUncertainty ? t('yes') : t('no')],
    [t('sourceWeighting'), settings.sourceWeighting === 'equal' ? t('equalW') : t('invVar')],
    [t('iterations'), String(res.iterations)],
    [t('seed'), String(settings.seed)],
  ]
  return { t, name, scoreHead, scoreRows, themeHead, themeRows, indHead, indRows, srcHead, srcRows, robHead, robRows, settingsRows, ext }
}

function fileBase(ctx: ReportCtx) {
  return `MECH-I_${ctx.situation.situation_id}_${new Date().toISOString().slice(0, 10)}`
}

/** jsPDF standard fonts are WinAnsi only: replace characters they cannot draw. */
function safe(s: string) {
  return s.replace(/CO₂/g, 'CO2').replace(/₂/g, '2').replace(/≈/g, '~').replace(/→/g, '->').replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => '^' + '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c))
    .replace(/’/g, "'").replace(/[“”]/g, '"').replace(/·/g, '-')
}

export async function exportPdf(ctx: ReportCtx) {
  const m = model(ctx)
  const { situation, lang, p, res } = ctx
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const margin = 15
  let y = 18
  const synthetic = p.ds.meta?.synthetic !== false
  doc.setFont('helvetica', 'bold').setFontSize(15).text(safe(m.t('appName')), margin, y)
  y += 6
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90).text(new Date().toLocaleString(lang === 'nl' ? 'nl-NL' : 'en-GB'), margin, y)
  if (synthetic) {
    y += 6
    doc.setFillColor(253, 236, 200).rect(margin, y - 4, W - 2 * margin, 8, 'F')
    doc.setTextColor(120, 60, 0).setFont('helvetica', 'bold').text(safe(m.t('syntheticBanner')), margin + 2, y + 1)
  }
  y += 10
  doc.setTextColor(0).setFont('helvetica', 'bold').setFontSize(12).text(safe(L(situation, 'name', lang)), margin, y)
  y += 5
  doc.setFont('helvetica', 'normal').setFontSize(9)
  const lines = doc.splitTextToSize(safe(`${L(situation, 'description', lang)} ${m.t('functionalUnit')}: ${L(situation, 'functional_unit', lang)}.`), W - 2 * margin)
  doc.text(lines, margin, y)
  y += lines.length * 4 + 3

  // forest chart
  doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(0).text(safe(m.t('score')), margin, y)
  y += 5
  const chartH = 8 * res.alts.length + 10
  const labelW = 55
  const maxV = Math.max(...res.alts.map((a) => a.p95)) * 1.05 || 1
  const x0 = margin + labelW, x1 = W - margin - 5
  const sx = (v: number) => x0 + (Math.max(0, v) / maxV) * (x1 - x0)
  doc.setDrawColor(200).line(x0, y, x0, y + chartH - 8)
  res.alts.forEach((a, i) => {
    const yy = y + 4 + i * 8
    const ci = ctx.alts.findIndex((x) => x.intervention_id === a.id)
    const [r, g, b] = SERIES_RGB[(ci < 0 ? i : ci) % 8]
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(0).text(safe(m.name(a.id)).slice(0, 38), margin, yy + 1)
    doc.setDrawColor(r, g, b).setLineWidth(0.8).line(sx(a.p05), yy, sx(a.p95), yy)
    doc.setFillColor(r, g, b).circle(sx(a.median), yy, 1.3, 'F')
  })
  doc.setLineWidth(0.2).setFontSize(7).setTextColor(110)
  doc.text(safe(`${m.t('score')} (${m.ext ? m.t('personDays') : m.t('relativeScore')}): 0 – ${n3(maxV * (m.ext ? 365 : 1))}`), x0, y + chartH - 3)
  y += chartH + 2

  const table = (title: string, head: string[], body: string[][], opts: Record<string, unknown> = {}) => {
    if (y > 260) { doc.addPage(); y = 18 }
    if (title) doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(0).text(safe(title), margin, y)
    autoTable(doc, {
      startY: title ? y + 2 : y - 4, head: [head.map(safe)], body: body.map((r) => r.map(safe)), margin: { left: margin, right: margin },
      styles: { fontSize: 7.5, cellPadding: 1.4 }, headStyles: { fillColor: [31, 58, 77] }, theme: 'striped', ...opts,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 8
  }
  table('', m.scoreHead, m.scoreRows)
  if (res.excluded.length) {
    doc.setFontSize(8).setTextColor(150, 60, 0)
    const ex = doc.splitTextToSize(safe(`${m.t('excludedTitle')}: ${res.excluded.map((e) => L(e.indicator, 'name', lang)).join(', ')}.`), W - 2 * margin)
    doc.text(ex, margin, y - 4)
    y += ex.length * 3.5
    doc.setTextColor(0)
  }
  table(m.t('analysisSettings'), [m.t('analysisSettings'), ''], m.settingsRows, { showHead: 'never' })
  table(m.t('themeContrib'), m.themeHead, m.themeRows)
  if (m.robRows.length) table(m.t('robustness'), m.robHead, m.robRows)
  table(m.t('indicatorTable'), m.indHead, m.indRows)
  table(m.t('sourcesTable'), m.srcHead, m.srcRows, { columnStyles: { 0: { cellWidth: 70 } } })
  doc.addPage(); y = 18
  doc.setFont('helvetica', 'bold').setFontSize(11).text(safe(m.t('methods')), margin, y)
  y += 6
  for (const sec of METHODS[lang]) {
    const txt = doc.splitTextToSize(safe(sec.p), W - 2 * margin)
    if (y + txt.length * 4 > 280) { doc.addPage(); y = 18 }
    doc.setFont('helvetica', 'bold').setFontSize(9).text(safe(sec.h), margin, y)
    doc.setFont('helvetica', 'normal').text(txt, margin, y + 4.5)
    y += txt.length * 4 + 9
  }
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i).setFontSize(7).setTextColor(130)
    doc.text(safe(`MECH-I ${synthetic ? '- SYNTHETIC DATA' : ''} - ${i}/${pages}`), W - margin, 290, { align: 'right' })
  }
  await downloadBlob(doc.output('blob'), `${fileBase(ctx)}.pdf`)
}

export async function exportResultsXlsx(ctx: ReportCtx) {
  const m = model(ctx)
  const bold = { fontWeight: 'bold' as const }
  const sheet = (name: string, head: string[], rows: string[][]) => ({
    sheet: name.slice(0, 31),
    data: [head.map((h) => ({ value: h, ...bold })), ...rows.map((r) => r.map((c) => {
      const n = Number(c)
      return c !== '' && Number.isFinite(n) && /^-?[\d.]+(e-?\d+)?$/i.test(c) ? n : c
    }))],
    columns: head.map(() => ({ width: 22 })),
    stickyRowsCount: 1,
  })
  const sheets = [
    sheet('Scores', m.scoreHead, m.scoreRows),
    sheet('Themes', m.themeHead, m.themeRows),
    sheet('Indicators', m.indHead, m.indRows),
    ...(m.robRows.length ? [sheet('Robustness', m.robHead, m.robRows)] : []),
    sheet('Sources', m.srcHead, m.srcRows),
    sheet('Settings', ['Setting', 'Value'], [...m.settingsRows, ['Dataset', ctx.p.ds.meta?.synthetic !== false ? 'SYNTHETIC' : ctx.p.ds.meta?.name ?? '']]),
  ]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await writeXlsxFile(sheets as any).toBlob()
  await downloadBlob(blob, `${fileBase(ctx)}.xlsx`)
}

export async function exportCsv(ctx: ReportCtx) {
  const m = model(ctx)
  const esc = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const csv = [m.indHead, ...m.indRows].map((r) => r.map(esc).join(',')).join('\n')
  await downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `${fileBase(ctx)}_indicators.csv`)
}
