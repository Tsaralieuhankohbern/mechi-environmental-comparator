#!/usr/bin/env python3
"""
Synthetic demo dataset generator for the MECH-I environmental decision tool.

ALL VALUES PRODUCED BY THIS SCRIPT ARE SYNTHETIC. They are calibrated to the
order of magnitude reported in published healthcare LCA literature, but they are
NOT results of real studies and must not be used for real decisions.

How it works
------------
1. Each intervention is described by a "true" Dutch-context climate footprint
   split into life-cycle stages, each linked to a process archetype
   (electricity, plastics, pharmaceuticals, direct gas emissions, ...).
2. Each archetype has a profile of EF impact intensities per kg CO2-eq, expressed
   as normalised ratios relative to climate change. This keeps all 16 EF
   categories internally consistent with the climate figure.
3. Synthetic "sources" (primary LCA studies, reviews, policy documents, Dutch
   hospital audits) then "report" these values with study-level bias, noise,
   their own country's electricity grid, a reported range and pedigree scores.
   Some sources report all categories, others only climate change - as in the
   real literature.

Outputs: src/data/synthetic.json (bundled in the app) and
         data/MECH-I_data_template_SYNTHETIC.xlsx (the spreadsheet format).

Run:  python3 tools/generate_synthetic.py
"""
import json
import math
import os
from datetime import date

import numpy as np

RNG = np.random.default_rng(20261117)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REF_YEAR = 2026
NL_GRID = 0.33  # kg CO2-eq per kWh, illustrative life-cycle factor for the NL mix

# ---------------------------------------------------------------------------
# Indicators
# ---------------------------------------------------------------------------
# EF 3.0 global normalisation factors (per person per year, reference year 2010)
# and EF 3.0/3.1 weighting factors (%). Verify against the JRC EF 3.1 package
# before using with real data.
IMPACTS = [
    # id, theme, name_en, name_nl, unit, nf, ef_weight
    ("cc", "climate", "Climate change", "Klimaatverandering", "kg CO2-eq", 8.10e3, 21.06),
    ("od", "ozone", "Ozone depletion", "Aantasting ozonlaag", "kg CFC-11-eq", 5.36e-2, 6.31),
    ("ir", "radiation", "Ionising radiation (environmental)", "Ioniserende straling (milieu)", "kBq U235-eq", 4.22e3, 5.01),
    ("pof", "air", "Photochemical ozone formation", "Fotochemische ozonvorming", "kg NMVOC-eq", 4.06e1, 4.78),
    ("pm", "air", "Particulate matter", "Fijnstof", "disease incidence", 5.95e-4, 8.96),
    ("htc", "toxicity", "Human toxicity, cancer", "Humane toxiciteit, kanker", "CTUh", 1.69e-5, 2.13),
    ("htnc", "toxicity", "Human toxicity, non-cancer", "Humane toxiciteit, niet-kanker", "CTUh", 2.30e-4, 1.84),
    ("ac", "acidification", "Acidification", "Verzuring", "mol H+-eq", 5.56e1, 6.20),
    ("euf", "eutrophication", "Eutrophication, freshwater", "Vermesting, zoetwater", "kg P-eq", 1.61e0, 2.80),
    ("eum", "eutrophication", "Eutrophication, marine", "Vermesting, zeewater", "kg N-eq", 1.95e1, 2.96),
    ("eut", "eutrophication", "Eutrophication, terrestrial", "Vermesting, land", "mol N-eq", 1.77e2, 3.71),
    ("etf", "toxicity", "Ecotoxicity, freshwater (incl. drug residues)", "Ecotoxiciteit, zoetwater (incl. medicijnresten)", "CTUe", 4.27e4, 1.92),
    ("lu", "land", "Land use", "Landgebruik", "pt", 8.19e5, 7.94),
    ("wu", "water", "Water use (scarcity-weighted)", "Watergebruik (schaarste-gewogen)", "m3 world-eq deprived", 1.15e4, 8.51),
    ("ruf", "energy", "Resource use, fossils", "Uitputting fossiele grondstoffen", "MJ", 6.50e4, 8.32),
    ("rum", "minerals", "Resource use, minerals and metals", "Uitputting mineralen en metalen", "kg Sb-eq", 6.36e-2, 7.55),
]
IMPACT_IDS = [i[0] for i in IMPACTS]
NF = {i[0]: i[5] for i in IMPACTS}

INVENTORY = [
    # id, group, name_en, name_nl, unit, hazard_factor
    ("ced_fossil", "energy_source", "Primary energy, fossil", "Primaire energie, fossiel", "MJ", None),
    ("ced_nuclear", "energy_source", "Primary energy, nuclear", "Primaire energie, nucleair", "MJ", None),
    ("ced_renewable", "energy_source", "Primary energy, renewable", "Primaire energie, hernieuwbaar", "MJ", None),
    ("elec_kwh", "energy_carrier", "Electricity use (on-site)", "Elektriciteitsverbruik (locatie)", "kWh", None),
    ("heat_mj", "energy_carrier", "Heating fuels (on-site)", "Brandstof voor verwarming (locatie)", "MJ", None),
    ("fuel_mj", "energy_carrier", "Transport fuels", "Transportbrandstof", "MJ", None),
    ("water_withdrawal", "water", "Water withdrawal (on-site)", "Wateronttrekking (locatie)", "m3", None),
    ("waste_residual", "waste", "Residual waste", "Restafval", "kg", 1.0),
    ("waste_sza", "waste", "Specific hospital waste (infectious)", "Specifiek ziekenhuisafval (SZA)", "kg", 3.0),
    ("waste_cyto", "waste", "Cytotoxic & pharmaceutical waste", "Cytostatisch & farmaceutisch afval", "kg", 5.0),
    ("waste_recycled", "waste", "Recycled waste", "Gerecycled afval", "kg", 0.2),
    ("travel_km", "travel", "Patient & staff travel", "Reizen van patiënten & personeel", "km", None),
    ("api_water", "api", "Active substances to wastewater", "Werkzame stoffen naar afvalwater", "g", None),
]

THEMES = [
    ("climate", "Climate change", "Klimaatverandering", "Greenhouse gas emissions (GWP100)", "Broeikasgasemissies (GWP100)"),
    ("energy", "Energy & fossil resources", "Energie & fossiele grondstoffen", "Depletion of fossil energy carriers", "Uitputting van fossiele energiedragers"),
    ("water", "Water use", "Watergebruik", "Water consumption weighted by local scarcity", "Waterverbruik gewogen naar lokale schaarste"),
    ("land", "Land use", "Landgebruik", "Effects of land occupation on soil quality", "Effect van landgebruik op bodemkwaliteit"),
    ("air", "Air quality", "Luchtkwaliteit", "Fine particulate matter and smog formation", "Fijnstof en smogvorming"),
    ("ozone", "Ozone layer", "Ozonlaag", "Stratospheric ozone depletion", "Afbraak van de stratosferische ozonlaag"),
    ("radiation", "Ionising radiation", "Ioniserende straling", "Radionuclide emissions to the environment (not patient dose)", "Emissie van radionucliden naar het milieu (niet de patiëntdosis)"),
    ("acidification", "Acidification", "Verzuring", "Acidifying emissions (SO2, NOx, NH3)", "Verzurende emissies (SO2, NOx, NH3)"),
    ("eutrophication", "Eutrophication", "Vermesting", "Nutrient enrichment of water and soil", "Verrijking van water en bodem met nutriënten"),
    ("toxicity", "Toxicity & drug residues", "Toxiciteit & medicijnresten", "Human toxicity and freshwater ecotoxicity, including active pharmaceutical substances", "Humane toxiciteit en zoetwater-ecotoxiciteit, inclusief farmaceutisch werkzame stoffen"),
    ("minerals", "Minerals & metals", "Mineralen & metalen", "Depletion of mineral and metal resources", "Uitputting van mineralen en metalen"),
    ("waste", "Waste", "Afval", "Hazard-weighted waste mass (prototype indicator; partly overlaps with other categories)", "Gevarengewogen afvalmassa (prototype-indicator; overlapt deels met andere categorieën)"),
]

STAGES = [
    ("pharma", "Pharmaceuticals & chemicals", "Geneesmiddelen & chemicaliën"),
    ("gases", "Direct gas emissions", "Directe gasemissies"),
    ("devices", "Medical devices & consumables", "Medische hulpmiddelen & disposables"),
    ("electricity", "Electricity (on-site)", "Elektriciteit (locatie)"),
    ("heat", "Heating (on-site fuels)", "Verwarming (brandstof locatie)"),
    ("services", "Services, staff overhead, catering & laundry", "Diensten, overhead, catering & wasserij"),
    ("transport", "Transport (patients, staff, goods)", "Transport (patiënten, personeel, goederen)"),
    ("waste", "Waste treatment", "Afvalverwerking"),
]

# ---------------------------------------------------------------------------
# Process archetypes: normalised impact per normalised climate impact
# order: cc od ir pof pm htc htnc ac euf eum eut etf lu wu ruf rum
# plus CED per kg CO2-eq (fossil, nuclear, renewable MJ)
# ---------------------------------------------------------------------------
ARCH = {
    "elec":    ([1, .02, .15, .35, .15, .08, .15, .35, .15, .25, .25, .15, .05, .08, 1.8, .08], (15, 1.2, 5.0)),
    "waterro": ([1, .02, .15, .30, .15, .10, .15, .30, .20, .25, .25, .20, .05, 6.0, 1.7, .10], (15, 1.2, 5.0)),
    "heat":    ([1, .03, .02, .30, .05, .02, .04, .15, .01, .15, .15, .03, .01, .01, 2.0, .01], (16, .05, .1)),
    "car":     ([1, .02, .05, .90, .60, .15, .40, .40, .05, .50, .55, .40, .08, .05, 1.7, .60], (13, .2, .3)),
    "freight": ([1, .02, .03, 1.2, .50, .10, .30, .50, .02, .70, .80, .20, .03, .02, 1.8, .15], (14, .1, .3)),
    "plast":   ([1, .03, .08, .40, .20, .15, .25, .35, .10, .25, .25, .25, .06, .15, 1.6, .10], (15, .5, .5)),
    "pharma":  ([1, .15, .30, .50, .35, .40, .60, .60, .50, .40, .40, 1.2, .20, .60, 1.4, .40], (13, 1.5, 1.5)),
    "device":  ([1, .04, .20, .45, .60, 1.5, 1.0, 1.0, .60, .35, .40, 1.0, .15, .30, 1.2, 4.0], (11, 2.0, 2.0)),
    "gas":     ([1, .001, .001, .001, .001, .001, .001, .001, .001, .001, .001, .001, .001, .001, .004, .001], (.05, .005, .005)),
    # N2O also depletes stratospheric ozone. Characterisation of N2O differs
    # between methods (ReCiPe includes it; check EF 3.1) - synthetic ratio.
    "n2o":     ([1, 2.0, .001, .001, .001, .001, .001, .001, .001, .001, .001, .001, .001, .001, .004, .001], (.02, .002, .002)),
    "laundry": ([1, .03, .10, .30, .15, .10, .20, .30, .40, .40, .25, .50, .30, .80, 1.5, .05], (14, 1.0, 3.0)),
    "incin":   ([1, .01, .02, .20, .05, .30, .80, .15, .05, .15, .15, .40, .01, .03, .20, .02], (.5, .05, .05)),
    "food":    ([1, .05, .05, .25, .60, .10, .60, 1.5, .80, 1.8, 2.0, .60, 3.0, 1.5, .60, .10], (6, .5, 1.5)),
    "hosp":    ([1, .05, .20, .40, .35, .30, .40, .50, .30, .40, .40, .50, .40, .30, 1.4, .30], (12, 1.5, 2.5)),
}
ELEC_ARCH = {"elec", "waterro"}
CAR_KG_PER_KM = 0.15  # NL patient travel mix (car, bike, public transport)

# Ecotoxicity of active substances reaching wastewater, CTUe per gram (synthetic)
API_CF = {
    "iodinated contrast (g I)": 0.02, "inhaled corticosteroid": 40, "propofol": 8,
    "sertraline": 60, "acenocoumarol": 10, "apixaban": 5, "ropivacaine": 2,
    "paracetamol": 0.5, "fluorouracil & platinum": 30, "capecitabine, fluorouracil & platinum": 30,
}

# ---------------------------------------------------------------------------
# Grid factors (illustrative life-cycle kg CO2-eq/kWh of consumption mix)
# ---------------------------------------------------------------------------
GRID = {
    "NL": ("Netherlands", "Nederland", 0.33), "UK": ("United Kingdom", "Verenigd Koninkrijk", 0.23),
    "US": ("United States", "Verenigde Staten", 0.41), "DE": ("Germany", "Duitsland", 0.40),
    "FR": ("France", "Frankrijk", 0.06), "AU": ("Australia", "Australië", 0.62),
    "CA": ("Canada", "Canada", 0.13), "SE": ("Sweden", "Zweden", 0.04), "ES": ("Spain", "Spanje", 0.18),
    "IT": ("Italy", "Italië", 0.32), "DK": ("Denmark", "Denemarken", 0.15), "BE": ("Belgium", "België", 0.16),
    "JP": ("Japan", "Japan", 0.48), "CN": ("China", "China", 0.58), "CH": ("Switzerland", "Zwitserland", 0.05),
    "NO": ("Norway", "Noorwegen", 0.03), "AT": ("Austria", "Oostenrijk", 0.14), "IE": ("Ireland", "Ierland", 0.33),
}
GEO_SCORE = {"NL": 1, "BE": 2, "DE": 2, "DK": 2, "UK": 2, "FR": 2, "SE": 2, "AT": 2, "IE": 2, "INT": 3}


def geo_score(c):
    return GEO_SCORE.get(c, 3)


def temporal_score(year):
    age = REF_YEAR - year
    return 1 if age <= 3 else 2 if age <= 6 else 3 if age <= 10 else 4 if age <= 15 else 5


# ---------------------------------------------------------------------------
# Situations & interventions
# ---------------------------------------------------------------------------
def S(sid, area_en, area_nl, name_en, name_nl, desc_en, desc_nl, fu_en, fu_nl, vol, scope_en="", scope_nl=""):
    return dict(situation_id=sid, clinical_area_en=area_en, clinical_area_nl=area_nl, name_en=name_en, name_nl=name_nl,
                description_en=desc_en, description_nl=desc_nl, functional_unit_en=fu_en, functional_unit_nl=fu_nl,
                nl_annual_volume=vol, volume_note="Synthetic estimate of annual Dutch volume (functional units/year)",
                scope_note_en=scope_en, scope_note_nl=scope_nl)


def I(iid, sid, name_en, name_nl, desc_en, desc_nl, share, stages, travel=0, water_l=0, waste=(0, 0, 0, 0),
      api=None, note_en="", note_nl=""):
    return dict(intervention_id=iid, situation_id=sid, name_en=name_en, name_nl=name_nl, description_en=desc_en,
                description_nl=desc_nl, nl_current_share=share, clinical_note_en=note_en, clinical_note_nl=note_nl,
                _stages=stages, _travel=travel, _water=water_l, _waste=waste, _api=api)


SITUATIONS = [
    S("S01", "Cardiology", "Cardiologie", "Severe aortic stenosis: valve replacement", "Ernstige aortaklepstenose: klepvervanging",
      "Transcatheter versus surgical aortic valve replacement in patients eligible for both.",
      "Transcatheter versus chirurgische aortaklepvervanging bij patiënten die voor beide in aanmerking komen.",
      "One valve replacement, incl. index admission and pre-operative work-up",
      "Eén klepvervanging, incl. opname en preoperatieve screening", 5000,
      "Excludes long-term follow-up and complications.", "Exclusief langetermijnfollow-up en complicaties."),
    S("S02", "Nephrology", "Nefrologie", "End-stage kidney disease: dialysis modality", "Eindstadium nierfalen: dialysevorm",
      "In-centre haemodialysis, home haemodialysis and peritoneal dialysis.",
      "Centrumhemodialyse, thuishemodialyse en peritoneale dialyse.",
      "One patient-year of dialysis", "Eén patiëntjaar dialyse", 6500,
      "Includes medication, consumables, water treatment and patient transport.",
      "Inclusief medicatie, disposables, waterbehandeling en patiëntenvervoer."),
    S("S03", "Pulmonology", "Longziekten", "Asthma: maintenance inhaler type", "Astma: type onderhoudsinhalator",
      "Pressurised metered-dose inhalers with two propellants, dry-powder inhaler and reusable soft-mist inhaler.",
      "Dosisaerosolen met twee drijfgassen, poederinhalator en herbruikbare soft-mist-inhalator.",
      "One patient-year of maintenance therapy (ICS/LABA, 2 inhalations twice daily)",
      "Eén patiëntjaar onderhoudsbehandeling (ICS/LABA, 2× daags 2 inhalaties)", 400000,
      "Clinical suitability differs per patient (inspiratory flow, technique).",
      "Klinische geschiktheid verschilt per patiënt (inspiratoire flow, techniek)."),
    S("S04", "Anaesthesiology", "Anesthesiologie", "Maintenance of general anaesthesia", "Onderhoud van algehele anesthesie",
      "Volatile anaesthetics versus total intravenous anaesthesia (TIVA).",
      "Dampvormige anesthetica versus totale intraveneuze anesthesie (TIVA).",
      "One hour of anaesthesia maintenance in an adult (fresh gas flow 1 L/min for volatiles)",
      "Eén uur onderhoud van anesthesie bij een volwassene (verse gasflow 1 L/min bij dampvormige middelen)", 2000000,
      "Excludes operating-theatre energy that is the same for all options.",
      "Exclusief OK-energie die voor alle opties gelijk is."),
    S("S05", "Ophthalmology", "Oogheelkunde", "Cataract surgery pathway", "Zorgpad cataractchirurgie",
      "Conventional pathway versus an optimised low-waste pathway.",
      "Conventioneel zorgpad versus een geoptimaliseerd zorgpad met minder afval.",
      "One eye operated, incl. pre- and post-operative visits", "Eén geopereerd oog, incl. pre- en postoperatieve bezoeken", 170000),
    S("S06", "Surgery", "Chirurgie", "Laparoscopic cholecystectomy: instruments and approach",
      "Laparoscopische cholecystectomie: instrumentarium en techniek",
      "Single-use versus hybrid reusable instruments, and robot-assisted surgery.",
      "Disposable versus hybride herbruikbaar instrumentarium, en robotgeassisteerde chirurgie.",
      "One cholecystectomy incl. day-case or one-night admission",
      "Eén cholecystectomie incl. dagopname of één nacht opname", 25000),
    S("S07", "Gynaecology", "Gynaecologie", "Benign hysterectomy: surgical route", "Benigne hysterectomie: operatieve benadering",
      "Abdominal, laparoscopic, vaginal and robot-assisted hysterectomy.",
      "Abdominale, laparoscopische, vaginale en robotgeassisteerde hysterectomie.",
      "One hysterectomy incl. admission", "Eén hysterectomie incl. opname", 10000),
    S("S08", "Mental health", "GGZ", "Mild to moderate depression: first-line treatment", "Lichte tot matige depressie: eerstelijnsbehandeling",
      "Antidepressant medication, face-to-face CBT and guided internet CBT.",
      "Antidepressiva, face-to-face CGT en begeleide online CGT.",
      "One 12-week treatment course", "Eén behandeltraject van 12 weken", 300000,
      "Effectiveness and patient preference determine suitability; environmental comparison only.",
      "Effectiviteit en voorkeur van de patiënt bepalen de geschiktheid; alleen milieuvergelijking."),
    S("S09", "Oncology", "Oncologie", "Oncology follow-up consultation", "Oncologisch nacontrolegesprek",
      "In-person versus video and telephone consultation.",
      "Fysiek consult versus video- en telefonisch consult.",
      "One follow-up consultation (no physical examination needed)",
      "Eén nacontrolegesprek (zonder noodzaak tot lichamelijk onderzoek)", 1000000),
    S("S10", "Radiotherapy", "Radiotherapie", "Whole-breast radiotherapy after breast-conserving surgery",
      "Radiotherapie van de hele borst na borstsparende operatie",
      "Conventional (25 fractions), moderate (15) and ultra-hypofractionation (5).",
      "Conventionele (25 fracties), matige (15) en ultra-hypofractionering (5).",
      "One radiotherapy course", "Eén radiotherapiebehandeling", 12000),
    S("S11", "Thrombosis care", "Trombosezorg", "Atrial fibrillation: oral anticoagulation", "Atriumfibrilleren: orale antistolling",
      "Vitamin K antagonist with INR monitoring by a thrombosis service versus a direct oral anticoagulant.",
      "Vitamine K-antagonist met INR-controle door de trombosedienst versus een direct werkend oraal anticoagulans.",
      "One patient-year of anticoagulation incl. monitoring", "Eén patiëntjaar antistolling incl. controle", 400000),
    S("S12", "Orthopaedics", "Orthopedie", "Total knee arthroplasty: care pathway", "Totale knieprothese: zorgpad",
      "Conventional inpatient pathway versus outpatient (same-day discharge) pathway.",
      "Conventioneel klinisch zorgpad versus poliklinisch zorgpad (ontslag op de dag van operatie).",
      "One knee replacement incl. admission and outpatient physiotherapy",
      "Eén knieprothese incl. opname en poliklinische fysiotherapie", 30000),
    S("S13", "Gastroenterology", "Maag-darm-lever", "Colorectal cancer screening strategy", "Strategie bevolkingsonderzoek darmkanker",
      "FIT-based screening (with colonoscopy after a positive FIT) versus primary colonoscopy.",
      "Screening met FIT (met coloscopie na positieve FIT) versus primaire coloscopie.",
      "One person screened in one screening round", "Eén gescreende persoon in één screeningsronde", 1500000),
    S("S14", "Paediatrics", "Kindergeneeskunde", "Suspected appendicitis in children: imaging strategy",
      "Verdenking appendicitis bij kinderen: beeldvormingsstrategie",
      "Ultrasound first (MRI if inconclusive), CT with contrast, or MRI for all.",
      "Eerst echografie (MRI bij twijfel), CT met contrast, of MRI voor iedereen.",
      "One diagnostic imaging work-up (shared emergency department care excluded)",
      "Eén beeldvormend diagnostisch traject (gedeelde SEH-zorg uitgesloten)", 15000),
    S("S15", "Operating theatre", "Operatiekamer", "Surgical gowns and drapes", "Operatiejassen en afdekmateriaal",
      "Single-use nonwoven versus reusable textile gowns and drapes.",
      "Disposable non-woven versus herbruikbare textiele operatiejassen en afdekmateriaal.",
      "One surgical procedure (2 gowns + 1 drape set)", "Eén operatie (2 operatiejassen + 1 afdekset)", 1500000),
    S("S16", "Obstetrics", "Verloskunde", "Pharmacological pain relief during labour", "Medicamenteuze pijnstilling tijdens de bevalling",
      "Nitrous oxide (vented or with destruction unit), epidural and remifentanil PCA.",
      "Lachgas (afgevoerd of met kraakinstallatie), epidurale analgesie en remifentanil-PCA.",
      "One labour (average 6 hours of analgesia)", "Eén bevalling (gemiddeld 6 uur pijnstilling)", 80000,
      "Clinical effectiveness and side effects differ; the woman's preference is central.",
      "Effectiviteit en bijwerkingen verschillen; de voorkeur van de vrouw staat centraal."),
    S("S17", "Sleep medicine", "Slaapgeneeskunde", "Obstructive sleep apnoea: therapy", "Obstructief slaapapneu: behandeling",
      "Continuous positive airway pressure versus a mandibular advancement device.",
      "CPAP versus een mandibulair repositieapparaat (MRA).",
      "One patient-year of therapy", "Eén patiëntjaar behandeling", 200000,
      "A mandibular advancement device is mainly suitable for mild to moderate OSA.",
      "Een MRA is vooral geschikt voor licht tot matig OSA."),
    S("S18", "Gastroenterology", "Maag-darm-lever", "ERCP: duodenoscope type", "ERCP: type duodenoscoop",
      "Reprocessed reusable versus single-use duodenoscope.", "Herbruikbare (gereinigde) versus disposable duodenoscoop.",
      "One ERCP procedure (duodenoscope-related life cycle only)",
      "Eén ERCP-procedure (alleen levenscyclus van de duodenoscoop)", 12000),
    S("S19", "Hospital pharmacy", "Ziekenhuisfarmacie", "Postoperative paracetamol: route", "Postoperatief paracetamol: toedieningsweg",
      "Intravenous versus oral paracetamol in patients able to take oral medication.",
      "Intraveneus versus oraal paracetamol bij patiënten die orale medicatie kunnen innemen.",
      "One inpatient day (4 g paracetamol)", "Eén opnamedag (4 g paracetamol)", 3000000),
    S("S20", "Oncology", "Oncologie", "Metastatic colorectal cancer: fluoropyrimidine schedule",
      "Gemetastaseerd colorectaal carcinoom: fluoropyrimidineschema",
      "Infusional 5-FU (FOLFOX) versus oral capecitabine (CAPOX).",
      "Infuus met 5-FU (FOLFOX) versus orale capecitabine (CAPOX).",
      "Six weeks of treatment (FOLFOX: 3 cycles; CAPOX: 2 cycles)",
      "Zes weken behandeling (FOLFOX: 3 cycli; CAPOX: 2 cycli)", 40000,
      "Oral capecitabine is excreted at home: residues reach municipal rather than hospital wastewater.",
      "Orale capecitabine wordt thuis uitgescheiden: resten komen in gemeentelijk in plaats van ziekenhuisafvalwater."),
]

ICM = "iodinated contrast (g I)"
INTERVENTIONS = [
    I("I01a", "S01", "TAVI (transfemoral)", "TAVI (transfemoraal)",
      "Transfemoral TAVI under local anaesthesia/sedation; ~2.5-day admission.",
      "Transfemorale TAVI onder lokale anesthesie/sedatie; opname ca. 2,5 dag.", .60,
      [("devices", "device", 45), ("devices", "plast", 35), ("pharma", "pharma", 12), ("electricity", "elec", 50),
       ("heat", "heat", 27), ("services", "hosp", 50), ("services", "food", 10), ("transport", "car", 13),
       ("transport", "freight", 5), ("waste", "incin", 8)], 84, 400, (6, 4, 0, 1), (30, ICM),
      "Choice depends on surgical risk, age and anatomy (Heart Team decision).",
      "Keuze hangt af van operatierisico, leeftijd en anatomie (Heart Team-besluit)."),
    I("I01b", "S01", "SAVR (surgical)", "SAVR (chirurgisch)",
      "Surgical replacement via sternotomy with cardiopulmonary bypass; ~1.5 ICU days and 5.5 ward days.",
      "Chirurgische vervanging via sternotomie met hart-longmachine; ca. 1,5 dag IC en 5,5 dag verpleegafdeling.", .40,
      [("devices", "device", 25), ("devices", "plast", 75), ("pharma", "pharma", 30), ("gases", "gas", 10),
       ("electricity", "elec", 150), ("heat", "heat", 88), ("services", "hosp", 170), ("services", "food", 25),
       ("transport", "car", 19), ("transport", "freight", 8), ("waste", "incin", 20)], 112, 2500, (18, 10, 0, 4), (10, ICM),
      "Choice depends on surgical risk, age and anatomy (Heart Team decision).",
      "Keuze hangt af van operatierisico, leeftijd en anatomie (Heart Team-besluit)."),

    I("I02a", "S02", "In-centre haemodialysis", "Centrumhemodialyse",
      "3 sessions/week of 4 h in a dialysis centre; patients mostly travel by (taxi) car.",
      "3 sessies/week van 4 uur in een dialysecentrum; patiënten reizen meestal per (taxi)auto.", .78,
      [("pharma", "pharma", 1500), ("devices", "plast", 900), ("devices", "device", 150), ("electricity", "elec", 300),
       ("electricity", "waterro", 150), ("heat", "heat", 200), ("services", "hosp", 500), ("services", "food", 50),
       ("transport", "car", 800), ("transport", "freight", 150), ("waste", "incin", 200)], 4680, 78000, (150, 350, 0, 30), None,
      "Modality depends on medical suitability, residual kidney function and patient preference.",
      "Dialysevorm hangt af van medische geschiktheid, nierrestfunctie en voorkeur van de patiënt."),
    I("I02b", "S02", "Home haemodialysis", "Thuishemodialyse",
      "5–6 shorter sessions/week at home after training; supplies delivered to the home.",
      "5–6 kortere sessies/week thuis na training; materialen worden thuisbezorgd.", .05,
      [("pharma", "pharma", 1300), ("devices", "plast", 1100), ("devices", "device", 200), ("electricity", "elec", 350),
       ("electricity", "waterro", 120), ("heat", "heat", 30), ("services", "hosp", 250), ("transport", "car", 91),
       ("transport", "freight", 450), ("waste", "incin", 250)], 960, 40000, (300, 150, 0, 10), None,
      "Modality depends on medical suitability, residual kidney function and patient preference.",
      "Dialysevorm hangt af van medische geschiktheid, nierrestfunctie en voorkeur van de patiënt."),
    I("I02c", "S02", "Peritoneal dialysis", "Peritoneale dialyse",
      "Peritoneal dialysis at home (mix of CAPD and automated PD); large volumes of dialysis fluid delivered.",
      "Peritoneale dialyse thuis (mix van CAPD en APD); grote hoeveelheden dialysevloeistof bezorgd.", .17,
      [("pharma", "pharma", 1600), ("devices", "plast", 700), ("devices", "device", 60), ("electricity", "elec", 60),
       ("services", "hosp", 200), ("transport", "car", 61), ("transport", "freight", 700), ("waste", "incin", 280)],
      360, 500, (600, 50, 0, 20), None,
      "Modality depends on medical suitability, residual kidney function and patient preference.",
      "Dialysevorm hangt af van medische geschiktheid, nierrestfunctie en voorkeur van de patiënt."),

    I("I03a", "S03", "pMDI (HFA-134a propellant)", "Dosisaerosol (drijfgas HFA-134a)",
      "Pressurised metered-dose inhaler, ~12 inhalers per year.", "Dosisaerosol, ca. 12 inhalatoren per jaar.", .25,
      [("gases", "gas", 264), ("devices", "device", 5), ("devices", "plast", 2), ("pharma", "pharma", 6),
       ("services", "hosp", 5), ("transport", "car", 2), ("transport", "freight", 2), ("waste", "incin", 1)],
      20, 0, (.5, 0, 0, .1), (.3, "inhaled corticosteroid")),
    I("I03b", "S03", "pMDI (HFA-152a, low-GWP)", "Dosisaerosol (HFA-152a, lage GWP)",
      "Next-generation pMDI with low global-warming propellant HFA-152a.",
      "Nieuwe generatie dosisaerosol met drijfgas HFA-152a met lage GWP.", .02,
      [("gases", "gas", 28), ("devices", "device", 5), ("devices", "plast", 2), ("pharma", "pharma", 7),
       ("services", "hosp", 5), ("transport", "car", 2), ("transport", "freight", 2), ("waste", "incin", 1)],
      20, 0, (.5, 0, 0, .1), (.3, "inhaled corticosteroid")),
    I("I03c", "S03", "Dry-powder inhaler (DPI)", "Poederinhalator (DPI)",
      "Multi-dose dry-powder inhaler, ~12 per year.", "Multidosis-poederinhalator, ca. 12 per jaar.", .65,
      [("devices", "plast", 7), ("devices", "device", 1), ("pharma", "pharma", 6), ("services", "hosp", 5),
       ("transport", "car", 2), ("transport", "freight", 2), ("waste", "incin", 1)], 20, 0, (.6, 0, 0, .05),
      (.3, "inhaled corticosteroid"),
      "Requires sufficient inspiratory flow; not suitable for all patients.",
      "Vereist voldoende inspiratoire flow; niet geschikt voor alle patiënten."),
    I("I03d", "S03", "Soft-mist inhaler (reusable)", "Soft-mist-inhalator (herbruikbaar)",
      "Reusable soft-mist inhaler with refill cartridges.", "Herbruikbare soft-mist-inhalator met navulpatronen.", .08,
      [("devices", "plast", 3), ("devices", "device", 1), ("pharma", "pharma", 6), ("services", "hosp", 5),
       ("transport", "car", 2), ("transport", "freight", 1), ("waste", "incin", .5)], 20, 0, (.25, 0, 0, .05),
      (.3, "inhaled corticosteroid")),

    I("I04a", "S04", "Desflurane", "Desfluraan", "Volatile maintenance with desflurane at 1 L/min.",
      "Onderhoud met desfluraan bij 1 L/min.", .03,
      [("gases", "gas", 36), ("pharma", "pharma", 1.0), ("devices", "plast", .6), ("electricity", "elec", .2),
       ("waste", "incin", .1)], 0, 0, (.1, .05, 0, 0), None,
      "All options are clinically acceptable for most adult procedures.",
      "Alle opties zijn klinisch aanvaardbaar voor de meeste ingrepen bij volwassenen."),
    I("I04b", "S04", "Sevoflurane", "Sevofluraan", "Volatile maintenance with sevoflurane at 1 L/min.",
      "Onderhoud met sevofluraan bij 1 L/min.", .57,
      [("gases", "gas", 2.6), ("pharma", "pharma", .6), ("devices", "plast", .6), ("electricity", "elec", .2),
       ("waste", "incin", .1)], 0, 0, (.1, .05, 0, 0), None,
      "All options are clinically acceptable for most adult procedures.",
      "Alle opties zijn klinisch aanvaardbaar voor de meeste ingrepen bij volwassenen."),
    I("I04c", "S04", "Propofol TIVA", "Propofol-TIVA", "Total intravenous anaesthesia with propofol and remifentanil via pumps.",
      "Totale intraveneuze anesthesie met propofol en remifentanil via pompen.", .40,
      [("pharma", "pharma", .25), ("devices", "plast", .5), ("devices", "device", .1), ("electricity", "elec", .15),
       ("waste", "incin", .15)], 0, 0, (.1, .1, .05, 0), (.05, "propofol"),
      "Unused propofol must be incinerated, never poured down the drain.",
      "Ongebruikte propofol moet worden verbrand, nooit via de gootsteen worden afgevoerd."),

    I("I05a", "S05", "Conventional pathway", "Conventioneel zorgpad",
      "Single-use phaco pack, separate sessions per eye, pre-op visit and 2 post-op hospital visits.",
      "Disposable phaco-set, aparte sessies per oog, preoperatief bezoek en 2 postoperatieve ziekenhuisbezoeken.", .85,
      [("devices", "plast", 18), ("devices", "device", 4), ("pharma", "pharma", 12), ("electricity", "elec", 10),
       ("heat", "heat", 7), ("services", "hosp", 15), ("transport", "car", 11), ("transport", "freight", 2),
       ("waste", "incin", 4)], 72, 30, (1.5, .8, 0, .1)),
    I("I05b", "S05", "Optimised low-waste pathway", "Geoptimaliseerd zorgpad",
      "Reusable instruments, same-day bilateral surgery where suitable, multi-dose drops, remote post-op check.",
      "Herbruikbaar instrumentarium, beide ogen op één dag waar passend, multidosisdruppels, controle op afstand.", .15,
      [("devices", "plast", 9), ("devices", "device", 3), ("pharma", "pharma", 6), ("electricity", "elec", 7),
       ("heat", "heat", 4), ("services", "hosp", 10), ("transport", "car", 4), ("transport", "freight", 1),
       ("waste", "incin", 2)], 27, 40, (.8, .4, 0, .3)),

    I("I06a", "S06", "Laparoscopic, single-use instruments", "Laparoscopisch, disposable instrumentarium",
      "Single-use trocars, clip applier, scissors and graspers.", "Disposable trocars, clipapplicator, schaar en grijpers.", .55,
      [("devices", "plast", 32), ("devices", "device", 6), ("pharma", "pharma", 4), ("gases", "gas", 4),
       ("electricity", "elec", 26), ("heat", "heat", 15), ("services", "hosp", 35), ("services", "food", 5),
       ("transport", "car", 5), ("transport", "freight", 3), ("waste", "incin", 8)], 54, 300, (2.5, 2, 0, .3)),
    I("I06b", "S06", "Laparoscopic, hybrid reusable instruments", "Laparoscopisch, hybride herbruikbaar instrumentarium",
      "Reusable instruments with few single-use parts; steam sterilisation.",
      "Herbruikbaar instrumentarium met enkele disposable onderdelen; stoomsterilisatie.", .40,
      [("devices", "plast", 18), ("devices", "device", 4), ("pharma", "pharma", 4), ("gases", "gas", 4),
       ("electricity", "elec", 29), ("heat", "heat", 15), ("services", "hosp", 38), ("services", "food", 5),
       ("transport", "car", 5), ("transport", "freight", 2), ("waste", "incin", 5)], 54, 420, (1.8, 1.2, 0, .4)),
    I("I06c", "S06", "Robot-assisted", "Robotgeassisteerd",
      "Robot-assisted cholecystectomy with limited-reuse robotic instruments.",
      "Robotgeassisteerde cholecystectomie met beperkt herbruikbare robotinstrumenten.", .05,
      [("devices", "plast", 40), ("devices", "device", 20), ("pharma", "pharma", 5), ("gases", "gas", 5),
       ("electricity", "elec", 38), ("heat", "heat", 17), ("services", "hosp", 40), ("services", "food", 5),
       ("transport", "car", 5), ("transport", "freight", 4), ("waste", "incin", 12)], 54, 450, (3, 3, 0, .3)),

    I("I07a", "S07", "Abdominal", "Abdominaal", "Open abdominal hysterectomy; ~3-day admission.",
      "Open abdominale hysterectomie; opname ca. 3 dagen.", .25,
      [("devices", "plast", 25), ("devices", "device", 5), ("pharma", "pharma", 10), ("gases", "gas", 6),
       ("electricity", "elec", 49), ("heat", "heat", 31), ("services", "hosp", 90), ("services", "food", 15),
       ("transport", "car", 6), ("transport", "freight", 3), ("waste", "incin", 12)], 72, 900, (4, 3, 0, .5), None,
      "Route depends on uterine size, pathology and surgical expertise.",
      "Benadering hangt af van baarmoedergrootte, pathologie en expertise."),
    I("I07b", "S07", "Laparoscopic", "Laparoscopisch", "Total laparoscopic hysterectomy; ~1-day admission.",
      "Totale laparoscopische hysterectomie; opname ca. 1 dag.", .55,
      [("devices", "plast", 40), ("devices", "device", 8), ("pharma", "pharma", 8), ("gases", "gas", 7),
       ("electricity", "elec", 38), ("heat", "heat", 19), ("services", "hosp", 55), ("services", "food", 5),
       ("transport", "car", 6), ("transport", "freight", 3), ("waste", "incin", 12)], 72, 500, (3.5, 3, 0, .4), None,
      "Route depends on uterine size, pathology and surgical expertise.",
      "Benadering hangt af van baarmoedergrootte, pathologie en expertise."),
    I("I07c", "S07", "Vaginal", "Vaginaal", "Vaginal hysterectomy; ~1.5-day admission.", "Vaginale hysterectomie; opname ca. 1,5 dag.", .15,
      [("devices", "plast", 15), ("devices", "device", 4), ("pharma", "pharma", 7), ("gases", "gas", 5),
       ("electricity", "elec", 30), ("heat", "heat", 18), ("services", "hosp", 55), ("services", "food", 8),
       ("transport", "car", 6), ("transport", "freight", 2), ("waste", "incin", 7)], 72, 500, (2, 1.8, 0, .3), None,
      "Route depends on uterine size, pathology and surgical expertise.",
      "Benadering hangt af van baarmoedergrootte, pathologie en expertise."),
    I("I07d", "S07", "Robot-assisted", "Robotgeassisteerd", "Robot-assisted laparoscopic hysterectomy; ~1-day admission.",
      "Robotgeassisteerde laparoscopische hysterectomie; opname ca. 1 dag.", .05,
      [("devices", "plast", 50), ("devices", "device", 25), ("pharma", "pharma", 8), ("gases", "gas", 9),
       ("electricity", "elec", 53), ("heat", "heat", 21), ("services", "hosp", 65), ("services", "food", 5),
       ("transport", "car", 6), ("transport", "freight", 4), ("waste", "incin", 16)], 72, 550, (4, 4, 0, .4), None,
      "Route depends on uterine size, pathology and surgical expertise.",
      "Benadering hangt af van baarmoedergrootte, pathologie en expertise."),

    I("I08a", "S08", "Antidepressant (SSRI)", "Antidepressivum (SSRI)", "Sertraline 50 mg daily with 3 GP visits.",
      "Sertraline 50 mg per dag met 3 huisartsbezoeken.", .50,
      [("pharma", "pharma", 3), ("devices", "plast", .3), ("electricity", "elec", 1), ("heat", "heat", 1.5),
       ("services", "hosp", 6), ("transport", "car", 3.6), ("transport", "freight", .3), ("waste", "incin", .2)],
      24, 0, (.1, 0, .01, .05), (.3, "sertraline")),
    I("I08b", "S08", "Face-to-face CBT", "Face-to-face CGT", "12 sessions of cognitive behavioural therapy in a practice.",
      "12 sessies cognitieve gedragstherapie in een praktijk.", .40,
      [("electricity", "elec", 6), ("heat", "heat", 8), ("services", "hosp", 26), ("transport", "car", 25),
       ("waste", "incin", .5)], 168, 20, (.5, 0, 0, .2)),
    I("I08c", "S08", "Guided internet CBT", "Begeleide online CGT", "8 online modules with 3 video check-ins.",
      "8 online modules met 3 videogesprekken.", .10,
      [("devices", "device", 1.5), ("electricity", "elec", 2.5), ("heat", "heat", 1), ("services", "hosp", 6),
       ("transport", "car", 2), ("waste", "incin", .1)], 14, 2, (.05, 0, 0, .02)),

    I("I09a", "S09", "In-person consultation", "Fysiek consult", "Outpatient clinic visit; patient travels ~25 km return.",
      "Polikliniekbezoek; patiënt reist ca. 25 km heen en terug.", .80,
      [("devices", "plast", .1), ("electricity", "elec", .8), ("heat", "heat", 1.0), ("services", "hosp", 3),
       ("transport", "car", 4), ("waste", "incin", .1)], 25, 5, (.05, 0, 0, .01), None,
      "Remote consultation is suitable when no physical examination is needed.",
      "Consult op afstand is geschikt als geen lichamelijk onderzoek nodig is."),
    I("I09b", "S09", "Video consultation", "Videoconsult", "Video call from the clinician's office.",
      "Videogesprek vanuit de spreekkamer.", .15,
      [("devices", "device", .05), ("electricity", "elec", .15), ("heat", "heat", .4), ("services", "hosp", 1.8)],
      0, 1, (.01, 0, 0, 0)),
    I("I09c", "S09", "Telephone consultation", "Telefonisch consult", "Telephone call from the clinician's office.",
      "Telefoongesprek vanuit de spreekkamer.", .05,
      [("electricity", "elec", .02), ("heat", "heat", .3), ("services", "hosp", 1.5)], 0, 1, (.01, 0, 0, 0)),

    I("I10a", "S10", "25 fractions (conventional)", "25 fracties (conventioneel)", "Daily fractions over 5 weeks.",
      "Dagelijkse fracties gedurende 5 weken.", .05,
      [("devices", "device", 20), ("devices", "plast", 3), ("pharma", "pharma", 2), ("electricity", "elec", 60),
       ("heat", "heat", 25), ("services", "hosp", 50), ("transport", "car", 112), ("waste", "incin", 2)],
      750, 50, (1, .2, 0, .2), None,
      "Hypofractionation is standard for most patients; 25 fractions only for specific indications.",
      "Hypofractionering is standaard voor de meeste patiënten; 25 fracties alleen bij specifieke indicaties."),
    I("I10b", "S10", "15 fractions (moderate hypofractionation)", "15 fracties (matige hypofractionering)",
      "Daily fractions over 3 weeks.", "Dagelijkse fracties gedurende 3 weken.", .75,
      [("devices", "device", 12), ("devices", "plast", 3), ("pharma", "pharma", 1.5), ("electricity", "elec", 41),
       ("heat", "heat", 16), ("services", "hosp", 38), ("transport", "car", 67.5), ("waste", "incin", 1.5)],
      450, 35, (.8, .15, 0, .15)),
    I("I10c", "S10", "5 fractions (ultra-hypofractionation)", "5 fracties (ultra-hypofractionering)",
      "Daily fractions over 1 week.", "Dagelijkse fracties gedurende 1 week.", .20,
      [("devices", "device", 5), ("devices", "plast", 3), ("pharma", "pharma", 1), ("electricity", "elec", 20),
       ("heat", "heat", 7), ("services", "hosp", 25), ("transport", "car", 22.5), ("waste", "incin", 1)],
      150, 20, (.5, .1, 0, .1)),

    I("I11a", "S11", "Vitamin K antagonist + INR monitoring", "Vitamine K-antagonist + INR-controle",
      "Acenocoumarol with ~18 INR checks/year by the thrombosis service (part home visits).",
      "Acenocoumarol met ca. 18 INR-controles/jaar door de trombosedienst (deels thuisbezoek).", .25,
      [("pharma", "pharma", 2), ("devices", "plast", 4), ("electricity", "elec", 3), ("heat", "heat", 3),
       ("services", "hosp", 20), ("transport", "car", 40), ("transport", "freight", 1), ("waste", "incin", 2)],
      250, 10, (1, 1.2, 0, .1), (.05, "acenocoumarol"),
      "A VKA remains indicated for mechanical heart valves and moderate–severe mitral stenosis.",
      "Een VKA blijft geïndiceerd bij mechanische hartkleppen en matig-ernstige mitralisstenose."),
    I("I11b", "S11", "Direct oral anticoagulant (DOAC)", "Direct werkend oraal anticoagulans (DOAC)",
      "Apixaban twice daily with annual check-up and renal function tests.",
      "Apixaban 2× daags met jaarlijkse controle en nierfunctiebepaling.", .75,
      [("pharma", "pharma", 12), ("devices", "plast", 1), ("electricity", "elec", 1), ("heat", "heat", 1),
       ("services", "hosp", 6), ("transport", "car", 3), ("transport", "freight", .5), ("waste", "incin", .5)],
      20, 2, (.3, .1, 0, .1), (.4, "apixaban")),

    I("I12a", "S12", "Conventional inpatient pathway", "Conventioneel klinisch zorgpad",
      "~3-day admission with inpatient physiotherapy.", "Opname ca. 3 dagen met klinische fysiotherapie.", .85,
      [("devices", "device", 45), ("devices", "plast", 30), ("pharma", "pharma", 12), ("gases", "gas", 1),
       ("electricity", "elec", 46), ("heat", "heat", 31), ("services", "hosp", 110), ("services", "food", 15),
       ("transport", "car", 24), ("transport", "freight", 4), ("waste", "incin", 14)], 162, 1500, (5, 4, 0, 1.5)),
    I("I12b", "S12", "Outpatient (same-day) pathway", "Poliklinisch zorgpad (zelfde dag naar huis)",
      "Same-day discharge with extra outpatient physiotherapy visits.",
      "Ontslag op de dag van operatie met extra poliklinische fysiotherapie.", .15,
      [("devices", "device", 45), ("devices", "plast", 28), ("pharma", "pharma", 10), ("gases", "gas", 1),
       ("electricity", "elec", 25), ("heat", "heat", 12), ("services", "hosp", 60), ("services", "food", 2),
       ("transport", "car", 32), ("transport", "freight", 4), ("waste", "incin", 12)], 216, 1100, (4.5, 3.5, 0, 1.4), None,
      "Same-day discharge requires patient selection and support at home.",
      "Ontslag op dezelfde dag vereist patiëntselectie en ondersteuning thuis."),

    I("I13a", "S13", "FIT-based screening", "Screening met FIT",
      "Mailed faecal immunochemical test; colonoscopy only after a positive test (~4.5%).",
      "Ontlastingstest per post; coloscopie alleen na positieve test (ca. 4,5%).", 1.0,
      [("pharma", "pharma", .14), ("devices", "plast", .31), ("devices", "device", .07), ("electricity", "elec", .23),
       ("heat", "heat", .135), ("services", "hosp", .655), ("transport", "car", .18), ("transport", "freight", .15),
       ("waste", "incin", .09)], 1.2, 2.3, (.05, .04, 0, .01)),
    I("I13b", "S13", "Primary colonoscopy", "Primaire coloscopie", "Colonoscopy offered to every participant.",
      "Coloscopie voor iedere deelnemer.", 0.0,
      [("pharma", "pharma", 3), ("devices", "plast", 5), ("devices", "device", 1.5), ("electricity", "elec", 4),
       ("heat", "heat", 3), ("services", "hosp", 9), ("transport", "car", 4), ("transport", "freight", .5),
       ("waste", "incin", 1.5)], 25, 50, (1, .8, 0, .1), None,
      "Primary colonoscopy is not the Dutch programme standard; included as comparator.",
      "Primaire coloscopie is niet de standaard in het Nederlandse programma; opgenomen als vergelijking."),

    I("I14a", "S14", "Ultrasound first (MRI if inconclusive)", "Eerst echografie (MRI bij twijfel)",
      "Ultrasound for all; ~20% need additional MRI.", "Echografie voor iedereen; ca. 20% krijgt aanvullend MRI.", .85,
      [("devices", "device", .55), ("devices", "plast", .15), ("electricity", "elec", 2.55), ("heat", "heat", .3),
       ("services", "hosp", 1.1), ("waste", "incin", .04)], 0, 0, (.05, .02, 0, 0)),
    I("I14b", "S14", "CT with IV contrast", "CT met intraveneus contrast", "Contrast-enhanced CT for all.",
      "CT met contrast voor iedereen.", .05,
      [("pharma", "pharma", 1.2), ("devices", "device", 1.5), ("devices", "plast", .6), ("electricity", "elec", 5),
       ("heat", "heat", .8), ("services", "hosp", 2.5), ("waste", "incin", .2)], 0, 0, (.2, .1, 0, 0), (15, ICM),
      "CT exposes children to ionising radiation (patient dose — not the environmental category).",
      "CT stelt kinderen bloot aan ioniserende straling (patiëntdosis — niet de milieucategorie)."),
    I("I14c", "S14", "MRI for all", "MRI voor iedereen", "Non-contrast MRI for all.", "MRI zonder contrast voor iedereen.", .10,
      [("devices", "device", 2), ("devices", "plast", .5), ("electricity", "elec", 12), ("heat", "heat", 1.5),
       ("services", "hosp", 3), ("waste", "incin", .1)], 0, 0, (.1, .02, 0, 0)),

    I("I15a", "S15", "Single-use (nonwoven)", "Disposable (non-woven)",
      "Polypropylene SMS gowns and drapes, incinerated after use.",
      "Operatiejassen en afdekmateriaal van polypropyleen (SMS), na gebruik verbrand.", .70,
      [("devices", "plast", 1.8), ("transport", "freight", .2), ("services", "hosp", .05), ("waste", "incin", .6)],
      0, 0, (.5, .3, 0, 0)),
    I("I15b", "S15", "Reusable (textile)", "Herbruikbaar (textiel)",
      "Polyester textiles, ~75 uses with industrial laundering and sterilisation.",
      "Polyester textiel, ca. 75 keer gebruikt met industriële was en sterilisatie.", .30,
      [("services", "laundry", .75), ("devices", "plast", .12), ("transport", "freight", .08), ("waste", "incin", .02)],
      0, 10, (.02, 0, 0, .03)),

    I("I16a", "S16", "Nitrous oxide (vented)", "Lachgas (afgevoerd)", "50% N2O/O2 for ~4 h, exhaled gas vented outside.",
      "50% N2O/O2 gedurende ca. 4 uur, uitgeademd gas naar buiten afgevoerd.", .05,
      [("gases", "n2o", 170), ("pharma", "pharma", 3), ("devices", "device", .5), ("devices", "plast", .3),
       ("transport", "freight", 1), ("services", "hosp", 2), ("waste", "incin", .1)], 0, 0, (.05, 0, 0, 0)),
    I("I16b", "S16", "Nitrous oxide + destruction unit", "Lachgas + kraakinstallatie",
      "As above, with catalytic destruction of exhaled N2O (~90%).",
      "Als hierboven, met katalytische afbraak van uitgeademd N2O (ca. 90%).", 0.0,
      [("gases", "n2o", 17), ("pharma", "pharma", 3), ("devices", "device", 3.5), ("devices", "plast", .3),
       ("electricity", "elec", 1), ("transport", "freight", 1), ("services", "hosp", 2), ("waste", "incin", .1)],
      0, 0, (.05, 0, 0, 0), None,
      "Pilot technology; only reported by a Dutch pilot audit (climate, energy and waste).",
      "Pilottechnologie; alleen gerapporteerd door een Nederlandse pilot-audit (klimaat, energie en afval)."),
    I("I16c", "S16", "Epidural analgesia", "Epidurale analgesie", "Epidural with ropivacaine/sufentanil infusion pump.",
      "Epidurale analgesie met ropivacaïne/sufentanil via pomp.", .75,
      [("pharma", "pharma", 1.5), ("devices", "plast", 1.2), ("devices", "device", .3), ("electricity", "elec", .3),
       ("services", "hosp", 3), ("waste", "incin", .4), ("transport", "freight", .2)], 0, 0, (.2, .15, 0, 0),
      (.05, "ropivacaine")),
    I("I16d", "S16", "Remifentanil PCA", "Remifentanil-PCA", "Patient-controlled IV remifentanil with continuous monitoring.",
      "Patiëntgestuurde IV remifentanil met continue bewaking.", .20,
      [("pharma", "pharma", .8), ("devices", "plast", .9), ("devices", "device", .4), ("electricity", "elec", .4),
       ("services", "hosp", 2.5), ("waste", "incin", .3), ("transport", "freight", .2)], 0, 0, (.15, .12, 0, 0)),

    I("I17a", "S17", "CPAP", "CPAP", "CPAP device with heated humidifier, ~7.5 h/night; mask and tubing replaced periodically.",
      "CPAP-apparaat met verwarmde bevochtiger, ca. 7,5 uur/nacht; masker en slang periodiek vervangen.", .80,
      [("electricity", "elec", 50), ("devices", "device", 5), ("devices", "plast", 6), ("transport", "freight", 2),
       ("services", "hosp", 15), ("transport", "car", 7.5), ("waste", "incin", 1)], 50, 110, (1.5, 0, 0, .2)),
    I("I17b", "S17", "Mandibular advancement device", "Mandibulair repositieapparaat (MRA)",
      "Custom-made oral appliance, replaced every ~3 years.", "Op maat gemaakt apparaat, ca. elke 3 jaar vervangen.", .20,
      [("devices", "device", .3), ("devices", "plast", .27), ("services", "hosp", 10), ("transport", "car", 7.5),
       ("waste", "incin", .1), ("transport", "freight", .3)], 50, 1, (.1, 0, 0, 0), None,
      "Mainly suitable for mild to moderate OSA.", "Vooral geschikt bij licht tot matig OSA."),

    I("I18a", "S18", "Reusable duodenoscope", "Herbruikbare duodenoscoop",
      "Reusable scope with high-level disinfection and drying after each use.",
      "Herbruikbare scoop met hoogwaardige desinfectie en droging na elk gebruik.", .98,
      [("devices", "device", .4), ("devices", "plast", .6), ("electricity", "elec", .5), ("pharma", "pharma", .5),
       ("services", "hosp", .2), ("waste", "incin", .2)], 0, 70, (.2, .3, 0, 0)),
    I("I18b", "S18", "Single-use duodenoscope", "Disposable duodenoscoop",
      "Single-use scope, incinerated as specific hospital waste.", "Disposable scoop, verbrand als specifiek ziekenhuisafval.", .02,
      [("devices", "plast", 35), ("devices", "device", 25), ("transport", "freight", 1.5), ("waste", "incin", 6),
       ("services", "hosp", .2)], 0, 0, (0, 4.5, 0, 0)),

    I("I19a", "S19", "Intravenous paracetamol", "Intraveneus paracetamol", "4 × 1 g infusions with giving sets.",
      "4 × 1 g infuus met toedieningssystemen.", .25,
      [("pharma", "pharma", .35), ("devices", "plast", .45), ("transport", "freight", .12), ("services", "hosp", .05),
       ("electricity", "elec", .03), ("waste", "incin", .15)], 0, 0, (.15, .08, 0, 0), (.12, "paracetamol")),
    I("I19b", "S19", "Oral paracetamol", "Oraal paracetamol", "8 × 500 mg tablets.", "8 × 500 mg tabletten.", .75,
      [("pharma", "pharma", .035), ("devices", "plast", .006), ("transport", "freight", .002), ("services", "hosp", .002),
       ("waste", "incin", .002)], 0, 0, (.005, 0, 0, 0), (.12, "paracetamol")),

    I("I20a", "S20", "FOLFOX (infusional 5-FU)", "FOLFOX (infuus 5-FU)",
      "Every 2 weeks: day-unit infusion plus 46-h home pump and disconnection visit.",
      "Elke 2 weken: infuus op de dagbehandeling plus 46-uurs pomp thuis en afkoppelbezoek.", .50,
      [("pharma", "pharma", 24), ("devices", "plast", 12), ("devices", "device", 1), ("electricity", "elec", 9),
       ("heat", "heat", 6), ("services", "hosp", 30), ("transport", "car", 27), ("transport", "freight", 1),
       ("waste", "incin", 5)], 180, 60, (1.5, 1, 2.5, .2), (1.5, "fluorouracil & platinum")),
    I("I20b", "S20", "CAPOX (oral capecitabine)", "CAPOX (orale capecitabine)",
      "Every 3 weeks: oxaliplatin infusion plus 14 days of oral capecitabine at home.",
      "Elke 3 weken: oxaliplatine-infuus plus 14 dagen orale capecitabine thuis.", .50,
      [("pharma", "pharma", 22), ("devices", "plast", 6), ("devices", "device", .5), ("electricity", "elec", 5),
       ("heat", "heat", 3.5), ("services", "hosp", 18), ("transport", "car", 11), ("transport", "freight", .5),
       ("waste", "incin", 3)], 72, 30, (1, .6, 1.0, .1), (3.2, "capecitabine, fluorouracil & platinum")),
]

# ---------------------------------------------------------------------------
# Sources per situation
# ---------------------------------------------------------------------------
# kind: A comparative primary LCA (full), B second study, C review/policy (climate only), D Dutch hospital audit
SRC_SPECS = {
    "S01": [("A", "UK", 2022, "process", "full", "all"), ("B", "US", 2019, "hybrid", "climate_energy", "all"),
            ("C", "INT", 2024, "review", "climate", "all")],
    "S02": [("A", "AU", 2020, "process", "full", "all"), ("B", "UK", 2017, "process", "climate_energy", ["I02a", "I02c"]),
            ("D", "NL", 2024, "audit", "audit", ["I02a"])],
    "S03": [("A", "SE", 2021, "process", "full", ["I03a", "I03c", "I03d"]), ("B", "UK", 2023, "process", "full", ["I03a", "I03b", "I03c"]),
            ("C", "INT", 2025, "policy", "climate", "all")],
    "S04": [("A", "US", 2018, "process", "full", "all"), ("B", "DE", 2023, "process", "full", "all"),
            ("C", "INT", 2022, "review", "climate", ["I04a", "I04b"])],
    "S05": [("A", "UK", 2019, "process", "full", "all"), ("D", "NL", 2025, "audit", "audit", "all")],
    "S06": [("A", "UK", 2022, "process", "full", ["I06a", "I06b", "I06c"]), ("B", "US", 2023, "hybrid", "climate_energy", "all")],
    "S07": [("A", "US", 2016, "process", "full", "all"), ("B", "DE", 2024, "process", "climate_energy", ["I07b", "I07d"])],
    "S08": [("A", "UK", 2021, "hybrid", "full", "all"), ("C", "INT", 2023, "review", "climate", ["I08a", "I08b"])],
    "S09": [("A", "UK", 2021, "process", "full", "all"), ("B", "NL", 2023, "process", "climate_energy", ["I09a", "I09b"])],
    "S10": [("A", "UK", 2023, "process", "full", "all"), ("B", "FR", 2022, "process", "climate_energy", "all")],
    "S11": [("A", "NL", 2024, "hybrid", "full", "all"), ("C", "INT", 2022, "review", "climate", ["I11b"])],
    "S12": [("A", "DK", 2022, "process", "full", "all"), ("B", "US", 2020, "hybrid", "climate", ["I12a"])],
    "S13": [("A", "NL", 2023, "process", "full", "all"), ("B", "UK", 2024, "process", "climate_energy", ["I13b"])],
    "S14": [("A", "AU", 2022, "process", "full", "all"), ("B", "US", 2023, "process", "climate_energy", "all")],
    "S15": [("A", "US", 2020, "process", "full", "all"), ("B", "NL", 2023, "process", "full", "all")],
    "S16": [("A", "UK", 2023, "process", "full", ["I16a", "I16c", "I16d"]), ("D", "NL", 2025, "audit", "audit", ["I16a", "I16b"])],
    "S17": [("A", "AU", 2022, "process", "full", "all"), ("C", "INT", 2024, "review", "climate", ["I17a"])],
    "S18": [("A", "US", 2022, "process", "full", "all"), ("B", "DE", 2024, "process", "climate_energy", "all")],
    "S19": [("A", "UK", 2024, "process", "full", "all"), ("D", "NL", 2025, "audit", "audit", "all")],
    "S20": [("A", "ES", 2023, "process", "full", "all"), ("B", "NL", 2024, "hybrid", "climate_energy", "all")],
}

CALIBRATION = {
    "S01": "Hospital-stay, operating-theatre and ICU magnitudes modelled on published footprints (e.g. MacNeill et al. 2017; McGain et al. 2018).",
    "S02": "Order of magnitude modelled on published UK and Australian dialysis footprints (several tonnes CO2-eq per patient-year).",
    "S03": "Propellant-dominated pMDI vs DPI ratio modelled on published inhaler footprints (e.g. Janson et al. 2020).",
    "S04": "Relative magnitude of volatile anaesthetics vs TIVA modelled on published anaesthetic LCAs (e.g. Sherman et al. 2012).",
    "S05": "Modelled on published cataract footprints from the UK and India (e.g. Morris et al. 2013; Thiel et al. 2017).",
    "S06": "Instrument-related reduction for hybrid instruments modelled on published work (e.g. Rizan & Bhutta 2022).",
    "S07": "Route comparison modelled on published hysterectomy LCA (e.g. Thiel et al. 2015).",
    "S08": "Travel-dominated footprint of therapy sessions; generic assumptions.",
    "S09": "Travel-dominated outpatient footprint modelled on telemedicine reviews (e.g. Purohit et al. 2021).",
    "S10": "Travel- and linac-energy-dominated footprint; generic assumptions.",
    "S11": "Dutch thrombosis-service monitoring pattern; generic assumptions.",
    "S12": "Implant and bed-day magnitudes; generic assumptions.",
    "S13": "Colonoscopy footprint order of magnitude modelled on published endoscopy footprints.",
    "S14": "Per-scan magnitudes modelled on published imaging footprints (e.g. McAlister et al. 2022).",
    "S15": "Reusable vs single-use ratio modelled on published gown LCAs (e.g. Vozzola et al. 2020).",
    "S16": "N2O footprint from direct emissions at GWP100 = 273; generic assumptions.",
    "S17": "CPAP electricity use from device power; generic assumptions.",
    "S18": "Single-use vs reusable duodenoscope ratio modelled on published comparisons (~20–40x).",
    "S19": "IV vs oral ratio from consumables and sterile manufacture; generic assumptions.",
    "S20": "Day-unit, pump and travel magnitudes; generic assumptions.",
}

KIND_PARAMS = {
    # type, reliability, completeness, technological, bias (ln), sigma (ln), reported range sigma (ln)
    "A": ("Primary LCA study", 2, 2, 2, 0.0, 0.08, 0.20),
    "B": ("Primary LCA study", 2, 3, 3, 0.05, 0.15, 0.28),
    "C": ("Review", 3, 3, 3, 0.0, 0.20, 0.40),
    "D": ("Hospital audit", 2, 3, 1, -0.05, 0.08, 0.15),
}
REPORTS = {
    "full": IMPACT_IDS + [i[0] for i in INVENTORY],
    "climate_energy": ["cc", "ruf", "ced_fossil", "ced_nuclear", "ced_renewable"],
    "climate": ["cc"],
    "audit": ["cc", "elec_kwh", "heat_mj", "fuel_mj", "water_withdrawal", "waste_residual", "waste_sza",
              "waste_cyto", "waste_recycled", "travel_km"],
}
REPORTS_LABEL = {
    "full": "All EF categories + inventory", "climate_energy": "Climate change + energy",
    "climate": "Climate change only", "audit": "Climate, energy carriers, water, waste, travel",
}
METHOD_LABEL = {"process": "Process LCA", "hybrid": "Hybrid (process + input-output)", "review": "Review of LCA studies",
                "policy": "Policy document", "audit": "Hospital environmental audit"}


def truth(iv):
    """Dutch-context 'true' values for all indicators of an intervention."""
    vals = {k: 0.0 for k in IMPACT_IDS}
    ced = [0.0, 0.0, 0.0]
    elec_kg = heat_kg = car_kg = freight_kg = 0.0
    stage_kg = {}
    for stage, arch, kg in iv["_stages"]:
        prof, cedp = ARCH[arch]
        for j, k in enumerate(IMPACT_IDS):
            vals[k] += kg * prof[j] * NF[k] / NF["cc"]
        for j in range(3):
            ced[j] += kg * cedp[j]
        if arch in ELEC_ARCH:
            elec_kg += kg
        if arch == "heat":
            heat_kg += kg
        if arch == "car":
            car_kg += kg
        if arch == "freight":
            freight_kg += kg
        stage_kg[stage] = stage_kg.get(stage, 0) + kg
    if iv["_api"]:
        g, name = iv["_api"]
        vals["etf"] += g * API_CF[name]
    inv = {
        "ced_fossil": ced[0], "ced_nuclear": ced[1], "ced_renewable": ced[2],
        "elec_kwh": elec_kg / NL_GRID, "heat_mj": heat_kg * 15.4, "fuel_mj": car_kg * 13.5 + freight_kg * 14,
        "water_withdrawal": iv["_water"] / 1000.0,
        "waste_residual": iv["_waste"][0], "waste_sza": iv["_waste"][1], "waste_cyto": iv["_waste"][2],
        "waste_recycled": iv["_waste"][3], "travel_km": iv["_travel"],
        "api_water": iv["_api"][0] if iv["_api"] else 0.0,
    }
    vals.update(inv)
    return vals, stage_kg, elec_kg


def sig(x, n=3):
    if x == 0 or not math.isfinite(x):
        return 0.0
    return float(f"{x:.{n}g}")


def build():
    situations = [dict(s) for s in SITUATIONS]
    interventions = []
    for iv in INTERVENTIONS:
        interventions.append({k: v for k, v in iv.items() if not k.startswith("_")})
    by_sit = {}
    for iv in INTERVENTIONS:
        by_sit.setdefault(iv["situation_id"], []).append(iv)

    sources, data, contribs = [], [], []
    for sid, specs in SRC_SPECS.items():
        sit = next(s for s in SITUATIONS if s["situation_id"] == sid)
        for kind, country, year, method, reports, covers in specs:
            src_id = f"SYN-{sid}-{kind}"
            stype, rel, comp, tech, bias, sigma, rep_sigma = KIND_PARAMS[kind]
            if method == "policy":
                stype = "Policy document"
            if method == "hybrid":
                rel = max(rel, 3)
            ivs = by_sit[sid] if covers == "all" else [i for i in by_sit[sid] if i["intervention_id"] in covers]
            alt_names = " vs ".join(i["name_en"] for i in ivs)
            where = GRID[country][0] if country in GRID else "international"
            sources.append(dict(
                source_id=src_id,
                title=f"SYNTHETIC — {METHOD_LABEL[method]}: {alt_names} ({where}, {year})",
                source_type=stype, method=METHOD_LABEL[method], country=country, year=year,
                reports=REPORTS_LABEL[reports], reliability=rel, completeness=comp,
                temporal=temporal_score(year), geographical=geo_score(country), technological=tech,
                synthetic="yes", calibration_note=CALIBRATION[sid] + " Synthetic values, not real study results.",
                url=""))
            study_factor = math.exp(RNG.normal(bias, sigma))
            grid_c = GRID[country][2] if country in GRID else None
            for iv in ivs:
                vals, stage_kg, elec_kg = truth(iv)
                alt_factor = study_factor * math.exp(RNG.normal(0, 0.04))
                cc_nonelec = vals["cc"] - elec_kg
                cc_country = cc_nonelec + elec_kg * (grid_c / NL_GRID if grid_c else 1.0)
                e_share = (elec_kg * (grid_c / NL_GRID if grid_c else 1.0)) / cc_country if cc_country > 0 else 0
                for ind in REPORTS[reports]:
                    base = cc_country if ind == "cc" else vals[ind]
                    if base == 0:
                        if ind.startswith("waste") or ind in ("travel_km", "api_water", "water_withdrawal"):
                            data.append(dict(intervention_id=iv["intervention_id"], source_id=src_id, indicator_id=ind,
                                             value=0.0, low=0.0, high=0.0, electricity_share=None, note=""))
                        continue
                    noise = 1.0 if ind in ("travel_km",) else math.exp(RNG.normal(0, 0.06 if kind in "AD" else 0.12))
                    v = base * alt_factor * noise
                    rs = rep_sigma * math.exp(RNG.normal(0, 0.15))
                    low, high = v * math.exp(-1.645 * rs), v * math.exp(1.645 * rs)
                    es = None
                    if ind == "cc" and kind in ("A", "D") or (ind == "cc" and kind == "B" and method == "process"):
                        es = round(e_share, 3)
                    data.append(dict(intervention_id=iv["intervention_id"], source_id=src_id, indicator_id=ind,
                                     value=sig(v), low=sig(low), high=sig(high), electricity_share=es,
                                     note="" if es is not None or ind != "cc" else "Electricity share not reported; cannot harmonise"))
                if kind in ("A", "D"):
                    tot = sum(stage_kg.values()) - elec_kg + elec_kg * (grid_c / NL_GRID if grid_c else 1.0)
                    for st, kg in stage_kg.items():
                        kgc = kg * (grid_c / NL_GRID) if st == "electricity" and grid_c else kg
                        contribs.append(dict(intervention_id=iv["intervention_id"], source_id=src_id, stage_id=st,
                                             share=round(kgc / tot, 4)))

    indicators = []
    for iid, theme, en, nl, unit, nf, w in IMPACTS:
        indicators.append(dict(indicator_id=iid, kind="impact", theme_id=theme, group="", name_en=en, name_nl=nl,
                               unit=unit, nf=nf, subweight=w, hazard_factor=None,
                               description_en=f"EF impact category. Normalisation factor: global per person per year (EF 3.0).",
                               description_nl=f"EF-impactcategorie. Normalisatiefactor: mondiaal per persoon per jaar (EF 3.0)."))
    indicators.append(dict(indicator_id="waste_hw", kind="impact", theme_id="waste", group="", name_en="Waste (hazard-weighted)",
                           name_nl="Afval (gevarengewogen)", unit="kg-eq", nf=510, subweight=1, hazard_factor=None,
                           description_en="Derived by the tool: sum of waste streams × hazard factor. Normalised by EU municipal waste per person (~510 kg/yr, Eurostat). Prototype assumption.",
                           description_nl="Berekend door de tool: som van afvalstromen × gevarenfactor. Genormaliseerd op Europees huishoudelijk afval per persoon (~510 kg/jaar, Eurostat). Prototype-aanname."))
    for iid, group, en, nl, unit, hf in INVENTORY:
        indicators.append(dict(indicator_id=iid, kind="inventory", theme_id="", group=group, name_en=en, name_nl=nl,
                               unit=unit, nf=None, subweight=None, hazard_factor=hf, description_en="", description_nl=""))

    themes = [dict(theme_id=t[0], name_en=t[1], name_nl=t[2], description_en=t[3], description_nl=t[4], order=n + 1)
              for n, t in enumerate(THEMES)]
    stages = [dict(stage_id=s[0], name_en=s[1], name_nl=s[2], order=n + 1) for n, s in enumerate(STAGES)]

    theme_order = [t[0] for t in THEMES]
    panels = {
        "zin": ("ZIN advisors (synthetic panel)", "ZIN-adviseurs (synthetisch panel)", "Policy (macro)", "Beleid (macro)", 9,
                [26, 8, 9, 6, 10, 3, 3, 4, 6, 12, 5, 8]),
        "insurers": ("Health insurers (synthetic panel)", "Zorgverzekeraars (synthetisch panel)", "Purchasing (meso)", "Inkoop (meso)", 8,
                     [30, 10, 7, 5, 10, 4, 3, 3, 5, 10, 5, 8]),
        "hospitals": ("Hospitals & procurement (synthetic panel)", "Ziekenhuizen & inkoop (synthetisch panel)", "Purchasing (meso)", "Inkoop (meso)", 14,
                      [25, 12, 8, 4, 8, 3, 2, 3, 4, 10, 6, 15]),
        "clinicians": ("Clinicians & guideline developers (synthetic panel)", "Clinici & richtlijnontwikkelaars (synthetisch panel)", "Clinical (micro)", "Klinisch (micro)", 16,
                       [28, 7, 7, 4, 11, 4, 2, 3, 5, 13, 4, 12]),
        "patients": ("Patients & public (synthetic panel)", "Patiënten & publiek (synthetisch panel)", "Clinical (micro)", "Klinisch (micro)", 11,
                     [24, 7, 10, 6, 10, 3, 2, 3, 4, 13, 4, 14]),
    }
    profiles = []
    sds = {}
    for pid, (en, nl, gen, gnl, n, means) in panels.items():
        sd = [round(0.22 * m + 1.2 + RNG.uniform(-.4, .4), 1) for m in means]
        sds[pid] = sd
        for t, m, s in zip(theme_order, means, sd):
            profiles.append(dict(profile_id=pid, name_en=en, name_nl=nl, group_en=gen, group_nl=gnl, panel_size=n,
                                 theme_id=t, weight_mean=m, weight_sd=s, synthetic="yes"))
    total_n = sum(p[4] for p in panels.values())
    comb_means = [sum(p[4] * p[5][j] for p in panels.values()) / total_n for j in range(12)]
    comb_sd = []
    for j in range(12):
        within = sum(p[4] * (sds[k][j] ** 2) for k, p in panels.items()) / total_n
        between = sum(p[4] * (p[5][j] - comb_means[j]) ** 2 for p in panels.values()) / total_n
        comb_sd.append(round(math.sqrt(within + between), 1))
    comb = [dict(profile_id="combined", name_en="Combined stakeholder panel (synthetic)",
                 name_nl="Gecombineerd stakeholderpanel (synthetisch)", group_en="All levels", group_nl="Alle niveaus",
                 panel_size=total_n, theme_id=t, weight_mean=round(m, 2), weight_sd=s, synthetic="yes")
            for t, m, s in zip(theme_order, comb_means, comb_sd)]
    ef = [21.06, 8.32, 8.51, 7.94, 13.74, 6.31, 5.01, 6.20, 9.47, 5.89, 7.55, 0]
    ref = [dict(profile_id="ef", name_en="EF 3.1 reference weights (no waste)", name_nl="EF 3.1-referentiegewichten (zonder afval)",
                group_en="Reference", group_nl="Referentie", panel_size=0, theme_id=t, weight_mean=m, weight_sd=0, synthetic="no")
           for t, m in zip(theme_order, ef)]
    eq = [dict(profile_id="equal", name_en="Equal weights", name_nl="Gelijke gewichten", group_en="Reference",
               group_nl="Referentie", panel_size=0, theme_id=t, weight_mean=round(100 / 12, 3), weight_sd=0, synthetic="no")
          for t in theme_order]
    profiles = comb + profiles + ref + eq

    grid = [dict(country=c, name_en=v[0], name_nl=v[1], kg_co2e_per_kwh=v[2],
                 note="Illustrative life-cycle factor; replace with current values (e.g. CO2emissiefactoren.nl for NL)")
            for c, v in GRID.items()]

    settings = [
        dict(key="dataset_label", value="SYNTHETIC DEMO DATA — not for real decisions", note="Shown in the app header"),
        dict(key="synthetic", value="yes", note="yes/no"),
        dict(key="base_country", value="NL", note="Country to which electricity is harmonised"),
        dict(key="reference_year", value=REF_YEAR, note="Used for the temporal pedigree score"),
        dict(key="default_profile", value="combined", note="Weight profile selected by default"),
        dict(key="default_sigma", value=0.35, note="Log-SD used when a data row has no low/high range"),
        dict(key="car_kg_co2e_per_km", value=0.17, note="Average passenger car, used for the km-by-car equivalence"),
        dict(key="mc_iterations", value=2000, note="Monte Carlo iterations"),
        dict(key="seed", value=2026, note="Random seed for reproducible results"),
        dict(key="generated", value=date.today().isoformat(), note="Date this dataset was generated"),
    ]

    return dict(situations=situations, interventions=interventions, sources=sources, data=data,
                contributions=contribs, indicators=indicators, themes=themes, stages=stages,
                weightProfiles=profiles, gridFactors=grid, settings=settings)


SHEET_ORDER = [
    ("Situations", "situations"), ("Interventions", "interventions"), ("Sources", "sources"), ("Data", "data"),
    ("Contributions", "contributions"), ("Indicators", "indicators"), ("Themes", "themes"), ("Stages", "stages"),
    ("WeightProfiles", "weightProfiles"), ("GridFactors", "gridFactors"), ("Settings", "settings"),
]

README_ROWS = [
    "MECH-I environmental decision tool — data workbook",
    "",
    "THIS FILE CONTAINS SYNTHETIC DEMO DATA. Values are calibrated to published magnitudes but are NOT real study results.",
    "",
    "How to maintain the data (no coding needed):",
    "1. Situations — one row per clinical decision situation, with the functional unit and annual Dutch volume.",
    "2. Interventions — one row per alternative; nl_current_share is the current share of Dutch practice (0–1).",
    "3. Sources — one row per extracted publication. Pedigree scores 1 (best) to 5 (worst) for reliability, completeness,",
    "   temporal, geographical and technological correlation (Weidema pedigree matrix).",
    "4. Data — one row per intervention × source × indicator: central value, low and high (reported range or 90% interval).",
    "   For climate change (cc), fill electricity_share = share of on-site electricity in the reported footprint,",
    "   so the tool can harmonise to the Dutch grid. Leave empty if unknown.",
    "5. Contributions — optional: share of climate change per life-cycle stage (from the study's contribution analysis).",
    "6. Indicators, Themes, Stages — the impact categories and how they group into weighting themes. Change with care.",
    "7. WeightProfiles — stakeholder weights per theme (mean and SD in %), e.g. from a Delphi panel.",
    "8. GridFactors — life-cycle kg CO2-eq per kWh per country; used for harmonisation.",
    "9. Settings — general parameters.",
    "",
    "Load the file in the app via 'Load data'. It is read in your browser and is not uploaded anywhere.",
    "Do not commit files with real (licensed) data to a public repository.",
]


def write_xlsx(ds, path):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "README"
    for r in README_ROWS:
        ws.append([r])
    ws["A1"].font = Font(bold=True, size=14)
    ws["A3"].font = Font(bold=True, color="B42318")
    ws.column_dimensions["A"].width = 120
    head_fill = PatternFill("solid", fgColor="1F3A4D")
    for sheet, key in SHEET_ORDER:
        rows = ds[key]
        cols = list(rows[0].keys())
        w = wb.create_sheet(sheet)
        w.append(cols)
        for c in w[1]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = head_fill
            c.alignment = Alignment(vertical="center")
        for row in rows:
            w.append([row.get(c) for c in cols])
        w.freeze_panes = "A2"
        for j, c in enumerate(cols, 1):
            longest = max([len(str(c))] + [len(str(r.get(c) or "")) for r in rows[:200]])
            w.column_dimensions[get_column_letter(j)].width = min(max(10, longest + 2), 60)
    wb.save(path)


if __name__ == "__main__":
    ds = build()
    ds["meta"] = {"name": "MECH-I synthetic demo dataset", "synthetic": True, "generated": date.today().isoformat(),
                  "generator": "tools/generate_synthetic.py"}
    out_json = os.path.join(ROOT, "src", "data", "synthetic.json")
    os.makedirs(os.path.dirname(out_json), exist_ok=True)
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(ds, f, ensure_ascii=False, separators=(",", ":"))
    out_xlsx = os.path.join(ROOT, "data", "MECH-I_data_template_SYNTHETIC.xlsx")
    os.makedirs(os.path.dirname(out_xlsx), exist_ok=True)
    write_xlsx(ds, out_xlsx)
    print(f"{len(ds['situations'])} situations, {len(ds['interventions'])} interventions, {len(ds['sources'])} sources, "
          f"{len(ds['data'])} data rows, {len(ds['contributions'])} contribution rows")
    print("wrote", out_json, "and", out_xlsx)
