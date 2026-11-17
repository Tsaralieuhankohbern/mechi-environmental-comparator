import type { ReactNode } from 'react'
import type { Grade } from '../lib/engine'
import { useT } from '../lib/i18n'

const GRADE_INFO: Record<Grade, { cls: string; en: string; nl: string; icon: string }> = {
  A: { cls: 'good', en: 'High', nl: 'Hoog', icon: '●' },
  B: { cls: 'good', en: 'Good', nl: 'Goed', icon: '●' },
  C: { cls: 'warning', en: 'Moderate', nl: 'Matig', icon: '▲' },
  D: { cls: 'serious', en: 'Low', nl: 'Laag', icon: '▲' },
  E: { cls: 'critical', en: 'Very low', nl: 'Zeer laag', icon: '■' },
}

export function GradeBadge({ grade }: { grade: Grade }) {
  const t = useT()
  const g = GRADE_INFO[grade]
  return (
    <span className={`grade grade-${g.cls}`} title={t('gradeHelp')}>
      <span aria-hidden className="grade-icon">{g.icon}</span>
      {grade} · {t.lang === 'nl' ? g.nl : g.en}
    </span>
  )
}

export function Info({ text }: { text: string }) {
  return <span className="info" title={text} aria-label={text} tabIndex={0}>i</span>
}

export function Card({ title, help, children, className = '', actions }: { title?: ReactNode; help?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h3>{title}{help && <> <Info text={help} /></>}</h3>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn'; children: ReactNode }) {
  return <div className={`notice notice-${kind}`} role={kind === 'warn' ? 'alert' : undefined}>{children}</div>
}
