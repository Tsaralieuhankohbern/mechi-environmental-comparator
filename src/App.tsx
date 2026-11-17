import { useEffect, useMemo, useRef, useState } from 'react'
import synthetic from './data/synthetic.json'
import type { AnalysisSettings, Dataset, Lang, Level } from './types'
import { compare, prepare, type Prepared } from './lib/engine'
import { L, LangContext, translate, type TKey } from './lib/i18n'
import { exportWorkbook, importWorkbook } from './lib/workbook'
import { seriesVar } from './components/charts'
import { Notice } from './components/common'
import { MicroView } from './views/MicroView'
import { MesoView } from './views/MesoView'
import { MacroView } from './views/MacroView'

const SYNTHETIC = synthetic as unknown as Dataset

function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key)
      return s ? (JSON.parse(s) as T) : initial
    } catch { return initial }
  })
  const set = (nv: T) => {
    setV(nv)
    try { localStorage.setItem(key, JSON.stringify(nv)) } catch { /* storage unavailable */ }
  }
  return [v, set]
}

function defaultSettings(p: Prepared): AnalysisSettings {
  const profileId = String(p.settings.default_profile ?? p.profiles[0]?.id ?? 'custom')
  const prof = p.profiles.find((x) => x.id === profileId) ?? p.profiles[0]
  return {
    profileId: prof ? prof.id : 'custom',
    customWeights: { ...(prof?.mean ?? {}) },
    normalisation: 'external',
    harmonise: true,
    weightUncertainty: true,
    iterations: Number(p.settings.mc_iterations ?? 2000) || 2000,
    seed: Number(p.settings.seed ?? 2026) || 2026,
    sourceWeighting: 'inverse_variance',
  }
}

const LEVELS: { id: Level; label: TKey; sub: TKey }[] = [
  { id: 'micro', label: 'micro', sub: 'microSub' },
  { id: 'meso', label: 'meso', sub: 'mesoSub' },
  { id: 'macro', label: 'macro', sub: 'macroSub' },
]

export default function App() {
  const [lang, setLang] = usePersisted<Lang>('mechi.lang', 'en')
  const [level, setLevel] = usePersisted<Level>('mechi.level', 'micro')
  const [dataset, setDataset] = useState<Dataset>(SYNTHETIC)
  const p = useMemo(() => prepare(dataset), [dataset])
  const [sitId, setSitId] = useState<string>(p.ds.situations[0]?.situation_id ?? '')
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [settings, setSettings] = useState<AnalysisSettings>(() => defaultSettings(p))
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [importMsg, setImportMsg] = useState<{ errors: string[]; warnings: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const t = (k: TKey, v?: Record<string, string | number>) => translate(lang, k, v)

  useEffect(() => { document.documentElement.lang = lang; document.title = translate(lang, 'appName') }, [lang])

  const situation = p.ds.situations.find((s) => s.situation_id === sitId) ?? p.ds.situations[0]
  const sitAlts = p.ds.interventions.filter((i) => i.situation_id === situation?.situation_id)
  const selIds = (selected[situation?.situation_id] ?? sitAlts.map((a) => a.intervention_id).slice(0, 8))
    .filter((id) => sitAlts.some((a) => a.intervention_id === id))
  const alts = sitAlts.filter((a) => selIds.includes(a.intervention_id))
  const colorOf = (id: string) => Math.max(0, sitAlts.findIndex((a) => a.intervention_id === id))
  const res = useMemo(() => (alts.length >= 2 ? compare(p, alts.map((a) => a.intervention_id), settings) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p, alts.map((a) => a.intervention_id).join(','), settings])

  const toggleAlt = (id: string) => {
    const cur = new Set(selIds)
    if (cur.has(id)) cur.delete(id)
    else cur.add(id)
    setSelected({ ...selected, [situation.situation_id]: sitAlts.map((a) => a.intervention_id).filter((x) => cur.has(x)) })
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const m = new Map<string, typeof p.ds.situations>()
    for (const s of p.ds.situations) {
      const hay = `${L(s, 'name', lang)} ${L(s, 'clinical_area', lang)} ${p.ds.interventions.filter((i) => i.situation_id === s.situation_id).map((i) => L(i, 'name', lang)).join(' ')}`.toLowerCase()
      if (q && !hay.includes(q)) continue
      const area = L(s, 'clinical_area', lang)
      if (!m.has(area)) m.set(area, [])
      m.get(area)!.push(s)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [p, query, lang])

  const onFile = async (f: File | undefined) => {
    setMenuOpen(false)
    if (!f) return
    const r = await importWorkbook(f)
    if (r.dataset) {
      const np = prepare(r.dataset)
      setDataset(r.dataset)
      setSelected({})
      setSitId(np.ds.situations[0]?.situation_id ?? '')
      setSettings(defaultSettings(np))
    }
    setImportMsg(r.errors.length || r.warnings.length ? { errors: r.errors, warnings: r.warnings } : null)
    if (fileRef.current) fileRef.current.value = ''
  }
  const resetDemo = () => {
    setMenuOpen(false)
    setDataset(SYNTHETIC)
    setSelected({})
    const np = prepare(SYNTHETIC)
    setSitId(np.ds.situations[0].situation_id)
    setSettings(defaultSettings(np))
    setImportMsg(null)
  }
  const isSynthetic = p.ds.meta?.synthetic !== false

  const viewProps = res && situation ? { p, situation, alts, res, settings, setSettings, colorOf } : null

  return (
    <LangContext.Provider value={lang}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="logo" aria-hidden>
              <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2C7 7 5 10.5 5 14a7 7 0 0 0 14 0c0-3.5-2-7-7-12Z" fill="currentColor" opacity=".9" /><path d="M12 21v-8m0 3 3-3m-3 1-2.5-2.5" stroke="var(--topbar)" strokeWidth="1.6" fill="none" strokeLinecap="round" /></svg>
            </span>
            <div>
              <div className="brand-name">{t('appName')}</div>
              <div className="brand-tag">{t('tagline')}</div>
            </div>
          </div>
          <nav className="levels" aria-label={t('level')}>
            {LEVELS.map((lv) => (
              <button key={lv.id} className={`level-btn ${level === lv.id ? 'active' : ''}`} aria-pressed={level === lv.id} onClick={() => setLevel(lv.id)}>
                <span className="lv-label">{t(lv.label)}</span>
                <span className="lv-sub">{t(lv.sub)}</span>
              </button>
            ))}
          </nav>
          <div className="top-actions">
            <div className="lang-switch" role="group" aria-label="Language">
              {(['en', 'nl'] as Lang[]).map((l) => (
                <button key={l} className={lang === l ? 'active' : ''} aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
              ))}
            </div>
            <div className="menu-wrap">
              <button className="btn btn-ghost" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{t('data')} ▾</button>
              {menuOpen && (
                <div className="menu" role="menu">
                  <button role="menuitem" onClick={() => fileRef.current?.click()}>{t('loadData')}</button>
                  <button role="menuitem" onClick={() => { setMenuOpen(false); exportWorkbook(dataset, isSynthetic ? 'MECH-I_data_workbook_SYNTHETIC.xlsx' : 'MECH-I_data_workbook.xlsx') }}>{t('downloadTemplate')}</button>
                  {!isSynthetic && <button role="menuitem" onClick={resetDemo}>{t('resetDemo')}</button>}
                </div>
              )}
              <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            </div>
          </div>
        </header>

        {isSynthetic
          ? <div className="banner banner-synthetic" role="status"><span aria-hidden>▲</span> {t('syntheticBanner')}</div>
          : <div className="banner banner-user" role="status">{t('userDataBanner')}: <b>{p.ds.meta?.fileName}</b> — {t('loadedLocally')}</div>}

        {importMsg && (
          <div className="import-msg">
            <Notice kind="warn">
              <b>{importMsg.errors.length ? t('importErrors') : t('importWarnings')}</b>
              <ul className="compact">{[...importMsg.errors, ...importMsg.warnings].map((m) => <li key={m}>{m}</li>)}</ul>
              <button className="btn btn-small" onClick={() => setImportMsg(null)}>{t('close')}</button>
            </Notice>
          </div>
        )}

        <div className="layout">
          <aside className="sidebar">
            <input className="search" type="search" placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('search')} />
            <select className="sit-select" value={situation?.situation_id} onChange={(e) => setSitId(e.target.value)} aria-label={t('situations')}>
              {p.ds.situations.map((s) => <option key={s.situation_id} value={s.situation_id}>{L(s, 'name', lang)}</option>)}
            </select>
            <nav className="sit-list" aria-label={t('situations')}>
              {groups.map(([area, sits]) => (
                <div key={area} className="sit-group">
                  <div className="sit-area-h">{area}</div>
                  {sits.map((s) => (
                    <button key={s.situation_id} className={`sit-item ${s.situation_id === situation?.situation_id ? 'active' : ''}`} onClick={() => setSitId(s.situation_id)}>
                      <span>{L(s, 'name', lang)}</span>
                      <span className="count">{p.ds.interventions.filter((i) => i.situation_id === s.situation_id).length}</span>
                    </button>
                  ))}
                </div>
              ))}
            </nav>
          </aside>

          <main className="main">
            {situation && (
              <section className="sit-head">
                <div className="sit-area">{L(situation, 'clinical_area', lang)} · {situation.situation_id}</div>
                <h2>{L(situation, 'name', lang)}</h2>
                <p className="sit-desc">{L(situation, 'description', lang)}</p>
                <p className="fu"><b>{t('functionalUnit')}:</b> {L(situation, 'functional_unit', lang)}</p>
                <div className="alt-picker" role="group" aria-label={t('alternatives')}>
                  <span className="picker-label">{t('alternatives')}:</span>
                  {sitAlts.map((a) => {
                    const on = selIds.includes(a.intervention_id)
                    return (
                      <label key={a.intervention_id} className={`chip ${on ? 'on' : ''}`} title={L(a, 'description', lang)}>
                        <input type="checkbox" checked={on} onChange={() => toggleAlt(a.intervention_id)} />
                        <span className="swatch" style={{ background: seriesVar(colorOf(a.intervention_id)) }} />
                        {L(a, 'name', lang)}
                      </label>
                    )
                  })}
                </div>
              </section>
            )}
            {!viewProps && <Notice kind="warn">{t('minTwo')}</Notice>}
            {viewProps && level === 'micro' && <MicroView {...viewProps} />}
            {viewProps && level === 'meso' && <MesoView {...viewProps} />}
            {viewProps && level === 'macro' && <MacroView {...viewProps} />}
            <footer className="footer">{t('footer')}</footer>
          </main>
        </div>
      </div>
    </LangContext.Provider>
  )
}
