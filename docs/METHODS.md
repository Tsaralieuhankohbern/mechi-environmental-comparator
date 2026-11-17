# Method notes (prototype)

These notes are also shown in the app (Macro view) and in the PDF report. Dutch version: see `src/lib/methods.ts`.

## Purpose

The tool compares the environmental impact of two or more clinically relevant alternatives for the same functional unit. It ranks environmental impact only; clinical effectiveness, safety and costs are assessed separately.

## Evidence

Values are extracted from primary LCA studies, reviews, policy documents and hospital audits into the data workbook. Several sources per intervention are allowed. Each source gets pedigree scores (1–5) for reliability, completeness, and temporal, geographical and technological correlation with current Dutch practice (Weidema pedigree matrix).

## Harmonisation

For climate change, the on-site electricity share of a reported footprint is rescaled from the study country’s grid factor to the Dutch grid factor. Other categories are not harmonised in this prototype. Upstream manufacturing electricity is left as reported, because it occurs where products are made.

## Impact categories

16 Environmental Footprint (EF) impact categories plus a hazard-weighted waste indicator, grouped into 12 themes for weighting. Energy by carrier and by source, water withdrawal, waste streams, travel distance and active substances to wastewater are shown as inventory indicators and are not weighted separately, to avoid double counting with the impact categories.

## Normalisation

External: each impact is divided by the global per-person annual impact (EF 3.0 normalisation factors), so 1 = the annual footprint of an average person in that category. Internal (alternative): each impact is divided by the highest value among the compared alternatives.

## Weighting

Themes are weighted with stakeholder weight profiles (mean and SD per theme, e.g. from a Delphi panel). Within a theme, categories are combined using the EF weighting factors as relative sub-weights. Themes without data for all alternatives are left out and the weights renormalised. The EF 3.1 reference weights and equal weights are available for comparison.

## Uncertainty

Every data row is modelled as a lognormal distribution (median = reported value; spread from the reported range plus pedigree variance). Monte Carlo simulation samples a source per alternative (weighted by precision and quality), correlated values across categories, and optionally the stakeholder weights. Results are reported as median and 90% interval, the probability that each alternative has the lowest score, pairwise probabilities and rank probabilities.

## Limitations

Prototype with synthetic data. Normalisation and weighting factors must be verified against the official JRC EF 3.1 package before use. LCA toxicity models capture pharmaceutical residues only partly; persistence (e.g. iodinated contrast media) is shown as an inventory indicator. Patient radiation dose is not part of the environmental "ionising radiation" category. The waste indicator partly overlaps with other categories and its hazard factors are prototype assumptions.

## Score definition

For alternative *a*, indicator *i* in theme *t*, with normalisation factor NF and EF sub-weight *s*:

```
PE(a,i)    = value(a,i) / NF(i)                              (external normalisation)
Theme(a,t) = Σ_i∈t s(i) · PE(a,i) / Σ_i∈t s(i)
Score(a)   = Σ_t W(t) · Theme(a,t)          with Σ_t W(t) = 1 over themes with data
```

An average person scores 1 person-year (365 person-days) under any weighting, which makes the score readable as 'share of an average person's annual environmental footprint'.

## Uncertainty model

- Each data row → lognormal with median = value, σ² = σ²(reported range: ln(high/low)/(2·1.645)) + Σ pedigree variances (ecoinvent v3 / Weidema et al. 2013).
- Several sources for one cell → a mixture. Per iteration one source is drawn per alternative, with probability ∝ 1/σ² (or equal), using the same random draw for all indicators so that a study's results stay together.
- Correlation across indicators within an alternative: ρ = 0.7 (shared study-level factor).
- Weight uncertainty (optional): each theme weight ~ N(mean, SD) truncated at 0, then renormalised (as in SMAA).
- Outputs: median, 5th–95th percentile, P(lowest), rank probabilities, pairwise P(a < b).

## Harmonisation

`cc_harmonised = cc · (1 − e + e · grid_NL / grid_country)`, where *e* is the reported on-site electricity share.

## Synthetic data

`tools/generate_synthetic.py` documents every assumption: stage-level climate footprints per intervention, process archetype profiles (normalised ratios to climate change) used to derive the other 15 EF categories, synthetic sources with study-level bias, noise, country grids, ranges and pedigree scores.
