# Cerebrum MCP directory listing package

Prepared 13 October 2026 and regenerated 14 October 2026 against
fresh live probes of the endpoint (recorded in
`endpoint-record.json`). This folder holds everything needed to
submit Cerebrum's MCP endpoint to the two assistant directories: the
ChatGPT directory (OpenAI plugins) and the Claude Connectors
Directory (Anthropic). Submission itself needs Dusty's own accounts;
the steps that need him are marked **Dusty** in each checklist and
gathered again at the end.

Why this matters: the competitor research in
`~/workspace/research_notes/cerebrum-competitor-intel-20261013-1407/report.md`
ranks distribution inside assistants as the top threat. Scite already
advertises search inside ChatGPT and ships a Claude Connector, and
Consensus bundles MCP quotas into its paid tiers. Cerebrum's endpoint is
live and marketed on Cerebrum's own pages, but it is listed in neither
directory, and until now the repo held no submission preparation at all.

## What is in this folder

- `endpoint-record.json`: the ground truth. What the live endpoint
  returned on 14 October 2026, recorded verbatim: the tools/list
  reply, the initialize reply, every protocol error probe, and what
  real tool calls returned. All listing copy in this package is
  written from this record and from `functions/api/mcp.js`.
- `openai-plugin/plugin.json`: the OpenAI plugin package manifest, in
  the shape the official OpenAI submission documentation uses, filled
  with Cerebrum's real values, including the listing copy and the review
  test cases.
- `openai-plugin/mcp.json`: the companion file that points the package
  at the production server.
- `openai-plugin/assets/`: the site icon at 180 by 180, copied from
  `public/`, plus `icon-512.png` at 512 by 512, rendered on
  14 October 2026 from the mark's vector source (`icon.svg`), ready
  to bundle into the package ZIP.
- `claude-listing.json`: the Anthropic portal field values, ready to
  paste. The Claude flow has no manifest file for a remote connector;
  the portal collects these fields directly.
- This README: the verified requirements for both directories, the
  endpoint gaps to close first, and the submission day list.

## Ground truth, in brief

Both `https://askcerebrum.org/mcp` and `https://askcerebrum.org/api/mcp`
answer, and they answer identically. The server is `cerebrum` version
`1.0.0`, protocol version `2025-03-26`, stateless streamable HTTP with
plain JSON bodies, no sessions, no sign in. It exposes two tools:

- `search_literature`: one required string argument, `query`. Returns
  a text block plus structured data. The text: the answer, a plain
  quality note when the answer was assembled from source excerpts or
  the pipeline degraded, a numbered source list with authors, year,
  and DOI or URL per source and whether each source was cited or is
  further reading, a coverage line with records gathered and sources
  cited, and, when the search stored a Search record, the record's
  permanent address and counts. The structured twin carries all of it
  as data (sources as objects, coverage counts, synthesis mode, the
  record address), shaped by an `outputSchema` the tool declares.
- `get_trending`: no arguments. Returns a text block plus structured
  data: the current Trending in Science edition, up to five headlines
  per section, each with its source name and the original story URL,
  with the same sections and headlines as data beside the text.

One timing note, stated plainly because both directories scan the
live server rather than this package: the structured output and the
icon and documentation fields on the server identity are in the
endpoint code as of 14 October 2026, and the live build probed that
day did not yet return them (the record in `endpoint-record.json`
says exactly what the live build returned). They reach the
directories with the next deploy of `functions/api/mcp.js`. Before
submitting, rerun the record's probes and confirm the live server
returns `structuredContent`.

Protocol behavior a reviewer would test, all verified live: a request
missing the `jsonrpc` member, or carrying a value other than `2.0`,
returns error `-32600` Invalid Request; an unknown method returns
`-32601` Method not found; malformed JSON returns HTTP 400 with
`-32700` Parse error; a notification returns HTTP 202 with no body; an
unknown tool name returns `-32602`. Every one of those probes was run
again on 14 October 2026 with the same results. A GET on the endpoint
returns a JSON description of the server. The rate limit, from the
code, is 20 calls per 60 seconds per client IP, answered with HTTP
429, error `-32000`, and a Retry-After of 30; the limiter fails
bounded, never open: if its durable check throws, the handler falls
back to a per isolate in memory limit and still refuses past the
limit (that fallback replaced a fail open catch on 14 October 2026).

## Read this first: reliability, as observed, and the endpoint gaps

**Reliability note.** Every live tool call made while preparing this
package succeeded. Five `search_literature` calls with different
questions (four on 13 October 2026, one more on 14 October) all
returned results with `isError` false: two full synthesized answers,
and three extractive answers in the "What the sources say" shape,
which is the mode the endpoint serves when the provider fleet is
capped. The result text discloses that assembly honestly rather than
dressing it as synthesis, which is the behavior a reviewer should see
and the behavior the listing copy describes.
`get_trending` succeeded on every call. Two honest caveats for
submission day, neither of them a defect found in the endpoint: the
search path is slow (a direct call took about 18 seconds, and MCP
calls run in the same range; the 14 October call took 13.6 seconds),
and answer mode depends on fleet conditions the endpoint reports
truthfully. A repeated call check from a custom connector on
submission day is routine diligence, and the checklists below include
it.

Gaps the requirements reveal, in the order to close them. The first
gap from the 13 October pass is closed and verified live; the rest
stand as written.

1. **CLOSED 14 October 2026: tool annotations and tool titles.** The
   first pass found tools/list carrying neither, which both
   directories require (Anthropic: a `title` and the applicable
   `readOnlyHint` or `destructiveHint` on every tool; OpenAI:
   `readOnlyHint`, `destructiveHint`, and `openWorldHint` as explicit
   booleans, imported by its dashboard scan). The endpoint now
   advertises both, and the live tools/list reply of 14 October 2026
   returns them verbatim: title "Search the literature" and
   "Trending in Science", `readOnlyHint` true, `destructiveHint`
   false, `openWorldHint` true. `claude-listing.json` carries the
   same values as the live ones. This is no longer a blocker for
   either submission. Sources: Anthropic submission page and review
   criteria; OpenAI plugin guidelines, Tools section; the live probe
   in `endpoint-record.json`.
2. **Tool descriptions may draw a finding at OpenAI.** Both directories
   want descriptions that state what the tool does. Anthropic's
   criteria also ask for when to invoke it, which the current
   `search_literature` description does ("Use this when you need
   evidence from papers rather than general knowledge"). OpenAI's fair
   play rules bar descriptions that steer the model or recommend broad
   triggering beyond the user's explicit intent, so the same sentence
   is a possible portal finding there. If OpenAI flags it, trim the
   description to behavior alone and rescan. Sources: Anthropic review
   criteria; OpenAI plugin guidelines, Fair play and Tools sections.
3. **Domain verification token (ChatGPT only).** OpenAI asks the
   submitter to host the exact token the portal issues, as plain text,
   at `https://askcerebrum.org/.well-known/openai-apps-challenge`. The
   token comes from the portal during submission, so this small site
   addition can only happen on submission day. Source: OpenAI
   submission page, Domain verification details.
4. **Rate limit versus reviewer traffic.** Twenty calls per minute per
   IP is aligned with anonymous search and is reasonable, but reviewers
   and directory scanners may share egress addresses. Worth one look
   before submission; not a stated requirement in either directory's
   documents. Source: `functions/api/mcp.js`.
5. **Icon size.** The bundled icon was the site's apple touch icon
   at 180 by 180, and neither directory document fetched for this
   package states an exact pixel size for a remote connector icon,
   so a larger asset could have been a portal finding with nothing
   ready to answer it. That is covered now: `openai-plugin/assets/`
   also carries `icon-512.png`, 512 by 512, rendered from the mark's
   vector source. `plugin.json` still points its composer icon and
   logo slots at the 180 by 180 files; if a portal asks for the
   larger asset in a slot, point that slot at `icon-512.png` and
   rezip. Treat any portal finding on size as the requirement.

## ChatGPT directory (OpenAI)

OpenAI now takes MCP backed apps as **plugins**: you upload a package
ZIP in the Plugins portal, connect the hosted MCP server, resolve the
automated findings, add review information, and submit for review.
Approved, you choose when to publish. After publication OpenAI scans
the hosted server daily, and tool changes go live through a rescan
rather than a new package.

Verified requirements and steps, from the official OpenAI pages listed
under Sources:

- [ ] A verified developer identity. Publishing needs individual or
      business verification in the OpenAI organization settings, and
      either the organization owner role or Apps Management Write
      permission. **Dusty**
- [ ] A project with global data residency. The submission
      documentation notes that projects with EU data residency cannot
      submit plugins containing apps for review. **Dusty** to confirm
      which project he uses.
- [ ] The package ZIP: `plugin.json` plus `mcp.json` plus the assets
      they name. Ready in `openai-plugin/`; zip that folder's contents
      at submission time.
- [ ] Domain verification: host the portal's token at the challenge URL
      (gap 3 above). **Dusty** triggers it in the portal; the site
      change is a five minute job once the token exists.
- [ ] Connect the server in the portal and run **Scan Tools**. The scan
      imports tool names, titles, descriptions, schemas, security
      schemes, and annotations from the live endpoint. Titles and
      annotations are live (gap 1, closed), and the scan will also
      import each tool's `outputSchema` once the structured output
      deploy is the live build; confirm that first with the probes in
      `endpoint-record.json`.
- [ ] Listing rules from the guidelines: the name must not append
      "MCP" or "Plugin" to the product name (ours is just Cerebrum);
      descriptions must not advertise pricing, subscriptions, trials,
      or promotions, so the listing copy in this package never calls
      Cerebrum free even though the site does; descriptions must not
      compare against or disparage other products; screenshots are no
      longer shown in the directory, example prompts are shown instead,
      and three are prepared in `defaultPrompt`.
- [ ] A published privacy policy covering data categories, purposes,
      recipients, retention, and user controls. Already live at
      https://askcerebrum.org/privacy. The endpoint collects nothing
      beyond the question text a user sends and the caller IP the rate
      limiter hashes; the policy already published is the one reviewers
      will read.
- [ ] Support contact details on the listing. Prepared:
      `https://askcerebrum.org/about`, with `contact@askcerebrum.org`
      as the working address behind it.
- [ ] Review information: five positive test cases and three negative
      ones, written into `plugin.json` from real endpoint behavior;
      release notes, written; a video walkthrough of the test cases at
      a public URL, **Dusty** to record and host; reviewer credentials,
      not applicable because the server needs no sign in, which the
      submission page only requires when sign in is required.
- [ ] Category: `plugin.json` says Education. The official pages
      fetched for this package show category as a manifest field with
      Productivity in their example but do not print the full list of
      allowed values, so confirm the exact value in the portal and fix
      the manifest if the portal's list differs. **Dusty** sees the
      list at upload time.
- [ ] Submit for review, complete the policy attestations in the
      portal, and publish when approved. **Dusty**

The listing copy for ChatGPT is the `interface` block of
`openai-plugin/plugin.json`: name Cerebrum, subtitle "Search the
scientific literature and get a cited answer", and a long description
that promises only what the endpoint does today. Tool presentation in
ChatGPT comes from the server scan, which is why the tool titles and
annotations had to live on the endpoint rather than in the package;
they do now, verified live on 14 October 2026.

## Claude Connectors Directory (Anthropic)

A remote MCP server is submitted through the developer portal at
`claude.ai/directory/manage` by choosing **Submit new** and then
**MCP connector**. Anthropic scans the submission automatically and, by
default, lists it as a Community connector; some listings are later
escalated to Verified review by Anthropic, which cannot be requested.

Verified requirements and steps, from the official Anthropic pages
listed under Sources:

- [ ] Who can submit: anyone on a paid Claude plan, per the official
      submission page. On Team and Enterprise plans an Owner submits.
      **Dusty**, with his Claude account. Note for the record: several
      third party guides claim a Team or Enterprise organization is
      required; the official page, updated 25 September 2026, says any
      paid plan, and this package follows the official page.
- [ ] The server is remote and reachable over HTTPS:
      https://askcerebrum.org/mcp. Done.
- [ ] Authentication: OAuth 2.0 for services that act on a user's
      account, or no authentication for public data. Cerebrum is the
      second kind. Nothing to build.
- [ ] Every tool annotated with a `title` and the applicable hint:
      done, and verified in the live tools/list reply of 14 October
      2026 (gap 1, closed). The portal flags tools missing them; ours
      are not missing.
- [ ] Tested in Claude first: add the server as a custom connector in
      his own account and call each tool from a conversation; the
      portal's Test and launch step asks him to confirm this. Anthropic
      also recommends exercising every tool through the MCP Inspector.
      **Dusty**
- [ ] Listing materials: documentation URL
      (https://askcerebrum.org/features, which already describes the
      MCP endpoint), privacy policy URL
      (https://askcerebrum.org/privacy), support contact
      (contact@askcerebrum.org), and an icon (copies in
      `openai-plugin/assets/`, including the 512 by 512
      `icon-512.png`). The review criteria add that public
      documentation must exist by the publish date; the features page
      satisfies this.
- [ ] Test credentials for reviewers, for a fully populated account:
      there is no account to give, because the connector needs none.
      `claude-listing.json` carries the sentence to enter if the
      portal insists on the field. **Dusty** sees the field's exact
      wording in the portal.
- [ ] Review criteria that already hold: read and write tools are
      separate by construction (both tools read only, and there is no
      catch all request tool); tool names are short and descriptive;
      descriptions state what each tool does and when to invoke it; the
      server calls Cerebrum's own first party endpoints on the same
      domain; the use case is none of the unsupported ones (no money
      movement, no media generation); results carry no conversation
      data beyond the answer to the question asked.
- [ ] Allowed link URIs: not applicable. That list belongs to MCP Apps
      that open links through Claude's UI capability. Cerebrum is a
      plain connector whose results contain DOI links as ordinary text.
- [ ] Carousel screenshots: not applicable. They are required of MCP
      Apps (servers with interactive UI). Cerebrum returns text only.
- [ ] Directory terms: submitting accepts the Anthropic Software
      Directory Terms and Policy, including keeping the connector
      secure and descriptions accurate. **Dusty** accepts at submit
      time.

The listing copy for Claude is in `claude-listing.json`: the name, a
short description for the directory card ("Search the scientific
literature from inside Claude and get answers that cite real
papers."), the detail card description written for the portal, the
URLs, the support contact, and three working example prompts. The
portal warns that Anthropic cannot edit the detail card description,
so the wording in the file is the wording to paste, unchanged.

## Submission day: what Dusty does, in order

1. No endpoint work stands in front of submission. Tool titles and
   annotations are deployed and verified live. One confirmation
   remains: the structured output and the server identity fields are
   in the endpoint code, and the live build probed on 14 October
   2026 did not yet return them, so once a deploy carrying
   `functions/api/mcp.js` is live, rerun the probes in
   `endpoint-record.json` and confirm `structuredContent` comes back
   from a real call. Then call both tools a few times from a custom
   connector as the final live check, because both directories read
   the live server, not this package.
2. ChatGPT: sign in to the OpenAI platform with the account that will
   own the plugin, complete identity verification if it is not already
   done, and confirm the project is on global data residency.
3. ChatGPT: create the plugin draft, upload the ZIP built from
   `openai-plugin/`, complete the domain challenge (the token step
   needs one small site deploy), connect the server, and run Scan
   Tools.
4. ChatGPT: record the short video walkthrough of the five positive
   test cases, host it at a public URL, and put the URL in Review
   details. Then submit for review and complete the attestations.
5. Claude: sign in at claude.ai on a paid plan, add
   https://askcerebrum.org/mcp as a custom connector, and call both
   tools once each in a real conversation.
6. Claude: open the developer portal, Submit new, MCP connector, and
   paste the fields from `claude-listing.json`. Upload the icon. Submit.
7. Both: watch the portals for findings and reviewer questions.
   Anthropic also takes escalations at mcp-review@anthropic.com; OpenAI
   sends review feedback by email and tracks status on the Plugins
   page.

## Sources

Official documentation, all accessed 13 October 2026:

- OpenAI, "Upload and submit your plugin":
  https://developers.openai.com/apps-sdk/deploy/submission
- OpenAI, "Plugin guidelines":
  https://developers.openai.com/apps-sdk/app-submission-guidelines
- Anthropic, "Submit a connector to the directory":
  https://claude.com/docs/connectors/building/submission
- Anthropic, "Connector pre-submission checklist" (review criteria):
  https://claude.com/docs/connectors/building/review-criteria

Endpoint behavior: live probes against https://askcerebrum.org/mcp and
https://askcerebrum.org/api/mcp on 13 and 14 October 2026, recorded in
`endpoint-record.json`, and the endpoint source,
`functions/api/mcp.js` in this repository.

One honesty note: the full list of values the OpenAI portal accepts for
the manifest category field could not be verified from the official
pages above (their complete example uses Productivity and prints no
list), so the category in `plugin.json` is marked for confirmation in
the checklist rather than presented as verified. Everything else in
the checklists traces to the pages above or to the live endpoint
record.
