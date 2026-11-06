// Retraction and editorial notice resolution (2026-11-06, Scite audit
// wave 1, ballot decision 5). Pure parsers plus the multi signal rule
// plus a batched resolver with an injectable fetch, so the rule is
// unit testable without any network.
//
// Sources, all free and keyless:
//   - Crossref work records. The `updated-by` array on a work lists
//     the notices that update it (retraction, withdrawal, expression
//     of concern, correction), each with the notice DOI, its date,
//     and a `source` field: "retraction-watch" when the assertion
//     comes from the Retraction Watch database Crossref acquired in
//     September 2023, or the publisher's own deposit otherwise. One
//     channel, two distinguishable asserters, both named in output.
//   - Europe PMC plus PubMed. One batched Europe PMC lite search
//     maps DOIs to PMIDs; one batched PubMed esummary call returns
//     each paper's publication types, where "Retracted Publication"
//     is the MEDLINE retraction mark. A different curation path from
//     Crossref, which is what makes it an independent channel.
//   - OpenAlex. `is_retracted` on the work record, batchable for up
//     to 50 DOIs in one call. Thinner provenance than the other two
//     (a bare boolean, no notice), so it corroborates and is never
//     the sole basis for the settled wording on its own either.
//
// THE MULTI SIGNAL RULE (the contract every surface renders):
//   A paper is presented as "retracted" (settled wording) only when
//   at least TWO of the three channels independently report a
//   retraction class event (retraction, withdrawal, removal).
//   Exactly one channel reporting a retraction class event yields
//   status "reported": the flag still shows, worded as reported by
//   that one named source, never as settled fact.
//   An expression of concern is a publisher's own notice by nature,
//   so it is shown as itself from any single channel that carries
//   it, always with the channel named.
//   A correction alone yields the quiet "corrected" status.
//   When at least one channel answered and none reported anything,
//   the status is "none" and surfaces render nothing: no notice
//   found is never printed as "not retracted".
//   When no channel could answer, or the paper has no DOI, the
//   status is "unknown" and surfaces render nothing. Unverifiable
//   is not clean.

export function normalizeRetractionDoi(raw) {
  const d = String(raw || "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/\/+$/, "")
    .trim()
    .replace(/[.,;:!?)\]]+$/, "");
  return /^10\.\d{4,9}\//.test(d) ? d.toLowerCase() : null;
}

function datePartsToIso(parts) {
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return null;
  const [y, m, d] = parts[0];
  if (!y) return null;
  const mm = m ? String(m).padStart(2, "0") : "01";
  const dd = d ? String(d).padStart(2, "0") : "01";
  return `${y}-${mm}-${dd}`;
}

// One Crossref work message -> its notice list. Each notice:
// { kind, date, noticeDoi, via } where via is the display name of the
// asserter ("Retraction Watch" or "Crossref" for a publisher deposit).
export function crossrefNotices(message) {
  const out = [];
  const updates = message && Array.isArray(message["updated-by"]) ? message["updated-by"] : [];
  for (const u of updates) {
    if (!u || typeof u !== "object") continue;
    const t = String(u.type || "").toLowerCase();
    let kind = "other";
    if (t.includes("retract")) kind = "retraction";
    else if (t.includes("withdraw") || t.includes("removal") || t.includes("removed")) kind = "withdrawal";
    else if (t.includes("concern")) kind = "concern";
    else if (t.includes("correct") || t.includes("erratum") || t.includes("corrigendum")) kind = "correction";
    if (kind === "other") continue;
    out.push({
      kind,
      date: datePartsToIso(u.updated && u.updated["date-parts"]),
      noticeDoi: u.DOI ? String(u.DOI).toLowerCase() : null,
      via: String(u.source || "").toLowerCase() === "retraction-watch" ? "Retraction Watch" : "Crossref",
    });
  }
  return out;
}

// One PubMed esummary entry -> { retracted, concern } or null when the
// entry is not a usable record.
export function pubmedSignal(entry) {
  if (!entry || typeof entry !== "object" || entry.error) return null;
  const types = Array.isArray(entry.pubtype) ? entry.pubtype.map((x) => String(x).toLowerCase()) : [];
  return {
    retracted: types.some((t) => t.includes("retracted publication")),
    concern: types.some((t) => t.includes("expression of concern")),
  };
}

// One OpenAlex work -> { retracted } or null.
export function openAlexSignal(work) {
  if (!work || typeof work !== "object") return null;
  if (typeof work.is_retracted !== "boolean") return null;
  return { retracted: work.is_retracted };
}

const RETRACTION_KINDS = new Set(["retraction", "withdrawal"]);

// Combine the three channel answers for one DOI into the verdict
// every surface renders. Each channel argument is either null (the
// channel could not answer) or its parsed signal:
//   crossref:  { notices: [...] }        (from crossrefNotices)
//   europepmc: { retracted, concern }    (PubMed types via Europe PMC)
//   openalex:  { retracted }             (from openAlexSignal)
export function combineRetractionSignals({ crossref = null, europepmc = null, openalex = null } = {}) {
  const channels = [];
  const notices = crossref && Array.isArray(crossref.notices) ? crossref.notices : [];
  const crossrefRetraction = notices.some((n) => RETRACTION_KINDS.has(n.kind));
  const crossrefConcern = notices.some((n) => n.kind === "concern");
  const crossrefCorrection = notices.some((n) => n.kind === "correction");
  if (crossref) channels.push("Crossref");
  if (europepmc) channels.push("Europe PMC");
  if (openalex) channels.push("OpenAlex");

  // Which channels report a retraction class event, with the display
  // names a reader should see. Inside Crossref the Retraction Watch
  // assertions are named as Retraction Watch, the curation readers
  // and the panel both treat as the authority worth naming.
  const retractionNamedBy = [];
  if (crossrefRetraction) {
    const rw = notices.some((n) => RETRACTION_KINDS.has(n.kind) && n.via === "Retraction Watch");
    retractionNamedBy.push(rw ? "Retraction Watch" : "Crossref");
  }
  if (europepmc && europepmc.retracted) retractionNamedBy.push("Europe PMC");
  if (openalex && openalex.retracted) retractionNamedBy.push("OpenAlex");
  const retractionChannels = (crossrefRetraction ? 1 : 0)
    + (europepmc && europepmc.retracted ? 1 : 0)
    + (openalex && openalex.retracted ? 1 : 0);

  const concernNamedBy = [];
  if (crossrefConcern) {
    const rw = notices.some((n) => n.kind === "concern" && n.via === "Retraction Watch");
    concernNamedBy.push(rw ? "Retraction Watch" : "Crossref");
  }
  if (europepmc && europepmc.concern) concernNamedBy.push("Europe PMC");

  let status = "unknown";
  let namedBy = [];
  if (retractionChannels >= 2) { status = "retracted"; namedBy = retractionNamedBy; }
  else if (retractionChannels === 1) { status = "reported"; namedBy = retractionNamedBy; }
  else if (crossrefConcern || (europepmc && europepmc.concern)) { status = "concern"; namedBy = concernNamedBy; }
  else if (crossrefCorrection) { status = "corrected"; namedBy = ["Crossref"]; }
  else if (channels.length > 0) { status = "none"; }

  return { status, namedBy, channels, notices };
}

// Batched resolution for a list of normalized DOIs. fetchJson(url)
// must return parsed JSON or null on any failure; it is injectable
// for tests. Cost per cold batch of N DOIs: N Crossref calls (one
// per work, unavoidable in the Crossref API) plus ONE Europe PMC
// lite call, ONE PubMed esummary call, and ONE OpenAlex call.
// Returns a map doi -> verdict object from combineRetractionSignals.
export async function resolveRetractionStatuses(dois, fetchJson) {
  const list = [...new Set((dois || []).filter(Boolean))];
  const out = {};
  if (!list.length) return out;

  const crossrefBy = {};
  const openalexBy = {};
  const epmcBy = {};

  const crossrefCalls = list.map(async (doi) => {
    const j = await fetchJson("https://api.crossref.org/works/" + encodeURIComponent(doi));
    if (j && j.message) crossrefBy[doi] = { notices: crossrefNotices(j.message) };
  });

  const openalexCall = (async () => {
    const filter = list.map((d) => encodeURIComponent(d)).join("|");
    const j = await fetchJson(`https://api.openalex.org/works?filter=doi:${filter}&select=id,doi,is_retracted&per-page=${Math.min(100, list.length + 5)}`);
    const results = j && Array.isArray(j.results) ? j.results : [];
    for (const w of results) {
      const doi = normalizeRetractionDoi(w && w.doi);
      const sig = openAlexSignal(w);
      if (doi && sig) openalexBy[doi] = sig;
    }
  })();

  const epmcCall = (async () => {
    const q = list.map((d) => `DOI:"${d}"`).join(" OR ");
    const j = await fetchJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&resultType=lite&pageSize=${Math.min(100, list.length + 5)}`);
    const results = j && j.resultList && Array.isArray(j.resultList.result) ? j.resultList.result : [];
    const pmidToDoi = {};
    for (const r of results) {
      const doi = normalizeRetractionDoi(r && r.doi);
      if (doi && r.pmid) pmidToDoi[String(r.pmid)] = doi;
    }
    const pmids = Object.keys(pmidToDoi);
    if (!pmids.length) return;
    const s = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmids.join(",")}&retmode=json`);
    const result = s && s.result && typeof s.result === "object" ? s.result : {};
    for (const pmid of pmids) {
      const sig = pubmedSignal(result[pmid]);
      if (sig) epmcBy[pmidToDoi[pmid]] = sig;
    }
  })();

  await Promise.allSettled([...crossrefCalls, openalexCall, epmcCall]);

  for (const doi of list) {
    out[doi] = combineRetractionSignals({
      crossref: crossrefBy[doi] || null,
      europepmc: epmcBy[doi] || null,
      openalex: openalexBy[doi] || null,
    });
  }
  return out;
}
