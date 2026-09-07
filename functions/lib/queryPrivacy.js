/**
 * The single place that decides what may be remembered about a search.
 *
 * WHY THIS EXISTS
 * A scientific question is often the most sensitive thing a person will ever
 * type into this product. "Is my son's rash a sign of Kawasaki disease",
 * "interactions between sertraline and my mother's chemotherapy", an
 * unpublished hypothesis a competitor would pay for — these arrive at the
 * same endpoint as "how does CRISPR work", and until now they were treated
 * identically: written verbatim into `query_intelligence.raw_query`, used as
 * the literal primary key of `answer_cache` and `paper_cache`, shared across
 * every user, and never deleted.
 *
 * That combination meant one user's private question could surface in another
 * user's results, and that the database held a permanent, readable log of
 * what everyone had ever asked. Neither was ever disclosed.
 *
 * THE MODEL
 *
 *   classifyQuery()  decides whether a question is safe to persist at all.
 *   cacheKey()       produces a non-reversible key for the ones that are.
 *
 * Two ideas do the work:
 *
 * 1. Sensitive questions are never written to shared storage. Not hashed,
 *    not truncated — not written. They are answered from live retrieval and
 *    forgotten. A cache miss costs a few seconds; a leak costs someone their
 *    privacy, and the asymmetry is not close.
 *
 * 2. Everything else is keyed by HMAC, not by the text. The old key was the
 *    query lowercased with punctuation stripped, which is to say: the query.
 *    Anyone with read access to the table could recover every question ever
 *    asked by reading the primary keys. An HMAC under a server secret is
 *    stable enough to serve as a cache key and cannot be read backwards, and
 *    rotating QUERY_KEY_SECRET retires the whole cache.
 *
 * The classifier is deliberately biased toward "do not persist". A false
 * positive means a slower answer. A false negative means someone's medical
 * question is in a shared table forever.
 */

/**
 * Signals that a question is about a specific person, a health situation, or
 * unpublished work — rather than about the literature in general.
 *
 * These are matched against the query text only, never logged.
 */
/* Bare "I" is included deliberately. Without it "why do I get migraines" and
 * "should I take metformin" read as impersonal. The known cost is scientific
 * notation like "mitochondrial complex I" — which, paired with a health word,
 * would be treated as personal and simply not cached. That is the right way
 * for this to be wrong. */
const FIRST_PERSON = /\b(my|our|i|i['’]m|i am|i have|i was|we are|we have|me|myself|mine)\b/i;

/* Possessive + a clinical noun within a few words. The window matters: "my
 * mother's chemotherapy" and "my son has a rash" both need to match, and both
 * put words between the possessive and the noun. */
const CLINICAL_CONTEXT = new RegExp(
  "\\b(?:my|our|his|her|their|the patient(?:'|’)?s?|a patient)\\b(?:\\W+\\w+){0,5}\\W+" +
  "(?:diagnos\\w*|symptom\\w*|result\\w*|scan|biops\\w*|bloodwork|labs?|tumou?r\\w*|cancer|chemo\\w*|radiotherapy|" +
  "dose|dosage|prescription|medication|treatment|therapy|condition|disease|illness|rash|pain|test|surgery|" +
  "meds|antidepressant\\w*|insulin|seizure\\w*|relapse)\\b",
  "i"
);

/* A relationship word beside a health word is the same situation stated the
 * other way round: "sertraline and my mother chemotherapy". */
const FAMILY_HEALTH = new RegExp(
  "\\b(?:my|our|his|her|their)\\b\\W+(?:\\w+\\W+){0,2}" +
  "(?:mother|mom|mum|father|dad|son|daughter|child|kid|wife|husband|partner|spouse|sister|brother|parent|grandmother|grandfather|baby|infant)\\b",
  "i"
);

/** Categories where even an impersonal question is worth not retaining. */
const SENSITIVE_TOPIC = new RegExp(
  [
    // Mental health and self-harm
    "suicid", "self.?harm", "self.?injur", "overdos", "kill myself",
    // Reproductive and sexual health
    "abortion", "miscarriage", "infertility", "erectile", "sexually transmitted",
    "\\bsti\\b", "\\bstd\\b", "hiv", "aids\\b", "contracept",
    // Stigmatised conditions
    "addiction", "alcoholism", "substance abuse", "eating disorder",
    "anorexia", "bulimia", "schizophren", "bipolar", "psychosis",
    // Genetic and identity
    "genetic test", "\\b23andme\\b", "carrier status", "gender dysphoria",
    "transition(?:ing)? hormone",
    // Legal/immigration exposure
    "asylum", "deportation", "criminal record",
  ].join("|"),
  "i"
);

/** Identifiers that should never end up in a shared row. */
const DIRECT_IDENTIFIER = new RegExp(
  [
    "[\\w.+-]+@[\\w-]+\\.[\\w.]+",           // email address
    "\\b\\d{3}-\\d{2}-\\d{4}\\b",             // US SSN shape
    "\\bmrn\\s*[:#]?\\s*\\d+",                // medical record number
    "\\b(?:\\+?1[ .-]?)?\\(?\\d{3}\\)?[ .-]?\\d{3}[ .-]?\\d{4}\\b", // phone
    "\\bpatient\\s+(?:id|number)\\b",
    "\\bdob\\b|\\bdate of birth\\b",
  ].join("|"),
  "i"
);

/* Any word that turns a general question into a health question. Kept broad
 * on purpose — the cost of over-matching is a slower answer. */
const HEALTH_WORD = new RegExp(
  [
    "symptom", "pain", "doctor", "diagnos", "treat", "medicat", "\\bdrugs?\\b", "dose", "dosage",
    "disease", "condition", "surgery", "therapy", "risk of", "should i take", "side effects?",
    "migraine", "headache", "nausea", "fatigue", "insomnia", "anxiety", "depress", "allerg",
    "rash", "fever", "infection", "cancer", "tumou?r", "diabet", "asthma", "seizure",
    "blood pressure", "cholesterol", "heart", "liver", "kidney", "thyroid",
    "pregnan", "menopaus", "\\bdiet\\b", "supplement", "vitamin", "prescri",
  ].join("|"),
  "i"
);

/** Language that marks work not yet public. */
const UNPUBLISHED = /\b(unpublished|our lab['’]?s|my lab['’]?s|our (?:preliminary|pilot|internal)|pre.?publication|under review|confidential|proprietary|patent pending|my (?:thesis|dissertation|manuscript)|our manuscript)\b/i;

/**
 * Classify a query for retention purposes.
 *
 * Returns:
 *   persist   — may this question be written to shared storage at all?
 *   cacheable — may an ANSWER to it be cached and served to someone else?
 *   reason    — a short category, for aggregate metrics only. Never the text.
 *
 * Note `cacheable` and `persist` move together today. They are separate
 * fields because they answer different questions and a future change may
 * reasonably split them; keeping them distinct means that change is a one-line
 * edit here rather than an audit of every call site.
 */
export function classifyQuery(query) {
  const q = String(query || "");
  if (!q.trim()) return { persist: false, cacheable: false, reason: "empty" };

  if (DIRECT_IDENTIFIER.test(q)) return { persist: false, cacheable: false, reason: "identifier" };
  if (SENSITIVE_TOPIC.test(q)) return { persist: false, cacheable: false, reason: "sensitive_topic" };
  if (CLINICAL_CONTEXT.test(q)) return { persist: false, cacheable: false, reason: "personal_clinical" };
  if (UNPUBLISHED.test(q)) return { persist: false, cacheable: false, reason: "unpublished_work" };

  /* A first-person question is usually personal even when the topic is not
   * obviously clinical — "why do I get migraines from red wine" is a health
   * question about one person. Combined with any health word, treat it as
   * personal. */
  if (FAMILY_HEALTH.test(q) && HEALTH_WORD.test(q)) {
    return { persist: false, cacheable: false, reason: "family_health" };
  }
  if (FIRST_PERSON.test(q) && HEALTH_WORD.test(q)) {
    return { persist: false, cacheable: false, reason: "personal_health" };
  }

  /* Very long questions tend to carry pasted context — a case description, an
   * abstract in progress, an email. Retention risk rises with length while
   * cache value collapses, because a 600-character question will never be
   * asked twice in the same words. */
  if (q.length > 400) return { persist: false, cacheable: false, reason: "long_form" };

  return { persist: true, cacheable: true, reason: "general" };
}

/**
 * A non-reversible cache key.
 *
 * `version` is folded in so a change to the answer format retires old entries
 * without a migration, and the secret means the key cannot be turned back
 * into the question. Falls back to a build constant when unset so a
 * deployment without secrets still functions — set QUERY_KEY_SECRET.
 */
export async function cacheKey(query, env, version = "v8") {
  const normalized = String(query || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const secret = (env && (env.QUERY_KEY_SECRET || env.JWT_SECRET)) || "cerebrum-query-key-v1";
  const data = new TextEncoder().encode(`${secret}|${version}|${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${version}:${hex.slice(0, 32)}`;
}

/** How long a cached answer stays servable. */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
