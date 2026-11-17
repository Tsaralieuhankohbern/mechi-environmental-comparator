# MECH-I Environmental Impact Comparator (prototype)

A decision-support tool that compares the **environmental impact of competing healthcare interventions** and combines the impact categories into one weighted score. The score comes with uncertainty, evidence-quality grades, and checks of how robust it is to the choice of weights. It was built for the MECH-I project (Julius Center, UMC Utrecht) to support advice to Zorginstituut Nederland and other Dutch decision-makers.

> **This repository ships with SYNTHETIC demo data only.** The values are modelled to match the order of magnitude in published healthcare LCA literature. They are not results of real studies and must not be used for real decisions.

## What it does

- **20 clinical situations**, each with 2–4 alternatives. Examples: TAVI vs SAVR, dialysis types, inhaler types, anaesthetic agents, cataract pathways, single-use vs reusable devices, telemedicine, radiotherapy fractionation.
- **Three switchable levels**, all running the same calculations:
  - **Micro** (clinician & patient): which option has the lowest impact, how certain that is, what drives the difference, and equivalents such as person-days and km by car.
  - **Meso** (hospital & insurer): annual totals for your own patient volume, savings from switching, climate hotspots by life-cycle stage, energy by carrier and by source, water, waste streams, travel and drug residues.
  - **Macro** (national policy / ZIN): weight profiles and custom weights, normalisation and harmonisation options, probabilities and rank probabilities, robustness across stakeholder profiles, national scaling and scenarios, full indicator and source tables, and method notes.
- **Score**: 16 EF impact categories plus hazard-weighted waste, grouped into 12 themes. The themes are weighted with **stakeholder weight profiles** (MCDA; synthetic Delphi panels for now). The result is expressed as person-equivalents: the share of an average person's annual footprint.
- **Uncertainty**: Monte Carlo over the data rows (lognormal, using the reported range plus the pedigree variance) and, optionally, over the weights. Output: median, 90% interval, P(lowest impact) and pairwise probabilities.
- **Evidence quality**: each source gets Weidema pedigree scores, which give an A–E grade per alternative.
- **Harmonisation**: the on-site electricity share of climate footprints is rescaled to the Dutch grid.
- **Dutch / English** interface.
- **Exports**: PDF report, Excel results, CSV indicators, and the full data workbook.

## Quick start

```bash
npm install
npm run dev           # http://localhost:5173
npm run build         # static site in dist/
npm run build:single  # one self-contained HTML file in dist-single/
npm run check         # sanity check of the engine over all situations
npm run generate-data # regenerate the synthetic dataset (Python 3 + numpy + openpyxl)
```

## Deploying on GitHub Pages

1. Push this repository to GitHub (branch `main`).
2. In *Settings → Pages*, set **Source = GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` builds and publishes the site on every push.

## Maintaining the data (no coding needed)

All data lives in one Excel workbook; `data/MECH-I_data_template_SYNTHETIC.xlsx` is the template. Edit it in Excel, then load it in the app through **Data → Load data workbook**. The file is read in the browser and never uploaded. See [`docs/DATA_GUIDE.md`](docs/DATA_GUIDE.md) for every sheet and column.

**Public code, private data.** Keep real or licensed data (for example values derived from ecoinvent or from the Healthcare LCA database) out of this public repository. Store such files in `data/private/`, which git ignores, or outside the repo, and load them at runtime. Only the synthetic dataset is bundled into the app (`src/data/synthetic.json`).

## Project structure

```
src/
  lib/engine.ts       calculation engine (harmonisation, pedigree, Monte Carlo, scoring, robustness)
  lib/workbook.ts     .xlsx import/export (sheet & column definitions)
  lib/exporters.ts    PDF / Excel / CSV reports
  lib/i18n.ts         English and Dutch interface text
  lib/methods.ts      method notes shown in the app and in the PDF
  views/              Micro, Meso and Macro views
  components/         charts and shared UI
  data/synthetic.json bundled synthetic dataset
tools/generate_synthetic.py   synthetic data generator (documents every assumption)
data/                         data workbook template
docs/                         data guide and method notes
```

## Method in brief

See [`docs/METHODS.md`](docs/METHODS.md). Key points:

1. Normalisation uses the EF 3.0 global per-person factors. Within a theme, categories are combined with EF weights as sub-weights. The themes are then weighted with stakeholder profiles; a custom profile is also possible.
2. A category missing for any compared alternative is excluded for all of them. The tool shows this, and the remaining weights are renormalised.
3. Inventory indicators (energy by carrier and source, water withdrawal, waste streams, travel, drug residues) are shown but not weighted separately, to avoid double counting.

## Known limitations / to do before real use

- Replace the synthetic data with extracted literature data, and the synthetic stakeholder weights with Delphi results.
- Verify the normalisation and weighting factors against the official JRC EF 3.1 package. Replace the illustrative grid factors with current values, for example from CO2emissiefactoren.nl.
- Harmonisation covers only the electricity share of climate change.
- The toxicity and drug-residue modelling (USEtox) only partly captures pharmaceuticals. Persistence is shown as an inventory indicator only.
- The waste indicator's hazard factors are prototype assumptions.
- The tool covers environmental impact only. Clinical effectiveness and costs must be weighed alongside it.
