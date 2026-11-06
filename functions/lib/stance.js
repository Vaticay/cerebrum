/* Stance classification over citation statements (2026-11-06, statements
 * lane, Scite audit Standard build, phase 2).
 *
 * Semantic Scholar gives us the citing sentence (contexts) and a PURPOSE
 * label (intents: background, methodology, result). Purpose is not stance:
 * S2 does not sell or give supporting / contrasting / mentioning. This
 * module is Cerebrum's own classifier, run over the sentence at ingest
 * time, and its labels are Cerebrum's own read of each sentence.
 *
 * The standard is rhetorical function, the same one Scite publishes for
 * its own classifier: SUPPORTING requires the citing paper's own primary
 * evidence agreeing with the cited work. A citation that merely uses the
 * same method, reagent, or software is MENTIONING, never supporting.
 * CONTRASTING requires the sentence to set the citing paper's evidence or
 * argument against the cited work (failed replication, contrary results,
 * explicit disagreement). Everything else is MENTIONING: background,
 * attribution, description of the cited work, neutral use.
 *
 * Design: transparent cue rules, no model call, no score. The classifier
 * returns the label plus the cues that fired, so a label can be audited
 * and the eval harness (tests/statements-stance.mjs and the lane's held
 * out hand labelled set) can measure it honestly. Both this label and
 * the S2 intent are stored and shown; neither is dressed up as the
 * other.
 */

export const STANCES = ["supporting", "contradicting", "mentioning"];

/* Plain display words for the S2 purpose labels. The UI shows these next
 * to our stance label so both judgments stay visible (ballot decision 4:
 * both labels on disagreement, no numeric confidence anywhere). */
export const INTENT_WORDS = {
  background: "Background",
  methodology: "Method",
  result: "Results",
};

function has(re, text) {
  return re.test(text);
}

/* Contradiction cues: the sentence puts the citing paper's own evidence
 * or a named result against the cited work. Ordered strongest first.
 * Each pattern is anchor directed in context because every sentence in
 * the corpus is, by construction, a sentence that cites the anchor. */
const CONTRAST_CUES = [
  /\bin contrast (to|with)\b/,
  /\bcontrary to\b/,
  /\bcontradict(s|ed|ing|ion|ions|ory)?\b/,
  /\bfailed to (replicate|reproduce|confirm|find)\b/,
  /\b(could|can|cannot|could not|did not|does not|do not) (replicate|reproduce|confirm)\b/,
  /\bunable to (replicate|reproduce|confirm)\b/,
  /\bno replication\b/,
  /\bdisagree(s|d|ment)? (with|that)\b/,
  /\brefut(e|es|ed|ing|ation)\b/,
  /\binconsistent with\b/,
  /\bnot (be )?supported by\b/,
  /\bfound no (evidence|support|significant|effect)\b/,
  /\bno (significant )?(difference|effect|association) was (found|observed|detected)\b/,
  /\bchallenges? the (claim|findings?|conclusions?|view|notion)\b/,
  /\bcasts? doubt\b/,
  /\bwe (question|doubt)\b/,
  /\bopposite (results?|findings?|effects?|direction)\b/,
  /\bdid not (find|observe|detect|show)\b[^.]{0,60}\b(however|in contrast|contrary)\b/,
  /\bhowever,? (we|our|the|this)\b[^.]{0,80}\b(no|not|failed|absent|contrary|inconsistent)\b/,
  /\bresults? (were|are) (not|never) (replicated|reproduced|confirmed)\b/,
  /\black(s|ing)? (of )?(support|evidence|replication)\b/,
  /* Falsity verdicts and dispute vocabulary, added from the dev eval
   * (Wakefield, Bem, power posing, Polderman anchors): a sentence that
   * calls the cited work discredited or falsified, reports evidence of
   * no link, or names replication problems or methodological criticisms
   * aimed at it is disputing the work, not mentioning it. */
  /\bdiscredited\b/,
  /\bfalsified (report|paper|study|results|data|claim)\b/,
  /\b(medical |scientific )?hoax\b/,
  /\bspurious(ly)? (suggest|claim|link|association|finding)/,
  /\bno (causal )?(link|association|relationship) (between|with)\b/,
  /\bevidence that there is no\b/,
  /\breplication (problems|crisis|failures)\b/,
  /\bmethodological criticisms\b/,
  /\bcriticisms (of|towards|toward|against|directed at)\b/,
  /\bbiased (estimates|results|findings)\b/,
];

/* Support cues: the citing paper's OWN evidence, stated in the sentence,
 * agreeing with the cited work. First person evidence framing plus an
 * agreement predicate; agreement about a method ("we used their method")
 * does not match these patterns and falls through to mentioning, which
 * is the whole point of the rhetorical function standard. */
const SUPPORT_CUES = [
  /\b(our|the present|this|these) (results?|findings?|data|study|analysis|observations?)\b[^.]{0,80}\b(consistent with|in agreement with|in line with|support|confirm|corroborat|align)/,
  /\b(we|our (results?|findings?|data))\b[^.]{0,60}\b(confirm|replicat|reproduc|corroborat)/,
  /\bconsistent with (the )?(findings?|results?|conclusions?|observations?|work) of\b/,
  /\bin agreement with (the )?(findings?|results?|work|study)\b/,
  /\bconfirm(s|ed|ing)? (the )?(findings?|results?|conclusions?|observations?)\b[^.]{0,40}\bof\b/,
  /\breplicat(es|ed|ing|ion of) (the )?(findings?|results?|work|study)\b/,
  /\bsupport(s|ed|ing)? (the )?(findings?|conclusions?|hypothesis|claim|view) (of|that|proposed)\b/,
  /\bwe (also )?(found|observed|detected|showed)\b[^.]{0,60}\b(similar|consistent|same|comparable)\b/,
  /\bsimilar (results?|findings?) (were|was) (also )?(found|observed|reported|obtained)\b/,
  /\bextends? (the )?(findings?|results?|work) of\b[^.]{0,60}\b(showing|demonstrating|finding)\b/,
  /\bcorroborat(es|ed|ing)\b/,
  /\b(validat|verifi)(es|ed|ing)\b[^.]{0,40}\b(findings?|results?|method|approach|model)\b/,
  /* Agreement shapes the first cue list missed, from the dev eval: an
   * own result stated to support prior work, and a reported successful
   * replication of the cited result. */
  /\bresults? supports? (previous|prior|earlier|previously)\b/,
  /\bsuccessful replications? of\b/,
];

/* Method use markers: present alone they confirm mentioning, and they
 * also veto a support call when the only agreement in the sentence is
 * about the method itself. */
const METHOD_CUES = [
  /\b(using|used|use|uses|following|adopted?|adapted?|employ(ed|ing)?|performed (with|using)|carried out (with|using|following))\b[^.]{0,50}\b(method|protocol|procedure|approach|technique|algorithm|software|pipeline|framework|assay|kit)\b/,
  /\bas (described|reported|proposed|developed|published) (by|in)\b/,
  /\baccording to (the )?(method|protocol|procedure|guidelines?)\b/,
];

export function classifyStatement(rawText, intents) {
  const text = String(rawText || "").replace(/\s+/g, " ").trim();
  const lower = " " + text.toLowerCase() + " ";
  const intentList = Array.isArray(intents) ? intents.map((i) => String(i || "").toLowerCase()) : [];
  const cues = [];

  for (const re of CONTRAST_CUES) {
    if (has(re, lower)) { cues.push("contrast:" + re.source.slice(0, 40)); break; }
  }
  if (cues.length) return { stance: "contradicting", cues };

  const methodOnly = intentList.length > 0 && intentList.every((i) => i === "methodology");
  let supportHit = null;
  for (const re of SUPPORT_CUES) {
    if (has(re, lower)) { supportHit = re; break; }
  }
  if (supportHit) {
    const methodHit = METHOD_CUES.some((re) => has(re, lower));
    /* A sentence whose only move is adopting the cited method is method
     * use, even if it carries a soft agreement word about the method.
     * Support cues above are evidence framed, so this veto only fires
     * when a method marker is present AND the matched support cue is
     * one of the method adjacent ones (validate or verify the method). */
    const methodAdjacent = /validat|verifi/.test(supportHit.source);
    if (!(methodHit && methodAdjacent)) {
      return { stance: "supporting", cues: ["support:" + supportHit.source.slice(0, 40)] };
    }
    cues.push("method-veto");
  }
  if (methodOnly) cues.push("intent:methodology-only");
  return { stance: "mentioning", cues };
}

/* Display shape for a stored statement, shared by the API and tests. */
export function intentWord(intents) {
  if (!Array.isArray(intents)) return null;
  for (const i of intents) {
    const w = INTENT_WORDS[String(i || "").toLowerCase()];
    if (w) return w;
  }
  return null;
}
