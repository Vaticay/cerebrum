/**
 * Gate audit honesty (2026-11-16): the audit record must agree
 * with the serve it describes.
 *
 * Two defects, both proven by the 2026-11-15 gate trace against
 * live records, both in the gate audit builder in
 * functions/api/search.js. Neither touches what serves; both
 * are the record lying about what served.
 *
 *   Defect 1 (SLT4): after the rescue fix at 7a79dbf, the salt
 *     question's answer cited the rescued NCCT paper while the
 *     same record's gateAudit still listed that paper in its
 *     excluded array with the floor reasons. The aggregate
 *     counts already skipped papers in the citable set; the
 *     excluded rows loop did not. The list now skips them too:
 *     a paper the run judged citable is not an exclusion.
 *
 *   Defect 2 (MNP2): on the manganese peroxidase measurement
 *     question, the audit listed three papers with standard
 *     true and EMPTY reasons. All three were method tier 0,
 *     the question carries measurement intent, and the method
 *     tier binding emptied the citable set by design (Lane E
 *     fix 3, 2026-11-02: a production paper never serves as
 *     the method answer). The builder never recorded that
 *     cause, and its counts filed the three under the
 *     relevance floor they had in fact cleared. The binding
 *     now names itself: the emptied papers are remembered when
 *     the binding fires, their rows carry the cause, the
 *     counts count them under it, and the no results line
 *     reports the new count in words.
 *
 * The scenarios run the real handler on the specimens' real
 * shelves (titles and abstracts as Europe PMC served them for
 * the 2026-11-15 trace, in
 * ~/workspace/cerebrum-gate-trace-nov15/abstracts.json), with
 * the live draws' own model expansion groups. The SLT4 shelf
 * is trimmed to the survivor plus ten of the collision papers
 * the passes dropped; the survivor's record is abstract less,
 * the shape the live draw scored (proven by elimination in
 * the trace: with its abstract, the live outcome is
 * impossible). Both scenarios were verified to fail on the
 * unfixed tree in exactly the live shapes before the fix.
 *
 * Run with: node tests/gateaudit-honesty-nov16.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const search = await import(join(root, "functions/api/search.js"));
const { onRequest, createSubrequestLedger, buildNoResultsPayload } = search;

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
function group(name) { console.log(`\n${name}`); }

// ── Handler scenario harness (stub env modeled on
// tests/search-wave-ten.mjs) ────────────────────────────────
function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function chatRes(content) { return jsonRes({ choices: [{ message: { content } }] }); }
function rgDb() {
  const st = (sql) => {
    const s = {
      bind: () => s,
      first: async () => {
        if (/CASE WHEN search_slots\.expires_at/.test(sql || "")) return { n: 1 };
        return null;
      },
      all: async () => {
        if (/sqlite_master/.test(sql || "")) {
          return { results: [
            { name: "pro_usage", sql: "CREATE TABLE pro_usage (user_id TEXT NOT NULL, month TEXT NOT NULL, ai_answers INTEGER NOT NULL DEFAULT 0, doc_reads INTEGER NOT NULL DEFAULT 0, flowcharts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month))" },
            { name: "stripe_events", sql: "CREATE TABLE stripe_events (event_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL)" },
            { name: "student_verifications", sql: "CREATE TABLE student_verifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)" },
          ] };
        }
        return { results: [] };
      },
      run: async () => ({ success: true, meta: { changes: 1 } }),
    };
    return s;
  };
  return {
    prepare: (sql) => st(sql),
    batch: async (arr) => (arr || []).map(() => ({ success: true })),
    exec: async () => ({ results: [] }),
  };
}

let scenPapers = [];
let scenGroups = null;

async function runScenario(query) {
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  globalThis.caches = {
    default: { match: async () => undefined, put: async () => {}, delete: async () => false },
  };
  Math.random = () => 0.99;
  globalThis.fetch = async (url, opts2 = {}) => {
    const u = String(url);
    const body = typeof opts2.body === "string" ? opts2.body : "";
    if (u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("api.groq.com") ||
        u.includes("openrouter.ai")) {
      if (body.includes("literature search specialist")) {
        if (!scenGroups) return jsonRes({ error: { message: "rate limited" } }, 429);
        return chatRes(JSON.stringify(scenGroups));
      }
      if (body.includes("relevance validator")) return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      return chatRes("");
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      return jsonRes({ resultList: { result: scenPapers } });
    }
    if (u.includes("api.openalex.org")) return jsonRes({ results: [] });
    if (u.includes("api.semanticscholar.org")) return jsonRes({ data: [] });
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (u.includes("esearch")) return jsonRes({ esearchresult: { idlist: [] } });
      if (u.includes("esummary")) return jsonRes({ result: {} });
      return new Response("", { status: 200 });
    }
    if (u.includes("export.arxiv.org")) return new Response("", { status: 200 });
    return jsonRes({});
  };
  try {
    const ledger = createSubrequestLedger(undefined);
    const env = { DB: rgDb(), OPENROUTER_KEY: "gateaudit-honesty-test-key-123456" };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, settings: {} }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
    return { data };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

const epmc = (id, title, abstractText, citedByCount = 40, pubYear = "2021") => ({
  title,
  doi: "10.1000/gah-" + id,
  pubYear: String(pubYear),
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Recorded Studies",
  abstractText,
});

// ── Specimen fixtures ───────────────────────────────────────
const MNP2_SHELF = [
 {
  "title": "Trait-based analysis of the human skin microbiome.",
  "abstract": "Background The past decade of microbiome research has concentrated on cataloging the diversity of taxa in different environments. The next decade is poised to focus on microbial traits and function. Most existing methods for doing this perform pathway analysis using reference databases. This has both benefits and drawbacks. Function can go undetected if reference databases are coarse-grained or incomplete. Likewise, detection of a pathway does not guarantee expression of the associated function. Finally, function cannot be connected to specific microbial constituents, making it difficult to ascertain the types of organisms exhibiting particular traits-something that is important for understanding microbial success in specific environments. A complementary approach to pathway analysis is to use the wealth of microbial trait information collected over years of lab-based, culture experiments. Methods Here, we use journal articles and Bergey's Manual of Systematic Bacteriology to develop a trait-based database for 971 human skin bacterial taxa. We then use this database to examine functional traits that are over/underrepresented among skin taxa. Specifically, we focus on three trait classes-binary, categorical, and quantitative-and compare trait values among skin taxa and microbial taxa more broadly. We compare binary traits using a Chi-square test, categorical traits using randomization trials, and quantitative traits using a nonparametric relative effects test based on global rankings using Tukey contrasts. Results We find a number of traits that are over/underrepresented within the human skin microbiome. For example, spore formation, acid phosphatase, alkaline phosphatase, pigment production, catalase, and oxidase are all less common among skin taxa. As well, skin bacteria are less likely to be aerobic, favoring, instead, a facultative strategy. They are also less likely to exhibit gliding motility, less likely to be spirillum or rod-shaped, and less likely to grow in chains. Finally, skin bacteria have more difficulty at high pH, prefer warmer temperatures, and are much less resilient to hypotonic conditions. Conclusions Our analysis shows how an approach that relies on information from culture experiments can both support findings from pathway analysis, and also generate new insights into the structuring principles of microbial communities."
 },
 {
  "title": "Effectiveness of antifungal treatments during chytridiomycosis epizootics in populations of an endangered frog.",
  "abstract": "The recently-emerged amphibian chytrid fungus Batrachochytrium dendrobatidis (Bd) has had an unprecedented impact on global amphibian populations, and highlights the urgent need to develop effective mitigation strategies. We conducted in-situ antifungal treatment experiments in wild populations of the endangered mountain yellow-legged frog during or immediately after Bd-caused mass die-off events. The objective of treatments was to reduce Bd infection intensity (\"load\") and in doing so alter frog-Bd dynamics and increase the probability of frog population persistence despite ongoing Bd infection. Experiments included treatment of early life stages (tadpoles and subadults) with the antifungal drug itraconazole, treatment of adults with itraconazole, and augmentation of the skin microbiome of subadults with Janthinobacterium lividum , a commensal bacterium with antifungal properties. All itraconazole treatments caused immediate reductions in Bd load, and produced longer-term effects that differed between life stages. In experiments focused on early life stages, Bd load was reduced in the 2 months immediately following treatment and was associated with increased survival of subadults. However, Bd load and frog survival returned to pre-treatment levels in less than 1 year, and treatment had no effect on population persistence. In adults, treatment reduced Bd load and increased frog survival over the entire 3-year post-treatment period, consistent with frogs having developed an effective adaptive immune response against Bd. Despite this protracted period of reduced impacts of Bd on adults, recruitment into the adult population was limited and the population eventually declined to near-extirpation. In the microbiome augmentation experiment, exposure of subadults to a solution of J. lividum increased concentrations of this potentially protective bacterium on frogs. However, concentrations declined to baseline levels within 1 month and did not have a protective effect against Bd infection. Collectively, these results indicate that our mitigation efforts were ineffective in causing long-term changes in frog-Bd dynamics and increasing population persistence, due largely to the inability of early life stages to mount an effective immune response against Bd. This results in repeated recruitment failure and a low probability of population persistence in the face of ongoing Bd infection."
 },
 {
  "title": "Using comparative genomics to drive new discoveries in microbiology.",
  "abstract": "Bioinformatics looks to many microbiologists like a service industry. In this view, annotation starts with what is known from experiments in the lab, makes reasonable inferences of which genes match other genes in function, builds databases to make all that we know accessible, but creates nothing truly new. Experiments lead, then biocuration and computational biology follow. But the astounding success of genome sequencing is changing the annotation paradigm. Every genome sequenced is an intercepted coded message from the microbial world, and as all cryptographers know, it is easier to decode a thousand messages than a single message. Some biology is best discovered not by phenomenology, but by decoding genome content, forming hypotheses, and doing the first few rounds of validation computationally. Through such reasoning, a role and function may be assigned to a protein with no sequence similarity to any protein yet studied. Experimentation can follow after the discovery to cement and to extend the findings. Unfortunately, this approach remains so unfamiliar to most bench scientists that lab work and comparative genomics typically segregate to different teams working on unconnected projects. This review will discuss several themes in comparative genomics as a discovery method, including highly derived data, use of patterns of design to reason by analogy, and in silico testing of computationally generated hypotheses."
 },
 {
  "title": "Cysteine Dioxygenase Enzyme Activity and Gene Expression in the Dimorphic Pathogenic Fungus Histoplasma capsulatum Is in",
  "abstract": "In the dimorphism (mold/yeast) Histoplasma capsulatum ( Hc ) literature are reports that yeast (the so-called pathogenic form) uniquely expresses a cysteine dioxygenase (CDO, approx. 10,500 dal) activity which the mold morphotype (the so-called saprophytic soil form) does not express (C.F., Kumar et al., Biochem 22, 762, 1983). This yeast-specific CDO activity is postulated to play a critical role in the mold-to-yeast shift. A number of years ago, our lab isolated the gene encoding the Hc cysteine dioxygenase ( CDO1 , Genbank accession AY804144) and noted significant expression in the mold morphotype of several Histoplasma strains and also determined that the predicted protein would be over double the 10,500 dal reported by Kumar et al. Our report demonstrates (in the class 1 Downs strain, the class 2 G271B strain and two Panamanian strains, 184AS and 186AS) that the CDO1 gene is expressed in both the mold and yeast morphotypes and both morphotypes show significant CDO activity. Furthermore, we show via a FLAG-tag analysis that the expressed protein is approximately 24.7 \u00b1 2.4 kd, in agreement with the putative protein sequence (determined from cDNA sequence) which yields 23.8 kd and is consistent with most other eukaryotic CDO enzymes. Additionally, we demonstrate that intracellular cysteine levels are actually significantly higher in the mold form of the two Panamanian strains, 184AS and 186AS, equal in both mold and yeast in the class 1 Downs strain and significantly higher in yeast of the more pathogenic class 2 G217B strain."
 },
 {
  "title": "Probiotics at War Against Viruses: What Is Missing From the Picture?",
  "abstract": "Our world is now facing a multitude of novel infectious diseases. Bacterial infections are treated with antibiotics, albeit with increasing difficulty as many of the more common causes of infection have now developed broad spectrum antimicrobial resistance. However, there is now an even greater challenge from both old and new viruses capable of causing respiratory, enteric, and urogenital infections. Reports of viruses resistant to frontline therapeutic drugs are steadily increasing and there is an urgent need to develop novel antiviral agents. Although this all makes sense, it seems rather strange that relatively little attention has been given to the antiviral capabilities of probiotics. Over the years, beneficial strains of lactic acid bacteria (LAB) have been successfully used to treat gastrointestinal, oral, and vaginal infections, and some can also effect a reduction in serum cholesterol levels. Some probiotics prevent gastrointestinal dysbiosis and, by doing so, reduce the risk of developing secondary infections. Other probiotics exhibit anti-tumor and immunomodulating properties, and in some studies, antiviral activities have been reported for probiotic bacteria and/or their metabolites. Unfortunately, the mechanistic basis of the observed beneficial effects of probiotics in countering viral infections is sometimes unclear. Interestingly, in COVID-19 patients, a clear decrease has been observed in cell numbers of Lactobacillus and Bifidobacterium spp., both of which are common sources of intestinal probiotics. The present review, specifically motivated by the need to implement effective new counters to SARS-CoV-2, focusses attention on viruses capable of co-infecting humans and other animals and specifically explores the potential of probiotic bacteria and their metabolites to intervene with the process of virus infection. The goal is to help to provide a more informed background for the planning of future probiotic-based antiviral research."
 },
 {
  "title": "Advances in S. cerevisiae Engineering for Xylose Fermentation and Biofuel Production: Balancing Growth, Metabolism, and ",
  "abstract": "Genetically engineering microorganisms to produce chemicals has changed the industrialized world. The budding yeast Saccharomyces cerevisiae is frequently used in industry due to its genetic tractability and unique metabolic capabilities. S. cerevisiae has been engineered to produce novel compounds from diverse sugars found in lignocellulosic biomass, including pentose sugars, like xylose, not recognized by the organism. Engineering high flux toward novel compounds has proved to be more challenging than anticipated since simply introducing pathway components is often not enough. Several studies show that the rewiring of upstream signaling is required to direct products toward pathways of interest, but doing so can diminish stress tolerance, which is important in industrial conditions. As an example of these challenges, we reviewed S. cerevisiae engineering efforts, enabling anaerobic xylose fermentation as a model system and showcasing the regulatory interplay's controlling growth, metabolism, and stress defense. Enabling xylose fermentation in S. cerevisiae requires the introduction of several key metabolic enzymes but also regulatory rewiring of three signaling pathways at the intersection of the growth and stress defense responses: the RAS/PKA, Snf1, and high osmolarity glycerol (HOG) pathways. The current studies reviewed here suggest the modulation of global signaling pathways should be adopted into biorefinery microbial engineering pipelines to increase efficient product yields."
 },
 {
  "title": "Conducting lab safety audits in a small college",
  "abstract": ""
 },
 {
  "title": "The absolute stereochemistry of pamamycin-607, an aerial mycelium-inducing substance of Streptomyces alboniger",
  "abstract": ""
 },
 {
  "title": "Biological Activity of Resveratrol, a Stilbenic Compound from Grapevines, Against Botrytis cinerea, the Causal Agent for",
  "abstract": ""
 }
];
const SLT4_SHELF = [
 {
  "title": "Left Atrial Appendage Occlusion during Cardiac Surgery to Prevent Stroke.",
  "abstract": "Atrial fibrillation accounts for 1/6 of all strokes, potentially leading to significant disability and death. The left atrial appendage (LAA) is the primary location for thrombus formation. Excluding the LAA has been hypothesized to decrease the risk of ischemic stroke. This study examines LAA occlusion (LAAO) with otherwise indicated cardiac surgery and its effect on surgical outcomes. We followed the standards recommended by the Cochrane Collaborative Group and Preferred Reporting Items for Systematic Reviews and Meta-Analyses (PRISMA) checklist to prepare this systematic review and meta-analysis. Studies were retrieved through an online bibliographic search, studies were screened, and data were extracted. We compared the 2 study arms (LAAO and cardiac surgery without LAAO). A total of 10 studies have been included in this study, and 6 randomized controlled trials were included in the meta-analysis, with data pooled from over 10,000 patients. LAAO is associated with no significant difference in the overall mortality (p = 0.98) and systemic embolism (p = 0.31). Strokes, particularly, ischemic strokes, have significantly lower risk in patients who underwent LAAO (p <0.0001 and p = 0.0007), respectively. In conclusion, LAAO can be done safely as a concomitant surgery with other cardiac surgeries, with a minimal incremental cost when performed concurrently. LAAO is associated with a lower risk of all stroke and ischemic strokes. Further studies are needed to shape guidance on the continuation versus discontinuation of anticoagulation after LAAO, especially in patient populations with a higher risk of bleeding."
 },
 {
  "title": "Ultra-processed food consumption and the risk of overweight and obesity in adolescents: A systematic review and meta-ana",
  "abstract": "Introduction Overweight and obesity during early life increase the risk of premature morbidity and mortality. Adolescent obesity raises the likelihood of developing cardiovascular risk factors, including prediabetes, type 2 diabetes, dyslipidemia, hypertension, liver disease, and metabolic syndrome. Sedentary lifestyles and unhealthy diets are major contributors, with one of the fastest-growing unhealthy eating patterns being the consumption of ultra-processed foods (UPFs). No systematic review and meta-analysis has specifically examined the association between UPF consumption and overweight/obesity in adolescents. Objective To systematically review and conduct a meta-analysis of available evidence on the association between UPF consumption and overweight or obesity among adolescents. Methods We searched PubMed, ScienceDirect, HINARI, Google, and Google Scholar for primary studies reporting UPF consumption and overweight/obesity outcomes in adolescents, without restrictions on language or study period. Study quality was assessed using the Newcastle\u2013Ottawa Scale. Heterogeneity was evaluated using Cochrane\u2019s Q test and the I\u00b2 statistic. Publication bias and small-study effects were assessed using Egger\u2019s regression test (p &lt; 0.05). A random-effects model estimated pooled associations. Results Twenty-three studies involving 155,000 adolescents were included. Adolescents with higher UPF consumption had 63% greater odds of overweight or obesity compared with those with lower intake (OR = 1.63; 95% CI: 1.36\u20131.95). Conclusion High UPF consumption is associated with an increased risk of overweight and obesity among adolescents. Public health strategies targeting reduced UPF intake and promotion of healthier diets should be prioritized to prevent adolescent overweight/obesity and associated health risks."
 },
 {
  "title": "Transcatheter Valve Repair in Heart Failure with Moderate to Severe Mitral Regurgitation.",
  "abstract": "Background Whether transcatheter mitral-valve repair improves outcomes in patients with heart failure and functional mitral regurgitation is uncertain. Methods We conducted a randomized, controlled trial involving patients with heart failure and moderate to severe functional mitral regurgitation from 30 sites in nine countries. The patients were assigned in a 1:1 ratio to either transcatheter mitral-valve repair and guideline-recommended medical therapy (device group) or medical therapy alone (control group). The three primary end points were the rate of the composite of first or recurrent hospitalization for heart failure or cardiovascular death during 24 months; the rate of first or recurrent hospitalization for heart failure during 24 months; and the change from baseline to 12 months in the score on the Kansas City Cardiomyopathy Questionnaire-Overall Summary (KCCQ-OS; scores range from 0 to 100, with higher scores indicating better health status). Results A total of 505 patients underwent randomization: 250 were assigned to the device group and 255 to the control group. At 24 months, the rate of first or recurrent hospitalization for heart failure or cardiovascular death was 37.0 events per 100 patient-years in the device group and 58.9 events per 100 patient-years in the control group (rate ratio, 0.64; 95% confidence interval [CI], 0.48 to 0.85; P = 0.002). The rate of first or recurrent hospitalization for heart failure was 26.9 events per 100 patient-years in the device group and 46.6 events per 100 patient-years in the control group (rate ratio, 0.59; 95% CI, 0.42 to 0.82; P = 0.002). The KCCQ-OS score increased by a mean (\u00b1SD) of 21.6\u00b126.9 points in the device group and 8.0\u00b124.5 points in the control group (mean difference, 10.9 points; 95% CI, 6.8 to 15.0; P Conclusions Among patients with heart failure with moderate to severe functional mitral regurgitation who received medical therapy, the addition of transcatheter mitral-valve repair led to a lower rate of first or recurrent hospitalization for heart failure or cardiovascular death and a lower rate of first or recurrent hospitalization for heart failure at 24 months and better health status at 12 months than medical therapy alone. (Funded by Abbott Laboratories; RESHAPE-HF2 ClinicalTrials.gov number, NCT02444338.)."
 },
 {
  "title": "Long-term use of ticagrelor in patients with prior myocardial infarction.",
  "abstract": "Background The potential benefit of dual antiplatelet therapy beyond 1 year after a myocardial infarction has not been established. We investigated the efficacy and safety of ticagrelor, a P2Y12 receptor antagonist with established efficacy after an acute coronary syndrome, in this context. Methods We randomly assigned, in a double-blind 1:1:1 fashion, 21,162 patients who had had a myocardial infarction 1 to 3 years earlier to ticagrelor at a dose of 90 mg twice daily, ticagrelor at a dose of 60 mg twice daily, or placebo. All the patients were to receive low-dose aspirin and were followed for a median of 33 months. The primary efficacy end point was the composite of cardiovascular death, myocardial infarction, or stroke. The primary safety end point was Thrombolysis in Myocardial Infarction (TIMI) major bleeding. Results The two ticagrelor doses each reduced, as compared with placebo, the rate of the primary efficacy end point, with Kaplan-Meier rates at 3 years of 7.85% in the group that received 90 mg of ticagrelor twice daily, 7.77% in the group that received 60 mg of ticagrelor twice daily, and 9.04% in the placebo group (hazard ratio for 90 mg of ticagrelor vs. placebo, 0.85; 95% confidence interval [CI], 0.75 to 0.96; P=0.008; hazard ratio for 60 mg of ticagrelor vs. placebo, 0.84; 95% CI, 0.74 to 0.95; P=0.004). Rates of TIMI major bleeding were higher with ticagrelor (2.60% with 90 mg and 2.30% with 60 mg) than with placebo (1.06%) (P Conclusions In patients with a myocardial infarction more than 1 year previously, treatment with ticagrelor significantly reduced the risk of cardiovascular death, myocardial infarction, or stroke and increased the risk of major bleeding. (Funded by AstraZeneca; PEGASUS-TIMI 54 ClinicalTrials.gov number, NCT01225562.)."
 },
 {
  "title": "EASY-WPW: a novel ECG-algorithm for easy and reliable localization of manifest accessory pathways in children and adults",
  "abstract": "Aims Accessory pathway (AP) ablation is a standard procedure for the treatment of Wolff-Parkinson-White syndrome (WPW). Twelve-lead electrocardiogram (ECG)-based delta wave analysis is essential for predicting ablation sites. Previous algorithms have shown to be complex, time-consuming, and unprecise. We aimed to retrospectively develop and prospectively validate a new, simple ECG-based algorithm considering the patients' heart axis allowing for exact localization of APs in patients undergoing ablation for WPW. Methods and results Our multicentre study included 211 patients undergoing ablation of a single manifest AP due to WPW between 2013 and 2021. The algorithm was developed retrospectively and validated prospectively by comparing its efficacy to two established ones (Pambrun and Arruda). All patients (32 \u00b1 19 years old, 47% female) underwent successful pathway ablation. Prediction of AP-localization was correct in 197 patients (93%) (sensitivity 92%, specificity 99%, PPV 96%, and NPV 99%). Our algorithm was particularly useful in correctly localizing antero-septal/-lateral (sensitivity and specificity 100%) and posteroseptal (sensitivity 98%, specificity 92%) AP in proximity to the tricuspid valve. The accuracy of EASY-WPW was superior compared to the Pambrun (93% vs. 84%, P = 0.003*) and the Arruda algorithm (94% vs. 75%, P 0.8; P Conclusion The novel EASY-WPW algorithm provides reliable and accurate pre-interventional ablation site determination in WPW patients. Only two steps are necessary to locate left-sided AP, and three steps to determine right-sided AP."
 },
 {
  "title": "Proactive Management and Treatment of Aortic Stenosis: An International Expert Perspective.",
  "abstract": "The 2025 European Society of Cardiology/European Association for Cardio-Thoracic Surgery guidelines mark a pivotal change, challenging the paradigm of symptom-driven watchful waiting, and supporting earlier treatment in many patients with asymptomatic severe aortic stenosis. Building on this foundation, this international expert perspective advocates a comprehensive, proactive management strategy and offers clinicians a contemporary operational framework for managing severe aortic stenosis. Key evidence-based elements include early referral to the multidisciplinary Heart Valve Team, streamlined evaluation, upstream testing, prompt aortic valve replacement in many asymptomatic patients, more urgent treatment for symptomatic patients, and structured surveillance involving close working relationships between the referring clinician and Heart Valve Team when intervention is deferred. This proactive evidence-based model aims to improve timeliness, efficiency, and equity of care, thereby reducing preventable morbidity and mortality and improving long-term outcomes."
 },
 {
  "title": "The DASH diet in diabetes related complications or comorbidities: an unexpected friend.",
  "abstract": "The global epidemic of diabetes and its complications poses a serious challenge to public health. Metabolic disorders and chronic hyperglycemia drive multi-system damage. The application of Dietary Approaches to Stop Hypertension (DASH) diet has been extended from hypertension management to multi-dimensional integrated prevention and treatment of diabetes. DASH diet significantly reduces the risk of type 2 diabetes by optimizing blood glucose homeostasis, reducing hemoglobin A1c (HbA1c), improving insulin sensitivity and insulin resistance, regulating lipid metabolism, and inhibiting oxidative stress and inflammation. In terms of management of complications, the DASH diet reduces the risk of diabetic nephropathy and delays decline of renal function. Its antihypertensive effect and improvement in arterial elasticity synergistically reduce the risk of cardiovascular events. The diet has also shown regulatory potential for metabolic abnormalities in polycystic ovary syndrome and microvascular damage in diabetic retinopathy. The DASH diet is suitable for long-term health management due to its advantages of standardized regimens and multi-target metabolic regulation. Future research needs to focus on molecular mechanisms, individual application optimization, and cross-disease synergies to strengthen the scientific basis and practical value in the comprehensive management of diabetes. This review discusses the multiple abilities by which the DASH diet provides comprehensive protection against diabetes and its complications or comorbidities."
 },
 {
  "title": "Nutrition Transition, Processed Foods, and Cardiometabolic Risk in Somalia: A Public Health Commentary.",
  "abstract": "Background Somalia is undergoing a nutrition transition in which traditional camel milk, sorghum, and legume-centred diets are being progressively displaced by imported processed foods high in refined sugars, saturated fats, and dietary cholesterol. This shift is occurring in a population already burdened by undernutrition and a fragile health system. Purpose This narrative commentary synthesises published evidence on the biochemical mechanisms linking excess sugar and cholesterol intake to dyslipidaemia, type 2 diabetes mellitus (T2DM), and cardiovascular disease, and considers how these mechanisms may apply to the Somali context. Discussion Globalisation, conflict-driven displacement, urbanisation, and food-import dependency are identified as structural drivers of the transition, though their interaction with Somalia's cyclical droughts and fragmented governance is likely to produce a trajectory distinct from that of more institutionally stable settings. The biological mechanisms by which added sugars, refined carbohydrates, and dietary fats promote insulin resistance, dyslipidaemia, and systemic inflammation are well established in the global literature; direct epidemiological evidence from Somalia itself remains largely absent, and this commentary draws cautiously on data from Somaliland, Djibouti, Morocco, and other comparator settings to illustrate a plausible-rather than confirmed-trajectory for Somalia. Conclusion Multi-sectoral action encompassing nutrition policy, food-system investment, community education, and health-system capacity building, sequenced according to feasibility in a resource-constrained and politically fragmented setting, is needed to reduce the risk of an entrenched NCD epidemic. Integrating traditional Somali dietary practices with evidence-based nutrition guidance offers a culturally grounded starting point, although traditional diets are not uniformly protective and require region-specific characterisation."
 },
 {
  "title": "Salt release from potato crisps",
  "abstract": "The rate of salt release in-mouth from salted potato crisps was evaluated. It was hypothesised that a slow steady release of sodium would occur on chewing and hydration; to test this a crisp was chewed and held in the oral cavity without swallowing for 60 s. Sodium release was measured over the entire holding period, after 20-30 s a peak in salivary sodium levels was recorded. A similar trend was observed with sensory perceived saltiness by trained panellists. The results suggest that a significant proportion of the crisp's salt flavouring is released in a pulse-type mechanism which would not be encountered when the crisp is exposed to normal eating patterns and would result in the consumption of a large proportion of unperceived sodium."
 },
 {
  "title": "Get Out the Potato Chips Again\u2014Sodium May Be Good for You",
  "abstract": ""
 },
 {
  "title": "Hypertension, Dietary Salt Intake, and the Role of the Thiazide-Sensitive Sodium Chloride Transporter NCCT",
  "abstract": ""
 }
];
const NCCT_TITLE = "Hypertension, Dietary Salt Intake, and the Role of the Thiazide-Sensitive Sodium Chloride Transporter NCCT";

// ═══════════════════════════════════════════════════════════
group("MNP2 — the method tier binding names itself in the audit");

let mnp2 = null;
{
  scenPapers = MNP2_SHELF.map((p, i) => epmc("m" + i, p.title, p.abstract));
  scenGroups = [
    { term: "lab people", alternates: ["lab staff", "laboratory personnel", "experimentalists"] },
    { term: "fungus", alternates: ["fungi", "mold", "yeast", "mycelium", "microfungi"] },
    { term: "chemical", alternates: ["compound", "reagent", "substance", "chemical agent", "chemical compound"] },
    { term: "doing", alternates: ["performing", "conducting", "executing", "carrying out", "implementing"] },
  ];
  mnp2 = (await runScenario("in the lab, how do people tell how much work that fungus chemical is doing")).data;
}

await test("the binding still binds: the run serves no results and cites nothing", () => {
  assert.equal(mnp2.responseKind, "no-results",
    "the measurement run no longer lands in no results: " + mnp2.responseKind);
  assert.ok((mnp2.sources || []).every((s) => !s.cited),
    "a tier 0 paper shipped as cited on a measurement question");
  const ga = mnp2._record && mnp2._record.gateAudit;
  assert.ok(ga, "the record carries no gate audit for the binding emptied run");
  assert.equal(ga.citableBefore, 0, "citableBefore is not the post binding zero");
});

await test("each binding emptied specimen row carries the method tier cause", () => {
  const ga = mnp2._record.gateAudit;
  const specimens = [
    "Trait-based analysis of the human skin microbiome.",
    "Using comparative genomics to drive new discoveries in microbiology.",
    "Cysteine Dioxygenase Enzyme Activity and Gene Expression in the Dimorphic Pathogenic Fungus",
  ];
  for (const title of specimens) {
    const row = ga.excluded.find((e) => e.title.startsWith(title.slice(0, 40)));
    assert.ok(row, "the specimen is missing from the audit: " + title);
    assert.equal(row.standard, true, "the specimen no longer reads standard true: " + title);
    assert.ok(row.reasons.some((r) => /method tier binding/.test(r)),
      "the specimen row does not name the method tier binding: " + JSON.stringify(row.reasons));
  }
});

await test("no standard true row in the audit has an empty reason list", () => {
  const ga = mnp2._record.gateAudit;
  const bare = ga.excluded.filter((e) => e.standard === true && (!Array.isArray(e.reasons) || e.reasons.length === 0));
  assert.equal(bare.length, 0,
    "standard true rows with empty reasons remain: " + JSON.stringify(bare.map((e) => e.title)));
});

await test("the no results line counts the binding emptied papers under their own cause", () => {
  assert.ok(/3 papers cleared the citation standard but were withheld by the method tier binding on a measurement question/.test(String(mnp2.answer || "")),
    "the answer's accounting does not name the method tier binding count: " + String(mnp2.answer || "").slice(0, 600));
});

// ═══════════════════════════════════════════════════════════
group("SLT4 — a paper the run cites is never listed as excluded");

let slt4 = null;
{
  scenPapers = SLT4_SHELF.map((p, i) => epmc("s" + i, p.title, p.abstract));
  scenGroups = [
    { term: "white stuff", alternates: ["refined flour", "white flour", "all-purpose flour", "plain flour"] },
    { term: "chips", alternates: ["potato chips", "crisps", "fried potato slices", "potato crisps"] },
    { term: "salt", alternates: ["sodium chloride", "table salt", "nacl", "salt content", "blood pressure", "serum sodium"] },
    { term: "junk food", alternates: ["processed food", "high-calorie food", "energy-dense food", "fast food", "waist circumference", "lipid profile"] },
    { term: "bad", alternates: ["bads"] },
    { term: "but", alternates: ["buts"] },
    { term: "say", alternates: [] },
    { term: "problem", alternates: [] },
  ];
  slt4 = (await runScenario("people say the white stuff on chips is bad for your heart, but is the problem the salt itself or just junk food in general")).data;
}

await test("the rescued paper is citable and the record cites it", () => {
  const ga = slt4._record && slt4._record.gateAudit;
  assert.ok(ga, "the record carries no gate audit for the one citable run");
  assert.equal(ga.citableBefore, 1, "the specimen no longer reproduces at citableBefore 1");
  const cited = ((slt4._record || {}).sources || []).filter((s) => s.cited);
  assert.ok(cited.some((s) => String(s.title || "").startsWith(NCCT_TITLE.slice(0, 40))),
    "the record does not cite the rescued paper: " + JSON.stringify(cited.map((s) => s.title)));
});

await test("the cited paper does not appear in the audit's excluded list", () => {
  const ga = slt4._record.gateAudit;
  assert.ok(!ga.excluded.some((e) => e.title.startsWith(NCCT_TITLE.slice(0, 40))),
    "the audit still lists the cited paper as excluded: " + JSON.stringify(ga.excluded.map((e) => e.title)));
});

await test("no excluded row names any paper the record cites", () => {
  const ga = slt4._record.gateAudit;
  const citedHeads = new Set(((slt4._record || {}).sources || []).filter((s) => s.cited).map((s) => String(s.title || "").slice(0, 40)));
  const clash = ga.excluded.filter((e) => citedHeads.has(String(e.title || "").slice(0, 40)));
  assert.equal(clash.length, 0,
    "the audit excludes papers the same record cites: " + JSON.stringify(clash.map((e) => e.title)));
});

// ═══════════════════════════════════════════════════════════
group("The no results payload — the new count in words, the old line untouched without it");

await test("a method tier binding count is reported in the withheld line", () => {
  const p = buildNoResultsPayload({
    query: "how do people tell how much work that fungus chemical is doing",
    sourcesQueried: [{ name: "Europe PMC", ok: true }],
    rungsTried: ["exact"],
    gatedOut: 6,
    gatedExamples: ["Using comparative genomics to drive new discoveries in microbiology."],
    gatheredCount: 23,
    exclusionReasonCounts: { belowFloor: 0, noConcept: 1, shortOfStandard: 1, applicationOnly: 1, methodTierBinding: 3 },
  });
  const line = p.whatWasTried.find((w) => /cited none/.test(w));
  assert.ok(line, "no withheld line in the payload: " + JSON.stringify(p.whatWasTried));
  assert.ok(/3 papers cleared the citation standard but were withheld by the method tier binding on a measurement question/.test(line),
    "the method tier binding count is missing from the line: " + line);
  assert.ok(!/below the relevance floor/.test(line),
    "papers that cleared the floor are filed under it: " + line);
});

await test("without the binding count the withheld line keeps its prior shape", () => {
  const p = buildNoResultsPayload({
    query: "if baby black soldier flies eat used cooking oil from restaurants do they turn out healthy",
    sourcesQueried: [{ name: "Europe PMC", ok: true }],
    rungsTried: ["exact"],
    gatedOut: 12,
    gatedExamples: ["Waste oil substrates reshape the black soldier fly larval gut microbiome"],
    gatheredCount: 34,
    exclusionReasonCounts: { belowFloor: 3, noConcept: 5, shortOfStandard: 4, applicationOnly: 0 },
  });
  const line = p.whatWasTried.find((w) => /cited none/.test(w));
  assert.ok(line, "no withheld line in the payload");
  assert.ok(/3 papers scored below the relevance floor/.test(line), "the below floor count moved: " + line);
  assert.ok(!/method tier binding/.test(line), "the binding is named where it never fired: " + line);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
