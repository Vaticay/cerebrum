# Free distribution route for the Cerebrum MCP server

Prepared 14 October 2026. Nothing in this folder has been published yet.
This is the free route around the gated assistant directories: the
official MCP Registry first, then Smithery, then Glama. Every fact about
the endpoint comes from `../endpoint-record.json` (live probes of
https://askcerebrum.org/mcp on build d339606, 14 October 2026): a remote
Streamable HTTP server, no authentication, two read only tools
(`search_literature` and `get_trending`), server name `cerebrum`,
version `1.0.0`.

Files in this folder:

- `server.json`: the official MCP Registry manifest for Cerebrum.
  Validated with the official `mcp-publisher` tool on 14 October 2026
  (output: "server.json is valid").
- `smithery.json`: the field values the Smithery publish flow and the
  listing metadata step need.
- `glama.json`: the Glama ownership file. Its home is the root of the
  GitHub repository, not this folder; copy it there when the Glama
  claim is made.
- `glama-connector-claim.json`: a template for the Glama connector
  claim proof file. It carries a placeholder on purpose. Read its
  `templateNote` before touching it.

## The namespace decision

`server.json` uses the name `org.askcerebrum/cerebrum`, the reverse
domain form of askcerebrum.org, proven with domain authentication.

Why the domain namespace and not the GitHub one:

- The registry verifies control of the namespace in `name`. It does not
  verify control of the remote URL under any method. The registry's own
  remote server guide recommends domain authentication when the remote
  URL sits on a domain you control, so the server name and the URL are
  visibly the same publisher. Our URL is on askcerebrum.org, so the
  domain namespace is the honest match.
- Domain authentication needs no personal account at all. It is a key
  pair plus a proof record. GitHub authentication (`io.github.Vaticay/cerebrum`)
  works too and stays documented below as the fallback, but it ties the
  listing identity to one person's GitHub account and a device code
  sign in at publish time.
- Both proofs are fully in our hands: we control the askcerebrum.org
  DNS zone at Cloudflare and the site itself. No step needs the owner.

## 1. Official MCP Registry (registry.modelcontextprotocol.io)

Publishing is free. No fee appears anywhere in the official registry
documentation, the registry is an open source community project, and
the only account the flow can involve is the optional GitHub fallback.
One standing warning from the project itself: the registry is still in
preview, and the project says breaking changes or data resets may
occur before general availability.

### Publish steps, exactly

1. Install the publisher tool (official quickstart):

   ```bash
   curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/
   ```

   Homebrew also works: `brew install mcp-publisher`.

2. Generate the signing key pair (Ed25519, official authentication
   guide; needs OpenSSL 3.0 or later):

   ```bash
   openssl genpkey -algorithm Ed25519 -out key.pem
   PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
   echo "askcerebrum.org. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
   ```

   Keep `key.pem` out of git. It is the publishing credential for this
   namespace: store it in the Secure Vault at publish time. Losing it
   means rotating to a new key and a new proof record.

3. Add the printed TXT record to the askcerebrum.org zone in Cloudflare.
   Placement matters, per the official guide: the record goes on the
   apex of the domain (the zone root, name `@` in Cloudflare), not
   under any selector style subdomain. Wait for it to propagate.

   Alternative proof, if DNS is ever a problem: serve the same string
   (`v=MCPv1; k=ed25519; p=${PUBLIC_KEY}`) as the body of
   https://askcerebrum.org/.well-known/mcp-registry-auth and use the
   `login http` variant in step 4 instead of `login dns`.

4. Sign in with the domain proof:

   ```bash
   PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
   mcp-publisher login dns --domain "askcerebrum.org" --private-key "${PRIVATE_KEY}"
   ```

5. Validate and publish from this folder:

   ```bash
   cd docs/mcp-listing/registry
   mcp-publisher validate server.json
   mcp-publisher publish
   ```

6. Verify the listing through the public API:

   ```bash
   curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=org.askcerebrum/cerebrum"
   ```

### Rules that shape the manifest

- `description` is capped at 100 characters by the schema. Ours is 94.
- A remote only server lists `remotes` and omits `packages`, so no
  package ownership proof (the `mcpName` marker) applies to us.
- Each remote URL can belong to only one server name in the registry.
  If the GitHub fallback is ever used instead, this domain entry and
  the GitHub entry cannot both point at https://askcerebrum.org/mcp;
  one name must win.
- Updates: raise `version` in `server.json` and run publish again.
  Keep the DNS proof record in place so later logins still verify.

### Fallback: the GitHub namespace

Change `name` in a copy of `server.json` to
`io.github.Vaticay/cerebrum`, run `mcp-publisher login github`, follow
the device code flow in the Vaticay GitHub account, then publish the
same way. Personal namespaces are always granted to the signed in
account. This is also the route to take if the DNS proof ever fails
and cannot be repaired quickly.

## 2. Smithery (smithery.ai)

What Smithery's own documentation says (Publish page, updated
24 April 2026 on the page itself): a hosted server is published by
bringing your own hosting. Smithery's gateway proxies to the upstream
server; the publisher supplies a public HTTPS URL and completes the
publishing flow, and Smithery scans the server to extract its tool
metadata. For public servers the scan completes automatically. The
stated requirements are Streamable HTTP transport and OAuth support
only if the server requires authentication. Cerebrum meets both: it is
Streamable HTTP and public, so no config schema is needed (an empty
one is prepared in `smithery.json` in case the flow asks).

Account and cost: publishing needs a Smithery account and a namespace.
Smithery's namespaces documentation lists a Hobby plan that is free
and allows up to 3 namespaces, so a free account suffices for this
listing. Two things are marked unverified because Smithery's pricing
page did not render its details during this research: the exact price
of gateway usage beyond the listing itself, and whether the proposed
namespace `askcerebrum` is still available (namespaces are globally
unique; availability is only known at creation time).

### Publish steps

Web route (the documented one):

1. Sign in at https://smithery.ai/new (this uses the directory account
   being set up for the submissions, dustybreen@gmail.com, or GitHub).
2. Choose the URL option and enter `https://askcerebrum.org/mcp`.
3. Complete the publishing flow under the namespace and slug from
   `smithery.json` (proposed: namespace `askcerebrum`, slug
   `cerebrum`, giving the listing address
   https://smithery.ai/servers/askcerebrum/cerebrum).
4. Fill the listing metadata (display name, description, homepage,
   icon) from `smithery.json` if the scan did not already supply them.

Command line route (documented as the advanced option):

```bash
npm install -g @smithery/cli
smithery auth login
smithery namespace create askcerebrum
smithery mcp publish "https://askcerebrum.org/mcp" -n askcerebrum/cerebrum
```

Watch item, from Smithery's own troubleshooting section: their scanner
sends requests with the user agent `SmitheryBot/1.0` from Cloudflare
Workers, and bot protection can reject the scan with a 403. If that
happens here, their documented fixes are to allowlist the scanner or
to bypass scanning by serving a static server card at
https://askcerebrum.org/.well-known/mcp/server-card.json. The card is
not prepared in this folder; add it only if the scan actually fails.

## 3. Glama (glama.ai)

Glama has two surfaces, and only one of them fits a hosted endpoint.

**Connectors** (https://glama.ai/mcp/connectors) is the remote server
surface, and it needs no submission of its own: connector pages are
keyed by the server's official registry name (live examples on
glama.ai today include `io.github.aneduaim/untap-mcp` and
`com.viatsy/mcp`). Once the registry publish in section 1 lands, the
Cerebrum connector page is expected at
https://glama.ai/mcp/connectors/org.askcerebrum/cerebrum with no
further step. Mark the timing unverified: Glama does not publish a
ingestion schedule on the pages checked.

Claiming the connector (optional, and Glama's own claim page for
servers states claiming is free) unlocks editing the listing, health
and analytics views. Glama connector pages offer claim by verifying
the domain or the GitHub account the connector belongs to, with an
HTTP challenge or a DNS record among the routes. All three routes are
in our hands. The HTTP route serves a proof file at
https://askcerebrum.org/.well-known/glama.json; `glama-connector-claim.json`
in this folder is the template, and its placeholder must be replaced
with the exact value the live claim flow presents (third party reports
disagree on whether that value is currently an account bound claim
token or a maintainer email matching the Glama account, so follow the
panel, never a file prepared in advance).

**Servers** (https://glama.ai/mcp/servers) is the surface for servers
Glama builds and runs from a GitHub repository. Cerebrum has no
repository runnable server to build; the MCP endpoint is a hosted
function of the main site, so this surface does not apply and no
Docker build should be attempted for it. If a servers listing for the
repository appears from Glama's crawling anyway, claim it with
`glama.json` from this folder placed at the repository root: per
Glama's own guide, the file names the GitHub accounts under
`maintainers` that may claim the listing (ours names `Vaticay`, the
repository owner account), and claiming is completed by signing in to
Glama with that account. Glama warns that organization owned
repositories must use this file; personal repositories can also claim
by GitHub sign in alone.

Cost: no charge appears in Glama's claim or listing material checked.
Glama sells promoted placement separately; nothing in this route
needs it.

## 4. What the registry listing covers on its own

Publishing to the official registry is the single action. These
directories take their data from it, so they need no separate
submission:

- **PulseMCP.** Its submission page (updated 3 September 2026) says
  manual submissions are paused and tells server authors to publish
  to the official MCP Registry instead, in its own words the best
  first step, and that it will pick the server up automatically once
  it reopens.
- **Glama connectors.** Covered in section 3 above: the connector
  page is generated from the registry entry.
- The registry project built the registry as the upstream source of
  truth that public and private subregistries ingest and enrich (the
  project's launch post, 8 September 2025, updated 12 March 2026), so
  other registry based directories and client galleries that follow
  the same model pick the listing up under the same pattern. Which
  specific client galleries have completed that ingestion is
  unverified; check each one after the registry publish lands rather
  than assuming.

## What still needs a human, and whose

Nothing needs the owner. Every remaining step runs on infrastructure
and accounts already in play: the Cloudflare DNS zone, the site
repository, the free Smithery and Glama accounts, and the signing key
generated at publish time. Two sign ins are involved (Smithery, and
Glama only if the listings are claimed); both belong to the same
delegated submission work already running for the Claude and ChatGPT
directories, not to the owner. No paid plan, identity check, or
payment appears on this route.

## Sources

All accessed 14 October 2026.

Official MCP Registry (the modelcontextprotocol/registry project):

- Quickstart, "Publish an MCP Server to the MCP Registry":
  https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx
- Authentication (GitHub, DNS, and HTTP methods, namespace rules):
  https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx
- Publishing Remote Servers (ownership note and the domain advice):
  https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/remote-servers.mdx
- Official Registry server.json requirements:
  https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/official-registry-requirements.md
- The schema the manifest follows (2025-12-11):
  https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json
- Launch post on subregistries ingesting the registry:
  https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/

Smithery:

- Publish documentation (page updated 24 April 2026):
  https://smithery.ai/docs/build/publish
- Namespaces documentation (plan table with the free Hobby tier):
  https://smithery.ai/docs/concepts/namespaces.md

Glama:

- What is glama.json (8 July 2025):
  https://glama.ai/blog/2025-07-08-what-is-glamajson
- A live claim page stating claiming is free and how access is proven:
  https://glama.ai/mcp/servers/switchwize/switchwize-mcp/admin
- Live connector pages keyed by registry name, showing the claim
  routes (domain or GitHub verification, HTTP challenge, DNS record):
  https://glama.ai/mcp/connectors/io.github.aneduaim/untap-mcp

PulseMCP:

- Submission page, updated 3 September 2026:
  https://www.pulsemcp.com/submit

## Publish run, 14 October 2026: staged on the HTTP proof, not yet published

The publish was attempted on 14 October 2026 and is staged, one deploy
away from done. What happened, in order:

- The official publisher tool is installed at
  `~/workspace/tools/mcp-publisher` (the release tarball from the
  quickstart, extracted locally, never system wide).
- The Ed25519 signing key was generated. The private key lives at
  `~/workspace/.secrets/mcp-registry-key.pem` with 600 permissions,
  outside the git repository. Treat that file as the publishing
  credential for `org.askcerebrum/*`; it is named here, never printed.
  The matching public key is `6V9KdbWB0rpcrKmPoe6n8TWR9ogu99sUvVLfXAlPwvU`,
  and the proof string for this key is
  `v=MCPv1; k=ed25519; p=6V9KdbWB0rpcrKmPoe6n8TWR9ogu99sUvVLfXAlPwvU`.
- The DNS route was tried first and is not reachable from this
  machine: `npx wrangler whoami` answers "You are not authenticated"
  and suggests `wrangler login` or a `CLOUDFLARE_API_TOKEN`, no such
  token is present in the shell environment, and no wrangler auth
  config is stored on disk. So the apex TXT record could not be added
  from here. Anyone sitting at the Cloudflare dashboard can still use
  it instead: add that proof string as a TXT record on the zone apex
  (name `@`) and use the `login dns` command from section 1.
- The HTTP fallback was taken instead. The proof file is created in
  the repository working tree at `public/.well-known/mcp-registry-auth`,
  holding exactly the proof string above. It is deliberately
  uncommitted and unpushed: a production push for the current fix wave
  is in flight and was not disturbed. `server.json` was revalidated
  with the installed tool against the live registry and is valid.
- Nothing about this step needs the owner. The one coordination point
  is internal: the wave's production push must carry
  `public/.well-known/mcp-registry-auth` along (it sits in `public/`,
  which the build copies to the site root).

The exact remaining commands, to run once the file answers at
https://askcerebrum.org/.well-known/mcp-registry-auth:

```bash
PRIVATE_KEY="$(openssl pkey -in ~/workspace/.secrets/mcp-registry-key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
~/workspace/tools/mcp-publisher login http --domain "askcerebrum.org" --private-key "${PRIVATE_KEY}"
cd ~/workspace/cerebrum/docs/mcp-listing/registry
~/workspace/tools/mcp-publisher validate server.json
~/workspace/tools/mcp-publisher publish
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=org.askcerebrum/cerebrum"
```
