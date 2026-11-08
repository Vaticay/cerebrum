// Cerebrum MCP endpoint. First version.
//
// MCP is the Model Context Protocol. This file lets assistants such as
// ChatGPT and Claude call Cerebrum search as a tool, the same way Scite,
// Consensus and Paperguide now ship their own MCP servers.
//
// Transport choice. Cloudflare Pages maps a file under functions/api to
// the matching path under /api, so this file serves POST /api/mcp. A thin
// wrapper at functions/mcp.js re exports onRequest from here, so the
// conventional root path /mcp serves the exact same handler. One
// implementation, two addresses, no drift between them.
//
// The transport is stateless Streamable HTTP with plain JSON bodies.
// There are no sessions, no server sent events and no streaming in this
// version. Each POST carries one JSON RPC 2.0 message (a small batch
// array is also accepted) and gets one JSON RPC response, except
// notifications, which get HTTP 202 with no body.
//
// The JSON RPC shaping lives in handleRpcMessage and the two format
// helpers, all pure or runner injected, so tests can exercise the whole
// protocol without any network. onRequest stays thin: method gate, rate
// limit, body parse, dispatch.

import { corsHeaders, clientIp, privacyKey, json } from "../lib/http.js";
import { checkRateLimit, checkRateLimitMemoryOnly } from "../lib/rateLimit.js";
import { normalizeDoi, readStatements } from "../lib/statements.js";

export const MCP_PROTOCOL_VERSION = "2025-03-26";
export const MCP_SERVER_INFO = { name: "cerebrum", version: "1.0.0" };

// Server identity surfaces beyond the name and version (2026-10-14,
// MCP structured output wave): the icon is the site's own 512 by 512
// mark, served from the site root (public/icon-512.png, the same mark
// the directory listing package holds), because directory scanners
// read the live server and the 180 by 180 touch icon is below the
// size some of them ask for; the touch icon keeps its own job on
// devices. The documentation address is the features page, which is
// the URL the directory listing package already names as the
// documentation URL. Both ride on the initialize result and on the
// human readable GET description so a directory scanner and a person
// see the same identity.
export const MCP_ICON_URL = "https://askcerebrum.org/icon-512.png";
export const MCP_DOCUMENTATION_URL = "https://askcerebrum.org/features";

// Aligned with anonymous search in functions/api/search.js, which allows
// 20 requests per minute per client. MCP calls proxy that endpoint, so a
// looser limit here would just move the same cost to a different door.
export const MCP_RATE_LIMIT = 20;
export const MCP_RATE_WINDOW_MS = 60000;

// Batch cap (2026-10-16, audit finding 10): a batch is one HTTP
// request, but every tools/call entry in it runs a full upstream
// search, the same cost the 20 per minute limit above exists to
// bound. Five entries keeps legitimate fan out working while one
// request can never spend more than a quarter of the minute budget
// (5 of 20) at once. Entries past the cap are not executed at all:
// the whole batch is rejected before dispatch.
export const MCP_MAX_BATCH = 5;

// Body ceiling (2026-10-16, audit finding 10): the bounded reader
// pattern the sibling JSON endpoints use through readJsonBody in
// functions/lib/http.js, with the same 32,000 byte ceiling the pro,
// report, and cortex endpoints use. An MCP message carries a short
// research question, so this is generous for real traffic.
export const MCP_MAX_BODY_BYTES = 32_000;

const MCP_USER_AGENT = "Cerebrum MCP 1.0.0 (https://askcerebrum.org)";
const TRENDING_PER_SECTION = 5;

// The list cap for get_statements, matching MAX_DOIS in
// functions/api/statements.js: one call can never ask the store for
// more papers than the endpoint itself serves at once.
const STATEMENTS_MAX_DOIS = 20;

// The stance counts shape both new tools ship, declared once so the
// two output schemas cannot drift apart. Null is the honest state
// for a paper whose sentences are not ready, so the counts ship as
// an object or as null, in the type list idiom the older schemas
// use. Counts only: the statements program's standing rule is no
// numeric confidence anywhere.
const STANCE_COUNTS_SCHEMA = {
  type: ["object", "null"],
  properties: {
    supporting: { type: "integer" },
    contradicting: { type: "integer" },
    mentioning: { type: "integer" },
  },
  required: ["supporting", "contradicting", "mentioning"],
  additionalProperties: false,
};

// Tool titles and annotations are the values drafted in
// docs/mcp-listing/claude-listing.json for the directory submissions,
// verified against what the tools actually do. Every tool only
// reads: none writes, deletes, or changes any state. Every tool
// reaches the open scholarly web (search queries the public indexes,
// trending serves the current edition built from live sources, and
// the statements and reception tools serve what Cerebrum and its
// sources collected from that same web), so all are open world in
// the MCP sense. Anthropic's directory requires a title and
// the applicable hints on every tool, and OpenAI's submission scan
// imports them from this response. The two tools added on 2026-11-07
// (get_statements, get_reception_report) are drafted to the same
// standard and verified the same way; the listing package itself is
// untouched, as submissions stay parked.
export const TOOLS = [
  {
    name: "search_literature",
    title: "Search the literature",
    description:
      "Search the scientific literature for a research question and return a cited answer with a numbered source list. Use this when you need evidence from papers rather than general knowledge.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A research question or topic to search for in the scientific literature.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    // The structured twin of the text result (2026-10-14): every
    // field the text block states in prose is also shipped as data
    // in structuredContent, shaped exactly by this schema, so a host
    // can read the sources, the coverage, and the record address
    // without parsing sentences. The text block stays byte stable
    // for clients that only read text.
    outputSchema: {
      type: "object",
      properties: {
        answer: { type: "string" },
        synthesisMode: { type: ["string", "null"] },
        degraded: { type: ["boolean", "null"] },
        sources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              authors: { type: ["string", "null"] },
              year: { type: ["integer", "null"] },
              doi: { type: ["string", "null"] },
              url: { type: ["string", "null"] },
              cited: { type: "boolean" },
            },
            required: ["title", "authors", "year", "doi", "url", "cited"],
            additionalProperties: false,
          },
        },
        sourceCount: { type: "integer" },
        citedCount: { type: "integer" },
        coverage: {
          type: ["object", "null"],
          properties: {
            gathered: { type: ["integer", "null"] },
            cited: { type: ["integer", "null"] },
          },
          required: ["gathered", "cited"],
          additionalProperties: false,
        },
        coverageNote: { type: ["string", "null"] },
        recordUrl: { type: ["string", "null"] },
        record: {
          type: ["object", "null"],
          properties: {
            id: { type: "string" },
            url: { type: "string" },
            question: { type: ["string", "null"] },
            askedAt: { type: ["string", "null"] },
            sourceCount: { type: ["integer", "null"] },
            citedCount: { type: ["integer", "null"] },
            databaseCount: { type: ["integer", "null"] },
          },
          required: ["id", "url", "question", "askedAt", "sourceCount", "citedCount", "databaseCount"],
          additionalProperties: false,
        },
      },
      required: ["answer", "synthesisMode", "degraded", "sources", "sourceCount", "citedCount", "coverage", "coverageNote", "recordUrl", "record"],
      additionalProperties: false,
    },
  },
  {
    name: "get_trending",
    title: "Today in Science",
    description:
      "Get the current Today in Science edition and return the top headlines grouped by section with links to the original stories.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    // The structured twin of the text result (2026-10-14): the same
    // sections and headlines the text block prints, as data.
    outputSchema: {
      type: "object",
      properties: {
        edition: { type: ["string", "null"] },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    source: { type: ["string", "null"] },
                    url: { type: ["string", "null"] },
                  },
                  required: ["title", "source", "url"],
                  additionalProperties: false,
                },
              },
            },
            required: ["name", "items"],
            additionalProperties: false,
          },
        },
        itemCount: { type: "integer" },
      },
      required: ["edition", "sections", "itemCount"],
      additionalProperties: false,
    },
  },
  {
    name: "get_statements",
    title: "Citation statements for a paper",
    description:
      "Look up what later papers say about a paper, in the citing sentences Cerebrum has collected and classified for it. Returns, for each DOI, whether its sentences are ready, still being collected, or settled empty, the counts by stance, and the sentences themselves, each with two separate labels: the stance Cerebrum assigned and the purpose Semantic Scholar recorded. A paper still being collected is reported as collecting, never as holding nothing.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        doi: {
          type: "string",
          description: "One DOI for the paper to look up. Give either doi or dois, not both.",
        },
        dois: {
          type: "array",
          items: { type: "string" },
          description: "Several DOIs to look up in one call, up to 20. Give either doi or dois, not both.",
        },
      },
      additionalProperties: false,
    },
    // The structured twin of the text result, in the same discipline
    // as the two older tools: every fact the text block states is
    // also shipped as data under this schema. A collecting paper
    // ships counts null and no sentences, so the data can never be
    // misread as an empty result.
    outputSchema: {
      type: "object",
      properties: {
        papers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              doi: { type: "string" },
              status: { type: "string" },
              counts: STANCE_COUNTS_SCHEMA,
              heldSentences: { type: "integer" },
              citingPapers: { type: "integer" },
              totalCitations: { type: "integer" },
              sentences: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sentence: { type: "string" },
                    stance: { type: "string" },
                    purposes: { type: "array", items: { type: "string" } },
                    influential: { type: "boolean" },
                    citingTitle: { type: ["string", "null"] },
                    citingYear: { type: ["integer", "null"] },
                    citingDoi: { type: ["string", "null"] },
                  },
                  required: ["sentence", "stance", "purposes", "influential", "citingTitle", "citingYear", "citingDoi"],
                  additionalProperties: false,
                },
              },
            },
            required: ["doi", "status", "counts", "heldSentences", "citingPapers", "totalCitations", "sentences"],
            additionalProperties: false,
          },
        },
      },
      required: ["papers"],
      additionalProperties: false,
    },
  },
  {
    name: "get_reception_report",
    title: "Reception report for a paper",
    description:
      "Build the standing reception report for one paper: the citation statement counts Cerebrum holds for it, the reception tallies served via scite.ai, and its retraction status under the multi signal rule, where a paper counts as retracted only when at least two of the three checking channels agree. A clean read prints no retraction line at all, and a status no channel could settle is reported as unknown.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        doi: {
          type: "string",
          description: "The DOI of the paper to report on.",
        },
      },
      required: ["doi"],
      additionalProperties: false,
    },
    // The structured twin of the text report. The retraction block
    // always ships, carrying the rule's own status word; the text
    // block is the one that stays silent on a clean read.
    outputSchema: {
      type: "object",
      properties: {
        doi: { type: "string" },
        statementsStatus: { type: "string" },
        statementCounts: STANCE_COUNTS_SCHEMA,
        heldSentences: { type: "integer" },
        tallies: {
          type: ["object", "null"],
          properties: {
            supporting: { type: "integer" },
            contradicting: { type: "integer" },
            mentioning: { type: "integer" },
            total: { type: "integer" },
            citingPublications: { type: "integer" },
          },
          required: ["supporting", "contradicting", "mentioning", "total", "citingPublications"],
          additionalProperties: false,
        },
        retraction: {
          type: "object",
          properties: {
            status: { type: "string" },
            namedBy: { type: "array", items: { type: "string" } },
            channels: { type: "array", items: { type: "string" } },
            notices: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  kind: { type: "string" },
                  date: { type: ["string", "null"] },
                  noticeDoi: { type: ["string", "null"] },
                  via: { type: "string" },
                },
                required: ["kind", "date", "noticeDoi", "via"],
                additionalProperties: false,
              },
            },
          },
          required: ["status", "namedBy", "channels", "notices"],
          additionalProperties: false,
        },
      },
      required: ["doi", "statementsStatus", "statementCounts", "heldSentences", "tallies", "retraction"],
      additionalProperties: false,
    },
  },
];
export const MCP_TOOLS = TOOLS;

// ── JSON RPC shapes ──────────────────────────────────────────────────

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id: id === undefined ? null : id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } };
}

function isObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Parse a raw request body. Malformed JSON is a parse error in JSON RPC
// terms, code -32700, with a null id because no id could be read.
export function parseJsonRpcText(text) {
  try {
    return { message: JSON.parse(String(text == null ? "" : text)) };
  } catch {
    return { error: rpcError(null, -32700, "Parse error") };
  }
}

// ── Source and headline shaping ──────────────────────────────────────

function authorLabel(source) {
  if (!source || typeof source !== "object") return "";
  if (typeof source.authors === "string" && source.authors.trim()) return source.authors.trim();
  if (Array.isArray(source.authors) && source.authors.length) {
    const names = source.authors
      .map((a) => {
        if (typeof a === "string") return a.trim();
        if (a && typeof a === "object") return String(a.name || a.display_name || a.fullName || "").trim();
        return "";
      })
      .filter(Boolean);
    if (!names.length) return "";
    return names.length > 1 ? names[0] + " et al." : names[0];
  }
  if (typeof source.author === "string" && source.author.trim()) return source.author.trim();
  return "";
}

function yearLabel(source) {
  if (!source || typeof source !== "object") return "";
  const raw = source.year || source.publication_year || source.publicationYear || source.publishedYear || "";
  if (raw) return String(raw).trim();
  if (typeof source.date === "string" && /^\d{4}/.test(source.date)) return source.date.slice(0, 4);
  return "";
}

function doiLabel(source) {
  if (!source || typeof source !== "object") return "";
  const raw = String(source.doi || source.DOI || "").trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  if (/^10\.\d{4,9}\//.test(raw)) return raw;
  const url = String(source.url || source.link || "");
  const m = url.match(/doi\.org\/(10\.\d{4,9}\/\S+)/i);
  return m ? m[1].replace(/[.)\]]+$/, "") : "";
}

function urlLabel(source, doi) {
  if (!source || typeof source !== "object") return "";
  const raw = String(source.url || source.link || source.href || "").trim();
  if (raw) return raw;
  return doi ? "https://doi.org/" + doi : "";
}

export function formatSourceLine(source, index) {
  const s = source && typeof source === "object" ? source : {};
  const title = String(s.title || "").trim() || "Untitled";
  const authors = authorLabel(s);
  const year = yearLabel(s);
  const doi = doiLabel(s);
  const url = urlLabel(s, doi);
  let line = `${index + 1}. ${title}`;
  if (authors) line += `. ${authors}`;
  if (year) line += `, ${year}`;
  line += ".";
  if (doi) line += ` DOI: ${doi}.`;
  else if (url) line += ` ${url}.`;
  line += s.uncited ? " Further reading." : " Cited in the answer.";
  return line;
}

function funnelOf(data) {
  const f = isObject(data && data._funnel) ? data._funnel : isObject(data && data._coverage) ? data._coverage : null;
  if (!f) return null;
  const gathered = typeof f.gathered === "number" && Number.isFinite(f.gathered) ? Math.max(0, Math.floor(f.gathered)) : null;
  let cited = typeof f.cited === "number" && Number.isFinite(f.cited) ? Math.max(0, Math.floor(f.cited)) : null;
  const sources = isObject(data) && Array.isArray(data.sources) ? data.sources
    : isObject(data) && Array.isArray(data.papers) ? data.papers : null;
  if (sources) {
    cited = sources.filter((s) => {
      if (!isObject(s)) return false;
      if (typeof s.cited === "boolean") return s.cited;
      return !s.uncited;
    }).length;
  }
  if (gathered === null && cited === null) return null;
  return { gathered, cited };
}

function funnelLine(data) {
  const f = funnelOf(data);
  if (!f) return "";
  const parts = [];
  if (f.gathered !== null) parts.push(`gathered ${f.gathered} record${f.gathered === 1 ? "" : "s"}`);
  if (f.cited !== null) parts.push(`cited ${f.cited} source${f.cited === 1 ? "" : "s"}`);
  return parts.length ? `Coverage: ${parts.join(" and ")}.` : "";
}

// One plain line naming the answer's quality state, from fields the
// search response already carries: synthesisMode says how the answer
// text was produced, degraded says part of the pipeline did not
// complete. A full AI answer gets no line, so an extractive or
// degraded answer never arrives dressed as one. The no results state
// is skipped: it renders its own honest note below, and its degraded
// flag is set by construction rather than by a pipeline failure.
function answerQualityLine(d) {
  if (d.synthesisMode === "extractive") {
    return "Note on quality: this answer was assembled from source excerpts because AI synthesis did not complete.";
  }
  if (d.degraded === true && !d.noResults) {
    return "Note on quality: this answer is degraded because part of the search pipeline did not complete.";
  }
  return "";
}

// The Search record block: when the payload carries a record with a
// permanent id, the tool result names where that record lives, so an
// assistant can point at the run itself and not only its answer. The
// counts come from the record as stored: the source list length, the
// cited flags on it, and the database outcome list. A record without
// an id (a recomputed cache serve: nothing was stored, so there is
// no page to point at) gets no block, and a payload without a record
// stays byte identical to before.
// The one record lookup every surface shares: a payload record
// counts only when it carries a permanent id (an unstored record's
// id was withdrawn at the source, so there is no page to point at).
// The permalink is the stored address when one rides along and is
// derived from the id otherwise.
function recordOf(data) {
  const rec = isObject(data && data._record) ? data._record : null;
  if (!rec || typeof rec.id !== "string" || !rec.id) return null;
  return rec;
}

function recordUrlOf(rec) {
  return typeof rec.url === "string" && rec.url
    ? rec.url
    : "https://askcerebrum.org/record/" + rec.id;
}

function searchRecordBlock(data) {
  const rec = recordOf(data);
  if (!rec) return "";
  const url = recordUrlOf(rec);
  const lines = ["Search record: " + url];
  if (typeof rec.question === "string" && rec.question.trim()) {
    lines.push("Question: " + rec.question.trim());
  }
  if (typeof rec.askedAt === "string" && rec.askedAt) {
    lines.push("Asked: " + rec.askedAt);
  }
  if (Array.isArray(rec.sources)) {
    const cited = rec.sources.filter((s) => isObject(s) && s.cited).length;
    lines.push(`Sources: ${rec.sources.length} in the record, ${cited} cited in the answer.`);
  }
  if (Array.isArray(rec.databases) && rec.databases.length) {
    lines.push(`Databases queried: ${rec.databases.length}.`);
  }
  return lines.join("\n");
}

// ── Structured content ─────────────────────────────────────────────
// The data twin of each text result (2026-10-14). Both are built from
// the same payload fields in the same pass, so the two can never
// drift apart: whatever the text states in prose, the structured
// object states as data, and the outputSchema declared in TOOLS is
// the contract the fixtures hold it to. Nulls are honest: a field
// the payload does not carry ships as null, never as an invention.

function structuredSource(source) {
  const s = source && typeof source === "object" ? source : {};
  const doi = doiLabel(s);
  const url = urlLabel(s, doi);
  const yearText = yearLabel(s);
  return {
    title: String(s.title || "").trim() || "Untitled",
    authors: authorLabel(s) || null,
    year: /^\d{4}$/.test(yearText) ? Number(yearText) : null,
    doi: doi || null,
    url: url || null,
    cited: typeof s.cited === "boolean" ? s.cited : !s.uncited,
  };
}

function structuredSearchContent(d, sources) {
  const structuredSources = (Array.isArray(sources) ? sources : []).map(structuredSource);
  const funnel = funnelOf(d);
  const rec = recordOf(d);
  return {
    answer: typeof d.answer === "string" ? d.answer.trim() : "",
    synthesisMode: typeof d.synthesisMode === "string" && d.synthesisMode ? d.synthesisMode : null,
    degraded: typeof d.degraded === "boolean" ? d.degraded : null,
    sources: structuredSources,
    sourceCount: structuredSources.length,
    citedCount: structuredSources.filter((s) => s.cited).length,
    coverage: funnel ? { gathered: funnel.gathered, cited: funnel.cited } : null,
    coverageNote: typeof d.coverageNote === "string" && d.coverageNote.trim() ? d.coverageNote.trim() : null,
    recordUrl: rec ? recordUrlOf(rec) : null,
    record: rec
      ? {
          id: rec.id,
          url: recordUrlOf(rec),
          question: typeof rec.question === "string" ? rec.question : null,
          askedAt: typeof rec.askedAt === "string" ? rec.askedAt : null,
          sourceCount: Array.isArray(rec.sources) ? rec.sources.length : null,
          citedCount: Array.isArray(rec.sources) ? rec.sources.filter((s) => isObject(s) && s.cited).length : null,
          databaseCount: Array.isArray(rec.databases) ? rec.databases.length : null,
        }
      : null,
  };
}

// Shape a parsed /api/search payload into an MCP tool result. Pure and
// defensive: every field it reads may be absent, because the search
// payload carries several diagnostics only on some paths.
export function formatSearchToolResult(data) {
  const d = isObject(data) ? data : {};
  const answer = typeof d.answer === "string" ? d.answer.trim() : "";
  const sources = Array.isArray(d.sources) ? d.sources : Array.isArray(d.papers) ? d.papers : [];
  const reportedError = typeof d.error === "string" && d.error.trim() && !answer && !sources.length;

  let text;
  if (answer) text = answer;
  else if (reportedError) text = "Cerebrum reported a problem with this search and returned no answer.";
  else if (sources.length) text = "Cerebrum returned sources for this question but no answer text.";
  else text = "Cerebrum found no answer for this question.";

  const quality = answer ? answerQualityLine(d) : "";
  if (quality) text += "\n\n" + quality;

  if (sources.length) {
    text += "\n\nSources\n" + sources.map((s, i) => formatSourceLine(s, i)).join("\n");
  } else {
    text +=
      "\n\nNo sources were returned for this question, so this answer should be treated as ungrounded. Try a different wording or a more specific question.";
  }
  const coverage = funnelLine(d);
  if (coverage) text += "\n\n" + coverage;
  if (typeof d.coverageNote === "string" && d.coverageNote.trim()) {
    text += "\n\nCoverage note: " + d.coverageNote.trim();
  }
  const record = searchRecordBlock(d);
  if (record) text += "\n\n" + record;
  return { content: [{ type: "text", text }], structuredContent: structuredSearchContent(d, sources), isError: false };
}

// Group an edition's items into sections once, so the text result
// and the structured result are two renderings of one grouping and
// cannot disagree about membership, order, or the per section cap.
function trendingSectionsOf(items) {
  const sections = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const title = String(item.title || "").trim();
    if (!title) continue;
    const section = String(item.category || item.section || "").trim() || "General";
    if (!sections.has(section)) sections.set(section, []);
    const bucket = sections.get(section);
    if (bucket.length < TRENDING_PER_SECTION) bucket.push(item);
  }
  return [...sections.entries()].map(([name, bucket]) => ({ name, items: bucket }));
}

function structuredTrendingContent(edition, sections) {
  return {
    edition: edition || null,
    sections: sections.map(({ name, items }) => ({
      name,
      items: items.map((item) => ({
        title: String(item.title || "").trim(),
        source: String(item.source || "").trim() || null,
        url: String(item.url || item.link || "").trim() || null,
      })),
    })),
    itemCount: sections.reduce((n, s) => n + s.items.length, 0),
  };
}

export function formatTrendingToolResult(data) {
  const d = isObject(data) ? data : {};
  const items = Array.isArray(d.items) ? d.items : Array.isArray(d.trending) ? d.trending : [];
  let edition = "";
  if (typeof d.edition === "string" && d.edition.trim()) edition = d.edition.trim();
  else if (typeof d.edition === "number") edition = String(d.edition);
  else if (typeof d.generatedAt === "number" && Number.isFinite(d.generatedAt) && d.generatedAt > 0) {
    edition = new Date(d.generatedAt).toISOString().slice(0, 10);
  }
  const sections = trendingSectionsOf(items);

  let text = edition ? `Today in Science, edition ${edition}.` : "Today in Science, current edition.";
  if (!items.length) {
    text += "\n\nNo headlines were returned for this edition.";
    return { content: [{ type: "text", text }], structuredContent: structuredTrendingContent(edition, sections), isError: false };
  }
  for (const { name, items: bucket } of sections) {
    const lines = bucket.map((item, i) => {
      const title = String(item.title || "").trim();
      const source = String(item.source || "").trim();
      const url = String(item.url || item.link || "").trim();
      let line = `${i + 1}. ${title}`;
      if (source && source !== name) line += ` (${source})`;
      if (url) line += ` ${url}`;
      return line;
    });
    text += `\n\n${name}\n` + lines.join("\n");
  }
  return { content: [{ type: "text", text }], structuredContent: structuredTrendingContent(edition, sections), isError: false };
}

// ── Statements and reception shaping ───────────────────────────────
// The data twins of the two tools added on 2026-11-07, built in the
// same single pass discipline as the search and trending twins:
// whatever the text states, the structured object states as data,
// and the outputSchema declared in TOOLS is the contract. The
// statements store read (functions/lib/statements.js) already
// shapes each paper's entry; these helpers only render it, and they
// hold the program's honesty rules at this surface: a paper that is
// still collecting ships counts null and no sentences, so it can
// never be read as an empty result, and nothing anywhere carries a
// numeric confidence.

function intOrZero(v) {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

function statementCountsOf(entry) {
  const c = isObject(entry && entry.counts) ? entry.counts : null;
  if (!c) return null;
  return {
    supporting: intOrZero(c.supporting),
    contradicting: intOrZero(c.contradicting),
    mentioning: intOrZero(c.mentioning),
  };
}

function structuredStatementSentence(item) {
  const it = isObject(item) ? item : {};
  const citing = isObject(it.citing) ? it.citing : {};
  return {
    sentence: String(it.sentence || ""),
    stance: typeof it.stance === "string" && it.stance ? it.stance : "mentioning",
    purposes: Array.isArray(it.intents) ? it.intents.filter((x) => typeof x === "string" && x) : [],
    influential: it.influential === true,
    citingTitle: typeof citing.title === "string" && citing.title ? citing.title : null,
    citingYear: Number.isInteger(citing.year) ? citing.year : null,
    citingDoi: typeof citing.doi === "string" && citing.doi ? citing.doi : null,
  };
}

// One paper's entry, shaped for either tool. Only a ready entry
// carries counts and sentences: the store read caps the sentence
// page it returns, and heldSentences reports the full held count so
// the page size is never mistaken for the whole.
function structuredStatementPaper(doi, entry) {
  const e = isObject(entry) ? entry : {};
  const status = typeof e.status === "string" && e.status ? e.status : "collecting";
  const ready = status === "ready";
  const items = ready && Array.isArray(e.items) ? e.items : [];
  return {
    doi,
    status,
    counts: ready ? statementCountsOf(e) : null,
    heldSentences: ready ? (Number.isInteger(e.kept) ? e.kept : items.length) : 0,
    citingPapers: ready ? intOrZero(e.citingPapers) : 0,
    totalCitations: intOrZero(e.totalCitations),
    sentences: items.map(structuredStatementSentence),
  };
}

function statementPaperTextLines(p) {
  const lines = [`Paper: ${p.doi}`];
  if (p.status === "ready") {
    const c = p.counts || { supporting: 0, contradicting: 0, mentioning: 0 };
    lines.push(
      `Status: ready. Cerebrum holds ${p.heldSentences} citing sentence${p.heldSentences === 1 ? "" : "s"} ` +
      `from ${p.citingPapers} citing paper${p.citingPapers === 1 ? "" : "s"}: ` +
      `${c.supporting} supporting, ${c.contradicting} contradicting, ${c.mentioning} mentioning.`
    );
    if (p.totalCitations > 0) {
      lines.push(
        `Semantic Scholar lists ${p.totalCitations} citations for this paper in total; ` +
        `sentences exist only where the full text of a citing paper was parsed.`
      );
    }
    if (p.sentences.length) {
      lines.push("Citing sentences:");
      for (const s of p.sentences) {
        let line = `- "${s.sentence}" Stance: ${s.stance}.`;
        if (s.purposes.length) line += ` Purpose: ${s.purposes.join(", ")}.`;
        const from = [];
        if (s.citingTitle) from.push(s.citingTitle);
        if (s.citingYear) from.push(String(s.citingYear));
        if (from.length) line += ` From: ${from.join(", ")}.`;
        if (s.influential) line += " Marked influential by Semantic Scholar.";
        lines.push(line);
      }
      if (p.heldSentences > p.sentences.length) {
        lines.push(`Showing the first ${p.sentences.length} of ${p.heldSentences} held sentences.`);
      }
    }
  } else if (p.status === "empty") {
    lines.push("Status: empty. The collection for this paper finished and held no citing sentences.");
  } else if (p.status === "unavailable") {
    lines.push("Status: unavailable. The statements store could not be read for this paper.");
  } else {
    lines.push(
      "Status: collecting. Cerebrum is still gathering the citing sentences for this paper, " +
      "so nothing can be reported yet. This is not an empty result."
    );
  }
  return lines;
}

// Shape a statements store read (the map readStatements returns, or
// the /api/statements payload's statements member) into a tool
// result covering the DOIs asked for, in the order asked.
export function formatStatementsToolResult(data, dois) {
  const d = isObject(data) ? data : {};
  const order = Array.isArray(dois) && dois.length ? dois : Object.keys(d);
  const papers = order.map((doi) => structuredStatementPaper(doi, d[doi]));
  const text = papers.map((p) => statementPaperTextLines(p).join("\n")).join("\n\n");
  return { content: [{ type: "text", text }], structuredContent: { papers }, isError: false };
}

function structuredRetraction(verdict) {
  const v = isObject(verdict) ? verdict : {};
  const notices = Array.isArray(v.notices) ? v.notices : [];
  return {
    status: typeof v.status === "string" && v.status ? v.status : "unknown",
    namedBy: Array.isArray(v.namedBy) ? v.namedBy.filter((x) => typeof x === "string" && x) : [],
    channels: Array.isArray(v.channels) ? v.channels.filter((x) => typeof x === "string" && x) : [],
    notices: notices.map((n) => {
      const o = isObject(n) ? n : {};
      return {
        kind: String(o.kind || "other"),
        date: typeof o.date === "string" && o.date ? o.date : null,
        noticeDoi: typeof o.noticeDoi === "string" && o.noticeDoi ? o.noticeDoi : null,
        via: String(o.via || ""),
      };
    }),
  };
}

// The retraction wording every surface renders, from the multi
// signal rule in functions/lib/retraction.js: two channels agreeing
// settles "retracted"; one channel is "reported", with the source
// named; a clean read (status none) prints nothing at all, never
// "not retracted"; no channel answering is unknown.
function retractionTextLines(retraction) {
  const named = retraction.namedBy.join(" and ");
  switch (retraction.status) {
    case "retracted":
      return [`Retraction status: retracted, named by ${named}.`];
    case "reported":
      return [`Retraction status: reported as retracted by ${named}, one channel only, so the report is not settled.`];
    case "concern":
      return [`Retraction status: an expression of concern stands for this paper, named by ${named}.`];
    case "corrected":
      return [`Retraction status: a correction is on record for this paper, named by ${named}.`];
    case "unknown":
      return ["Retraction status: unknown. No checking channel could answer for this paper."];
    default:
      return [];
  }
}

// Compose one paper's reception report from its three legs. The
// caller passes the statements entry for the DOI (or null when that
// leg could not answer), the scite tally object (or null), and the
// retraction verdict (or null). Each leg degrades into its own
// honest empty state instead of failing the report, matching how
// the app's reading surfaces treat these feeds.
export function formatReceptionToolResult(data) {
  const d = isObject(data) ? data : {};
  const doi = String(d.doi || "");
  const entry = isObject(d.statements) ? d.statements : { status: "unavailable" };
  const paper = structuredStatementPaper(doi, entry);
  const t = isObject(d.tallies) ? d.tallies : null;
  const tallies = t
    ? {
        supporting: intOrZero(t.supporting),
        contradicting: intOrZero(t.contradicting),
        mentioning: intOrZero(t.mentioning),
        total: intOrZero(t.total),
        citingPublications: intOrZero(t.citingPublications),
      }
    : null;
  const retraction = structuredRetraction(d.retraction);
  const structured = {
    doi,
    statementsStatus: paper.status,
    statementCounts: paper.counts,
    heldSentences: paper.heldSentences,
    tallies,
    retraction,
  };

  const sections = [`Reception report for ${doi}`];
  if (paper.status === "ready" && paper.counts) {
    sections.push(
      `Citation statements held by Cerebrum: ${paper.counts.supporting} supporting, ` +
      `${paper.counts.contradicting} contradicting, ${paper.counts.mentioning} mentioning, ` +
      `across ${paper.heldSentences} held sentence${paper.heldSentences === 1 ? "" : "s"}.`
    );
  } else if (paper.status === "empty") {
    sections.push("Citation statements held by Cerebrum: the collection for this paper settled empty.");
  } else if (paper.status === "unavailable") {
    sections.push("Citation statements held by Cerebrum: the statements store could not be read.");
  } else {
    sections.push("Citation statements held by Cerebrum: still collecting, so no counts yet.");
  }
  if (tallies) {
    sections.push(
      `Reception tallies via scite.ai: ${tallies.supporting} supporting, ${tallies.contradicting} contradicting, ` +
      `${tallies.mentioning} mentioning, across ${tallies.citingPublications} citing publications.`
    );
  } else {
    sections.push("Reception tallies via scite.ai: not available for this paper.");
  }
  sections.push(...retractionTextLines(retraction));
  return { content: [{ type: "text", text: sections.join("\n\n") }], structuredContent: structured, isError: false };
}

// ── Runners ──────────────────────────────────────────────────────────
// A runner performs one upstream call and returns the parsed JSON (or a
// fetch Response, which is normalised here). Tests inject fakes. The
// defaults fetch this site own origin, as the task specifies, so the MCP
// endpoint reuses the public search and trending pipelines exactly as
// they are, including their own rate limits and caching.

async function normalizeRunnerResult(value) {
  if (value && typeof value.json === "function" && typeof value.ok === "boolean") {
    if (!value.ok) throw new Error("upstream status " + (value.status || "unknown"));
    return value.json();
  }
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

export function createDefaultRunners(origin, fetchImpl) {
  const doFetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
  const base = String(origin || "").replace(/\/+$/, "");
  return {
    searchRunner: async (query) => {
      const res = await doFetch(base + "/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": MCP_USER_AGENT,
        },
        body: JSON.stringify({ query }),
      });
      return normalizeRunnerResult(res);
    },
    trendingRunner: async () => {
      const res = await doFetch(base + "/api/trending", {
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": MCP_USER_AGENT },
      });
      return normalizeRunnerResult(res);
    },
    // Read only by construction. When the request carries the D1
    // binding, the runner performs the exact store read the
    // /api/statements endpoint performs (readStatements touches
    // nothing else), so an MCP call can never schedule the
    // endpoint's waitUntil ingestion or spend anything upstream.
    // Without a binding it falls back to a plain GET on the
    // endpoint from this isolate, a call path that carries no
    // waitUntil and so cannot schedule ingestion either.
    statementsRunner: async (dois, ctx) => {
      const env = (ctx && ctx.env) || null;
      if (env && env.DB) {
        return readStatements(env, dois);
      }
      const qs = dois.map((d) => encodeURIComponent(d)).join(",");
      const res = await doFetch(base + "/api/statements?dois=" + qs, {
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": MCP_USER_AGENT },
      });
      const payload = await normalizeRunnerResult(res);
      return isObject(payload) && isObject(payload.statements) ? payload.statements : {};
    },
    // Tallies live in the tallies function's own isolate memory
    // cache, so a same origin GET is the only read that reuses it,
    // the same pattern the search and trending runners set.
    talliesRunner: async (doi) => {
      const res = await doFetch(base + "/api/tallies?dois=" + encodeURIComponent(doi), {
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": MCP_USER_AGENT },
      });
      const payload = await normalizeRunnerResult(res);
      const t = isObject(payload) && isObject(payload.tallies) ? payload.tallies[doi] : null;
      return isObject(t) ? t : null;
    },
    // The retraction verdict comes from the cached serving path of
    // functions/lib/retraction.js (the /api/retractions endpoint,
    // isolate memory in front of a D1 cache), never recomputed per
    // call. A payload without the DOI reads as the rule's own
    // unknown state.
    retractionRunner: async (doi) => {
      const res = await doFetch(base + "/api/retractions?dois=" + encodeURIComponent(doi), {
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": MCP_USER_AGENT },
      });
      const payload = await normalizeRunnerResult(res);
      const v = isObject(payload) && isObject(payload.retractions) ? payload.retractions[doi] : null;
      return isObject(v) ? v : { status: "unknown", namedBy: [], channels: [], notices: [] };
    },
  };
}

function pickSearchRunner(runners, context) {
  if (typeof runners === "function") return runners;
  if (runners && typeof runners.searchRunner === "function") return runners.searchRunner;
  if (runners && typeof runners.search === "function") return runners.search;
  if (runners && typeof runners.runSearch === "function") return runners.runSearch;
  const origin = (context && context.origin) || (runners && runners.origin) || "";
  if (origin) return createDefaultRunners(origin, runners && runners.fetchImpl).searchRunner;
  return null;
}

function pickTrendingRunner(runners, context) {
  if (runners && typeof runners.trendingRunner === "function") return runners.trendingRunner;
  if (runners && typeof runners.trending === "function") return runners.trending;
  if (runners && typeof runners.runTrending === "function") return runners.runTrending;
  if (runners && typeof runners.getTrending === "function") return runners.getTrending;
  const origin = (context && context.origin) || (runners && runners.origin) || "";
  if (origin) return createDefaultRunners(origin, runners && runners.fetchImpl).trendingRunner;
  return null;
}

// The statements picker also accepts the request env as a route to
// the default runner, because its read path is the D1 store itself:
// with a binding present it needs no origin at all.
function pickStatementsRunner(runners, context) {
  if (runners && typeof runners.statementsRunner === "function") return runners.statementsRunner;
  if (runners && typeof runners.statements === "function") return runners.statements;
  if (runners && typeof runners.getStatements === "function") return runners.getStatements;
  const origin = (context && context.origin) || (runners && runners.origin) || "";
  const env = (context && context.env) || (runners && runners.env) || null;
  if ((env && env.DB) || origin) {
    return createDefaultRunners(origin, runners && runners.fetchImpl).statementsRunner;
  }
  return null;
}

function pickTalliesRunner(runners, context) {
  if (runners && typeof runners.talliesRunner === "function") return runners.talliesRunner;
  if (runners && typeof runners.tallies === "function") return runners.tallies;
  if (runners && typeof runners.getTallies === "function") return runners.getTallies;
  const origin = (context && context.origin) || (runners && runners.origin) || "";
  if (origin) return createDefaultRunners(origin, runners && runners.fetchImpl).talliesRunner;
  return null;
}

function pickRetractionRunner(runners, context) {
  if (runners && typeof runners.retractionRunner === "function") return runners.retractionRunner;
  if (runners && typeof runners.retraction === "function") return runners.retraction;
  if (runners && typeof runners.getRetraction === "function") return runners.getRetraction;
  const origin = (context && context.origin) || (runners && runners.origin) || "";
  if (origin) return createDefaultRunners(origin, runners && runners.fetchImpl).retractionRunner;
  return null;
}

// ── Tools/call ───────────────────────────────────────────────────────

async function callTool(id, params, runners, context) {
  if (!isObject(params) || typeof params.name !== "string" || !params.name.trim()) {
    return rpcError(id, -32602, "Invalid params");
  }
  const name = params.name.trim();
  const args = isObject(params.arguments) ? params.arguments : {};

  if (name === "search_literature") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return rpcError(id, -32602, "Invalid params: missing required argument query");
    const runner = pickSearchRunner(runners, context);
    if (!runner) {
      return rpcResult(id, {
        content: [{ type: "text", text: "Cerebrum search is not available from this endpoint right now." }],
        isError: true,
      });
    }
    try {
      const data = await normalizeRunnerResult(await runner(query, context));
      if (!isObject(data) && !Array.isArray(data)) throw new Error("search returned no usable payload");
      return rpcResult(id, formatSearchToolResult(data));
    } catch {
      return rpcResult(id, {
        content: [{ type: "text", text: "Cerebrum search could not be reached. Try again in a moment." }],
        isError: true,
      });
    }
  }

  if (name === "get_trending") {
    const runner = pickTrendingRunner(runners, context);
    if (!runner) {
      return rpcResult(id, {
        content: [{ type: "text", text: "Cerebrum trending is not available from this endpoint right now." }],
        isError: true,
      });
    }
    try {
      const data = await normalizeRunnerResult(await runner(context));
      if (!isObject(data) && !Array.isArray(data)) throw new Error("trending returned no usable payload");
      return rpcResult(id, formatTrendingToolResult(data));
    } catch {
      return rpcResult(id, {
        content: [{ type: "text", text: "Cerebrum trending could not be reached. Try again in a moment." }],
        isError: true,
      });
    }
  }

  if (name === "get_statements") {
    const rawList = [];
    if (typeof args.doi === "string" && args.doi.trim()) rawList.push(args.doi);
    if (Array.isArray(args.dois)) {
      for (const d of args.dois) if (typeof d === "string" && d.trim()) rawList.push(d);
    }
    const dois = [];
    const seen = new Set();
    for (const raw of rawList) {
      const doi = normalizeDoi(raw);
      if (doi && !seen.has(doi)) {
        seen.add(doi);
        dois.push(doi);
      }
      if (dois.length >= STATEMENTS_MAX_DOIS) break;
    }
    if (!dois.length) {
      return rpcError(id, -32602, "Invalid params: missing required argument doi or dois");
    }
    const runner = pickStatementsRunner(runners, context);
    if (!runner) {
      return rpcResult(id, {
        content: [{ type: "text", text: "Cerebrum citation statements are not available from this endpoint right now." }],
        isError: true,
      });
    }
    try {
      const data = await normalizeRunnerResult(await runner(dois, context));
      if (!isObject(data)) throw new Error("statements returned no usable payload");
      return rpcResult(id, formatStatementsToolResult(data, dois));
    } catch {
      return rpcResult(id, {
        content: [{ type: "text", text: "Cerebrum citation statements could not be reached. Try again in a moment." }],
        isError: true,
      });
    }
  }

  if (name === "get_reception_report") {
    const doi = typeof args.doi === "string" ? normalizeDoi(args.doi) : null;
    if (!doi) return rpcError(id, -32602, "Invalid params: missing required argument doi");
    const statementsRunner = pickStatementsRunner(runners, context);
    const talliesRunner = pickTalliesRunner(runners, context);
    const retractionRunner = pickRetractionRunner(runners, context);
    if (!statementsRunner && !talliesRunner && !retractionRunner) {
      return rpcResult(id, {
        content: [{ type: "text", text: "Cerebrum reception reports are not available from this endpoint right now." }],
        isError: true,
      });
    }
    // Each leg degrades on its own: a leg that cannot answer leaves
    // its section in its honest empty state (still collecting, not
    // available, unknown) rather than failing the whole report,
    // matching how the app's own surfaces treat these feeds.
    let statements = null;
    if (statementsRunner) {
      try {
        const map = await normalizeRunnerResult(await statementsRunner([doi], context));
        if (isObject(map) && isObject(map[doi])) statements = map[doi];
      } catch {}
    }
    let tallies = null;
    if (talliesRunner) {
      try {
        const t = await normalizeRunnerResult(await talliesRunner(doi, context));
        if (isObject(t)) tallies = t;
      } catch {}
    }
    let retraction = null;
    if (retractionRunner) {
      try {
        const v = await normalizeRunnerResult(await retractionRunner(doi, context));
        if (isObject(v)) retraction = v;
      } catch {}
    }
    return rpcResult(id, formatReceptionToolResult({ doi, statements, tallies, retraction }));
  }

  return rpcError(id, -32602, "Invalid params: unknown tool");
}

// ── The protocol handler ─────────────────────────────────────────────
// Takes one parsed JSON RPC message (or a raw string, or a batch array)
// plus injected runners, and returns the response object, or null when
// the message is a notification and there is nothing to say back.

export async function handleRpcMessage(message, runners = {}, context = {}) {
  if (typeof message === "string") {
    const parsed = parseJsonRpcText(message);
    if (parsed.error) return parsed.error;
    return handleRpcMessage(parsed.message, runners, context);
  }
  if (Array.isArray(message)) {
    // Over cap batches are rejected whole (2026-10-16): dispatching
    // the first entries and dropping the rest would silently change
    // what the client asked for, and executing all of them is the
    // unbounded fan out this cap exists to stop.
    if (message.length > MCP_MAX_BATCH) {
      return rpcError(null, -32600, "Invalid Request: batch too large");
    }
    const out = [];
    for (const entry of message) {
      const r = await handleRpcMessage(entry, runners, context);
      if (r !== null && r !== undefined) out.push(r);
    }
    return out;
  }
  if (!isObject(message) || typeof message.method !== "string" || !message.method) {
    const id = isObject(message) && "id" in message ? message.id : null;
    return rpcError(id, -32600, "Invalid Request");
  }
  // JSON RPC 2.0 requires the jsonrpc member to be exactly "2.0". A
  // message without it is an Invalid Request, not a call to execute;
  // this check runs before the notification branch so a request shaped
  // message cannot slip through by omitting the member.
  if (message.jsonrpc !== "2.0") {
    return rpcError("id" in message ? message.id : null, -32600, "Invalid Request");
  }

  const isNotification = !("id" in message) || message.id === undefined;
  if (isNotification) return null;
  const id = message.id;

  switch (message.method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: MCP_SERVER_INFO.name,
          version: MCP_SERVER_INFO.version,
          icon: MCP_ICON_URL,
          documentationUrl: MCP_DOCUMENTATION_URL,
        },
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: JSON.parse(JSON.stringify(TOOLS)) });
    case "tools/call":
      return callTool(id, message.params, runners, context);
    default:
      return rpcError(id, -32601, "Method not found");
  }
}

// ── Human readable description for a browser visit ───────────────────

export function mcpServerDescription() {
  return {
    name: MCP_SERVER_INFO.name,
    version: MCP_SERVER_INFO.version,
    protocolVersion: MCP_PROTOCOL_VERSION,
    icon: MCP_ICON_URL,
    documentationUrl: MCP_DOCUMENTATION_URL,
    description:
      "Cerebrum is a free scientific literature search engine. This endpoint lets assistants call Cerebrum search as a tool.",
    transport: "Stateless HTTP transport using JSON RPC 2.0",
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    usage:
      "Send a POST request with a JSON RPC 2.0 message. Use tools/list to discover tools and tools/call to run a tool.",
  };
}

// ── HTTP entry point ─────────────────────────────────────────────────

/* FNV-1a hash of a client IP, used ONLY to key a per isolate memory
 * rate limit bucket when the privacy hash itself could not be
 * computed (see the fail bounded block in onRequest). It is never
 * stored anywhere durable and never leaves the isolate's memory;
 * it exists so the fallback bucket is per client rather than one
 * shared bucket every caller would exhaust together. */
function memoryFallbackKey(value) {
  let h = 0x811c9dc5;
  const s = String(value || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export async function onRequest(context) {
  const { request, env } = context || {};
  const cors = corsHeaders(request, env, { credentials: false, methods: "GET, POST, OPTIONS" });

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (request.method === "GET") {
    return json(mcpServerDescription(), 200, cors);
  }
  if (request.method !== "POST") {
    return json(rpcError(null, -32600, "Invalid Request"), 405, { ...cors, Allow: "GET, POST, OPTIONS" });
  }

  // Rate limit before any upstream work. The key is hashed by privacyKey
  // and the counting itself reuses the shared limiter, which prefers the
  // D1 backed counter and falls back to per isolate memory without D1.
  //
  // Fail bounded, never open (2026-10-14): the catch here used to log
  // and let the request through, so ANY failure in the block — the
  // privacy hash, a malformed DB binding, the limiter itself — turned
  // the limit off entirely for that request. Now a failure falls back
  // to the shared in memory limiter (the same per isolate fallback the
  // limiter documents for its own D1 failures), keyed on the derived
  // key when there is one and on a non crypto hash of the client IP
  // when even the key could not be derived. The limit is cruder in
  // that mode (per isolate, like every limiter here used to be), but
  // it is a limit.
  const rateLimited = () =>
    json(rpcError(null, -32000, "Too many requests. Wait a moment and try again."), 429, {
      ...cors,
      "Retry-After": "30",
    });
  let rlKey = null;
  // One limiter charge, with the fail bounded fallback above kept
  // intact for every charge. Returns true when the charge is allowed.
  const chargeOnce = async () => {
    try {
      if (!rlKey) rlKey = await privacyKey("mcp", clientIp(request), env);
      return await checkRateLimit(env, rlKey, MCP_RATE_LIMIT, MCP_RATE_WINDOW_MS);
    } catch (e) {
      console.error("Cerebrum MCP rate limit check failed, falling back to the in memory limiter:", e);
      const fallbackKey = rlKey || "mcp:mem:" + memoryFallbackKey(clientIp(request));
      return checkRateLimitMemoryOnly(fallbackKey, MCP_RATE_LIMIT, MCP_RATE_WINDOW_MS);
    }
  };
  if (!(await chargeOnce())) {
    return rateLimited();
  }

  // Bounded body read (2026-10-16), the readJsonBody pattern from
  // functions/lib/http.js: Content-Length is refused up front, then
  // the text is measured in real bytes, because Content-Length can
  // be absent and text length undercounts multibyte characters.
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength && declaredLength > MCP_MAX_BODY_BYTES) {
    return json(rpcError(null, -32600, "Request too large"), 413, cors);
  }
  let text;
  try {
    text = await request.text();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400, cors);
  }
  if (new TextEncoder().encode(text).length > MCP_MAX_BODY_BYTES) {
    return json(rpcError(null, -32600, "Request too large"), 413, cors);
  }
  const parsed = parseJsonRpcText(text);
  if (parsed.error) return json(parsed.error, 400, cors);

  if (Array.isArray(parsed.message) && parsed.message.length > MCP_MAX_BATCH) {
    return json(rpcError(null, -32600, "Invalid Request: batch too large"), 400, cors);
  }

  // Per entry charge for tool calls (2026-10-16, audit finding 10):
  // the baseline charge above pays for the request itself, which is
  // also the first tool call when there is one. Every further
  // dispatchable tools/call entry (an entry with an id, matching
  // what handleRpcMessage will actually execute; notifications are
  // never dispatched) is charged once more, all before dispatch, so
  // a batch spends limiter budget in proportion to the upstream
  // searches it is about to run.
  const parsedEntries = Array.isArray(parsed.message) ? parsed.message : [parsed.message];
  const toolCallCount = parsedEntries.filter(
    (entry) => isObject(entry) && entry.method === "tools/call" && "id" in entry && entry.id !== undefined
  ).length;
  for (let i = 1; i < toolCallCount; i++) {
    if (!(await chargeOnce())) {
      return rateLimited();
    }
  }

  const origin = (() => {
    try {
      return new URL(request.url).origin;
    } catch {
      return "";
    }
  })();
  const runners = (context && context.runners) || createDefaultRunners(origin);
  const response = await handleRpcMessage(parsed.message, runners, { origin, env, request });

  // Notifications, and batches made only of notifications, get 202 and
  // no body, per JSON RPC and the MCP streamable HTTP transport.
  if (response === null || response === undefined || (Array.isArray(response) && response.length === 0)) {
    return new Response(null, { status: 202, headers: cors });
  }
  return json(response, 200, cors);
}
