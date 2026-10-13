// Root path wrapper for the Cerebrum MCP endpoint.
//
// Pages maps functions/api/mcp.js to /api/mcp only. Assistants and MCP
// client registries conventionally expect the endpoint at the site root,
// /mcp, so this file serves that path by re exporting the one real
// implementation. All protocol logic stays in functions/api/mcp.js.

export { onRequest } from "./api/mcp.js";
