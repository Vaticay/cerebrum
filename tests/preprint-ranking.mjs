/**
 * Preprint relevance ranking regressions.
 *
 * From Dusty's production report (2026-10-08): a search for
 * "Studies involving BSFL waste oil substrates" did not rank the
 * bioRxiv preprint titled "Waste oil substrates reshape the black
 * soldier fly larval gut microbiome" (doi:10.64898/2026.06.09.731207v1)
 * at #1, even though its title contains the exact query phrase.
 *
 * The phrase bonus for contiguous query-term matches in titles was
 * increased from 18 to 30 so exact matches are decisive.
 *
 * Run with: node tests/preprint-ranking.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = await readFile(join(root, "functions/api/search.js"), "utf8");

// 1. Phrase bonus cap must be 30 (was 18) so exact title matches are decisive
assert.ok(
  src.includes("Math.min(30, 10 * (best - 1))"),
  "Phrase bonus must be capped at 30 with 10x multiplier for exact matches"
);

// 2. The comment must reflect the new decisive behavior
assert.ok(
  src.includes("verbatim title match is decisive"),
  "Phrase bonus comment must document decisive behavior for verbatim matches"
);

// 3. Preprint venues must get a journal bonus (not zero)
assert.ok(
  src.includes('isPreprintVenue ? 3 : 0'),
  "Preprints must receive a journal bonus so they compete on topical merit"
);

// 4. bioRxiv must be searched via OpenAlex preprint filter
assert.ok(
  src.includes('filter: "type:preprint"'),
  "bioRxiv search must use OpenAlex preprint filter"
);

// 5. Europe PMC preprint search must exist (SRC:PPR)
assert.ok(
  src.includes("SRC:PPR"),
  "Europe PMC preprint search (SRC:PPR) must be wired in"
);

console.log("All preprint ranking tests passed.");
