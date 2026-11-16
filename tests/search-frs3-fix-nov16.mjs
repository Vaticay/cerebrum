/**
 * FRS3 retrieval fix proofs (2026-11-16).
 *
 * Spec: the citation gate trace (~/workspace/cerebrum
 * -gate-trace-nov15/report.md), specimen FRS3, "does sugar
 * make kids hyper". The gate cleared all nine shelf papers
 * correctly; the failure was upstream. The answering
 * literature (the sucrose challenge trials, the Wolraich
 * 1995 meta analysis) was never gathered: only 2 of 14
 * databases answered that draw, the model expansion leg did
 * not fire, and the deterministic fallback carried "hypers"
 * for hyper and nothing at all for sugar, because neither
 * concept had a hand group.
 *
 * The fix is vocabulary only, in the salt pattern: two hand
 * groups in CONCEPT_GROUPS, headed by the asker's own words.
 * The sugar group's members are the substance's own forms.
 * The hyperactivity group carries the behaviour and
 * activity vocabulary the sucrose challenge literature
 * measures the concept in, typed RELATED in
 * CONCEPT_GROUP_RELATIONS, so those members widen gathering
 * (rungs, filter accept sets, the concept expanded fallback)
 * and never count as gate satisfaction: on the specimen's
 * own shelf, three beverage papers use "behavior" for
 * planned behaviour theory, parent modelling, and
 * consumption behaviour, and two sit inside the rescue band.
 * The gate set for the concept is its own three words.
 *
 * Pins below: the resolution and byte exact rungs for three
 * plain phrasings, the typed gate sets (the pre existing
 * entries byte for byte, so this wave cannot loosen them),
 * the nine specimen shelf papers refused on the same
 * engagement counts the live draw recorded, the two prefix
 * collisions engaging at most one concept and clearing, the
 * merely related guards (glucose is not sugar, attention is
 * not hyperactivity), and the answering papers: the 1994
 * sucrose trial clears the standard, the 1995 meta analysis
 * survives the topic filter to the shelf.
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  buildStructuredQuery, buildDeterministicFallbackGroups,
  questionConceptGroups, gateConceptSetFor, citationGateStandard,
  gateJudgedConcepts, paperClearsCitationGate, paperIsCitable,
  conceptGateContext, centralConceptHits, paperConceptGroupHits,
  topicOverlapFilter,
} = await import(join(root, "functions/api/search.js"));

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  PASS", name);
  } catch (e) {
    failures.push(name + ": " + String(e && e.message || e).split("\n").slice(0, 3).join(" | "));
    console.log("  FAIL", name, "-", String(e && e.message || e).split("\n")[0]);
  }
}
function group(label) { console.log("\n== " + label); }

const FRS3 = "does sugar make kids hyper";
const FRS3B = "does eating sugar make children hyperactive";
const FRS3C = "can sugar make my kid hyperactive";

const SUGAR_GROUP = ["sugar", "sugars", "sucrose", "table sugar", "dietary sugar",
  "added sugar", "added sugars", "sugar intake", "sugary"];
const HYPER_GROUP = ["hyper", "hyperactivity", "hyperactive", "behavior", "behaviour",
  "behavioral", "behavioural", "activity level", "activity levels"];
const SUGAR_RUNG = "(sugar OR \"table sugar\" OR \"dietary sugar\" OR \"added sugar\" OR \"added sugars\" OR \"sugar intake\" OR sugars)";

/* The Nov 15 live shelf, titles from the batch payload and
 * abstracts as the gate trace fetched them (Europe PMC,
 * Crossref, OpenAlex; empty where no source carried one,
 * the same record shape the live draw scored). */
const SHELF = [
  {
    "title": "“Your Body Feels Better When You Drink Water”: Parent and School-Age Children’s Sugar-Sweetened Beverage Cognitions",
    "abstract": "Sugar-sweetened beverages (SSBs) are a leading source of added sugar in the American diet. Further, ingestion of added sugars from SSBs exceeds recommendations. Thus, interventions that effectively reduce SSB consumption are needed. Focus group discussions with parents (<i>n</i> = 37) and school-aged children between the ages of 6 and 11 years (<i>n</i> = 41) from Florida, New Jersey, and West Virginia were led by trained moderators using Social Cognitive Theory as a guide. Trends and themes that emerged from the content analysis of the focus group data indicated that both parents and children felt that limiting SSBs was important to health and weight control. However, parents and children reported consuming an average of 1.85 ± 2.38 SD and 2.13 ± 2.52 SD SSB servings/week, respectively. Parents and children were aware that parent behaviors influenced kids, but parents reported modeling healthy SSB behaviors was difficult. Busy schedules, including more frequent parties and events as children get older, were another barrier to limiting SSBs. Parents were most successful at limiting SSBs when they were not in the house. This qualitative research provides novel insights into parents' and children's cognitions (e.g., beliefs, attitudes), barriers, and facilitators related to SSB ingestion. Consideration of these insights during nutrition intervention development has the potential to improve intervention effectiveness in reducing SSB intake.",
    "year": "2018",
    "doi": "10.3390/nu10091232"
  },
  {
    "title": "Hyper Triglyceridemia Induced Pancreatitis in Children with Diabetic Ketoacidosis",
    "abstract": "",
    "year": "",
    "doi": ""
  },
  {
    "title": "“It's junk food and chicken nuggets”: Children's perspectives on ‘kids' food’ and the question of food classification",
    "abstract": "",
    "year": "",
    "doi": ""
  },
  {
    "title": "Validity and Reliability of a Food Frequency Questionnaire (NFFQ-Kids) to Assess Food Consumption Based on the Nova Clas",
    "abstract": "Background/Objectives: There is a lack of food frequency questionnaires (FFQs) specifically designed to assess food consumption based on processing levels in younger populations. This study evaluates the validity and the reliability of a 107-item FFQ (NFFQ-Kids) in estimating the intake (g/day) and the weight and energy ratios of Nova groups in Italian children and adolescents aged 2–18 years. Methods: The NFFQ-Kids was administered twice (T0 and T1), with a four-week interval. A total of 73 participants completed the questionnaire at T0, and 53 completed it at T1. Participants were selected from the ICARO Study (December 2023–April 2024), a web-based cohort study in Southern Italy. Questionnaire validity was assessed by comparison with a 3-day food record (two weekdays and one weekend day) collected between the two NFFQ-Kids administrations. Test–retest reliability was evaluated to assess the consistency of the questionnaire over time. Results: A moderate correlation was found between the NFFQ-Kids and the 3-day food record for the energy ratio of ultra-processed foods (UPFs) (r = 0.48; p &lt; 0.001; ICC = 0.46; 95% CI 0.29–0.64) and the weight ratio for both unprocessed or minimally processed foods (r = 0.49; p &lt; 0.001; ICC = 0.50; 95%CI 0.33–0.66) and ultra-processed foods (UPFs) (r = 0.58; p &lt; 0.001; ICC = 0.58; 95%CI 0.42–0.72). Overall, the NFFQ-Kids showed good test–retest reliability across all Nova group intakes, total food, and relative energy and weight ratios of UPFs (r = 0.71, ICC = 0.67; and r = 0.79, ICC = 0.67, respectively), indicating stable measurements over time. Conclusions: The NFFQ-Kids demonstrated acceptable validity and good reliability, proving useful for assessing food intake by processing level in Italian youth.",
    "year": "",
    "doi": "10.3390/nu17233751"
  },
  {
    "title": "A Qualitative Study of Adolescent Views of Sugar-Sweetened Beverage Taxes, Michigan, 2014",
    "abstract": "<h4>Introduction</h4>We conducted a qualitative study to gather information on adolescent views of how a 20% tax on sugar-sweetened beverages (SSBs) would affect adolescents' consumption of SSBs. The role of habit in consumption of SSBs was also explored.<h4>Methods</h4>We held 3 focus groups with students from various racial/ethnic groups (N = 22) in grades 6 through 8 at a Michigan middle school. Data on demographic characteristics and beverage consumption were collected. Focus group discussions, guided by the Theory of Planned Behavior, explored adolescent views of a 20% tax on SSBs and the tax's effect on adolescents' consumption of these beverages. Focus groups were recorded and recordings transcribed verbatim. Data were coded and analyzed using NVivo software.<h4>Results</h4>Students understood the short- and long-term advantages and disadvantages of drinking SSBs. They understood that the opinions of those around them about SSBs might be affected by personal consumption. Students also understood the personal and economic effects of a 20% tax on SSBs, although the economics of a tax confused some. Students indicated that habit and environment could make reducing consumption of SSBs difficult, but they also gave suggestions, using habit and environment, to reduce consumption. Most students reported that they would decrease their consumption of SSBs if a 20% tax were implemented.<h4>Conclusion</h4>Taxes on SSBs could be used, with other strategies, to reduce adolescents' high level of SSB consumption.",
    "year": "2016",
    "doi": "10.5888/pcd13.150543"
  },
  {
    "title": "THE FUNCTIONAL PATHOLOGY OF HYPER-PARATHYROIDISM",
    "abstract": "",
    "year": "1930",
    "doi": "10.1172/jci100291"
  },
  {
    "title": "Perceptions of sugar-sweetened beverages among adolescents in North Carolina",
    "abstract": "<h4>Introduction</h4>Sugar-sweetened beverage (SSB) consumption among adolescents contributes to diet-related chronic disease including obesity, type 2 diabetes, and poor oral health.<h4>Objective</h4>To better understand adolescents' perceptions, attitudes, and consumption behaviors around SSBs by conducting virtual workshop discussions with adolescents in NC.<h4>Materials and methods</h4>Adolescents ages 11-17 in communities with a high proportion of Supplemental Nutrition Assistance Program (SNAP) eligible households were selected to participate in a series of virtual group workshops during summer 2021. A semi-structured discussion guide was used by a workshop facilitator. Workshop discussions centered around general health perceptions, SSB perceptions, and consumption behaviors. A thematic analysis was used to summarize knowledge, beliefs, attitudes, and perceptions around SSBs.<h4>Results</h4>Approximately 36 adolescents participated across four group workshops. Parents and caregivers influenced adolescents most when it came to making beverage choices. Positive SSB perceptions included liking the taste and the association with special times and social events. Negative opinions focused on associated health risks (diet-related chronic disease and poor oral health). Some adolescents acknowledged SSBs were not healthy but suggested they could be consumed occasionally. Very few participants mentioned any benefits from SSBs; those that mentioned benefits stated they provided energy, replaced electrolytes, and tasted good.<h4>Conclusion</h4>Findings provide several key insights that can contribute to the development of messages aimed at curbing SSB consumption among adolescents. For example, messages that focus on catching adolescents' attention and sharing short- and long-term health consequences of high SSB consumption resonated with adolescents, but because occasional SSB intake was not seen as consequential, messages that suggest abstinence from SSBs may not be helpful in reducing consumption.",
    "year": "2022",
    "doi": "10.3389/fpubh.2022.943295"
  },
  {
    "title": "Let the Kids Play: Latino Players, Differing Play Styles and Racial Stigma in Major League Baseball",
    "abstract": "Major League Baseball's (MLB) unwritten rules and unspoken norms communicate the continuing role that white American cultural values have within the sport. Coded into the past and present, foreign-born players, especially those from Latin America, confront these norms as they arrive to MLB with a distinctly Caribbean tíguere style of play. MLB seeks to overcome these differences by promoting its young Latino superstars through the marketing campaign Let the Kids Play. However, all actors, from The Office of the Commissioner of Baseball to current players, must increase their cultural competency and uproot their essentialist viewpoints to understand that these players are not trying to show up their opponent, but are instead adhering to the style of play they themselves learned and know best.",
    "year": "",
    "doi": "10.1177/01937235231171370"
  },
  {
    "title": "Pianeta Nutrizione kids: international pediatric conference on food, physical activity, growth and well-being",
    "abstract": "",
    "year": "2016",
    "doi": "10.1186/s13052-016-0240-0"
  }
];

const WOLRAICH_95 = {
  title: "The effect of sugar on behavior or cognition in children. A meta-analysis.",
  abstract: "Objective: To examine the effects of sugar on the behavior or cognition of children by using meta-analytic techniques on reported studies. Data sources: Studies were identified through a literature search of the MEDLINE and PsychINFO databases and the authors' files using sugar, sucrose, and attention deficit disorder as the search terms. Study selection: Studies were required to (1) intervene by having the subjects consume a known quantity of sugar, (2) use a placebo (artificial sweetener) condition (3) blind the subjects, parents, and research staff to the conditions; and (4) report statistics that could be used to compute the dependent measures effect sizes. Data extraction: Variables included publication year, study setting, subject type and number, gender, age, sugar and placebo type and dose, prior dietary condition, measurement construct, means and SDs for the sugar and placebo conditions, and direction of effect. Data synthesis: Sixteen reports met the inclusion criteria for a total of 23 within-subject design studies. The weighted mean effect size and related statistics for each of the 14 measurement constructs revealed that although the range for these means was from -0.14 for direct observations and up to +0.30 for academic tests, the 95% confidence interval for all 14 mean effect sizes included 0. Conclusion: The meta-analytic synthesis of the studies to date found that sugar does not affect the behavior or cognitive performance of children. The strong belief of parents may be due to expectancy and common association. However, a small effect of sugar or effects on subsets of children cannot be ruled out.",
  year: "1995", doi: "10.1001/jama.1995.03530200053037",
};
const WOLRAICH_94 = {
  title: "Effects of diets high in sucrose or aspartame on the behavior and cognitive performance of children.",
  abstract: "Background: Both dietary sucrose and the sweetener aspartame have been reported to produce hyperactivity and other behavioral problems in children. Methods: We conducted a double-blind controlled trial with two groups of children: 25 normal preschool children (3 to 5 years of age), and 23 school-age children (6 to 10 years) described by their parents as sensitive to sugar. The children and their families followed a different diet for each of three consecutive three-week periods. One diet was high in sucrose with no artificial sweeteners, another was low in sucrose and contained aspartame as a sweetener, and the third was low in sucrose and contained saccharin (placebo) as a sweetener. All the diets were essentially free of additives, artificial food coloring, and preservatives. The children's behavior and cognitive performance were evaluated weekly. Results: The preschool children ingested a mean (+/- SD) of 5600 +/- 2100 mg of sucrose per kilogram of body weight per day while on the sucrose diet, 38 +/- 13 mg of aspartame per kilogram per day while on the aspartame diet, and 12 +/- 4.5 mg of saccharin per kilogram per day while on the saccharin diet. The school-age children considered to be sensitive to sugar ingested 4500 +/- 1200 mg of sucrose per kilogram, 32 +/- 8.9 mg of aspartame per kilogram per day while on the saccharin diet, respectively. For the children described as sugar-sensitive, there were no significant differences among the three diets in any of 39 behavioral and cognitive variables. For the preschool children, only 4 of the 31 measures differed significantly among the three diets, and there was no consistent pattern in the differences that were observed. Conclusions: Even when intake exceeds typical dietary levels, neither dietary sucrose nor aspartame affects children's behavior or cognitive function.",
  year: "1994", doi: "10.1056/NEJM199402033300501",
};

function groupWith(member, q) {
  return questionConceptGroups(q || `zzz ${member} zzz`).find((g) => g.has(member)) || null;
}

group("Resolution: both concepts resolve on every plain phrasing");

await test("FRS3 resolves exactly the sugar and hyperactivity groups", () => {
  const gs = questionConceptGroups(FRS3).map((g) => [...g]);
  assert.deepEqual(gs, [SUGAR_GROUP, HYPER_GROUP]);
});

await test("the hyperactive phrasings resolve both groups", () => {
  for (const q of [FRS3B, FRS3C]) {
    const heads = questionConceptGroups(q).map((g) => [...g][0]).sort();
    assert.deepEqual(heads, ["hyper", "sugar"], q);
  }
});

await test("the fallback no longer mints sugar or hyper groups (hand covered now)", () => {
  const fb = buildDeterministicFallbackGroups(FRS3, ["hyper", "sugar", "kids"]);
  assert.deepEqual(fb, [{ term: "kids", alternates: ["kid"] }]);
});

group("Structured rungs: the literature's vocabulary reaches the boolean");

await test("FRS3 structured query, byte exact", () => {
  assert.equal(buildStructuredQuery(FRS3),
    SUGAR_RUNG + " AND " +
    "(hyper OR \"activity level\" OR \"activity levels\" OR hyperactivity OR hyperactive OR behavior OR behaviour) AND kids");
});

await test("hyperactive phrasing structured query, byte exact", () => {
  assert.equal(buildStructuredQuery(FRS3B),
    SUGAR_RUNG + " AND " +
    "(hyperactive OR \"activity level\" OR \"activity levels\" OR hyper OR hyperactivity OR behavior OR behaviour) AND children AND eating");
});

await test("kid phrasing structured query, byte exact", () => {
  assert.equal(buildStructuredQuery(FRS3C),
    SUGAR_RUNG + " AND " +
    "(hyperactive OR \"activity level\" OR \"activity levels\" OR hyper OR hyperactivity OR behavior OR behaviour) AND kid");
});

group("Typed gate sets: widening is not satisfaction");

await test("the hyperactivity gate set is the concept's own three words", () => {
  const g = groupWith("hyperactivity");
  assert.deepEqual([...gateConceptSetFor(g)].sort(), ["hyper", "hyperactive", "hyperactivity"]);
  // The widening set keeps the measurement vocabulary whole.
  assert.deepEqual([...g], HYPER_GROUP);
});

await test("the sugar gate set is the whole group (every member is the substance)", () => {
  const g = groupWith("sucrose");
  assert.deepEqual([...gateConceptSetFor(g)], SUGAR_GROUP);
});

await test("the pre existing typed entries keep their gate sets byte for byte", () => {
  const sleep = groupWith("insomnia", "zzz sleep zzz");
  assert.deepEqual([...gateConceptSetFor(sleep)].sort(),
    ["chronic sleep restriction", "short sleep", "sleep", "sleep deprivation", "sleep deprived",
     "sleep loss", "sleep restricted", "sleep restriction", "sleeping", "slept"]);
  const oil = groupWith("used cooking oil", "zzz waste oil zzz");
  assert.deepEqual([...gateConceptSetFor(oil)].sort(),
    ["used cooking oil", "waste cooking oil", "waste oil"]);
  const enz = groupWith("laccase", "zzz enzyme zzz");
  assert.deepEqual([...gateConceptSetFor(enz)].sort(),
    ["cutinase", "depolymerase", "enzymatic", "enzyme", "enzymes", "esterase", "esterases",
     "hydrolase", "hydrolases", "laccase", "lipase", "oxidase", "oxidases", "oxidoreductase",
     "oxidoreductases", "peroxidase", "phenoloxidase", "protease"]);
});

group("The gate on the specimen: judged set and the nine shelf papers");

const std = citationGateStandard(FRS3, null);
const judged = gateJudgedConcepts(std);

await test("the judged set is sugar (subject) and hyper, both backed", () => {
  assert.deepEqual(judged.map((c) => ({ term: c.term, subject: c.subject, backed: !!(c.group && c.group.size > 0) })),
    [{ term: "sugar", subject: true, backed: true }, { term: "hyper", subject: false, backed: true }]);
});

await test("all nine shelf papers are still refused, on the live engagement counts", () => {
  const expectedTotals = [1, 1, 0, 0, 1, 1, 1, 0, 0];
  SHELF.forEach((p, i) => {
    assert.equal(paperClearsCitationGate(p, std), false, "cleared: " + p.title);
    assert.equal(centralConceptHits(p, judged).total, expectedTotals[i], "engagement moved: " + p.title);
  });
});

await test("the rescue band does not admit the beverage papers", () => {
  const ctx = conceptGateContext(SHELF, FRS3, null);
  const tax = { ...SHELF[4], topicalScore: 20.67, score: 38, relevance: 38 };
  assert.equal(paperIsCitable(tax, 5, ctx), false);
  const perceptions = { ...SHELF[6], topicalScore: 20.67, score: 37, relevance: 37 };
  assert.equal(paperIsCitable(perceptions, 7, ctx), false);
  // Even stamped above both floors, a perception paper the
  // standard refuses stays uncitable.
  const water = { ...SHELF[0], topicalScore: 40, score: 70, relevance: 70 };
  assert.equal(paperIsCitable(water, 1, ctx), false);
});

group("Prefix collisions and merely related terms");

await test("hypertriglyceridemia and hyperparathyroidism engage at most one concept and clear", () => {
  for (const i of [1, 5]) {
    const h = centralConceptHits(SHELF[i], judged);
    assert.equal(h.total, 1, SHELF[i].title);
    assert.equal(paperClearsCitationGate(SHELF[i], std), false, SHELF[i].title);
  }
});

await test("a compound hyper token alone never touches the hyperactivity group", () => {
  const g = groupWith("hyperactivity");
  const p = { title: "Hypertriglyceridemia in adults: a case series", abstract: "Patients with hypertriglyceridemia presented with pancreatitis. Triglyceride levels were measured." };
  assert.equal(paperConceptGroupHits(p, [g]), 0);
});

await test("glucose is not sugar satisfaction", () => {
  const p = { title: "Glucose and classroom conduct in children", abstract: "We measured glucose after meals and rated conduct. Glucose predicted nothing." };
  const sugarConcept = judged.find((c) => c.term === "sugar");
  assert.equal(centralConceptHits(p, [sugarConcept]).total, 0);
  assert.equal(paperClearsCitationGate(p, std), false);
});

await test("attention is not hyperactivity satisfaction", () => {
  const p = { title: "Sugar and attention in schoolchildren", abstract: "Children ate sugar or placebo. Attention spans were timed with a stopwatch task." };
  const hyperConcept = judged.find((c) => c.term === "hyper");
  assert.equal(centralConceptHits(p, [hyperConcept]).total, 0);
  assert.equal(paperClearsCitationGate(p, std), false);
});

group("The answering papers");

await test("the 1994 sucrose challenge trial clears the citation standard", () => {
  assert.equal(paperClearsCitationGate(WOLRAICH_94, std), true);
  const h = centralConceptHits(WOLRAICH_94, judged);
  assert.equal(h.total, 2);
  assert.ok(h.inAbstract >= 1);
});

await test("the 1994 trial is citable at a passing score", () => {
  const ctx = conceptGateContext([WOLRAICH_94], FRS3, null);
  assert.equal(paperIsCitable({ ...WOLRAICH_94, topicalScore: 40, score: 70, relevance: 70 }, 1, ctx), true);
});

await test("the 1995 meta analysis survives the topic filter to the shelf", () => {
  const pool = [{ ...WOLRAICH_95 }, { ...WOLRAICH_94 }];
  const survivors = topicOverlapFilter(FRS3, pool, null).map((p) => p.title);
  assert.ok(survivors.includes(WOLRAICH_95.title), "meta analysis filtered out");
  assert.ok(survivors.includes(WOLRAICH_94.title), "trial filtered out");
  // Its abstract never uses the concept's own words, so the
  // standard refuses it: the typed split, recorded plainly.
  // It reaches the shelf and the further reading, not the
  // cited set, until a draw's shelf lets the trials carry
  // the citation.
  assert.equal(paperClearsCitationGate(WOLRAICH_95, std), false);
});

console.log("\nsearch-frs3-fix-nov16: " + passed + " passed, " + failures.length + " failed");
if (failures.length) {
  for (const f of failures) console.log("  FAILED:", f);
  process.exitCode = 1;
}
