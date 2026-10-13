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
import { checkRateLimit } from "../lib/rateLimit.js";

export const MCP_PROTOCOL_VERSION = "2025-03-26";
export const MCP_SERVER_INFO = { name: "cerebrum", version: "1.0.0" };

// Aligned with anonymous search in functions/api/search.js, which allows
// 20 requests per minute per client. MCP calls proxy that endpoint, so a
// looser limit here would just move the same cost to a different door.
export const MCP_RATE_LIMIT = 20;
export const MCP_RATE_WINDOW_MS = 60000;

const MCP_USER_AGENT = "Cerebrum MCP 1.0.0 (https://askcerebrum.org)";
const TRENDING_PER_SECTION = 5;

export const TOOLS = [
  {
    name: "search_literature",
    description:
      "Search the scientific literature for a research question and return a cited answer with a numbered source list. Use this when you need evidence from papers rather than general knowledge.",
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
  },
  {
    name: "get_trending",
    description:
      "Get the current Trending in Science edition and return the top headlines grouped by section with links to the original stories.",
    inputSchema: {
      type: "object",
      properties: {},
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
  return { content: [{ type: "text", text }], isError: false };
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

  let text = edition ? `Trending in Science, edition ${edition}.` : "Trending in Science, current edition.";
  if (!items.length) {
    text += "\n\nNo headlines were returned for this edition.";
    return { content: [{ type: "text", text }], isError: false };
  }
  const sections = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const title = String(item.title || "").trim();
    if (!title) continue;
    const section = String(item.category || item.section || "").trim() || "General";
    if (!sections.has(section)) sections.set(section, []);
    const bucket = sections.get(section);
    if (bucket.length < TRENDING_PER_SECTION) bucket.push(item);
  }
  for (const [section, bucket] of sections) {
    const lines = bucket.map((item, i) => {
      const title = String(item.title || "").trim();
      const source = String(item.source || "").trim();
      const url = String(item.url || item.link || "").trim();
      let line = `${i + 1}. ${title}`;
      if (source && source !== section) line += ` (${source})`;
      if (url) line += ` ${url}`;
      return line;
    });
    text += `\n\n${section}\n` + lines.join("\n");
  }
  return { content: [{ type: "text", text }], isError: false };
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
        serverInfo: { name: MCP_SERVER_INFO.name, version: MCP_SERVER_INFO.version },
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
    description:
      "Cerebrum is a free scientific literature search engine. This endpoint lets assistants call Cerebrum search as a tool.",
    transport: "Stateless HTTP transport using JSON RPC 2.0",
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    usage:
      "Send a POST request with a JSON RPC 2.0 message. Use tools/list to discover tools and tools/call to run a tool.",
  };
}

// ── HTTP entry point ─────────────────────────────────────────────────

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
  try {
    const rlKey = await privacyKey("mcp", clientIp(request), env);
    if (!(await checkRateLimit(env, rlKey, MCP_RATE_LIMIT, MCP_RATE_WINDOW_MS))) {
      return json(rpcError(null, -32000, "Too many requests. Wait a moment and try again."), 429, {
        ...cors,
        "Retry-After": "30",
      });
    }
  } catch (e) {
    console.error("Cerebrum MCP rate limit check failed:", e);
  }

  let text;
  try {
    text = await request.text();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400, cors);
  }
  const parsed = parseJsonRpcText(text);
  if (parsed.error) return json(parsed.error, 400, cors);

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
