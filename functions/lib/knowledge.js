// v35: real, sourced-from-NLM bulk vocabulary (8,500 entries pulled from the
// official MeSH thesaurus, filtered for quality — see meshBulk.js's own
// header for exactly how) that supplements the hand-curated table below.
// Imported here rather than inlined so the ~8,500-line generated file stays
// visually separate from the ~600 entries a human actually wrote and
// reasoned about one at a time.
import { MESH_BULK } from "./meshBulk.js";

// Cerebrum domain-knowledge module.
//
// search.js is the ORCHESTRATION layer — it decides what to fetch, when to
// fall back, how to merge and rank. This file is the KNOWLEDGE layer it
// consults while doing that: controlled vocabulary, source-quality signals,
// evidence-hierarchy classification, and entity recognition that would
// otherwise have to live inside an LLM call (slow, rate-limited, and not
// guaranteed to run on every request).
//
// Nothing in here talks to the network. Every export is a plain data
// structure or a pure function over strings already in hand. That's
// deliberate: this module has to be usable even when every LLM call in
// search.js has failed or been skipped for latency, so none of it can
// depend on one succeeding.
//
// Six systems, each with its own section below:
//   1. MESH_EXPANSIONS   — controlled-vocabulary query expansion
//   2. STUDY_TYPE        — evidence-hierarchy classification from text
//   3. JOURNAL_TIERS      — source-quality signal for ranking
//   4. PREDATORY_SIGNALS — soft penalty for known low-integrity venues
//   5. ENTITIES           — deterministic drug / pathway / gene recognition
//   6. RESEARCH_INTENT    — per-question-type search & ranking strategy

// ════════════════════════════════════════════════════════════════════════
// 1. MESH-STYLE QUERY EXPANSION
//
// PubMed/MEDLINE indexes papers under MeSH (Medical Subject Headings) —
// a controlled vocabulary that is NOT how people ask questions. A user who
// types "heart attack" is asking about papers indexed as "myocardial
// infarction". A user who types "sugar disease" means "diabetes mellitus".
// SYNONYMS in search.js already handles a few hundred acronyms and organism
// common names; this table is the disease/mechanism/method vocabulary layer
// that sits alongside it — the terms clinicians and MEDLINE indexers use
// that a plain-language question will otherwise never surface.
//
// Format: casual/plain term -> array of controlled-vocabulary synonyms to
// OR into the search. Keys are lowercase; multi-word keys are matched as
// substrings against the cleaned query in expandViaMesh() below.
// ════════════════════════════════════════════════════════════════════════

export const MESH_EXPANSIONS = {
  // ---- Cardiovascular ----
  "heart attack": ["myocardial infarction", "acute coronary syndrome", "STEMI", "NSTEMI"],
  "heart failure": ["cardiac insufficiency", "congestive heart failure", "left ventricular dysfunction"],
  "high blood pressure": ["hypertension", "elevated blood pressure"],
  "low blood pressure": ["hypotension"],
  "stroke": ["cerebrovascular accident", "cerebral infarction", "ischemic stroke", "CVA"],
  "mini stroke": ["transient ischemic attack", "TIA"],
  "clogged arteries": ["atherosclerosis", "arterial plaque", "coronary artery disease"],
  "irregular heartbeat": ["arrhythmia", "cardiac dysrhythmia"],
  "afib": ["atrial fibrillation"],
  "heart murmur": ["cardiac murmur", "valvular abnormality"],
  "blood clot": ["thrombosis", "thromboembolism"],
  "leg clot": ["deep vein thrombosis", "DVT"],
  "lung clot": ["pulmonary embolism", "PE"],
  "hardening of the arteries": ["arteriosclerosis", "atherosclerosis"],
  "high cholesterol": ["hypercholesterolemia", "dyslipidemia", "hyperlipidemia"],
  "enlarged heart": ["cardiomegaly", "cardiac hypertrophy"],

  // ---- Endocrine / Metabolic ----
  "sugar disease": ["diabetes mellitus", "type 2 diabetes", "hyperglycemia"],
  "diabetes": ["diabetes mellitus", "hyperglycemia", "insulin resistance"],
  "low blood sugar": ["hypoglycemia"],
  "thyroid problems": ["thyroid dysfunction", "hypothyroidism", "hyperthyroidism"],
  "underactive thyroid": ["hypothyroidism"],
  "overactive thyroid": ["hyperthyroidism", "Graves disease"],
  "weight gain hormone": ["leptin resistance", "insulin resistance"],
  "metabolic syndrome": ["insulin resistance syndrome", "syndrome X"],
  "adrenal fatigue": ["adrenal insufficiency", "hypocortisolism"],
  "growth hormone deficiency": ["somatotropin deficiency", "GH deficiency"],
  "osteoporosis": ["bone mineral density loss", "osteopenia"],
  "gout": ["hyperuricemia", "monosodium urate crystal arthropathy"],

  // ---- Oncology ----
  "cancer": ["neoplasm", "malignancy", "carcinoma", "tumor"],
  "breast cancer": ["mammary carcinoma", "breast neoplasm"],
  "lung cancer": ["pulmonary carcinoma", "bronchogenic carcinoma", "NSCLC", "SCLC"],
  "skin cancer": ["cutaneous neoplasm", "melanoma", "basal cell carcinoma", "squamous cell carcinoma"],
  "blood cancer": ["leukemia", "hematologic malignancy"],
  "lymph node cancer": ["lymphoma"],
  "bone marrow cancer": ["multiple myeloma"],
  "tumor spread": ["metastasis", "metastatic disease"],
  "chemo": ["chemotherapy", "cytotoxic therapy"],
  "cancer causing": ["carcinogenic", "oncogenic", "tumorigenic"],
  "cancer suppressing": ["tumor suppressor", "antineoplastic"],
  "remission": ["complete response", "disease-free survival"],

  // ---- Neurology / Psychiatry ----
  "alzheimer's": ["Alzheimer disease", "dementia", "neurodegeneration"],
  "memory loss": ["amnesia", "cognitive decline", "memory impairment"],
  "parkinson's": ["Parkinson disease", "parkinsonism"],
  "seizure": ["epilepsy", "convulsion", "epileptic seizure"],
  "nerve damage": ["neuropathy", "peripheral neuropathy"],
  "brain fog": ["cognitive impairment", "mental fatigue"],
  "depression": ["major depressive disorder", "MDD", "depressive disorder"],
  "anxiety": ["anxiety disorder", "generalized anxiety disorder", "GAD"],
  "bipolar": ["bipolar disorder", "manic depression"],
  "schizophrenia": ["psychotic disorder", "schizophrenia spectrum disorder"],
  "adhd": ["attention deficit hyperactivity disorder", "attention-deficit disorder"],
  "autism": ["autism spectrum disorder", "ASD", "pervasive developmental disorder"],
  "ptsd": ["post-traumatic stress disorder", "posttraumatic stress"],
  "ocd": ["obsessive-compulsive disorder"],
  "migraine": ["migraine headache", "vascular headache"],
  "chronic pain": ["chronic pain syndrome", "persistent pain"],
  "multiple sclerosis": ["MS", "demyelinating disease"],
  "als": ["amyotrophic lateral sclerosis", "Lou Gehrig disease", "motor neuron disease"],
  "brain injury": ["traumatic brain injury", "TBI"],
  "concussion": ["mild traumatic brain injury", "mTBI"],
  "sleep disorder": ["insomnia", "sleep-wake disorder"],
  "sleep apnea": ["obstructive sleep apnea", "OSA", "sleep-disordered breathing"],

  // ---- Infectious disease / Microbiology ----
  "bacterial infection": ["bacterial disease", "bacteremia", "sepsis"],
  "viral infection": ["viral disease", "viremia"],
  "flu": ["influenza"],
  "common cold": ["upper respiratory infection", "rhinovirus infection"],
  "food poisoning": ["foodborne illness", "gastroenteritis"],
  "std": ["sexually transmitted infection", "STI", "sexually transmitted disease"],
  "yeast infection": ["candidiasis", "candida infection"],
  "staph infection": ["staphylococcal infection", "Staphylococcus aureus infection"],
  "mrsa": ["methicillin-resistant Staphylococcus aureus"],
  "antibiotic resistance": ["antimicrobial resistance", "AMR", "drug resistance"],
  "superbug": ["multidrug-resistant organism", "MDRO"],
  "gut bacteria": ["gut microbiota", "gut microbiome", "intestinal flora"],
  "good bacteria": ["probiotic bacteria", "commensal microbiota"],
  "immunity": ["immune response", "immunocompetence"],
  "autoimmune": ["autoimmune disease", "autoimmunity"],
  "vaccine": ["vaccination", "immunization"],
  "long covid": ["post-acute sequelae of COVID-19", "PASC", "post-COVID condition"],

  // ---- Respiratory ----
  "asthma": ["reactive airway disease", "bronchial asthma"],
  "copd": ["chronic obstructive pulmonary disease", "emphysema", "chronic bronchitis"],
  "pneumonia": ["lung infection", "pulmonary infection"],
  "shortness of breath": ["dyspnea"],

  // ---- Gastrointestinal ----
  "acid reflux": ["gastroesophageal reflux disease", "GERD"],
  "stomach ulcer": ["peptic ulcer disease", "gastric ulcer"],
  "ibs": ["irritable bowel syndrome"],
  "ibd": ["inflammatory bowel disease", "Crohn disease", "ulcerative colitis"],
  "liver disease": ["hepatic disease", "hepatopathy"],
  "fatty liver": ["hepatic steatosis", "nonalcoholic fatty liver disease", "NAFLD"],
  "cirrhosis": ["hepatic cirrhosis", "liver fibrosis"],
  "gallstones": ["cholelithiasis"],
  "leaky gut": ["intestinal permeability", "gut barrier dysfunction"],

  // ---- Renal / Urologic ----
  "kidney disease": ["renal disease", "nephropathy", "chronic kidney disease", "CKD"],
  "kidney stones": ["nephrolithiasis", "urolithiasis"],
  "kidney failure": ["renal failure", "end-stage renal disease", "ESRD"],
  "uti": ["urinary tract infection"],
  "enlarged prostate": ["benign prostatic hyperplasia", "BPH"],

  // ---- Musculoskeletal ----
  "arthritis": ["joint inflammation", "osteoarthritis", "rheumatoid arthritis"],
  "joint pain": ["arthralgia"],
  "muscle wasting": ["sarcopenia", "muscle atrophy"],
  "herniated disc": ["disc herniation", "intervertebral disc displacement"],
  "back pain": ["lumbago", "low back pain"],
  "fibromyalgia": ["fibromyalgia syndrome", "chronic widespread pain"],

  // ---- Reproductive / OB-GYN ----
  "infertility": ["subfertility", "impaired fecundity"],
  "pcos": ["polycystic ovary syndrome"],
  "endometriosis": ["endometrial tissue growth"],
  "menopause": ["climacteric", "menopausal transition"],
  "erectile dysfunction": ["impotence", "ED"],
  "miscarriage": ["spontaneous abortion", "pregnancy loss"],
  "preeclampsia": ["pregnancy-induced hypertension", "gestational hypertension"],

  // ---- Hematology ----
  "anemia": ["low hemoglobin", "iron deficiency anemia"],
  "sickle cell": ["sickle cell disease", "sickle cell anemia"],
  "hemophilia": ["bleeding disorder", "coagulation factor deficiency"],
  "blood clotting disorder": ["coagulopathy", "thrombophilia"],

  // ---- Dermatology ----
  "eczema": ["atopic dermatitis"],
  "psoriasis": ["psoriatic skin disease"],
  "acne": ["acne vulgaris"],
  "hives": ["urticaria"],
  "hair loss": ["alopecia", "androgenetic alopecia"],

  // ---- Immunology / Allergy ----
  "allergies": ["allergic reaction", "hypersensitivity"],
  "food allergy": ["food hypersensitivity", "IgE-mediated food allergy"],
  "inflammation": ["inflammatory response", "inflammatory process"],
  "cytokine storm": ["hypercytokinemia", "cytokine release syndrome"],

  // ---- Nutrition / Lifestyle ----
  "obesity": ["adiposity", "excess body weight"],
  "malnutrition": ["nutritional deficiency", "undernutrition"],
  "vitamin d deficiency": ["hypovitaminosis D"],
  "intermittent fasting": ["time-restricted eating", "caloric restriction"],
  "gut health": ["gut microbiome composition", "intestinal health"],

  // ---- Genetics / Molecular biology ----
  "gene editing": ["genome editing", "CRISPR-Cas9", "targeted mutagenesis"],
  "genetic mutation": ["genomic variant", "DNA mutation", "sequence variant"],
  "inherited disease": ["hereditary disease", "genetic disorder"],
  "gene expression": ["transcriptional activity", "mRNA expression"],
  "epigenetics": ["epigenetic modification", "DNA methylation", "histone modification"],
  "stem cells": ["pluripotent stem cells", "stem cell therapy"],
  "gene therapy": ["genetic therapy", "viral vector therapy"],
  "protein folding": ["protein conformation", "protein structure"],
  "junk dna": ["noncoding DNA", "non-coding RNA"],
  "mitochondria": ["mitochondrial function", "oxidative phosphorylation"],

  // ---- Environmental / Public health / Toxicology ----
  "air pollution": ["particulate matter exposure", "PM2.5", "ambient air pollution"],
  "microplastics": ["microplastic pollution", "plastic particulate contamination"],
  "endocrine disruptor": ["endocrine-disrupting chemical", "EDC"],
  "heavy metal poisoning": ["heavy metal toxicity", "lead poisoning", "mercury poisoning"],
  "pesticide exposure": ["agrochemical exposure", "pesticide toxicity"],
  "climate change": ["global warming", "anthropogenic climate change"],
  "ocean acidification": ["marine pH decline", "carbonate chemistry shift"],

  // ---- Agriculture / Entomology / Ecology (Cerebrum sees a lot of these) ----
  "pollinator decline": ["pollinator loss", "bee population decline", "colony collapse disorder"],
  "insect decline": ["insect biomass decline", "entomofauna decline"],
  "crop pest": ["agricultural pest", "phytophagous insect"],
  "invasive species": ["non-native species", "introduced species"],
  "biodiversity loss": ["species extinction", "biodiversity decline"],
  "soil health": ["soil microbiome", "soil quality", "edaphic factors"],
  "pesticide resistance": ["insecticide resistance", "acaricide resistance"],
  "beneficial insects": ["biological control agents", "natural enemies"],
  "insect farming": ["insect mass rearing", "entomoculture"],
  "black soldier fly": ["Hermetia illucens", "BSFL", "black soldier fly larvae"],
  "mealworm": ["Tenebrio molitor", "yellow mealworm"],
  "fruit fly": ["Drosophila melanogaster"],

  // ---- Lab methods / techniques (helps match methods-heavy papers) ----
  "dna sequencing": ["next-generation sequencing", "NGS", "whole-genome sequencing"],
  "pcr test": ["polymerase chain reaction", "PCR amplification"],
  "gene sequencing": ["nucleotide sequencing", "genomic sequencing"],
  "protein analysis": ["mass spectrometry", "proteomic analysis"],
  "cell imaging": ["fluorescence microscopy", "confocal microscopy"],
  "16s sequencing": ["16S rRNA gene sequencing", "amplicon sequencing"],
  "single cell sequencing": ["single-cell RNA sequencing", "scRNA-seq"],
  "crispr": ["CRISPR-Cas9", "genome editing", "gene knockout"],
  "western blot": ["protein immunoblotting"],
  "elisa test": ["enzyme-linked immunosorbent assay"],

  // ---- Pain / addiction / substance use ----
  "chronic fatigue": ["myalgic encephalomyelitis", "chronic fatigue syndrome", "ME/CFS"],
  "opioid addiction": ["opioid use disorder", "opioid dependence"],
  "alcohol addiction": ["alcohol use disorder", "alcohol dependence"],
  "withdrawal symptoms": ["withdrawal syndrome", "discontinuation syndrome"],
  "nicotine addiction": ["tobacco use disorder", "nicotine dependence"],
  "overdose": ["drug toxicity", "acute poisoning"],
  "tolerance to drugs": ["drug tolerance", "pharmacological tolerance"],

  // ---- Pediatrics / developmental ----
  "developmental delay": ["developmental disability", "neurodevelopmental disorder"],
  "premature birth": ["preterm birth", "prematurity"],
  "low birth weight": ["intrauterine growth restriction", "small for gestational age"],
  "sudden infant death": ["sudden infant death syndrome", "SIDS"],
  "childhood obesity": ["pediatric obesity"],
  "growth stunting": ["stunted growth", "failure to thrive"],

  // ---- Geriatrics / aging ----
  "aging": ["senescence", "biological aging"],
  "frailty in elderly": ["frailty syndrome", "geriatric frailty"],
  "falls in elderly": ["fall risk", "geriatric falls"],
  "cognitive decline with age": ["age-related cognitive decline", "mild cognitive impairment"],
  "muscle loss with age": ["sarcopenia"],
  "cellular aging": ["cellular senescence", "telomere shortening"],

  // ---- Exercise / sports medicine ----
  "muscle soreness": ["delayed onset muscle soreness", "DOMS"],
  "sports injury": ["athletic injury", "sports-related trauma"],
  "concussion in sports": ["sports-related concussion", "mild traumatic brain injury"],
  "exercise performance": ["athletic performance", "exercise capacity"],
  "overtraining": ["overtraining syndrome"],
  "vo2 max": ["maximal oxygen uptake", "aerobic capacity"],

  // ---- Additional environmental / entomology / ecology (site's demonstrated
  //      focus area — worth extra depth beyond the core batch above) ----
  "honeybee decline": ["Apis mellifera decline", "managed pollinator loss"],
  "neonicotinoid": ["neonicotinoid pesticide", "imidacloprid", "neonicotinoid insecticide"],
  "monarch butterfly decline": ["Danaus plexippus decline", "monarch population decline"],
  "coral bleaching": ["coral reef bleaching", "zooxanthellae expulsion"],
  "ocean warming": ["sea surface temperature rise", "marine heatwave"],
  "wildfire smoke": ["biomass burning emissions", "wildfire particulate exposure"],
  "deforestation": ["forest loss", "land use change"],
  "permafrost thaw": ["permafrost degradation", "permafrost carbon release"],
  "antibiotic use in livestock": ["agricultural antimicrobial use", "livestock antibiotic use"],
  "insect protein": ["edible insects", "entomophagy", "insect-based feed"],
  "vertical farming": ["controlled environment agriculture", "indoor agriculture"],
  "gene drive": ["synthetic gene drive", "CRISPR gene drive"],
  "biological pest control": ["biocontrol", "natural enemy release"],
  "symbiotic bacteria": ["bacterial symbiont", "endosymbiont"],
  "horizontal gene transfer": ["lateral gene transfer", "HGT"],
  "quorum sensing": ["bacterial cell-cell signaling", "autoinducer signaling"],
  "biofilm": ["biofilm formation", "microbial biofilm"],

  // ---- v34 expansion: additional cardiology / vascular ----
  "chest pain": ["angina pectoris", "angina"],
  "silent heart attack": ["silent myocardial infarction", "unrecognized myocardial infarction"],
  "heart valve disease": ["valvular heart disease", "valvulopathy"],
  "leaky heart valve": ["valvular regurgitation", "mitral regurgitation"],
  "narrowed heart valve": ["valvular stenosis", "aortic stenosis"],
  "aneurysm": ["arterial aneurysm", "aortic aneurysm"],
  "varicose veins": ["venous insufficiency", "chronic venous disease"],
  "peripheral artery disease": ["PAD", "peripheral vascular disease"],
  "cardiac arrest": ["sudden cardiac arrest", "SCA"],
  "pacemaker": ["cardiac pacing", "implantable pacemaker"],
  "heart palpitations": ["palpitations", "cardiac arrhythmia sensation"],
  "cholesterol plaque": ["atherosclerotic plaque", "arterial plaque"],

  // ---- v34 expansion: additional endocrinology / metabolism ----
  "insulin resistance": ["impaired insulin sensitivity", "prediabetes"],
  "prediabetes": ["impaired glucose tolerance", "impaired fasting glucose"],
  "cushing's": ["Cushing syndrome", "hypercortisolism"],
  "addison's disease": ["primary adrenal insufficiency", "hypoadrenalism"],
  "hashimoto's": ["Hashimoto thyroiditis", "autoimmune thyroiditis"],
  "goiter": ["thyroid enlargement", "thyromegaly"],
  "pituitary tumor": ["pituitary adenoma"],
  "vitamin d": ["cholecalciferol", "25-hydroxyvitamin D"],
  "vitamin b12 deficiency": ["cobalamin deficiency", "pernicious anemia"],
  "electrolyte imbalance": ["electrolyte disturbance", "dyselectrolytemia"],
  "low sodium": ["hyponatremia"],
  "high potassium": ["hyperkalemia"],

  // ---- v34 expansion: additional oncology ----
  "colon cancer": ["colorectal carcinoma", "colorectal cancer", "CRC"],
  "prostate cancer": ["prostatic carcinoma", "prostate adenocarcinoma"],
  "pancreatic cancer": ["pancreatic adenocarcinoma", "PDAC"],
  "brain tumor": ["intracranial neoplasm", "glioma"],
  "ovarian cancer": ["ovarian carcinoma", "ovarian neoplasm"],
  "cervical cancer": ["cervical carcinoma", "cervical neoplasia"],
  "liver cancer": ["hepatocellular carcinoma", "HCC"],
  "stomach cancer": ["gastric carcinoma", "gastric adenocarcinoma"],
  "thyroid cancer": ["thyroid carcinoma", "papillary thyroid carcinoma"],
  "childhood leukemia": ["pediatric leukemia", "acute lymphoblastic leukemia", "ALL"],
  "tumor marker": ["biomarker of malignancy", "oncologic biomarker"],
  "cancer immunotherapy": ["immuno-oncology", "checkpoint inhibitor therapy"],
  "targeted cancer therapy": ["molecularly targeted therapy", "precision oncology"],
  "cancer screening": ["oncologic screening", "early cancer detection"],
  "benign tumor": ["benign neoplasm"],
  "cancer stem cells": ["tumor-initiating cells", "cancer-initiating cells"],

  // ---- v34 expansion: neurology / psychiatry, deeper ----
  "huntington's": ["Huntington disease", "HD"],
  "essential tremor": ["familial tremor", "benign essential tremor"],
  "peripheral nerve pain": ["peripheral neuropathic pain"],
  "diabetic nerve damage": ["diabetic neuropathy", "diabetic peripheral neuropathy"],
  "restless leg syndrome": ["restless legs syndrome", "RLS", "Willis-Ekbom disease"],
  "narcolepsy": ["excessive daytime sleepiness disorder", "hypersomnolence"],
  "postpartum depression": ["peripartum depression", "postnatal depression"],
  "seasonal depression": ["seasonal affective disorder", "SAD"],
  "eating disorder": ["disordered eating", "feeding and eating disorder"],
  "anorexia": ["anorexia nervosa"],
  "bulimia": ["bulimia nervosa"],
  "binge eating": ["binge eating disorder", "BED"],
  "self harm": ["nonsuicidal self-injury", "NSSI"],
  "panic attack": ["panic disorder", "acute anxiety episode"],
  "social anxiety": ["social phobia", "social anxiety disorder"],
  "learning disability": ["specific learning disorder", "learning disorder"],
  "dyslexia": ["reading disorder", "specific reading disability"],
  "brain plasticity": ["neuroplasticity", "synaptic plasticity"],
  "brain aging": ["neurocognitive aging", "age-related neurodegeneration"],
  "neurotransmitter imbalance": ["neurotransmitter dysregulation"],
  "dopamine": ["dopaminergic signaling", "dopamine neurotransmission"],
  "serotonin": ["serotonergic signaling", "5-hydroxytryptamine"],

  // ---- v34 expansion: infectious disease / virology, deeper ----
  "covid": ["COVID-19", "SARS-CoV-2 infection"],
  "coronavirus": ["SARS-CoV-2", "coronavirus infection"],
  "hiv": ["human immunodeficiency virus", "HIV infection"],
  "aids": ["acquired immunodeficiency syndrome"],
  "hepatitis": ["viral hepatitis", "hepatic inflammation"],
  "herpes": ["herpes simplex virus infection", "HSV infection"],
  "hpv": ["human papillomavirus", "HPV infection"],
  "shingles": ["herpes zoster", "varicella zoster reactivation"],
  "chickenpox": ["varicella", "varicella zoster infection"],
  "measles": ["rubeola", "morbillivirus infection"],
  "tuberculosis": ["TB", "Mycobacterium tuberculosis infection"],
  "malaria": ["Plasmodium infection", "malarial disease"],
  "lyme disease": ["Borrelia burgdorferi infection", "borreliosis"],
  "sepsis": ["septicemia", "systemic inflammatory response syndrome"],
  "antibiotic": ["antibacterial agent", "antimicrobial drug"],
  "antifungal": ["antifungal agent", "antimycotic drug"],
  "monkeypox": ["mpox", "monkeypox virus infection"],
  "zoonotic disease": ["zoonosis", "zoonotic infection"],
  "pandemic preparedness": ["epidemic preparedness", "outbreak response"],
  "herd immunity": ["population immunity", "herd protection"],
  "mrna vaccine": ["messenger RNA vaccine", "mRNA-based immunization"],

  // ---- v34 expansion: respiratory, deeper ----
  "chronic cough": ["persistent cough"],
  "bronchitis": ["bronchial inflammation"],
  "cystic fibrosis": ["CF", "CFTR-related disease"],
  "lung fibrosis": ["pulmonary fibrosis", "interstitial lung disease"],
  "pulmonary hypertension": ["PH", "elevated pulmonary artery pressure"],
  "black lung": ["coal workers' pneumoconiosis", "pneumoconiosis"],
  "wheezing": ["expiratory wheeze", "airway obstruction sign"],

  // ---- v34 expansion: gastro / hepatology, deeper ----
  "celiac disease": ["gluten enteropathy", "celiac sprue"],
  "lactose intolerance": ["lactase deficiency", "lactose malabsorption"],
  "diverticulitis": ["diverticular disease"],
  "hemorrhoids": ["hemorrhoidal disease", "piles"],
  "constipation": ["functional constipation"],
  "diarrhea": ["diarrheal disease"],
  "pancreatitis": ["pancreatic inflammation"],
  "gut microbiome diversity": ["intestinal microbial diversity"],

  // ---- v34 expansion: renal / urology, deeper ----
  "dialysis": ["renal replacement therapy", "hemodialysis"],
  "kidney transplant": ["renal transplantation"],
  "bladder infection": ["cystitis", "lower urinary tract infection"],
  "incontinence": ["urinary incontinence"],
  "overactive bladder": ["detrusor overactivity", "OAB"],

  // ---- v34 expansion: musculoskeletal / rheumatology, deeper ----
  "lupus": ["systemic lupus erythematosus", "SLE"],
  "gout flare": ["acute gouty arthritis"],
  "osteoarthritis": ["degenerative joint disease", "DJD"],
  "scoliosis": ["spinal curvature", "idiopathic scoliosis"],
  "carpal tunnel": ["carpal tunnel syndrome", "median nerve entrapment"],
  "tendonitis": ["tendinopathy", "tendon inflammation"],
  "muscular dystrophy": ["MD", "dystrophinopathy"],
  "bone fracture healing": ["fracture union", "bone repair"],

  // ---- v34 expansion: reproductive / women's & men's health, deeper ----
  "uterine fibroids": ["leiomyoma", "uterine myoma"],
  "ovarian cyst": ["adnexal cyst", "ovarian mass"],
  "postpartum hemorrhage": ["PPH", "obstetric hemorrhage"],
  "gestational diabetes": ["GDM", "pregnancy-induced diabetes"],
  "low sperm count": ["oligospermia", "male factor infertility"],
  "low testosterone": ["hypogonadism", "testosterone deficiency"],
  "prostatitis": ["prostate inflammation"],
  "hpv vaccine": ["human papillomavirus vaccination", "HPV immunization"],

  // ---- v34 expansion: dermatology / ENT / ophthalmology / dental ----
  "rosacea": ["facial erythema disorder", "rosacea skin disease"],
  "vitiligo": ["depigmentation disorder", "leukoderma"],
  "melasma": ["hyperpigmentation disorder", "chloasma"],
  "cataracts": ["lens opacity", "cataract disease"],
  "glaucoma": ["optic neuropathy", "elevated intraocular pressure"],
  "macular degeneration": ["age-related macular degeneration", "AMD"],
  "dry eye": ["keratoconjunctivitis sicca", "dry eye disease"],
  "hearing loss": ["hearing impairment", "sensorineural hearing loss"],
  "tinnitus": ["ringing in the ears", "auditory phantom perception"],
  "ear infection": ["otitis media", "otitis externa"],
  "sinus infection": ["sinusitis", "rhinosinusitis"],
  "tooth decay": ["dental caries", "cavities"],
  "gum disease": ["periodontal disease", "periodontitis"],
  "vertigo": ["vestibular dysfunction", "benign paroxysmal positional vertigo"],

  // ---- v34 expansion: immunology / allergy, deeper ----
  "peanut allergy": ["peanut hypersensitivity", "IgE-mediated peanut allergy"],
  "anaphylaxis": ["anaphylactic reaction", "systemic hypersensitivity reaction"],
  "immunodeficiency": ["immune deficiency disorder", "primary immunodeficiency"],
  "organ transplant rejection": ["allograft rejection", "graft rejection"],
  "immunosuppression": ["immune suppression", "immunosuppressive therapy"],

  // ---- v34 expansion: genetics / molecular / cell biology, deeper ----
  "chromosomal abnormality": ["chromosomal aberration", "karyotype abnormality"],
  "down syndrome": ["trisomy 21"],
  "genetic testing": ["genomic testing", "molecular genetic testing"],
  "gene knockout": ["gene knockout model", "loss-of-function mutation"],
  "protein misfolding": ["proteostasis dysfunction", "misfolded protein aggregation"],
  "cell death": ["apoptosis", "programmed cell death"],
  "cell division": ["mitosis", "cell proliferation"],
  "dna repair": ["DNA damage response", "genome repair mechanism"],
  "telomere": ["telomere length", "telomeric DNA"],
  "rna interference": ["RNAi", "small interfering RNA", "siRNA"],
  "single nucleotide polymorphism": ["SNP", "genetic variant"],
  "gut brain axis": ["gut-brain axis", "microbiota-gut-brain signaling"],
  "biomarker discovery": ["biomarker identification", "diagnostic biomarker"],

  // ---- v34 expansion: pharmacology / toxicology, deeper ----
  "drug interaction": ["pharmacokinetic interaction", "drug-drug interaction"],
  "drug metabolism": ["xenobiotic metabolism", "hepatic drug clearance"],
  "side effects": ["adverse drug reaction", "ADR"],
  "drug overdose": ["acute drug toxicity", "poisoning"],
  "painkiller": ["analgesic", "opioid analgesic"],
  "anti inflammatory drug": ["nonsteroidal anti-inflammatory drug", "NSAID"],
  "blood thinner": ["anticoagulant", "antiplatelet agent"],
  "statin": ["HMG-CoA reductase inhibitor", "lipid-lowering therapy"],
  "beta blocker": ["beta-adrenergic antagonist"],
  "antidepressant": ["antidepressant medication", "SSRI"],

  // ---- v34 expansion: epidemiology / biostatistics / public health ----
  "outbreak": ["disease outbreak", "epidemic"],
  "risk factor": ["risk determinant", "predisposing factor"],
  "clinical trial": ["randomized controlled trial", "RCT"],
  "placebo effect": ["placebo response"],
  "sample size": ["statistical power", "study power"],
  "confidence interval": ["CI", "interval estimate"],
  "publication bias": ["reporting bias"],
  "health disparity": ["health inequity", "healthcare disparity"],
  "life expectancy": ["mortality rate", "survival outcomes"],
  "vaccine hesitancy": ["vaccine refusal", "immunization hesitancy"],
  "screen time": ["digital media exposure", "screen exposure"],
  "sedentary behavior": ["physical inactivity", "sedentarism"],

  // ---- v34 expansion: neuroscience methods / imaging / surgery ----
  "brain scan": ["neuroimaging", "MRI brain imaging"],
  "fmri": ["functional magnetic resonance imaging"],
  "eeg": ["electroencephalography", "electroencephalogram"],
  "ct scan": ["computed tomography", "CT imaging"],
  "x-ray": ["radiography", "plain film imaging"],
  "ultrasound imaging": ["sonography", "ultrasonography"],
  "biopsy": ["tissue biopsy", "histopathological sampling"],
  "minimally invasive surgery": ["laparoscopic surgery", "MIS"],
  "robotic surgery": ["robot-assisted surgery"],
  "anesthesia": ["general anesthesia", "anesthetic management"],
  "organ donation": ["organ procurement", "transplant donation"],

  // ---- v34 expansion: nutrition / lifestyle, deeper ----
  "ketogenic diet": ["keto diet", "very-low-carbohydrate diet"],
  "mediterranean diet": ["Mediterranean dietary pattern"],
  "protein intake": ["dietary protein consumption"],
  "sugar intake": ["dietary sugar consumption", "added sugar intake"],
  "processed food": ["ultra-processed food", "UPF"],
  "gut probiotics": ["probiotic supplementation"],
  "fasting": ["caloric restriction", "time-restricted feeding"],
  "sleep deprivation": ["sleep restriction", "insufficient sleep"],
  "circadian rhythm": ["circadian clock", "diurnal rhythm"],
  "blue light exposure": ["screen light exposure", "short-wavelength light exposure"],

  // ---- v34 expansion: chemistry / physics / materials (breadth beyond
  //      biomedicine — Cerebrum fans out to cross-disciplinary sources too) ----
  "nanoparticle": ["nanomaterial", "nanoscale particle"],
  "graphene": ["graphene material", "two-dimensional carbon material"],
  "superconductor": ["superconducting material", "superconductivity"],
  "quantum computing": ["quantum computation", "quantum information processing"],
  "battery technology": ["energy storage technology", "electrochemical cell"],
  "solar panel": ["photovoltaic cell", "solar photovoltaics"],
  "greenhouse gas": ["GHG emissions", "atmospheric carbon emissions"],
  "carbon capture": ["carbon capture and storage", "CCS"],
  "machine learning": ["ML", "statistical learning algorithm"],
  "artificial intelligence": ["AI", "machine intelligence"],
  "neural network": ["artificial neural network", "deep learning model"],
  "gravitational waves": ["gravitational wave detection", "spacetime ripples"],
  "exoplanet": ["extrasolar planet"],
  "black hole": ["black hole astrophysics", "event horizon physics"],

  // ---- v34 expansion: ecology / agriculture / veterinary, deeper ----
  "coral reef decline": ["coral reef degradation", "reef ecosystem loss"],
  "ocean plastic": ["marine plastic pollution", "ocean debris"],
  "sea level rise": ["coastal inundation risk", "eustatic sea level change"],
  "drought": ["water scarcity", "meteorological drought"],
  "crop yield": ["agricultural yield", "crop productivity"],
  "genetically modified crop": ["GMO crop", "transgenic crop"],
  "soil erosion": ["land degradation", "topsoil loss"],
  "livestock disease": ["veterinary infectious disease"],
  "avian flu": ["avian influenza", "bird flu", "H5N1"],
  "wildlife trafficking": ["illegal wildlife trade"],
  "pollinator health": ["bee health", "pollinator conservation"],
  "ant colony behavior": ["eusocial insect behavior", "ant colony organization"],
  "termite": ["Isoptera", "termite colony biology"],
  "mosquito borne disease": ["vector-borne disease", "mosquito-transmitted infection"],
  "tick borne disease": ["tick-transmitted infection", "vector-borne illness"],

  // ---- v35 expansion: quantum physics ----
  "quantum entanglement": ["quantum nonlocality", "Bell's theorem", "EPR paradox"],
  "quantum superposition": ["superposition principle", "quantum coherence"],
  "quantum tunneling": ["tunneling effect", "quantum barrier penetration"],
  "quantum decoherence": ["environmental decoherence", "loss of quantum coherence"],
  "quantum teleportation": ["quantum state transfer"],
  "quantum cryptography": ["quantum key distribution", "QKD"],
  "quantum supremacy": ["quantum advantage", "quantum computational advantage"],
  "qubit": ["quantum bit"],
  "wave function collapse": ["quantum measurement problem"],
  "heisenberg uncertainty principle": ["quantum uncertainty", "uncertainty relation"],
  "schrodinger equation": ["quantum wave equation"],
  "quantum field theory": ["QFT"],
  "standard model": ["standard model of particle physics"],
  "higgs boson": ["Higgs particle", "Higgs mechanism"],
  "dark matter": ["nonbaryonic matter", "cold dark matter"],
  "dark energy": ["cosmological constant", "vacuum energy"],
  "string theory": ["superstring theory"],
  "quantum gravity": ["quantum theory of gravity"],
  "quantum dot": ["semiconductor nanocrystal"],
  "quantum annealing": ["adiabatic quantum computation"],
  "topological qubit": ["topological quantum computing"],
  "quantum error correction": ["fault-tolerant quantum computing"],
  "bose einstein condensate": ["BEC", "ultracold atom condensate"],
  "particle accelerator": ["synchrotron", "collider physics"],
  "neutrino oscillation": ["neutrino flavor change"],

  // ---- v35 expansion: materials science ----
  "metallic glass": ["amorphous metal", "bulk metallic glass"],
  "shape memory alloy": ["shape-memory metal", "nitinol"],
  "high entropy alloy": ["multi-principal element alloy", "HEA"],
  "carbon nanotube": ["CNT", "single-walled carbon nanotube"],
  "perovskite solar cell": ["perovskite photovoltaic"],
  "metamaterial": ["engineered electromagnetic material"],
  "piezoelectric material": ["piezoelectricity"],
  "self healing material": ["self-healing polymer"],
  "biodegradable plastic": ["bioplastic", "biodegradable polymer"],
  "superhydrophobic surface": ["water-repellent coating"],
  "thin film deposition": ["thin-film fabrication"],
  "crystal lattice defect": ["lattice imperfection", "point defect"],
  "grain boundary": ["polycrystalline boundary"],
  "sintering": ["powder consolidation"],
  "additive manufacturing": ["3D printing", "3-D printing"],
  "composite material": ["fiber-reinforced composite"],
  "ceramic matrix composite": ["CMC"],
  "nanowire": ["nanoscale wire"],
  "topological insulator": ["topological quantum material"],
  "2d material": ["two-dimensional material"],
  "metal organic framework": ["MOF", "metal-organic framework"],
  "aerogel": ["silica aerogel"],
  "superalloy": ["nickel-based superalloy"],

  // ---- v35 expansion: computer science / AI ----
  "deep learning": ["deep neural network", "DNN"],
  "reinforcement learning": ["RL"],
  "natural language processing": ["NLP", "computational linguistics"],
  "large language model": ["LLM"],
  "transformer model": ["attention-based neural network"],
  "generative adversarial network": ["GAN"],
  "convolutional neural network": ["CNN"],
  "recurrent neural network": ["RNN"],
  "computer vision": ["machine vision"],
  "data mining": ["knowledge discovery"],
  "blockchain": ["distributed ledger technology"],
  "cryptographic hash function": ["hash algorithm"],
  "edge computing": ["distributed edge processing"],
  "cloud computing": ["utility computing"],
  "cybersecurity": ["information security", "computer security"],
  "algorithmic bias": ["machine learning bias", "AI fairness"],
  "federated learning": ["decentralized machine learning"],
  "explainable ai": ["interpretable machine learning", "XAI"],
  "robotics": ["robotic systems engineering"],
  "internet of things": ["IoT", "connected devices"],
  "software vulnerability": ["security vulnerability"],
  "genetic algorithm": ["evolutionary computation"],

  // ---- v35 expansion: climate science ----
  "carbon footprint": ["greenhouse gas footprint"],
  "carbon sequestration": ["carbon capture and sequestration"],
  "methane emissions": ["atmospheric methane release"],
  "climate model": ["global climate model", "GCM"],
  "extreme weather": ["extreme weather event"],
  "heat wave": ["extreme heat event"],
  "polar ice melt": ["ice sheet melting", "glacial retreat"],
  "renewable energy": ["clean energy", "sustainable energy"],
  "carbon neutrality": ["net-zero emissions"],
  "climate mitigation": ["greenhouse gas mitigation"],
  "climate adaptation": ["climate resilience"],
  "albedo effect": ["surface reflectivity"],
  "jet stream": ["atmospheric jet stream"],
  "el nino": ["El Nino Southern Oscillation", "ENSO"],
  "la nina": ["La Nina climate pattern"],
  "ozone depletion": ["stratospheric ozone loss"],
  "greenhouse effect": ["atmospheric greenhouse warming"],
  "climate tipping point": ["critical climate threshold"],
  "carbon offset": ["emissions offset"],
  "biofuel": ["biomass fuel"],
  "desertification": ["land desertification"],
};

// Reverse-index lookup: every casual key that appears as a SUBSTRING of the
// cleaned query contributes its expansions. Longest keys are checked first
// so "black soldier fly" wins over a coincidental shorter match, and a hit
// short-circuits so overlapping phrases don't double-count.
// v35: with MESH_BULK folded in, the combined vocabulary jumped from ~600
// keys to ~9,000+. The old algorithm scanned EVERY key with a substring
// `.indexOf()` against the whole query — fine at 600 keys, a real per-request
// cost at 9,000 (and, worse, `.indexOf()` matches inside other words too:
// the substring "cell" would fire on "cellular", a false positive the old
// small table mostly got away with by luck). Replaced with a single merged
// lookup Map built once at module load, queried by generating the query's
// own word n-grams and doing an O(1) Map lookup per n-gram — cost now scales
// with the QUERY's length (typically a few dozen n-grams for an ordinary
// sentence), not the dictionary's size, and a multi-word key like "heart
// attack" only matches when those are actually adjacent words, not a
// substring collision.
const _MESH_MERGED = (() => {
  const map = new Map();
  // Bulk (real NLM data) loaded first, hand-curated second so a curated
  // entry — reasoned about by a person, not filtered by a heuristic — wins
  // outright on any key collision rather than being merged/diluted with it.
  for (const [key, syns] of Object.entries(MESH_BULK)) map.set(key, syns);
  for (const [key, syns] of Object.entries(MESH_EXPANSIONS)) map.set(key, syns);
  return map;
})();
const _MESH_MAX_WORDS = (() => {
  let max = 1;
  for (const key of _MESH_MERGED.keys()) {
    const n = key.split(" ").length;
    if (n > max) max = n;
  }
  return Math.min(max, 6); // sane ceiling regardless of what's in the table
})();

export function expandViaMesh(rawQuery) {
  const q = (rawQuery || "").toLowerCase();
  if (!q) return [];
  // Split on whitespace only (not hyphens) — several real keys are
  // hyphenated compounds ("x-ray", "5-ht", "2d material" aside) that need to
  // survive as one token to match; a query containing "x-ray" verbatim
  // still tokenizes to the single word "x-ray" this way.
  const words = q.replace(/[^\p{L}\p{N}\s\-']/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = new Set();
  // Longest n-grams first: a precise multi-word match ("mobile genetic
  // element") is worth more than an incidental single-word overlap, so it's
  // collected before the cap below can crowd it out.
  for (let n = Math.min(_MESH_MAX_WORDS, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n).join(" ");
      const syns = _MESH_MERGED.get(gram);
      if (syns) for (const s of syns) out.add(s);
    }
    if (out.size >= 12) break; // caller (search.js) only ever uses the first 4
  }
  return [...out];
}

// ════════════════════════════════════════════════════════════════════════
// 2. STUDY-TYPE / EVIDENCE-HIERARCHY CLASSIFICATION
//
// Not all papers that pass the topic-relevance filter are equally strong
// evidence for a claim. A systematic review of 40 trials and a single
// mouse-model case report can both be "about" the same topic; only one of
// them should anchor an answer. Evidence-based-medicine hierarchies rank
// study designs this way, and title/abstract phrasing is a reliable enough
// signal to classify design WITHOUT reading the full text — journals and
// authors follow fairly rigid conventions for describing their own methods.
//
// Tier 1 (strongest) -> Tier 6 (weakest), plus two side categories
// (narrative review, and editorial/opinion) that aren't primary evidence at
// all and are scored separately rather than slotted into the hierarchy.
// ════════════════════════════════════════════════════════════════════════

export const EVIDENCE_TIERS = {
  SYSTEMATIC_REVIEW: { tier: 1, label: "Systematic review / meta-analysis", weight: 16 },
  RCT: { tier: 2, label: "Randomized controlled trial", weight: 13 },
  COHORT: { tier: 3, label: "Cohort study", weight: 10 },
  CASE_CONTROL: { tier: 4, label: "Case-control / cross-sectional study", weight: 7 },
  CASE_REPORT: { tier: 5, label: "Case report / case series", weight: 3 },
  PRECLINICAL: { tier: 6, label: "Preclinical (animal / in vitro / in silico)", weight: 4 },
  NARRATIVE_REVIEW: { tier: null, label: "Narrative review", weight: 6 },
  EDITORIAL: { tier: null, label: "Editorial / commentary / letter", weight: -4 },
};

// Ordered so more specific/rarer phrasing (meta-analysis, RCT) is tested
// before generic ones (review, study) that would otherwise false-match a
// systematic review's own abstract (which necessarily says "we reviewed
// studies" while describing tier-1 evidence, not a narrative review).
const STUDY_TYPE_PATTERNS = [
  { re: /\b(systematic review\s+and\s+meta-analysis|meta-analysis|meta-analytic)\b/i, key: "SYSTEMATIC_REVIEW" },
  { re: /\bsystematic\s+(literature\s+)?review\b/i, key: "SYSTEMATIC_REVIEW" },
  { re: /\bcochrane\s+review\b/i, key: "SYSTEMATIC_REVIEW" },
  { re: /\b(randomi[sz]ed\s+(double-blind|single-blind|placebo-controlled|controlled)?\s*(clinical\s+)?trial|randomi[sz]ed\s+controlled\s+trial|\bRCT\b|double-blind\s+placebo-controlled)\b/i, key: "RCT" },
  { re: /\b(prospective|retrospective)\s+cohort\s+stud(y|ies)\b/i, key: "COHORT" },
  { re: /\blongitudinal\s+stud(y|ies)\b/i, key: "COHORT" },
  { re: /\bcohort\s+stud(y|ies)\b/i, key: "COHORT" },
  { re: /\bcase-control\s+stud(y|ies)\b/i, key: "CASE_CONTROL" },
  { re: /\bcross-sectional\s+stud(y|ies)\b/i, key: "CASE_CONTROL" },
  { re: /\bcase\s+report\b/i, key: "CASE_REPORT" },
  { re: /\bcase\s+series\b/i, key: "CASE_REPORT" },
  { re: /\bin\s+vitro\b/i, key: "PRECLINICAL" },
  { re: /\bin\s+vivo\b/i, key: "PRECLINICAL" },
  { re: /\bin\s+silico\b/i, key: "PRECLINICAL" },
  { re: /\b(mouse|murine|rat|rodent|animal)\s+model\b/i, key: "PRECLINICAL" },
  { re: /\bcell\s+(line|culture)\s+stud(y|ies)\b/i, key: "PRECLINICAL" },
  { re: /\b(narrative|scoping)\s+review\b/i, key: "NARRATIVE_REVIEW" },
  { re: /^review[:.]|^\s*a\s+review\s+of\b/i, key: "NARRATIVE_REVIEW" },
  { re: /\b(editorial|commentary|letter\s+to\s+the\s+editor|perspective|opinion\s+piece)\b/i, key: "EDITORIAL" },
];

/**
 * Classify a paper's study design from its title + abstract. Returns null
 * when nothing matches — most papers (a plain hypothesis-driven bench
 * study, a field survey, a descriptive genomics paper) don't fit any EBM
 * category and that's fine; they're scored on topical/quality signals alone
 * elsewhere, this classification is a BONUS signal, never a penalty for
 * papers it can't categorize.
 */
export function classifyStudyType(title, abstract) {
  const hay = ((title || "") + " " + (abstract || ""));
  for (const { re, key } of STUDY_TYPE_PATTERNS) {
    if (re.test(hay)) {
      return { key, ...EVIDENCE_TIERS[key] };
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════
// 3. JOURNAL QUALITY TIERS
//
// scoreAnswerQuality()/the paper-ranking pass in search.js currently scores
// quality from abstract length, citation count, and recency — three signals
// that treat a paper in Nature identically to one in an unindexed
// pay-to-publish venue, provided both happen to have a long abstract. This
// table is a THIRD, independent signal: is the journal itself one whose
// peer-review and editorial standards are well established.
//
// This is intentionally a SHORT allowlist of unambiguous, broadly-recognized
// venues, not an attempt to rank the entire literature — absence from this
// table means "unscored on this dimension", never "low quality". A specialty
// journal nobody has heard of outside its field is not predatory just for
// being missing here; only PREDATORY_SIGNALS (section 4) makes that call,
// and even that is a soft penalty.
//
// Tier 3 — flagship generalist / field-defining journals.
// Tier 2 — major society or leading specialty journals.
// Tier 1 — solid, well-established, broadly indexed journals worth a small
//          nudge over an entirely unknown venue but not flagship-tier.
// ════════════════════════════════════════════════════════════════════════

const _JOURNAL_TIER_RAW = {
  3: [
    "nature", "science", "cell", "the lancet", "new england journal of medicine",
    "jama", "nature medicine", "nature genetics", "nature neuroscience",
    "nature biotechnology", "nature methods", "nature immunology",
    "nature cell biology", "nature materials", "nature physics",
    "nature chemistry", "nature communications", "nature reviews",
    "science translational medicine", "science advances", "science immunology",
    "science signaling", "proceedings of the national academy of sciences",
    "pnas", "cell metabolism", "cell reports", "cell host & microbe",
    "cell stem cell", "immunity", "neuron", "cancer cell", "molecular cell",
    "the bmj", "annals of internal medicine", "circulation",
    "journal of clinical oncology", "jco", "blood", "gut", "brain",
    "the embo journal", "elife", "plos biology", "plos medicine",
    "genome research", "genome biology",
  ],
  2: [
    "the lancet oncology", "the lancet neurology", "the lancet infectious diseases",
    "the lancet psychiatry", "the lancet public health", "lancet global health",
    "nature reviews cancer", "nature reviews immunology", "nature reviews genetics",
    "nature reviews neuroscience", "nature reviews drug discovery",
    "nature reviews molecular cell biology", "nature ecology & evolution",
    "nature microbiology", "nature plants", "nature climate change",
    "nature sustainability", "european heart journal", "circulation research",
    "journal of the american college of cardiology", "jacc",
    "diabetes care", "diabetes", "diabetologia", "gastroenterology",
    "hepatology", "journal of hepatology", "american journal of respiratory and critical care medicine",
    "chest", "thorax", "the european respiratory journal", "kidney international",
    "annals of neurology", "annals of oncology", "molecular psychiatry",
    "jama psychiatry", "jama internal medicine", "jama oncology",
    "jama pediatrics", "jama cardiology", "jama neurology", "pediatrics",
    "obstetrics & gynecology", "american journal of obstetrics and gynecology",
    "the american journal of psychiatry", "biological psychiatry",
    "journal of allergy and clinical immunology", "arthritis & rheumatology",
    "annals of the rheumatic diseases", "gut microbes", "microbiome",
    "the isme journal", "applied and environmental microbiology",
    "journal of virology", "mbio", "plos pathogens", "the plant cell",
    "plant physiology", "new phytologist", "molecular plant",
    "ecology letters", "ecology", "journal of animal ecology",
    "global change biology", "proceedings of the royal society b",
    "insect biochemistry and molecular biology", "journal of insect physiology",
    "bioinformatics", "genome medicine", "genetics in medicine",
    "the journal of clinical investigation", "jci insight",
    "journal of experimental medicine", "embo reports",
    "molecular biology and evolution", "trends in ecology & evolution",
    "trends in genetics", "trends in cell biology", "trends in microbiology",
    "annual review of immunology", "annual review of genetics",
    "annual review of biochemistry", "annual review of microbiology",
    "annual review of physiology", "annual review of ecology, evolution, and systematics",
    "psychological science", "the american naturalist", "molecular ecology",
    "functional ecology", "conservation biology", "biological conservation",
  ],
  1: [
    "plos one", "scientific reports", "bmc medicine", "bmc biology",
    "bmc genomics", "bmc microbiology", "bmc public health",
    "bmc infectious diseases", "frontiers in immunology", "frontiers in microbiology",
    "frontiers in psychology", "frontiers in plant science", "frontiers in ecology and evolution",
    "the journal of biological chemistry", "biochemical journal",
    "the journal of nutrition", "the american journal of clinical nutrition",
    "nutrients", "journal of clinical endocrinology & metabolism",
    "european journal of endocrinology", "molecular metabolism",
    "the journal of infectious diseases", "clinical infectious diseases",
    "emerging infectious diseases", "vaccine", "the journal of immunology",
    "european journal of immunology", "journal of experimental biology",
    "journal of insect science", "environmental entomology",
    "journal of economic entomology", "apidologie", "insects",
    "peerj", "royal society open science", "scientific data",
    "microorganisms", "pathogens", "viruses", "toxins", "antibiotics",
    "molecules", "international journal of molecular sciences",
    "the journal of neuroscience", "neuroimage", "cortex", "cognition",
    "psychological medicine", "sleep", "journal of sleep research",
    "the journals of gerontology", "aging cell", "geroscience",
    "the plant journal", "journal of experimental botany",
    "soil biology and biochemistry", "applied soil ecology",
    "environmental science & technology", "environmental pollution",
    "chemosphere", "science of the total environment",
  ],
};

export const JOURNAL_TIERS = new Map();
for (const [tier, names] of Object.entries(_JOURNAL_TIER_RAW)) {
  for (const name of names) JOURNAL_TIERS.set(name, parseInt(tier, 10));
}

const _TIER_WEIGHT = { 3: 14, 2: 9, 1: 4 };

/**
 * Normalize a raw journal-name string the same way for lookup as for
 * insertion: lowercase, strip a leading "the ", collapse whitespace/punct.
 * Source APIs are inconsistent about the leading article ("The Lancet" vs
 * "Lancet"), so the table stores the WITH-article form (the more common
 * citation style) and this strips it only for matching, not storage.
 */
function normalizeJournalName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns a quality-score bonus (0, 4, 9, or 14) for a known journal name,
 * or 0 for anything not in the table — unknown is neutral, not penalized.
 */
export function scoreJournalTier(journalName) {
  const norm = normalizeJournalName(journalName);
  if (!norm) return 0;
  if (JOURNAL_TIERS.has(norm)) return _TIER_WEIGHT[JOURNAL_TIERS.get(norm)];
  // Also try without a leading "the " in case the source dropped it.
  const noThe = norm.replace(/^the\s+/, "");
  if (noThe !== norm && JOURNAL_TIERS.has(noThe)) return _TIER_WEIGHT[JOURNAL_TIERS.get(noThe)];
  if (JOURNAL_TIERS.has("the " + norm)) return _TIER_WEIGHT[JOURNAL_TIERS.get("the " + norm)];
  return 0;
}

// ════════════════════════════════════════════════════════════════════════
// 4. PREDATORY / QUESTIONABLE PUBLISHER SIGNALS
//
// A handful of publisher names recur constantly in the journalology
// literature on predatory publishing (Beall's list and its successors,
// Cabells' Predatory Reports criteria, and repeated coverage in Nature,
// Science, and COPE case studies) for the same well-documented pattern:
// little or no real peer review, fee-for-acceptance rather than
// fee-for-quality, and journal titles cloned across dozens of unrelated
// subject areas from one publisher. This is intentionally a SOFT, additive
// penalty applied during scoring — never a hard filter — because:
//   (a) a false positive here should degrade a paper's rank, not vanish it,
//       since the paper might still be the only source on a niche topic;
//   (b) publisher status changes over time (acquisitions, delistings), and
//       a stale blocklist that hard-deletes results is worse than a stale
//       one that merely down-weights them.
//
// Matched against the journal name AND the paper's URL/domain, since a
// predatory publisher's own domain is often the more reliable signal than
// whatever journal title string a given API returns.
// ════════════════════════════════════════════════════════════════════════

const PREDATORY_SIGNALS = [
  /\bomics\s*(international|publishing)?\b/i,
  /\bimedpub\b/i,
  /\bscientific research publishing\b/i,
  /\bscirp\.org\b/i,
  /\baustin publishing group\b/i,
  /\bavens publishing\b/i,
  /\bhilaris\b/i,
  /\blongdom\b/i,
  /\bjscimed ?central\b/i,
  /\bmedcrave\b/i,
  /\bscitechnol\b/i,
  /\bpeertechz\b/i,
  /\bsymbiosis online\b/i,
  /\btrade science inc\b/i,
  /\bsciencepg\b/i,
  /\bscience publishing group\b/i,
  /\bacademic journals\b.*\bafrica\b/i,
  /\bopenaccesspub\b/i,
  /\bannex publishers\b/i,
  /\braast publications\b/i,
  /\bglobal research online\b/i,
  /\biosr journals\b/i,
];

/**
 * Returns a NEGATIVE score adjustment (0 if nothing matched) for a paper
 * whose journal name or URL matches a known predatory-publishing signal.
 * Always additive/soft — see section header. Checks the journal string
 * first (cheaper), falls back to the URL/domain.
 */
export function predatoryPenalty(journalName, url) {
  const hay = ((journalName || "") + " " + (url || ""));
  if (!hay.trim()) return 0;
  for (const re of PREDATORY_SIGNALS) {
    if (re.test(hay)) return -18;
  }
  return 0;
}

// ════════════════════════════════════════════════════════════════════════
// 5. DETERMINISTIC ENTITY RECOGNITION
//
// search.js's selfReason() asks an LLM to pull out "key_terms" and
// "organisms" — useful, but it's one network call with a 4s timeout that
// can fail, rate-limit, or simply not run (e.g. no OpenRouter token
// configured on this deploy). This section is a zero-latency, zero-cost
// fallback: pattern/dictionary-based extraction that runs synchronously on
// every request regardless of LLM availability, and can also FILL IN gaps
// the LLM's extraction misses even when it does succeed.
// ════════════════════════════════════════════════════════════════════════

// A genuinely common cross-section of generic drug names spanning the drug
// classes that show up most often in a general-purpose science search:
// analgesics/NSAIDs, antibiotics, antivirals, cardiovascular, diabetes,
// psychiatric, anticoagulants, statins, chemotherapy, immunosuppressants,
// and the "-mab"/"-nib"/"-zumab" biologic/targeted-therapy naming families.
export const COMMON_DRUGS = new Set([
  // Analgesics / NSAIDs
  "acetaminophen", "paracetamol", "ibuprofen", "naproxen", "aspirin",
  "diclofenac", "celecoxib", "ketorolac", "indomethacin", "morphine",
  "oxycodone", "hydrocodone", "fentanyl", "tramadol", "gabapentin", "pregabalin",
  // Antibiotics
  "amoxicillin", "penicillin", "azithromycin", "doxycycline", "ciprofloxacin",
  "levofloxacin", "metronidazole", "clindamycin", "vancomycin", "cephalexin",
  "trimethoprim", "sulfamethoxazole", "erythromycin", "tetracycline", "rifampin",
  "meropenem", "linezolid", "gentamicin", "clarithromycin",
  // Antivirals
  "acyclovir", "oseltamivir", "remdesivir", "molnupiravir", "paxlovid",
  "tenofovir", "emtricitabine", "lamivudine", "ritonavir", "sofosbuvir",
  "valacyclovir", "zidovudine", "efavirenz", "dolutegravir",
  // Cardiovascular
  "lisinopril", "losartan", "amlodipine", "metoprolol", "atenolol",
  "carvedilol", "hydrochlorothiazide", "furosemide", "spironolactone",
  "digoxin", "nitroglycerin", "clopidogrel", "warfarin", "apixaban",
  "rivaroxaban", "dabigatran", "enoxaparin", "heparin",
  // Statins / lipid
  "atorvastatin", "simvastatin", "rosuvastatin", "pravastatin", "ezetimibe",
  "evolocumab", "alirocumab",
  // Diabetes / metabolic
  "metformin", "insulin", "glipizide", "glyburide", "pioglitazone",
  "sitagliptin", "empagliflozin", "dapagliflozin", "canagliflozin",
  "semaglutide", "liraglutide", "tirzepatide", "exenatide",
  // Psychiatric / neurologic
  "sertraline", "fluoxetine", "escitalopram", "citalopram", "paroxetine",
  "venlafaxine", "duloxetine", "bupropion", "mirtazapine", "trazodone",
  "quetiapine", "risperidone", "olanzapine", "aripiprazole", "clozapine",
  "haloperidol", "lithium", "valproate", "lamotrigine", "levetiracetam",
  "carbamazepine", "phenytoin", "methylphenidate", "amphetamine",
  "diazepam", "lorazepam", "alprazolam", "clonazepam", "zolpidem",
  "donepezil", "memantine", "levodopa", "carbidopa", "rivastigmine",
  // Respiratory / allergy
  "albuterol", "salbutamol", "fluticasone", "budesonide", "montelukast",
  "prednisone", "prednisolone", "dexamethasone", "hydrocortisone",
  "loratadine", "cetirizine", "diphenhydramine", "omeprazole", "pantoprazole",
  "famotidine", "ranitidine",
  // Chemotherapy / oncology
  "cisplatin", "carboplatin", "oxaliplatin", "paclitaxel", "docetaxel",
  "doxorubicin", "cyclophosphamide", "methotrexate", "fluorouracil",
  "gemcitabine", "irinotecan", "vincristine", "etoposide", "tamoxifen",
  "letrozole", "anastrozole", "imatinib", "erlotinib", "gefitinib",
  "osimertinib", "sunitinib", "sorafenib", "lenvatinib", "palbociclib",
  "olaparib", "venetoclax", "ibrutinib", "rituximab", "trastuzumab",
  "bevacizumab", "pembrolizumab", "nivolumab", "atezolizumab", "ipilimumab",
  "durvalumab", "cetuximab", "panitumumab", "daratumumab",
  // Immunosuppressants / biologics for autoimmune disease
  "prednisolone", "azathioprine", "mycophenolate", "tacrolimus", "cyclosporine",
  "sirolimus", "adalimumab", "infliximab", "etanercept", "certolizumab",
  "golimumab", "ustekinumab", "secukinumab", "tofacitinib", "baricitinib",
  "upadacitinib", "abatacept", "rituximab",
  // GLP-1 / weight / hormone
  "levothyroxine", "methimazole", "propylthiouracil", "testosterone",
  "estradiol", "progesterone", "finasteride", "tadalafil", "sildenafil",
]);

// Signaling pathway / mechanism names, grouped so any member phrase
// (canonical or an alias) is recognized as referring to the same pathway.
// Mirrors CONCEPT_GROUPS' structure in search.js but is scoped specifically
// to molecular mechanism vocabulary rather than general topic synonyms.
export const MOLECULAR_PATHWAYS = [
  ["mapk pathway", "mapk/erk pathway", "ras-raf-mek-erk", "erk signaling", "mitogen-activated protein kinase"],
  ["pi3k/akt/mtor pathway", "pi3k-akt pathway", "pi3k/akt", "akt signaling", "mtor signaling", "phosphoinositide 3-kinase"],
  ["jak-stat pathway", "jak/stat signaling", "janus kinase", "jak2", "stat3", "stat5"],
  ["nf-kb pathway", "nf-κb signaling", "nuclear factor kappa b"],
  ["wnt/beta-catenin pathway", "wnt signaling", "wnt/β-catenin", "canonical wnt pathway"],
  ["notch signaling", "notch pathway"],
  ["hedgehog signaling", "sonic hedgehog", "shh pathway", "gli signaling"],
  ["tgf-beta/smad pathway", "tgf-β signaling", "smad signaling", "transforming growth factor beta"],
  ["apoptosis", "programmed cell death", "caspase cascade", "intrinsic apoptotic pathway", "extrinsic apoptotic pathway"],
  ["autophagy", "macroautophagy", "autophagic flux", "lc3", "atg genes"],
  ["cell cycle regulation", "cdk-cyclin", "cyclin-dependent kinase", "cell cycle checkpoint"],
  ["dna damage response", "atm/atr pathway", "dna repair pathway", "double-strand break repair"],
  ["immune checkpoint", "pd-1/pd-l1 pathway", "ctla-4 pathway", "immune checkpoint inhibition"],
  ["inflammasome", "nlrp3 inflammasome", "caspase-1 activation"],
  ["oxidative stress response", "nrf2/keap1 pathway", "reactive oxygen species signaling", "antioxidant response element"],
  ["insulin signaling", "insulin receptor pathway", "insulin resistance mechanism"],
  ["renin-angiotensin-aldosterone system", "raas pathway", "ace pathway"],
  ["coagulation cascade", "clotting cascade", "intrinsic coagulation pathway", "extrinsic coagulation pathway"],
  ["complement system", "complement activation", "classical complement pathway", "alternative complement pathway"],
  ["toll-like receptor signaling", "tlr signaling", "pattern recognition receptor"],
  ["gut-brain axis", "gut-brain signaling", "microbiome-gut-brain axis"],
  ["circadian clock", "clock gene", "bmal1", "period gene", "cryptochrome gene"],
  ["hpa axis", "hypothalamic-pituitary-adrenal axis", "cortisol axis"],
  ["vegf signaling", "angiogenesis pathway", "vascular endothelial growth factor"],
  ["egfr signaling", "epidermal growth factor receptor pathway"],
];

const _PATHWAY_LOOKUP = new Map();
for (const group of MOLECULAR_PATHWAYS) {
  for (const alias of group) _PATHWAY_LOOKUP.set(alias.toLowerCase(), group[0]);
}

// Gene symbols are notoriously hard to detect reliably — "FOR", "WAS", "ATP"
// (a molecule, not always a gene reference), and roman-numeral-like tokens
// ("III", "IV") all look like valid 2-6 character all-caps symbols. This is
// a conservative exclusion list of common false positives so the heuristic
// below only flags tokens that are plausibly real HGNC-style symbols.
const GENE_SYMBOL_STOPLIST = new Set([
  "THE", "AND", "FOR", "WAS", "ARE", "NOT", "BUT", "ALL", "ITS", "WHO", "HOW",
  "WHY", "CAN", "MAY", "USE", "NEW", "OLD", "TWO", "ONE", "OUR", "OUT", "GET",
  "HAS", "HAD", "HIS", "HER", "HIM", "SHE", "YOU", "SET", "TOP", "LOW", "HIGH",
  "USA", "USD", "DNA", "RNA", "PCR", "PhD", "MRI", "CT", "MD", "PET", "III",
  "IV", "II", "VI", "VII", "VIII", "IX", "XI", "XII", "NIH", "FDA", "WHO",
  "CDC", "EU", "UK", "US", "IL", "TNF", "IFN", "IGF",
  // Chemical formulas share gene symbols' exact shape — a capital letter
  // followed by a short run of caps/digits — so any earth-science, climate,
  // or chemistry answer trips the heuristic constantly (an ocean-acidification
  // answer that says "CO2" was flagged as an unverifiable "gene" and tanked
  // the fact-check score to 0% on an otherwise well-cited answer). These are
  // the atmospheric/aqueous formulas most likely to show up outside a
  // genetics context; real gene symbols never coincide with them.
  "CO2", "CO", "H2O", "O2", "O3", "N2", "N2O", "NO", "NO2", "NO3", "SO2",
  "SO3", "SO4", "NH3", "NH4", "CH4", "H2S", "H2O2", "HCL", "HNO3", "NAOH",
  "KOH", "CACO3", "NACL", "MGCL2", "CACL2", "C2H4", "C6H12O6",
]);
const GENE_SYMBOL_RE = /^[A-Z][A-Z0-9]{1,6}$/;

/** Heuristic: does this token look like a real gene/protein symbol? */
export function looksLikeGeneSymbol(token) {
  if (!token || GENE_SYMBOL_STOPLIST.has(token)) return false;
  if (!GENE_SYMBOL_RE.test(token)) return false;
  // Require at least one digit OR mixed-case-looking pattern typical of real
  // symbols (BRCA1, TP53, EGFR, IL6, CDKN2A) — pure short dictionary-word-
  // shaped all-caps tokens (CAT, DOG, RUN) are excluded by requiring the
  // token be at least 3 chars AND either contain a digit or be 4+ letters
  // (most 3-letter real symbols like "RAS", "MYC", "FOS", "JUN" are common
  // enough oncogenes that they're allowed through at length 3 too, since the
  // stoplist above already screens ordinary short words).
  if (token.length === 2) return false;
  return true;
}

/**
 * Deterministic entity extraction over a block of text (title + abstract,
 * or the raw query). Zero network calls, runs in well under a millisecond
 * even on long abstracts. Returns arrays (never null) so callers can always
 * spread/concat the result without a null check.
 */
export function extractEntities(text) {
  const hay = (text || "");
  const lower = hay.toLowerCase();
  const drugs = new Set();
  for (const drug of COMMON_DRUGS) {
    if (lower.indexOf(drug) !== -1) drugs.add(drug);
  }
  const pathways = new Set();
  for (const [alias, canonical] of _PATHWAY_LOOKUP) {
    if (lower.indexOf(alias) !== -1) pathways.add(canonical);
  }
  const genes = new Set();
  const tokens = hay.match(/\b[A-Za-z][A-Za-z0-9]{1,7}\b/g) || [];
  for (const t of tokens) {
    if (/[A-Z]/.test(t) && t === t.toUpperCase() && looksLikeGeneSymbol(t)) {
      genes.add(t);
    }
  }
  return { drugs: [...drugs], pathways: [...pathways], genes: [...genes] };
}

// ════════════════════════════════════════════════════════════════════════
// 6. RESEARCH-QUESTION INTENT CLASSIFICATION
//
// Not to be confused with classifyIntent() in search.js, which classifies
// conversation flow (new topic vs. follow-up vs. correction). This
// classifies what KIND of question is being asked about the science itself
// — "does X cause Y" is an etiology question and wants cohort/case-control
// evidence; "does X treat Y" is a treatment question and wants RCTs/
// meta-analyses; "how common is X" is epidemiology and wants prevalence
// studies. Each intent gets a template of hints the orchestration layer can
// use to weight evidence tiers, prefer certain answer structures, or bias
// which sub-queries get fired first.
//
// A query can match more than one pattern (a real question often is more
// than one type at once); classifyResearchIntent() returns ALL matches,
// ranked by how early/specific the trigger phrase was, not just one.
// ════════════════════════════════════════════════════════════════════════

export const INTENT_TEMPLATES = {
  mechanism: {
    label: "Mechanism / how it works",
    preferredEvidence: ["PRECLINICAL", "SYSTEMATIC_REVIEW", "NARRATIVE_REVIEW"],
    answerHint: "Explain the causal chain step by step; molecular/physiological detail is the point, not just the headline finding.",
  },
  treatment: {
    label: "Treatment / efficacy",
    preferredEvidence: ["SYSTEMATIC_REVIEW", "RCT", "COHORT"],
    answerHint: "Lead with the strongest-design evidence available; note effect size and whether findings replicate across trials, not just one study's result.",
  },
  etiology: {
    label: "Cause / risk factor",
    preferredEvidence: ["SYSTEMATIC_REVIEW", "COHORT", "CASE_CONTROL"],
    answerHint: "Distinguish association from causation explicitly; cohort/case-control evidence supports correlation, not proof of cause, unless a trial or Mendelian-randomization design is cited.",
  },
  epidemiology: {
    label: "Prevalence / how common",
    preferredEvidence: ["SYSTEMATIC_REVIEW", "COHORT"],
    answerHint: "Prioritize the largest, most recent population-level estimates; note the population studied (age range, region, year) since prevalence varies by all three.",
  },
  diagnosis: {
    label: "Diagnostic accuracy",
    preferredEvidence: ["SYSTEMATIC_REVIEW", "CASE_CONTROL"],
    answerHint: "Report sensitivity/specificity or diagnostic accuracy metrics where the source gives them, not just whether a test 'works'.",
  },
  prognosis: {
    label: "Prognosis / outcome",
    preferredEvidence: ["COHORT", "SYSTEMATIC_REVIEW"],
    answerHint: "Frame outcomes with their time horizon (5-year survival, recurrence at 1 year) rather than an unqualified outcome claim.",
  },
  comparison: {
    label: "Comparative (X vs Y)",
    preferredEvidence: ["RCT", "SYSTEMATIC_REVIEW", "COHORT"],
    answerHint: "Structure the answer around the comparison directly — what differs, by how much, and how confident the evidence is — rather than describing each side independently.",
  },
  prevention: {
    label: "Prevention",
    preferredEvidence: ["RCT", "SYSTEMATIC_REVIEW", "COHORT"],
    answerHint: "Distinguish primary prevention (before onset) from secondary prevention (after diagnosis, preventing recurrence) since sources for each differ.",
  },
  safety: {
    label: "Safety / adverse effects",
    preferredEvidence: ["SYSTEMATIC_REVIEW", "RCT", "CASE_REPORT"],
    answerHint: "Report absolute risk or incidence where available, not just that a side effect 'can occur' — case reports establish possibility, not frequency.",
  },
  methodology: {
    label: "Methods / how to measure or study something",
    preferredEvidence: ["PRECLINICAL", "NARRATIVE_REVIEW"],
    answerHint: "Focus on the technique itself — what it measures, its limitations, how it compares to alternative methods.",
  },
};

const RESEARCH_INTENT_PATTERNS = [
  { re: /\b(mechanism|how does|how do|why does|why do|pathway|molecular basis|underlying biology)\b/i, key: "mechanism" },
  { re: /\b(treat|treatment|therapy|therapeutic|cure|manage|management of|efficacy|effective(ness)? of|does .+ (help|work|improve))\b/i, key: "treatment" },
  { re: /\b(cause|causes|caused by|risk factor|link(ed)? to|association between|contributes? to|leads? to)\b/i, key: "etiology" },
  { re: /\b(how common|prevalence|incidence|how many people|rate of|epidemiology of|how widespread)\b/i, key: "epidemiology" },
  { re: /\b(diagnos|detect|screening for|test for|biomarker for)\b/i, key: "diagnosis" },
  { re: /\b(prognosis|survival rate|life expectancy|outcome|long-term effects?|recurrence)\b/i, key: "prognosis" },
  { re: /\b(vs\.?|versus|compared to|compare|which is better|difference between)\b/i, key: "comparison" },
  { re: /\b(prevent|prevention|reduce (the )?risk|avoid|protective (against|effect))\b/i, key: "prevention" },
  { re: /\b(side effects?|adverse (effects?|events?|reactions?)|safety of|risks of taking|toxicity of|dangerous)\b/i, key: "safety" },
  { re: /\b(how (is|are|do (you|researchers|scientists)) .*(measure|study|test|analyz|assess)|method(ology)? for|technique for)\b/i, key: "methodology" },
];

/**
 * Classify a research question by type. Returns an array (possibly empty)
 * of { key, ...INTENT_TEMPLATES[key] }, most-specific match first. A query
 * matching nothing returns [] — callers should treat that as "no bias",
 * not as an error; most general-knowledge questions don't fit a clean EBM
 * question type and shouldn't be forced into one.
 */
export function classifyResearchIntent(query) {
  const q = (query || "");
  const hits = [];
  const seen = new Set();
  for (const { re, key } of RESEARCH_INTENT_PATTERNS) {
    if (re.test(q) && !seen.has(key)) {
      seen.add(key);
      hits.push({ key, ...INTENT_TEMPLATES[key] });
    }
  }
  return hits;
}

/**
 * Given a classified study-type key (from classifyStudyType) and the set of
 * preferred evidence types for a research intent (from classifyResearchIntent),
 * return a bonus score — used to nudge ranking toward the evidence type that
 * actually answers the kind of question being asked, on top of the flat
 * evidence-tier weight every paper already gets from EVIDENCE_TIERS.
 */
export function intentEvidenceBonus(studyTypeKey, intents) {
  if (!studyTypeKey || !intents || !intents.length) return 0;
  let bonus = 0;
  for (const intent of intents) {
    if (intent.preferredEvidence && intent.preferredEvidence.includes(studyTypeKey)) {
      bonus += 6;
    }
  }
  return bonus;
}

// ════════════════════════════════════════════════════════════════════════
// 7. STATISTICAL RIGOR DETECTION
//
// classifyStudyType() (section 2) tells you the DESIGN of a study; this
// tells you whether the abstract actually reports the numbers that make a
// result checkable — a sample size, a p-value or confidence interval, an
// effect size — versus asserting a finding in prose with nothing to verify
// it against. Two RCTs of the same design aren't equally strong evidence if
// one reports "n=412, p=0.003, 95% CI 1.2–3.4" and the other just says
// "the treatment group improved significantly." This is a small, honest
// bonus for the former — never a penalty for the latter, since plenty of
// legitimate abstracts (especially older ones, or non-clinical fields where
// this kind of reporting isn't the norm) simply don't include this detail.
// ════════════════════════════════════════════════════════════════════════

const STAT_PATTERNS = {
  pValue: /\bp\s*[<>=]\s*0?\.\d+/i,
  confidenceInterval: /\b(95|90|99)%?\s*ci\b|\bconfidence interval\b/i,
  sampleSize: /\bn\s*=\s*\d+/i,
  effectSize: /\b(odds ratio|hazard ratio|relative risk|cohen'?s d|r\s*=\s*0?\.\d+|β\s*=|standardized mean difference)\b/i,
  percentage: /\b\d{1,3}(\.\d+)?\s*%/,
};

/**
 * Scans an abstract for the hallmarks of a quantitatively reported result.
 * Returns { hits: [...], rigorBonus: number } — rigorBonus caps at 10 so it
 * nudges ranking without ever dominating the topical-relevance score it's
 * added to.
 */
export function detectStatisticalRigor(abstract) {
  const text = abstract || "";
  if (!text) return { hits: [], rigorBonus: 0 };
  const hits = [];
  for (const [key, re] of Object.entries(STAT_PATTERNS)) {
    if (re.test(text)) hits.push(key);
  }
  // A p-value AND a sample size together is the strongest combined signal —
  // weight it a little higher than any single hit alone.
  let rigorBonus = hits.length * 2;
  if (hits.includes("pValue") && hits.includes("sampleSize")) rigorBonus += 2;
  return { hits, rigorBonus: Math.min(rigorBonus, 10) };
}

// ════════════════════════════════════════════════════════════════════════
// 8. CLAIM VERIFICATION (the actual "fact-check pass")
//
// The frontend has had a fact-check toggle and a FactCheck display component
// for a while; the backend never implemented the other half — every response
// hardcoded `factCheck: null` regardless of what the toggle said, so the
// control did nothing. This is the real implementation: a deterministic,
// zero-latency cross-check of the DRAFTED ANSWER against the actual source
// abstracts it was supposed to be grounded in.
//
// What it catches: the answer names a drug, pathway, or gene that appears in
// NONE of the source abstracts/titles — the single most common shape of LLM
// citation-adjacent fabrication (the right general topic, a specific detail
// invented). What it deliberately does NOT try to catch: nuanced factual
// claims, causal language, or numeric precision — those need actual reading
// comprehension, not string matching, and a heuristic that pretended to
// verify them would be worse than not checking at all (false confidence).
// This stays honest about that scope in what it returns.
// ════════════════════════════════════════════════════════════════════════

// An answer routinely defines its own acronym inline — "liquid-liquid phase
// separation (LLPS)" — and then keeps using the short form afterward. The
// bare acronym almost never appears verbatim in a paper's title/abstract
// even when the underlying concept obviously does (the paper says the words
// out; the answer just abbreviates them), so checking only the literal
// 4-letter token systematically misreads that as unsupported. This isn't
// full Schwartz-Hearst-style acronym alignment — it doesn't try to match
// the acronym's letters to the phrase's initials — it just grabs the run of
// words immediately before "(XXXX)" and treats it as a phrase to look up
// too, trying it and its trailing sub-phrases until one lands. Cheap, and
// it's exactly the case that actually shows up in these answers.
const ACRONYM_DEF_RE = /([a-z][a-z\- ]{2,80}?)\s*\(([A-Z]{2,8})\)/gi;

function findAcronymExpansions(text) {
  const map = new Map(); // ACRONYM -> phrase as written just before it
  let m;
  ACRONYM_DEF_RE.lastIndex = 0;
  while ((m = ACRONYM_DEF_RE.exec(text || ""))) {
    const acronym = m[2].toUpperCase();
    if (!map.has(acronym)) map.set(acronym, m[1].trim());
  }
  return map;
}

/** Does a trailing sub-phrase of `rawPhrase` (long to short) show up verbatim
 *  in `haystackLower`? Trimming from the front handles the defining phrase
 *  having swept in extra preceding words (the regex above has no way to know
 *  exactly where the phrase "starts") — the clean core phrase is still in
 *  there as a suffix, so shrinking the window from the front finds it. */
function phraseFoundInText(rawPhrase, haystackLower) {
  const words = rawPhrase.toLowerCase().split(/\s+/).filter(Boolean);
  const maxWin = Math.min(8, words.length);
  for (let n = maxWin; n >= 2; n--) {
    const phrase = words.slice(-n).join(" ");
    if (phrase.length >= 6 && haystackLower.includes(phrase)) return true;
  }
  return false;
}

/**
 * Cross-checks entities named in a drafted answer against the entities
 * actually present in its cited source papers. Returns:
 *   { checked: bool, supported: [...], thin: [...], unsupported: [...], note }
 * `checked: false` means there wasn't enough material to check (no entities
 * detected in the answer at all, or no sources to check against) — this is
 * a normal, common outcome for a purely conceptual/mechanistic answer that
 * never names a specific drug/gene/pathway, NOT a failure. `thin` entries are
 * ones only supported indirectly — the acronym itself isn't in any source,
 * but the phrase the answer used to define it is.
 */
export function verifyAnswerAgainstSources(answerText, papers) {
  const text = answerText || "";
  const answerEntities = extractEntities(text);
  const namedInAnswer = [...answerEntities.drugs, ...answerEntities.pathways, ...answerEntities.genes];
  if (namedInAnswer.length === 0) {
    return { checked: false, unsupported: [], supported: [], thin: [], note: "Answer doesn't name specific drugs, genes, or pathways to check." };
  }
  if (!papers || papers.length === 0) {
    return { checked: false, unsupported: [], supported: [], thin: [], note: "No sources to check the answer against." };
  }
  // NOT lowercased before extraction: extractEntities()'s gene/acronym
  // detection only fires on a token that's ALL CAPS in the text as written
  // (that's the whole signal separating "SARS" from an ordinary word) —
  // lowercase the string first and every acronym vanishes before it's ever
  // looked at, so a source titled "SARS-CoV-2 nucleocapsid protein forms
  // condensates..." would never register as supporting a claim about SARS.
  // extractEntities() already lowercases internally for its drug/pathway
  // matching, and the set comparison below is already case-insensitive, so
  // preserving case here only helps the gene/acronym side — it doesn't cost
  // the other two.
  const sourceText = papers
    .map((p) => ((p && p.title) || "") + " " + ((p && p.abstract) || ""))
    .join(" ");
  const sourceEntities = extractEntities(sourceText);
  const sourceSet = new Set([...sourceEntities.drugs, ...sourceEntities.pathways, ...sourceEntities.genes].map((e) => e.toLowerCase()));
  const sourceTextLower = sourceText.toLowerCase();
  const acronymPhrases = findAcronymExpansions(text);

  const unsupported = [];
  const supported = [];
  const thin = [];
  for (const entity of new Set(namedInAnswer)) {
    if (sourceSet.has(entity.toLowerCase())) { supported.push(entity); continue; }
    const phrase = acronymPhrases.get(entity.toUpperCase());
    if (phrase && phraseFoundInText(phrase, sourceTextLower)) { thin.push(entity); continue; }
    unsupported.push(entity);
  }
  /* Commit 99 — this sentence is the whole panel for most readers, and it
     was overselling what it had done. It used to read "All 3 specific terms
     named in the answer appear in the cited sources", which a reader pairs
     with the big "100%" above it and takes to mean the answer was verified.
     What actually happened is narrower and worth saying out loud: the gene,
     drug and pathway names were pulled out of the answer and looked for in
     the titles and abstracts of the papers it cites. That catches an answer
     citing a paper that has nothing to do with what it just said. It cannot
     tell you the conclusion is right. Both halves of that belong in the
     copy, because the reader's next move depends on which one they think
     they are looking at. */
  const parts = [];
  if (unsupported.length) parts.push(`${unsupported.length === 1 ? "One name, " : `${unsupported.length} names, `}${unsupported.slice(0, 5).join(", ")}, ${unsupported.length === 1 ? "doesn't" : "don't"} turn up in any paper the answer cites. That can mean the answer reached past its sources, or that it attached the wrong citation`);
  if (thin.length) parts.push(`${thin.length === 1 ? "One name is" : `${thin.length} names are`} only an indirect match: the answer writes ${thin.length === 1 ? "it" : "them"} out in full somewhere a source agrees with, but the short form itself never appears`);
  const note = parts.length
    ? parts.join(". ") + "."
    : `Every specific name the answer uses turns up in a paper it cites. That means it is drawing on this evidence rather than reaching past it. It is not a check on whether the conclusions are right.`;
  return { checked: true, unsupported, supported, thin, note };
}
