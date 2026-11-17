# Data guide — the MECH-I data workbook

The app reads one `.xlsx` workbook. Each sheet is a table: the first row holds the column names, and those must stay as they are. Extra columns are ignored. Load the workbook through **Data → Load data workbook**; it is parsed in your browser and nothing is uploaded. **Data → Download data workbook** exports whatever data is currently loaded, in this same format.

## Sheets

### Situations — one row per decision situation
| column | meaning |
|---|---|
| `situation_id` | unique id, e.g. `S01` |
| `clinical_area_en/nl` | grouping in the sidebar |
| `name_en/nl`, `description_en/nl` | shown in the header |
| `functional_unit_en/nl` | what is compared. Every value for this situation must refer to this unit (e.g. *one patient-year of dialysis*) |
| `nl_annual_volume` | number of functional units per year in NL (used for national scaling) |
| `scope_note_en/nl` | optional: what is excluded |

### Interventions — one row per alternative
| column | meaning |
|---|---|
| `intervention_id` | unique id, e.g. `I01a` |
| `situation_id` | the situation it belongs to |
| `name_*`, `description_*` | labels |
| `nl_current_share` | current share of Dutch practice (0–1), used for the current-mix scenario |
| `clinical_note_*` | optional clinical caveats |

Colours follow the order of the rows within a situation. Up to 8 alternatives per situation are supported.

### Sources — one row per extracted publication or dataset
| column | meaning |
|---|---|
| `source_id` | unique id |
| `title`, `source_type`, `method`, `reports`, `url` | descriptive |
| `country` | ISO-like code matching `GridFactors.country` (`INT` for international) |
| `year` | year of the data |
| `reliability`, `completeness`, `temporal`, `geographical`, `technological` | pedigree scores 1 (best) – 5 (worst). Temporal and geographical scores describe the fit with current Dutch practice |
| `synthetic` | `yes` / `no` |

Suggested scoring for synthetic generation (adapt as needed): temporal 1 = ≤3 years old, 2 = ≤6, 3 = ≤10, 4 = ≤15, 5 = older; geographical 1 = NL, 2 = north-west Europe, 3 = other high-income or international.

### Data — the extracted values (long format)
One row per **intervention × source × indicator**.

| column | meaning |
|---|---|
| `intervention_id`, `source_id`, `indicator_id` | keys |
| `value` | central value per functional unit, in the indicator's unit |
| `low`, `high` | reported range (sensitivity range, min–max, or 90% interval). If empty, `Settings.default_sigma` is used |
| `electricity_share` | **climate change (`cc`) only:** share (0–1) of the footprint that comes from on-site electricity. Needed to harmonise to the Dutch grid; leave empty if not reported |
| `note` | free text |

A study that reports only climate change simply has only `cc` rows. When a category is missing for one of the compared alternatives, the tool leaves that category out for all alternatives and says so.

### Contributions — optional
Share of climate change per life-cycle stage (`stage_id` from **Stages**) per intervention × source. Shares of one source should add up to about 1.

### Indicators — the indicator catalogue
| column | meaning |
|---|---|
| `kind` | `impact` (used in the score) or `inventory` (shown only) |
| `theme_id` | weighting theme (impact indicators) |
| `group` | inventory display group: `energy_source`, `energy_carrier`, `water`, `waste`, `travel`, `api` |
| `unit` | unit of the values |
| `nf` | normalisation factor: impact of one average person per year (EF 3.0 global) |
| `subweight` | relative weight within the theme (EF weighting factors) |
| `hazard_factor` | waste streams only: multiplier used for the derived `waste_hw` indicator |

`waste_hw` (hazard-weighted waste) is calculated by the tool from the waste-stream rows. Do not enter it in **Data**.

### Themes / Stages
Labels and display order for weighting themes and life-cycle stages.

### WeightProfiles — stakeholder weights (long format)
One row per **profile × theme**: `weight_mean` and `weight_sd` in % (e.g. median and spread from a Delphi round), plus `panel_size`. Weights are renormalised to 100% over the themes that have data.

### GridFactors
Life-cycle kg CO₂-eq per kWh of each country's consumption mix. The `base_country` (NL) is the harmonisation target. **The bundled values are illustrative.**

### Settings
`dataset_label`, `synthetic` (yes/no: controls the warning banner), `base_country`, `reference_year`, `default_profile`, `default_sigma`, `car_kg_co2e_per_km`, `mc_iterations`, `seed`.

## Extraction checklist
1. Is the functional unit the same as in **Situations**? If not, convert (e.g. per session → per patient-year) and record how in `note`.
2. Which life-cycle stages are included (system boundary)? Record this in `Sources.reports`, and lower `completeness` if stages are missing.
3. Which impact method was used (EF, ReCiPe, CML)? Only enter values in EF units. Otherwise convert, or enter only climate change.
4. Was a range reported? Fill `low`/`high`.
5. Was the on-site electricity share reported, or can it be derived from the contribution analysis? Fill `electricity_share`.
