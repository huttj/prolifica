# Prolifica

A living archipelago of tools for your data. People keep a few MB of data (CSV, JSON, markdown,
images), their agent makes **isles** from it (small HTML pages that read data by named slots), and
anyone can remix an isle: same page with new data, same data with a new look, or both. Every remix
keeps a line back, so data and isles grow family trees. Stars, emoji and comments attach to a whole
isle or to one element in it, and a person's stars become a library their agent leans on.

MCP-first: connect Claude (or any MCP client) to `https://prolifica.app/mcp`.

## How it fits together

- `worker/index.ts` one Worker, two hosts. `isles.prolifica.app` runs people's pages (another origin, so
  isle code can never touch the app's session); `prolifica.app` is the app, `/api`, `/mcp` and OAuth.
- `worker/store.ts` all the rules: data, quota, isles, lineage, marks. REST (`api.ts`) and MCP (`mcp.ts`) both go through it.
- `worker/islehost.ts` serves an isle with `public/bridge.js` injected: `prolifica.data(slot)`, element
  picking, mark pins, `#focus=<selector>`.
- `worker/mcp.ts` hand-rolled JSON-RPC MCP server; `GUIDE` there is what agents read first.
- OAuth 2.1 (with DCR and CIMD) by `@cloudflare/workers-oauth-provider`; sign-in is an emailed link + code.
  Personal keys (`pro_…`) work as a bearer too.
- D1 for everything relational (`migrations/`), R2 for content-addressed blobs, KV for OAuth.
- `client/` React SPA, no router library.

## Develop

    npm install
    npm run db:migrate:local
    npm run dev            # app at http://localhost:5190, isles at http://127.0.0.1:5190

Local dev never sends email: sign-in links and codes print to the terminal.
`node test/ui.mjs <pro_session cookie> <isle id> <outdir>` drives headless Chrome through the main flows.

## Ship

    npm run check && npm test && npm run build
    npm run db:migrate:remote   # when a migration was added
    npm run deploy
