// Data model. One interface per sheet of the data workbook.

export interface Situation {
  situation_id: string
  clinical_area_en: string
  clinical_area_nl: string
  name_en: string
  name_nl: string
  description_en: string
  description_nl: string
  functional_unit_en: string
  functional_unit_nl: string
  nl_annual_volume: number
  volume_note?: string
  scope_note_en?: string
  scope_note_nl?: string
}

export interface Intervention {
  intervention_id: string
  situation_id: string
  name_en: string
  name_nl: string
  description_en: string
  description_nl: string
  nl_current_share: number
  clinical_note_en?: string
  clinical_note_nl?: string
}

export interface Source {
  source_id: string
  title: string
  source_type: string
  method: string
  country: string
  year: number
  reports: string
  reliability: number
  completeness: number
  temporal: number
  geographical: number
  technological: number
  synthetic: string
  calibration_note?: string
  url?: string
}

export interface DataRow {
  intervention_id: string
  source_id: string
  indicator_id: string
  value: number
  low?: number | null
  high?: number | null
  electricity_share?: number | null
  note?: string
}

export interface ContributionRow {
  intervention_id: string
  source_id: string
  stage_id: string
  share: number
}

export interface Indicator {
  indicator_id: string
  kind: 'impact' | 'inventory'
  theme_id: string
  group: string
  name_en: string
  name_nl: string
  unit: string
  nf: number | null
  subweight: number | null
  hazard_factor: number | null
  description_en?: string
  description_nl?: string
}

export interface Theme {
  theme_id: string
  name_en: string
  name_nl: string
  description_en: string
  description_nl: string
  order: number
}

export interface Stage {
  stage_id: string
  name_en: string
  name_nl: string
  order: number
}

export interface WeightProfileRow {
  profile_id: string
  name_en: string
  name_nl: string
  group_en: string
  group_nl: string
  panel_size: number
  theme_id: string
  weight_mean: number
  weight_sd: number
  synthetic: string
}

export interface GridFactor {
  country: string
  name_en: string
  name_nl: string
  kg_co2e_per_kwh: number
  note?: string
}

export interface SettingRow {
  key: string
  value: string | number
  note?: string
}

export interface Dataset {
  situations: Situation[]
  interventions: Intervention[]
  sources: Source[]
  data: DataRow[]
  contributions: ContributionRow[]
  indicators: Indicator[]
  themes: Theme[]
  stages: Stage[]
  weightProfiles: WeightProfileRow[]
  gridFactors: GridFactor[]
  settings: SettingRow[]
  meta?: { name: string; synthetic: boolean; generated?: string; generator?: string; fileName?: string }
}

export type Lang = 'en' | 'nl'
export type Level = 'micro' | 'meso' | 'macro'

export interface WeightProfile {
  id: string
  name_en: string
  name_nl: string
  group_en: string
  group_nl: string
  panelSize: number
  mean: Record<string, number> // percent
  sd: Record<string, number> // percent points
  synthetic: boolean
}

export interface AnalysisSettings {
  profileId: string // 'custom' allowed
  customWeights: Record<string, number> // percent
  normalisation: 'external' | 'internal'
  harmonise: boolean
  weightUncertainty: boolean
  iterations: number
  seed: number
  sourceWeighting: 'inverse_variance' | 'equal'
}
