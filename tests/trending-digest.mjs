/**
 * Trending digest integrity — the newspaper edition must be honest.
 *
 * Three invariants:
 *  1. The no-photograph cover is a solid tonal field, not a decorative
 *     gradient (the craft pass killed gradients on cards; coverFor was a
 *     survivor — this locks the fix).
 *  2. "Cited by N" comes only from Europe PMC's own citedByCount field and
 *     is shown only when positive. No trending score, no read counts, no
 *     view numbers are ever invented — the upstream sources do not provide
 *     them and the digest must not print what it does not know.
 *  3. The "why it matters" signal degrades to nothing, never to a fake:
 *     a record without a citation count carries citedByCount null,
 *     meaning no data, never a structural zero.
 *
 * Standalone script with its own assertions; run as a child process from
 * tests/run. The backend half runs against the real fetchTrendingItems
 * with stubbed fetch (no network); the frontend half is a source
 * assertion on src/CerebrumApp.jsx.
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

function group(name) {
  console.log(`\n${name}`);
}

// ══════════════════════════════════════════════════════════════════════════
group("trending digest — frontend craft and honesty");

const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");

await test("coverFor paints a solid tonal field, never a gradient", () => {
  const m = appSrc.match(/function coverFor\(item\) \{[\s\S]*?\n\}/);
  assert.ok(m, "coverFor not found");
  assert.doesNotMatch(m[0], /linear-gradient|radial-gradient/, "coverFor still emits a decorative gradient");
  assert.match(m[0], /background: `hsl\(/, "coverFor background is not a solid hsl tone");
});

await test("no fabricated engagement numbers anywhere in the trending view", () => {
  // The digest prints what the feed provides: title, source, journal,
  // recency, and Europe PMC citation counts. Read counts, view counts and
  // "trending scores" do not exist upstream and must never be printed.
  const trendStart = appSrc.indexOf("function TrendingView(");
  const trendEnd = appSrc.indexOf("/* ═", trendStart);
  assert.ok(trendStart > 0 && trendEnd > trendStart, "TrendingView bounds not found");
  const view = appSrc.slice(trendStart, trendEnd);
  assert.doesNotMatch(view, /reads?\b.{0,20}\d|views?\b.{0,20}\d|trending score/i, "fabricated engagement stat in TrendingView");
});

await test("the 'Cited by' label is guarded by a real positive count", () => {
  // Pass 4 (2026-09-17): digest rows render through trendProvenance, which
  // guards the label with `if (item.citedByCount > 0)` before pushing it.
  assert.match(
    appSrc,
    /if \(item\.citedByCount > 0\) parts\.push\(`Cited by \$\{item\.citedByCount\}`\)/,
    "digest 'Cited by' label is not guarded by a positive count"
  );
});

// ══════════════════════════════════════════════════════════════════════════
group("trending digest — citation signal is real and never invented");

const { fetchTrendingItems } = await import(join(root, "functions/lib/trendingSource.js"));

// Fixture dates are computed from the run's own clock, never hard
// coded: the edition window (90 days, judged on the real Date.now in
// fetchTrendingFeed) silently ate fixed 2026-09-01 fixtures once the
// calendar passed them — the suite would have begun failing around
// 2026-11-30 with nothing in the code changed. Relative dates keep
// every fixture inside the window forever while the window assertions
// themselves (in trending-redesign.mjs, against an explicit `now`)
// stay exactly as strict.
const DAY_MS = 86400000;
const isoDaysAgo = (n) => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

function stubFetch(handler) {
  const saved = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = saved; };
}

function cannedFetch(map) {
  return async (url) => {
    const body = map(url);
    if (body === null) return new Response("nope", { status: 500 });
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(payload, { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

await test("Europe PMC citation counts carry through; missing means no data, never a guess", async () => {
  const epmc = {
    resultList: { result: [
      { title: "Cited paper.", abstractText: "A.", doi: "10.9/z", journalTitle: "J Test",
        firstPublicationDate: isoDaysAgo(2), citedByCount: 42 },
      { title: "Uncited paper.", abstractText: "B.", doi: "10.9/w", journalTitle: "J Test",
        firstPublicationDate: isoDaysAgo(2) },
      { title: "Zero paper.", abstractText: "C.", doi: "10.9/v", journalTitle: "J Test",
        firstPublicationDate: isoDaysAgo(2), citedByCount: 0 },
    ] },
  };
  const restore = stubFetch(cannedFetch((url) => {
    if (url.includes("europepmc")) return epmc;
    return null; // every other source down: they are simply absent
  }));
  let items;
  try { items = await fetchTrendingItems(); } finally { restore(); }
  assert.equal(items.length, 3, "expected only the Europe PMC bucket");
  // Europe PMC titles have trailing periods stripped by the parse step.
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.equal(byTitle["Cited paper"].citedByCount, 42, "real count did not carry through");
  assert.equal(byTitle["Uncited paper"].citedByCount, null, "missing count was not kept as no data");
  assert.equal(byTitle["Zero paper"].citedByCount, 0, "explicit zero was not kept at 0");
  assert.ok(items.every((i) => i.citedByCount === null || (Number.isInteger(i.citedByCount) && i.citedByCount >= 0)), "count is not null or a non-negative integer");
});

await test("malformed citation counts degrade to no data, never a fake zero", async () => {
  const epmc = {
    resultList: { result: [
      { title: "Weird paper.", abstractText: "A.", doi: "10.9/z", journalTitle: "J Test",
        firstPublicationDate: isoDaysAgo(2), citedByCount: "a dozen" },
      { title: "Negative paper.", abstractText: "B.", doi: "10.9/w", journalTitle: "J Test",
        firstPublicationDate: isoDaysAgo(2), citedByCount: -5 },
    ] },
  };
  const restore = stubFetch(cannedFetch((url) => (url.includes("europepmc") ? epmc : null)));
  let items;
  try { items = await fetchTrendingItems(); } finally { restore(); }
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.citedByCount === null || i.citedByCount === 0), "malformed counts were not degraded honestly");
  assert.equal(items.find((i) => i.title === "Weird paper").citedByCount, null, "non numeric count should be no data");
  assert.equal(items.find((i) => i.title === "Negative paper").citedByCount, 0, "negative count should clamp to zero");
});

await test("spaceflight nav-chrome summaries degrade to a missing summary", async () => {
  // Real incident (2026-09-16): an APOD item's card description was the
  // upstream scraper's nav text ("Today's APOD Archive Submissions Index
  // Search Calendar"). Site furniture must never print as a summary.
  // Corrected contract (wave seven): this fixture used to expect the
  // placeholder sentence "NASA story. Full text at the source link."
  // in the summary's place — and that placeholder shipped on the live
  // edition AS a summary with summaryMissing false (the sixth panel's
  // item 39). A placeholder is not a summary: chrome in place of text
  // now means the item has NO summary, empty and flagged missing.
  const space = {
    results: [
      { title: "APOD: Something in the sky.", summary: "APOD Science APOD APOD: 2026 September 16 – Today's APOD Archive Submissions Index Search Calendar",
        url: "https://x.example/a", image_url: "", news_site: "NASA", published_at: isoDaysAgo(1) },
      { title: "A real story.", summary: "Engineers tested the new thruster and it worked.",
        url: "https://x.example/b", image_url: "", news_site: "SpaceNews", published_at: isoDaysAgo(1) },
    ],
  };
  const restore = stubFetch(cannedFetch((url) => (url.includes("spaceflightnewsapi") ? space : null)));
  let items;
  try { items = await fetchTrendingItems(); } finally { restore(); }
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.ok(!/archive|submissions|calendar/i.test(byTitle["APOD: Something in the sky."].summary),
    "nav chrome leaked into the summary: " + byTitle["APOD: Something in the sky."].summary);
  assert.equal(byTitle["APOD: Something in the sky."].summary, "",
    "chrome summary did not degrade to no summary at all");
  assert.equal(byTitle["APOD: Something in the sky."].summaryMissing, true,
    "chrome summary was not flagged as the missing summary it is");
  assert.equal(byTitle["A real story."].summary, "Engineers tested the new thruster and it worked.",
    "legitimate summary was altered");
});

await test("entity-mangled upstream titles render as plain text, never raw entities", async () => {
  // Real incident (2026-09-16): an Europe PMC title shipped with embedded,
  // already-escaped markup — "Disseminated &lt;i&gt;Klebsiella
  // pneumoniae&lt;/i&gt; Infection ..." — and rendered on the card as
  // literal "&lt;i&gt;" text after JSX escaped the ampersands a second
  // time. Titles and summaries must be decoded once and stripped of tags.
  const { cleanTrendingText } = await import(join(root, "functions/lib/trendingSource.js"));
  assert.equal(
    cleanTrendingText("Disseminated &lt;i&gt;Klebsiella pneumoniae&lt;/i&gt; Infection Mimicking Lesions: A Case Report"),
    "Disseminated Klebsiella pneumoniae Infection Mimicking Lesions: A Case Report",
    "escaped markup was not decoded and stripped"
  );
  assert.equal(cleanTrendingText("Fish &amp; chips: a &quot;study&quot;"), 'Fish & chips: a "study"',
    "named entities were not decoded");
  // Corrected contract (fifth panel, data hygiene): the decoded en
  // dash no longer ships — a dash glued inside a word is a compound
  // joint and normalizes to a space, the way deDash treats the
  // answers' text. The old expectation pinned the dash surviving.
  assert.equal(cleanTrendingText("T&#8211;cell &#x3B1; response"), "T cell α response",
    "numeric entities were not decoded, or the decoded en dash shipped");
  assert.equal(cleanTrendingText("&bogus; stays"), "&bogus; stays",
    "unknown entities must pass through untouched");
  assert.equal(cleanTrendingText("  spaced   <b>bold</b>  text  "), "spaced bold text",
    "tags were not removed as plain text / whitespace not collapsed");
});

await test("fetchTrendingItems strips entities from upstream Europe PMC titles", async () => {
  const epmc = {
    resultList: { result: [
      { title: "Disseminated &lt;i&gt;Klebsiella pneumoniae&lt;/i&gt; Infection Mimicking Lesions.", abstractText: "A &amp; B.",
        doi: "10.9/z", journalTitle: "J Test", firstPublicationDate: isoDaysAgo(2) },
    ] },
  };
  const restore = stubFetch(cannedFetch((url) => (url.includes("europepmc") ? epmc : null)));
  let items;
  try { items = await fetchTrendingItems(); } finally { restore(); }
  assert.equal(items.length, 1);
  assert.ok(!/[&<>]/.test(items[0].title) || !items[0].title.includes("&lt;"),
    "raw entities survived into the served title: " + items[0].title);
  // The served title carries the species name's italics as a markdown
  // pair: the pipeline used to strip the <i> span entirely, so the
  // name rendered in roman. The client renders titles through
  // renderInlineMdLite, which turns the pair back into italics.
  assert.equal(items[0].title, "Disseminated *Klebsiella pneumoniae* Infection Mimicking Lesions",
    "title was not cleaned end to end, italics marker included");
  assert.equal(items[0].summary, "A & B.", "summary entities were not decoded");
});

// ══════════════════════════════════════════════════════════════════════════
group("trending digest — species italics survive the pipeline");

await test("italic spans become markdown pairs for titles and summaries; the default clean stays plain", async () => {
  const { cleanTrendingText, buildTrendingItem } = await import(join(root, "functions/lib/trendingSource.js"));
  const raw = "Disseminated &lt;i&gt;Klebsiella pneumoniae&lt;/i&gt; Infection";
  assert.equal(cleanTrendingText(raw), "Disseminated Klebsiella pneumoniae Infection",
    "the default clean changed: plain surfaces must stay marker free");
  assert.equal(cleanTrendingText(raw, { italics: "markdown" }), "Disseminated *Klebsiella pneumoniae* Infection",
    "escaped italic markup did not become a markdown pair");
  assert.equal(cleanTrendingText("A <i>Phytophthora infestans</i> outbreak", { italics: "markdown" }),
    "A *Phytophthora infestans* outbreak", "literal italic tags did not become a markdown pair");
  assert.equal(cleanTrendingText("A &lt;em&gt;Phytophthora&lt;/em&gt; outbreak", { italics: "markdown" }),
    "A *Phytophthora* outbreak", "an em span did not become a markdown pair");
  // Broken markup loses its markers rather than printing them: an
  // unclosed span and a stray close both degrade to the plain words.
  assert.equal(cleanTrendingText("A &lt;i&gt;Phytophthora outbreak", { italics: "markdown" }),
    "A Phytophthora outbreak", "an unclosed italic span kept its marker");
  assert.equal(cleanTrendingText("A Phytophthora&lt;/i&gt; outbreak", { italics: "markdown" }),
    "A Phytophthora outbreak", "a stray italic close kept its marker");
  const item = buildTrendingItem(
    { title: raw, summary: "About &lt;i&gt;Klebsiella&lt;/i&gt; in the gut.", url: "https://doi.org/10.9/z" },
    "Biology & Medicine"
  );
  assert.equal(item.title, "Disseminated *Klebsiella pneumoniae* Infection", "the built title lost its italics marker");
  // Corrected contract (fifth panel): summaries carry the same pairs
  // titles do, because the digest now renders summaries through
  // renderInlineMdLite exactly like titles — the marker renders as
  // italics and never prints literally. The old pin held summaries
  // plain, which left species names in a summary in roman while the
  // same name in a title italicized.
  assert.equal(item.summary, "About *Klebsiella* in the gut.", "the built summary lost its italics marker");
});

await test("markdown italics already in an upstream title pass through untouched", async () => {
  const epmc = { resultList: { result: [
    { title: "*Phytophthora infestans* spreads in wet soil.", abstractText: "A.",
      doi: "10.9/p", journalTitle: "J Test", firstPublicationDate: isoDaysAgo(2) },
  ] } };
  const restore = stubFetch(cannedFetch((url) => (url.includes("europepmc") ? epmc : null)));
  let items;
  try { items = await fetchTrendingItems(); } finally { restore(); }
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "*Phytophthora infestans* spreads in wet soil",
    "a title's own markdown italics were altered by the pipeline");
});

// ══════════════════════════════════════════════════════════════════════════
group("trending digest — data hygiene in the cleaning path");

await test("an APOD shaped item comes out dash free", async () => {
  // The live item 39 shape: an en dash in the title and an em dash
  // summary, both arriving through upstream DATA where the authored
  // string gate cannot see them.
  const { buildTrendingItem } = await import(join(root, "functions/lib/trendingSource.js"));
  const item = buildTrendingItem(
    { title: "APOD: 2026 October 13 – Desert Stairway to Heaven",
      summary: "NASA story — full text at the source link.",
      url: "https://x.example/apod", source: "NASA" },
    "Space"
  );
  assert.equal(item.title, "APOD: 2026 October 13, Desert Stairway to Heaven",
    "the title's en dash was not normalized: " + item.title);
  assert.ok(!/[–—]/.test(item.title + " " + item.summary), "a dash survived into the built item");
  assert.equal(item.summary, "NASA story, full text at the source link.",
    "the summary's em dash was not normalized: " + item.summary);
});

await test("a NASA tech shaped item is furniture free and TeX clean, and its mismatched remainder is not shipped", async () => {
  // The live item 11 and item 30 shapes combined: a contact block and
  // a download prompt ahead of the surviving text, TeX double hyphens
  // and an escaped percent inside it. The text level cleaning is
  // unchanged (asserted on cleanTrendingText directly).
  // Corrected contract (wave seven): the wave six version of this
  // fixture expected the cleaned remainder to SHIP as the summary —
  // equilibrium chemistry prose under a structural systems title,
  // which is precisely the sixth panel's item 11 defect. The build
  // now judges the remainder against its title (see
  // summaryCoheresWithTitle) and ships it as missing instead.
  const { cleanTrendingText, buildTrendingItem } = await import(join(root, "functions/lib/trendingSource.js"));
  const rawSummary = "For more information, contact Joel W. Sills, Langley Research Center, joel.w.sills@nasa.gov Download the PDF version of this fact sheet. The CEA code follows the Curie--Weiss law from 10--41\\% of runs and calculates chemical equilibrium compositions.";
  const cleaned = cleanTrendingText(rawSummary);
  assert.ok(cleaned.startsWith("The CEA code"), "leading furniture survived: " + cleaned);
  assert.ok(!/contact|download|nasa\.gov/i.test(cleaned), "furniture text survived: " + cleaned);
  assert.ok(!/--/.test(cleaned), "a TeX double hyphen survived: " + cleaned);
  assert.ok(!/[\\–—]/.test(cleaned), "a backslash or dash survived: " + cleaned);
  assert.ok(cleaned.includes("Curie Weiss law"), "the name compound was not opened: " + cleaned);
  assert.ok(cleaned.includes("10 to 41% of runs"), "the numeric range was not written with 'to': " + cleaned);
  const item = buildTrendingItem(
    { title: "Complex Modes in Lightly Damped Structural Systems",
      summary: rawSummary,
      url: "https://x.example/tech", source: "NASA Tech" },
    "Space"
  );
  assert.equal(item.summary, "", "the structural title shipped the chemistry summary: " + item.summary);
  assert.equal(item.summaryMissing, true, "the mismatched summary was not flagged missing");
});

await test("TeX remnants repair mechanically: subscripts join, comparators restore, decimal ranges convert", async () => {
  // The live item 30 shapes, verbatim classes: a subscripted ratio
  // ("f=J_2/J_1"), a dropped comparator ("For f 1" where the
  // abstract's $f\gg 1$ lost its relation to the command strip), a
  // subscripted factor ("Z_c"), and a hyphen range between decimals
  // ("0.382-0.386") that the dash rules did not reach.
  const { cleanTrendingText } = await import(join(root, "functions/lib/trendingSource.js"));
  const out = cleanTrendingText("Varying the ratio f=J_2/J_1 over a wide range has a weak effect. For $f\\gg 1$, the compressibility factor Z_c stays within 0.382-0.386 for most fluids.");
  assert.ok(out.includes("f=J2/J1"), "subscripts were not joined: " + out);
  assert.ok(out.includes("For f >> 1"), "the dropped comparator was not restored: " + out);
  assert.ok(out.includes("factor Zc stays"), "the letter subscript was not joined: " + out);
  assert.ok(out.includes("0.382 to 0.386"), "the decimal hyphen range was not converted: " + out);
  assert.ok(!/_/.test(out), "an underscore survived: " + out);
  // A named Greek entity decodes to the letter it names (the
  // decodable form of the ESA mission name class): "&epsilon;psilon"
  // is the stylized "εpsilon", and printing the entity raw was the
  // only failure available here — the live edition's "εpsilon"
  // itself is the mission's actual stylized name, upstream data the
  // cleaner passes through untouched either way.
  assert.equal(cleanTrendingText("her &epsilon;psilon mission aboard the station"),
    "her εpsilon mission aboard the station",
    "the named Greek entity did not decode");
  // Snake case prose is not a subscript and is never fused.
  assert.equal(cleanTrendingText("the neural_network module uses a learning_rate schedule"),
    "the neural_network module uses a learning_rate schedule",
    "snake_case words were fused by the subscript rule");
});

await test("a comparator glued to its operand survives cleaning (the live arXiv variant)", async () => {
  // Seventh panel, live item 30 (Curie Weiss cell fluid model,
  // arXiv 2610.18411): the served summary read "For f 1" AGAIN,
  // although the wave seven fixture above passes. The variant is
  // the raw form the arXiv Atom summary actually carries: the
  // command glued straight to its operand with no space,
  // "For $f\\geq1$" and "$Z_c\\approx0.382-0.386$". A TeX command
  // name is a letter run, so a digit ends it; the restore rule's
  // old word boundary terminator saw letter and digit as one word
  // and never fired, and the generic command strip then ate the
  // command whole. This fixture is built from the variant's raw
  // form, not from the spaced form the older fixture uses.
  const { cleanTrendingText } = await import(join(root, "functions/lib/trendingSource.js"));
  const out = cleanTrendingText("For $f\\geq1$, the model's critical compressibility factor lays within a narrow range $Z_c\\approx0.382-0.386$, remaining close to the mean field value.");
  assert.ok(out.includes("For f >= 1"), "the glued \\geq comparator was not restored: " + out);
  assert.ok(out.includes("Zc ≈ 0.382 to 0.386"), "the glued \\approx was not restored: " + out);
  assert.ok(!/For f 1/.test(out), "the comparator hole shipped again: " + out);
  // The sibling relations take the same variant path: glued forms
  // of each restore, and a letter continuation is still not a
  // command (\get is not \ge).
  const sib = cleanTrendingText("For $f\\gg1$ and $x\\ll2$ and $y\\leq0$ and $z\\le 3$.");
  assert.ok(sib.includes("For f >> 1"), "the glued \\gg was not restored: " + sib);
  assert.ok(sib.includes("x << 2"), "the glued \\ll was not restored: " + sib);
  assert.ok(sib.includes("y <= 0"), "the glued \\leq was not restored: " + sib);
  assert.ok(sib.includes("z <= 3"), "the spaced \\le changed behaviour: " + sib);
});

await test("micro signs in unit contexts survive cleaning in every delivery form", async () => {
  // Seventh panel, live item 29 (oyster acidification): the served
  // summary read "(~2800 atm pCO2)", which reads as 2,800
  // atmospheres where the treatment is 2,800 MICROatmospheres —
  // Europe PMC's record for the same paper carries "(~2800 μatm
  // pCO2)". The micro sign must come through cleaning as the
  // character, in each form a source delivers it: literal micro
  // sign, literal Greek mu, the &micro; entity (previously not
  // decoded at all, so it printed raw), and the numeric entity.
  const { cleanTrendingText } = await import(join(root, "functions/lib/trendingSource.js"));
  assert.equal(cleanTrendingText("larvae to control, CA (~2800 µatm pCO2), and 5 µm mesh"),
    "larvae to control, CA (~2800 µatm pCO2), and 5 µm mesh",
    "a literal micro sign was dropped or altered");
  assert.equal(cleanTrendingText("larvae to control, CA (~2800 &micro;atm pCO2), and 5 &micro;m mesh"),
    "larvae to control, CA (~2800 µatm pCO2), and 5 µm mesh",
    "the &micro; entity did not decode to the micro sign");
  assert.equal(cleanTrendingText("dose &#181;atm and &#x3bc;atm forms"),
    "dose µatm and μatm forms",
    "a numeric micro entity did not decode");
});

await test("species italics are ensured on summaries, not just preserved", async () => {
  // Seventh panel, live item 29 again: the summary shipped
  // "Crassostrea virginica" bare (bioRxiv prints it unmarked),
  // while a neighbour item's source marked name rendered italic.
  // buildTrendingItem now ensures the marking on summaries: a
  // binomial shaped pair the source left bare ships wrapped in the
  // markdown pair, an already marked name is never double wrapped,
  // and marked non species spans (a statistical *p*) plus ordinary
  // prose pairs pass through unwrapped.
  const { buildTrendingItem, ensureSpeciesItalics } = await import(join(root, "functions/lib/trendingSource.js"));
  const bare = buildTrendingItem(
    { title: "Oyster selection under coastal acidification",
      summary: "Here, we exposed eastern oyster (Crassostrea virginica) larvae to control and acidified water for 24 h across independent spawns, and measured survival.",
      url: "https://doi.org/10.9/oy", source: "bioRxiv" },
    "Preprints"
  );
  assert.ok(bare.summary.includes("(*Crassostrea virginica*)"),
    "an unmarked binomial shipped unmarked: " + bare.summary);
  const marked = buildTrendingItem(
    { title: "Oyster selection under coastal acidification",
      summary: "Here, we exposed eastern oyster (<i>Crassostrea virginica</i>) larvae to control and acidified water for 24 h across independent spawns.",
      url: "https://doi.org/10.9/oy", source: "bioRxiv" },
    "Preprints"
  );
  assert.equal(marked.summary.split("*Crassostrea virginica*").length - 1, 1,
    "a source marked binomial was double wrapped or lost: " + marked.summary);
  assert.ok(!marked.summary.includes("**"), "a double marker shipped: " + marked.summary);
  // A marked statistical span is the source's own markup and is
  // never rewritten, and prose pairs are not binomials.
  assert.equal(ensureSpeciesItalics("Effects were significant (*p* < 0.05) in the trial."),
    "Effects were significant (*p* < 0.05) in the trial.",
    "a marked non species span was rewritten");
  assert.equal(ensureSpeciesItalics("Bayesian inference and Logistic regression were used. The results showed promise."),
    "Bayesian inference and Logistic regression were used. The results showed promise.",
    "an ordinary prose pair was wrapped as a species");
  // The abbreviated genus form ensures under the same discipline.
  assert.equal(ensureSpeciesItalics("Larvae of C. elegans were exposed."),
    "Larvae of *C. elegans* were exposed.",
    "an abbreviated binomial was not ensured");
});

await test("a topically coherent long summary survives the coherence check", async () => {
  const { buildTrendingItem } = await import(join(root, "functions/lib/trendingSource.js"));
  const item = buildTrendingItem(
    { title: "Complex Modes in Lightly Damped Structural Systems",
      summary: "A method for lightly damped structural systems is presented. The structural modes interact when their frequencies are close, and the damped response of the system is derived in closed form for the two mode case.",
      url: "https://x.example/modes", source: "NASA Tech" },
    "Space"
  );
  assert.ok(item.summary.includes("lightly damped structural systems"), "a coherent summary was dropped: " + item.summary);
  assert.equal(item.summaryMissing, false, "a coherent summary was flagged missing");
});

await test("legitimate summaries are not eaten by the furniture strip", async () => {
  const { cleanTrendingText } = await import(join(root, "functions/lib/trendingSource.js"));
  assert.equal(
    cleanTrendingText("Engineers tested the new thruster and it worked."),
    "Engineers tested the new thruster and it worked.",
    "an ordinary summary was altered"
  );
  assert.equal(
    cleanTrendingText("Contact with the surface changed the material. The team measured the effect over 5–7 days."),
    "Contact with the surface changed the material. The team measured the effect over 5 to 7 days.",
    "a summary merely containing the word contact, or a numeric range, was mishandled"
  );
});

// ══════════════════════════════════════════════════════════════════════════
group("trending digest — citation health and ranking basis are on screen");

await test("there is no Most cited ordering to disclose a basis for", () => {
  // The Most cited sort is gone until the citation leg is reliable:
  // it ranked only the subset a rate limited provider answered and
  // let the rest follow unranked, which read as a ranking of the
  // whole edition. The counts and the health reporting stay; the
  // ordering does not.
  const view = appSrc.slice(appSrc.indexOf("function TrendingView("), appSrc.indexOf("function LiteratureTimeline("));
  assert.ok(!view.includes('id: "cited"'), "a cited sort option is still offered");
  assert.ok(!appSrc.includes("citedRankedCount"), "the cited ranking count is still computed");
  assert.match(appSrc, /const citedKnownCount = stories\.filter\(\(x\) => typeof x\.citedByCount === "number"\)\.length/,
    "the coverage count is not computed from the stories on screen");
});

await test("citation health is rendered, not just shipped in the payload", () => {
  assert.match(appSrc, /stories carry a citation count/, "no citation coverage line in the masthead");
  assert.match(appSrc, /const citedKnownCount = stories\.filter\(\(x\) => typeof x\.citedByCount === "number"\)\.length/,
    "the coverage line is not computed from the stories on screen");
  assert.match(appSrc, /item\.citedByCount === 0\) parts\.push\("No citations yet"\)/,
    "a reported zero citation count is not named in the story rows");
  assert.match(appSrc, /s\.source !== "Citation counts" && !s\.ok/,
    "the citation completion leg can still land in the missing sections list");
  assert.match(appSrc, /Citation counts could not be completed this round/,
    "a failed citation completion leg is not rendered on screen");
  // Partial failure gets its own disclosure (fifth panel): how many
  // counts resolved of how many attempted, and the rate limit named.
  assert.match(appSrc, /Citation counts are partial this round/,
    "a partial citation completion is not disclosed on screen");
  assert.match(appSrc, /\{citationHealth\.resolved\} of \{citationHealth\.attempted\} counts resolved/,
    "the partial disclosure does not name the resolved and attempted counts");
  assert.match(appSrc, /A provider was rate limited/,
    "the partial disclosure does not name the rate limit");
});

await test("story titles render through the inline markdown path the answers use", () => {
  const rendered = appSrc.split("renderInlineMdLite(item.title, P)").length - 1;
  assert.ok(rendered >= 3, `expected hero, digest and modal titles via renderInlineMdLite, found ${rendered}`);
  assert.ok(!appSrc.includes("TrendRailList"), "a rail still renders story titles a second time");
  assert.match(appSrc, /renderInlineMdLite\(nx\.title, P\)/, "up next titles do not render via renderInlineMdLite");
  assert.match(appSrc, /renderInlineMdLite\(c\.title, P\)/, "coverage titles do not render via renderInlineMdLite");
});

await test("story summaries render through the same path, so their italics markers restore", () => {
  // Summaries carry *pairs* from the pipeline now (see the species
  // italics group above); every surface that prints one must route
  // it through the formatter, or the marker prints literally and
  // the species name stays in roman.
  const rendered = appSrc.split("renderInlineMdLite(item.summary, P)").length - 1;
  assert.ok(rendered >= 3, `expected hero, digest and modal summaries via renderInlineMdLite, found ${rendered}`);
});

// ══════════════════════════════════════════════════════════════════════════
group("trending endpoint — first serve media and the edition archive");

// A minimal in-memory D1 stand in for the two trending tables plus
// the image cache (modelled because the media enrichment contract
// under test reads resolutions back through it: a cached miss is
// what lets a later pass spend its fan-out budget on new items
// instead of re-resolving settled ones). Other statements the
// request path issues (rate limit buckets) are pass-through: reads
// miss, writes land nowhere.
function fakeTrendingDb() {
  const cache = { row: null };
  const imageRows = new Map();
  const editions = new Map();
  // A statement answers run/first/all with or without a bind, the way
  // D1's own prepared statements do.
  const statement = (sql, args) => ({
    bind: (...a) => statement(sql, a),
    run: async () => {
      if (sql.includes("INSERT INTO trending_cache")) cache.row = { payload: args[0], fetched_at: args[1] };
      else if (sql.includes("INSERT INTO image_cache")) imageRows.set(args[0], { payload: args[1], created_at: args[2], hit: args[3] });
      else if (sql.includes("INSERT INTO trending_editions")) editions.set(args[0], { payload: args[1], generated_at: args[2] });
      else if (sql.includes("DELETE FROM trending_editions")) {
        const keep = [...editions.entries()].sort((a, b) => b[1].generated_at - a[1].generated_at).slice(0, args[0]);
        editions.clear();
        for (const [k, v] of keep) editions.set(k, v);
      }
      return { success: true };
    },
    first: async () => {
      if (sql.includes("FROM trending_cache")) return cache.row ? { payload: cache.row.payload, fetched_at: cache.row.fetched_at } : null;
      if (sql.includes("FROM image_cache")) return imageRows.get(args[0]) || null;
      if (sql.includes("FROM trending_editions")) {
        const e = editions.get(args[0]);
        return e ? { payload: e.payload, generated_at: e.generated_at } : null;
      }
      return null;
    },
    all: async () => {
      if (sql.includes("FROM trending_editions")) {
        return { results: [...editions.entries()]
          .map(([edition_id, v]) => ({ edition_id, generated_at: v.generated_at, payload: v.payload }))
          .sort((a, b) => b.generated_at - a.generated_at) };
      }
      return { results: [] };
    },
  });
  return { prepare: (sql) => statement(sql, []), exec: async () => {}, _cache: cache, _editions: editions };
}

function jsonRes(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
}

// Routes the four feed sources and the citation providers; every
// other URL (the whole image pipeline) answers 404, so media
// resolution honestly finds nothing and attaches the empty contract.
function endpointFetch({ epmcResults, spaceResults }) {
  return async (url) => {
    const u = String(url);
    if (u.includes("europepmc") && u.includes("/search")) return jsonRes({ resultList: { result: epmcResults } });
    if (u.includes("biorxiv")) return jsonRes({ collection: [] });
    if (u.includes("export.arxiv.org")) return new Response("<feed></feed>", { status: 200, headers: { "Content-Type": "application/atom+xml" } });
    if (u.includes("spaceflightnewsapi")) return jsonRes({ results: spaceResults });
    if (u.includes("api.openalex.org")) return jsonRes({ results: [] });
    return new Response("nope", { status: 404 });
  };
}

async function callTrending(db, url) {
  const { onRequest } = await import(join(root, "functions/api/trending.js"));
  const pending = [];
  const res = await onRequest({
    request: new Request(url || "https://askcerebrum.org/api/trending"),
    env: { DB: db },
    waitUntil: (p) => pending.push(p),
  });
  return { res, data: await res.json(), pending };
}

await test("first serve spends a bounded fan-out at the front of the edition; backfills complete the row over successive serves", async () => {
  // Corrected contract (wave seven): the old version of this fixture
  // had the first serve resolving all ten slice items inline and one
  // backfill completing the row — ten-plus full fan-outs inside
  // invocations whose subrequest budget the feed fetch and citation
  // legs had already spent, which is how the live edition's media
  // resolutions starved and their nulls got cached as misses (the
  // sixth panel's zero verified yield). A pass now fans out on at
  // most MEDIA_FANOUT_PER_BUILD uncached subjects, serves cached
  // subjects for free, and leaves the rest without a media key —
  // the state the next serve's backfill reads as work still owed.
  // Distinct subjects, deliberately: the media cache key is the
  // title's first content terms, so twelve studies differing only
  // in a trailing number would be ONE subject to the resolver and
  // the later probes would read the first item's cached miss —
  // correct behaviour that would make this fixture measure the key
  // instead of the budget.
  const subjects = ["maple", "orchid", "cactus", "willow", "bamboo", "ginger", "clover", "sorrel", "nettle", "myrtle", "fennel", "sesame"];
  const epmcResults = subjects.map((w, i) => ({
    title: `Fixture study on ${w} cell signalling.`, abstractText: "An abstract.",
    doi: `10.9/m${i + 1}`, journalTitle: "J Fixture", firstPublicationDate: isoDaysAgo(1),
  }));
  const spaceResults = ["Falcon", "Starship", "Soyuz"].map((w, i) => ({
    title: `${w} launch fixture`, summary: "A summary.", url: `https://news.example/l${i + 1}`,
    image_url: "", news_site: "Fixture News", published_at: new Date().toISOString(),
  }));
  const db = fakeTrendingDb();
  const restore = stubFetch(endpointFetch({ epmcResults, spaceResults }));
  try {
    const { data, pending } = await callTrending(db);
    assert.equal(data.ok, true);
    assert.equal(data.items.length, 15, "fixture edition should hold fifteen items");
    // The fan-out budget lands at the front of the edition: the first
    // three items leave resolved (an explicit empty where nothing
    // verified), everything past them leaves unresolved rather than
    // making the first reader wait, or starving mid-list.
    for (let i = 0; i < 3; i++) assert.ok("media" in data.items[i], `item ${i} on the first serve has no media key`);
    for (let i = 3; i < 15; i++) assert.ok(!("media" in data.items[i]), `item ${i} past the fan-out budget was resolved inline`);
    // One backfill pass spends its own budget the same way: three
    // more items resolved in the stored row, no more.
    await Promise.all(pending);
    let stored = JSON.parse(db._cache.row.payload);
    assert.equal(stored.items.filter((it) => it && it.media).length, 6,
      "one backfill pass resolved more or fewer than its fan-out budget plus the first serve's");
    // Successive serves keep scheduling backfills while any item
    // lacks media, and the row completes: fifteen items, three
    // fan-outs per pass, five passes at most.
    for (let round = 0; round < 6; round++) {
      if (stored.items.every((it) => it && it.media)) break;
      const next = await callTrending(db);
      await Promise.all(next.pending);
      stored = JSON.parse(db._cache.row.payload);
    }
    assert.ok(stored.items.every((it) => it && it.media), "the stored row never completed across successive backfills");
  } finally { restore(); }
});

await test("editions accumulate: yesterday's archive gives today its second day", async () => {
  const db = fakeTrendingDb();
  const yesterdayTs = Date.now() - DAY_MS;
  const yesterdayId = new Date(yesterdayTs).toISOString().slice(0, 10);
  db._editions.set(yesterdayId, {
    payload: JSON.stringify({
      items: [{ title: "Fresh journal paper", doi: "10.9/fresh", url: "https://doi.org/10.9/fresh",
        category: "Biology & Medicine", source: "J Fixture", publishedAt: isoDaysAgo(3), citedByCount: null }],
      generatedAt: yesterdayTs,
    }),
    generated_at: yesterdayTs,
  });
  const epmcResults = [
    { title: "Fresh journal paper.", abstractText: "An abstract.", doi: "10.9/fresh",
      journalTitle: "J Fixture", firstPublicationDate: isoDaysAgo(2) },
    { title: "Counted journal paper.", abstractText: "An abstract.", doi: "10.9/counted",
      journalTitle: "J Fixture", firstPublicationDate: isoDaysAgo(2), citedByCount: 5 },
  ];
  const restore = stubFetch(endpointFetch({ epmcResults, spaceResults: [] }));
  let out;
  try { out = await callTrending(db); } finally { restore(); }
  const { data } = out;
  assert.equal(data.ok, true);
  // The store accumulated rather than overwrote: both days are in the
  // archive, the picker data lists both, and the work that was in
  // yesterday's edition honestly reads its second day.
  assert.equal(db._editions.size, 2, "the archive did not keep both editions");
  assert.equal(data.editions.length, 2, "the editions list does not carry both days");
  const fresh = data.items.find((i) => i.title === "Fresh journal paper");
  assert.equal(fresh.trend.daysPresent, 2, "a work in two editions did not read day 2");
  const counted = data.items.find((i) => i.title === "Counted journal paper");
  assert.equal(counted.trend.daysPresent, 1, "a new work did not read day 1");
  // And yesterday is still servable, read only, as itself.
  const archived = await callTrending(db, `https://askcerebrum.org/api/trending?edition=${yesterdayId}`);
  assert.equal(archived.data.archived, true, "the past edition was not served from the archive");
  assert.equal(archived.data.items.length, 1, "the archived edition's items changed");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
