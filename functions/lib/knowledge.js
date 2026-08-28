// Cerebrum domain-knowledge module.
//
// search.js is the ORCHESTRATION layer — it decides what to fetch, when to
// fall back, how to merge and rank. This file is the KNOWLEDGE layer.

// ════════════════════════════════════════════════════════════════════════
// 0. DATASET & REPOSITORY BLOCKLIST
// Exported for the orchestration layer to explicitly reject non-literature.
// ════════════════════════════════════════════════════════════════════════
export const BLOCKED_DOMAINS = [
  "wwpdb.org", "zenodo.org", "dryad.org", "figshare.com", "osf.io", 
  "clinicaltrials.gov", "data.mendeley.com", "kaggle.com"
];

export const BLOCKED_TYPES = [
  "dataset", "posted-content", "component", "peer-review", "grant"
];

// ════════════════════════════════════════════════════════════════════════
// 1. MESH-STYLE QUERY EXPANSION (MASSIVELY EXPANDED)
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

  // ---- Physics & Astronomy ----
  "quantum entanglement": ["quantum nonlocality", "bell's theorem", "entangled states"],
  "string theory": ["m-theory", "quantum gravity", "superstring theory"],
  "relativity": ["general relativity", "special relativity", "einstein field equations"],
  "dark energy": ["cosmological constant", "vacuum energy", "quintessence"],
  "dark matter": ["cold dark matter", "wimps", "axions"],
  "black hole": ["event horizon", "schwarzschild radius", "supermassive black hole"],
  "big bang": ["cosmic microwave background", "cosmic inflation", "primordial nucleosynthesis"],
  "particle accelerator": ["large hadron collider", "synchrotron", "particle physics"],
  "higg's boson": ["god particle", "higgs mechanism", "standard model"],
  "nuclear fusion": ["magnetic confinement fusion", "tokamak", "inertial confinement"],
  "nuclear fission": ["nuclear reactor", "fissile isotope", "uranium-235"],
  "superconductor": ["high-temperature superconductivity", "cuprate superconductor", "bcs theory", "meissner effect"],
  "thermodynamics": ["entropy", "enthalpy", "second law of thermodynamics"],
  "fluid dynamics": ["navier-stokes equations", "laminar flow", "turbulence"],
  "exoplanet": ["extrasolar planet", "habitable zone", "transit method", "radial velocity"],
  "gravitational waves": ["ligo", "spacetime ripples", "binary black hole merger"],

  // ---- Computer Science, AI, & Engineering ----
  "machine learning": ["deep learning", "predictive modeling", "statistical learning", "neural networks"],
  "artificial intelligence": ["agi", "artificial general intelligence", "computational intelligence"],
  "nlp": ["natural language processing", "computational linguistics", "large language models", "transformers"],
  "cybersecurity": ["information security", "network security", "cryptography", "malware", "zero-day"],
  "blockchain": ["distributed ledger technology", "smart contracts", "cryptocurrency", "consensus algorithm"],
  "cloud computing": ["distributed computing", "serverless architecture", "edge computing"],
  "quantum computing": ["qubit", "quantum supremacy", "quantum error correction", "quantum algorithm"],
  "internet of things": ["iot", "connected devices", "sensor networks"],
  "computer vision": ["image recognition", "object detection", "convolutional neural networks", "cnn"],
  "data mining": ["knowledge discovery", "big data analytics", "pattern recognition"],
  "robotics": ["autonomous systems", "kinematics", "mechatronics"],
  "reinforcement learning": ["q-learning", "markov decision process", "rl"],
  "software engineering": ["agile methodology", "devops", "software architecture", "ci/cd"],
  "microprocessor": ["cpu", "semiconductor device", "integrated circuit", "moore's law"],
  "nanotechnology": ["nanomaterials", "nanoscale engineering", "molecular nanotechnology"],

  // ---- Chemistry & Materials Science ----
  "catalyst": ["catalytic agent", "photocatalyst", "electrocatalyst", "enzymatic catalysis"],
  "polymer": ["macromolecule", "polymeric material", "copolymer", "elastomer", "thermoplastic"],
  "metallic glass": ["amorphous metal", "liquidmetal", "glassy alloy", "bulk metallic glass"],
  "carbon nanotube": ["cnt", "single-walled carbon nanotube", "multi-walled carbon nanotube", "fullerene"],
  "graphene": ["2d carbon", "monolayer graphite", "dirac fermions"],
  "photovoltaic": ["solar cell", "perovskite solar cells", "thin-film solar"],
  "battery": ["lithium-ion", "solid-state battery", "energy storage", "anode", "cathode"],
  "hydrogen storage": ["metal hydrides", "fuel cell", "hydrogen economy"],
  "crystal structure": ["crystallography", "x-ray diffraction", "lattice"],
  "spectroscopy": ["nmr", "mass spectrometry", "infrared spectroscopy", "raman spectroscopy"],
  "chromatography": ["hplc", "gas chromatography", "gel permeation"],
  "green chemistry": ["sustainable chemistry", "solvent-free synthesis", "atom economy"],

  // ---- Earth Science, Ecology, & Environment ----
  "climate change": ["global warming", "anthropogenic climate change", "greenhouse effect"],
  "ocean acidification": ["marine ph decline", "carbonate chemistry shift", "calcification"],
  "coral bleaching": ["coral reef degradation", "zooxanthellae expulsion"],
  "deforestation": ["forest loss", "land use change", "clear-cutting"],
  "microplastics": ["plastic particulate contamination", "nanoplastics", "marine debris"],
  "biodiversity loss": ["species extinction", "biodiversity decline", "habitat fragmentation"],
  "invasive species": ["non-native species", "introduced species", "alien species"],
  "permafrost thaw": ["permafrost degradation", "permafrost carbon release"],
  "wildfire": ["biomass burning", "wildland fire", "pyrogenic carbon"],
  "air pollution": ["particulate matter exposure", "pm2.5", "ambient air pollution", "smog"],
  "soil erosion": ["land degradation", "topsoil loss", "desertification"],
  "groundwater depletion": ["aquifer depletion", "water table decline"],
  "tectonic plates": ["plate tectonics", "continental drift", "subduction zone", "seafloor spreading"],
  "volcano": ["volcanism", "magma", "pyroclastic flow", "volcanic ash"],
  "earthquake": ["seismic activity", "seismology", "fault line"],
  "hurricane": ["tropical cyclone", "typhoon", "cyclogenesis"],

  // ---- Agriculture & Entomology ----
  "pollinator decline": ["pollinator loss", "bee population decline", "colony collapse disorder"],
  "insect decline": ["insect biomass decline", "entomofauna decline"],
  "crop pest": ["agricultural pest", "phytophagous insect"],
  "pesticide resistance": ["insecticide resistance", "acaricide resistance"],
  "beneficial insects": ["biological control agents", "natural enemies"],
  "insect farming": ["insect mass rearing", "entomoculture"],
  "black soldier fly": ["Hermetia illucens", "BSFL", "black soldier fly larvae"],
  "mealworm": ["Tenebrio molitor", "yellow mealworm"],
  "fruit fly": ["Drosophila melanogaster"],
  "genetically modified crop": ["gmo crop", "transgenic crop", "bt cotton", "roundup ready"],
  "vertical farming": ["controlled environment agriculture", "indoor agriculture", "hydroponics", "aeroponics"],
  "soil health": ["soil microbiome", "soil quality", "edaphic factors"],
  "nitrogen fertilizer": ["synthetic fertilizer", "eutrophication", "nitrogen runoff"],

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

  // ---- Lab methods / techniques ----
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
  "brain scan": ["neuroimaging", "MRI brain imaging"],
  "fmri": ["functional magnetic resonance imaging"],
  "eeg": ["electroencephalography", "electroencephalogram"],
  "ct scan": ["computed tomography", "CT imaging"],
  "x-ray": ["radiography", "plain film imaging"],
  "ultrasound imaging": ["sonography", "ultrasonography"],
  "biopsy": ["tissue biopsy", "histopathological sampling"],
  "minimally invasive surgery": ["laparoscopic surgery", "MIS"],
  "robotic surgery": ["robot-assisted surgery"],
  "anesthesia": ["general anesthesia", "anesthetic management"]
};

// Reverse-index lookup
const _MESH_KEYS_BY_LENGTH = Object.keys(MESH_EXPANSIONS).sort((a, b) => b.length - a.length);

export function expandViaMesh(rawQuery) {
  const q = (rawQuery || "").toLowerCase();
  if (!q) return [];
  const out = new Set();
  for (const key of _MESH_KEYS_BY_LENGTH) {
    if (q.indexOf(key) !== -1) {
      for (const syn of MESH_EXPANSIONS[key]) out.add(syn);
    }
  }
  return [...out];
}

// ════════════════════════════════════════════════════════════════════════
// 2. STUDY-TYPE / EVIDENCE-HIERARCHY CLASSIFICATION
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

export function classifyStudyType(title, abstract) {
  const hay = ((title || "") + " " + (abstract || ""));
  for (const { re, key } of STUDY_TYPE_PATTERNS) {
    if (re.test(hay)) return { key, ...EVIDENCE_TIERS[key] };
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════
// 3. JOURNAL QUALITY TIERS
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
    "genome research", "genome biology", "ieee transactions", "nature astronomy"
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

function normalizeJournalName(name) {
  return (name || "").toLowerCase().replace(/[.,;:]+$/g, "").replace(/\s+/g, " ").trim();
}

export function scoreJournalTier(journalName) {
  const norm = normalizeJournalName(journalName);
  if (!norm) return 0;
  if (JOURNAL_TIERS.has(norm)) return _TIER_WEIGHT[JOURNAL_TIERS.get(norm)];
  const noThe = norm.replace(/^the\s+/, "");
  if (noThe !== norm && JOURNAL_TIERS.has(noThe)) return _TIER_WEIGHT[JOURNAL_TIERS.get(noThe)];
  if (JOURNAL_TIERS.has("the " + norm)) return _TIER_WEIGHT[JOURNAL_TIERS.get("the " + norm)];
  return 0;
}

// ════════════════════════════════════════════════════════════════════════
// 4. PREDATORY / QUESTIONABLE PUBLISHER SIGNALS
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
// ════════════════════════════════════════════════════════════════════════

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

const GENE_SYMBOL_STOPLIST = new Set([
  "THE", "AND", "FOR", "WAS", "ARE", "NOT", "BUT", "ALL", "ITS", "WHO", "HOW",
  "WHY", "CAN", "MAY", "USE", "NEW", "OLD", "TWO", "ONE", "OUR", "OUT", "GET",
  "HAS", "HAD", "HIS", "HER", "HIM", "SHE", "YOU", "SET", "TOP", "LOW", "HIGH",
  "USA", "USD", "DNA", "RNA", "PCR", "PhD", "MRI", "CT", "MD", "PET", "III",
  "IV", "II", "VI", "VII", "VIII", "IX", "XI", "XII", "NIH", "FDA", "WHO",
  "CDC", "EU", "UK", "US", "IL", "TNF", "IFN", "IGF",
  "CO2", "CO", "H2O", "O2", "O3", "N2", "N2O", "NO", "NO2", "NO3", "SO2",
  "SO3", "SO4", "NH3", "NH4", "CH4", "H2S", "H2O2", "HCL", "HNO3", "NAOH",
  "KOH", "CACO3", "NACL", "MGCL2", "CACL2", "C2H4", "C6H12O6",
]);
const GENE_SYMBOL_RE = /^[A-Z][A-Z0-9]{1,6}$/;

export function looksLikeGeneSymbol(token) {
  if (!token || GENE_SYMBOL_STOPLIST.has(token)) return false;
  if (!GENE_SYMBOL_RE.test(token)) return false;
  if (token.length === 2) return false;
  return true;
}

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
// ════════════════════════════════════════════════════════════════════════

const STAT_PATTERNS = {
  pValue: /\bp\s*[<>=]\s*0?\.\d+/i,
  confidenceInterval: /\b(95|90|99)%?\s*ci\b|\bconfidence interval\b/i,
  sampleSize: /\bn\s*=\s*\d+/i,
  effectSize: /\b(odds ratio|hazard ratio|relative risk|cohen'?s d|r\s*=\s*0?\.\d+|β\s*=|standardized mean difference)\b/i,
  percentage: /\b\d{1,3}(\.\d+)?\s*%/,
};

export function detectStatisticalRigor(abstract) {
  const text = abstract || "";
  if (!text) return { hits: [], rigorBonus: 0 };
  const hits = [];
  for (const [key, re] of Object.entries(STAT_PATTERNS)) {
    if (re.test(text)) hits.push(key);
  }
  let rigorBonus = hits.length * 2;
  if (hits.includes("pValue") && hits.includes("sampleSize")) rigorBonus += 2;
  return { hits, rigorBonus: Math.min(rigorBonus, 10) };
}

// ════════════════════════════════════════════════════════════════════════
// 8. CLAIM VERIFICATION (FACT-CHECK) - DEEP JUSTIFICATION UPDATE
// ════════════════════════════════════════════════════════════════════════

const ACRONYM_DEF_RE = /([a-z][a-z\- ]{2,80}?)\s*\(([A-Z]{2,8})\)/gi;

function findAcronymExpansions(text) {
  const map = new Map();
  let m;
  ACRONYM_DEF_RE.lastIndex = 0;
  while ((m = ACRONYM_DEF_RE.exec(text || ""))) {
    const acronym = m[2].toUpperCase();
    if (!map.has(acronym)) map.set(acronym, m[1].trim());
  }
  return map;
}

function phraseFoundInText(rawPhrase, haystackLower) {
  const words = rawPhrase.toLowerCase().split(/\s+/).filter(Boolean);
  const maxWin = Math.min(8, words.length);
  for (let n = maxWin; n >= 2; n--) {
    const phrase = words.slice(-n).join(" ");
    if (phrase.length >= 6 && haystackLower.includes(phrase)) return true;
  }
  return false;
}

// Updated to enforce deep paragraph-level justifications, not just passing summaries.
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
  
  const parts = [];
  if (unsupported.length) parts.push(`STRICT EXCLUSION: ${unsupported.length} term(s) (${unsupported.slice(0, 5).join(", ")}) do not appear in any cited abstract. Ensure methodological justification accounts for missing ontology references.`);
  if (thin.length) parts.push(`THIN SUPPORT: ${thin.length} term(s) (${thin.slice(0, 5).join(", ")}) only appear via phrase expansion, not explicit scientific nomenclature.`);
  
  const note = parts.length
    ? parts.join(" ")
    : `All ${supported.length} specific term(s) named in the answer appear in the cited sources. Deep fact-check verified.`;
    
  return { checked: true, unsupported, supported, thin, note };
}
