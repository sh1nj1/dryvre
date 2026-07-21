# Dryvre

Dryvre is a single tree of first-class Markdown blocks, rendered as a document, task board, or conversation stream. References serve as links, tags, and AI context at once.

## Documentation

- [Documentation index](docs/README.md)
- [Product principles](docs/product-principles.md)
- [UI rules](docs/ui-rules.md)
- [Block editor specification](docs/editor-spec.md)
- [Architecture](docs/architecture.md)
- [Development database and E2E tests](docs/development-database.md)
- [Hackathon MVP scope](docs/hackathon-scope.md)
- [OpenAI Build Week guide](docs/build-week.md)
- [Not implemented backlog](docs/not-implemented/README.md)

## Stack

- TypeScript workspaces shared by the React client, Fastify server, database, and MCP server
- Vite + React SPA with a minimal Markdown editor
- Fastify REST API + one WebSocket connection
- PostgreSQL + Drizzle; no Redis, search service, queue, or CRDT
- OpenAI Responses API or a local Codex Agent; model output is persisted as a block
- One application container plus PostgreSQL

## Run locally

Requirements: Node.js 22+, npm 10+. Docker is required when local PostgreSQL is unavailable and for E2E tests.

```bash
cp .env.example .env
npm install
npm run dev
```

`npm run dev` uses the PostgreSQL host and port configured by `DATABASE_URL` when available (defaulting to `localhost:5432`). Otherwise it starts an ephemeral PostgreSQL 17 instance with Testcontainers and applies migrations automatically. See the [database guide](docs/development-database.md) for the local `psql` initialization command, forced modes, and E2E workflow.

Open <http://localhost:5173>. Development uses the seeded `builder` identity; production requires a valid database-backed session cookie.

To run the production-shaped stack instead, use `docker compose up --build`; the one-shot `migrate` service applies migrations before the app starts at <http://localhost:3000>.

Configure `OPENAI_API_KEY` to enable the AI composer. `OPENAI_MODEL` defaults to `gpt-5.6` and can be changed without code changes.

## Local Codex Agents

The context panel can run Agent blocks through a locally installed Codex CLI. Run `codex login`, verify it with `codex login status`, then configure named workspace roots in `.env`:

```dotenv
CODEX_COMMAND=codex
DRYVRE_AGENT_WORKSPACES={"dryvre":"/absolute/path/to/dryvre"}
DRYVRE_AGENT_TIMEOUT_MS=900000
DRYVRE_AGENT_MCP_URL=http://127.0.0.1:50000
```

Agent definitions begin with `# @agent <slug>` and have one direct `agent-config` code-block child. Skills begin with `# @skill <slug>`; prose becomes `SKILL.md`, while `file:scripts/example.sh` code blocks become runtime files. Put Skills below an Agent or reference a shared Skill subtree from it. The initial migration seeds Product Engineer and QA Agents that share one verification Skill.

`npm run dev` builds the Dryvre MCP entrypoint before starting the apps. When starting the server separately, run `npm run build -w @dryvre/mcp` first. The Agent readiness card (or `GET /api/agents/readiness`) reports missing Codex login and MCP builds. Real runs receive a managed Codex profile with the Dryvre MCP tools, so they can read, create, and edit canonical blocks while retaining the Agent author identity.

For a deterministic demo without Codex credentials, set `DRYVRE_AGENT_FAKE=true`; Docker Compose uses this mode by default because the image does not contain the host Codex login. The real runner always uses `workspace-write`, accepts prompts over stdin, and does not expose arbitrary CLI arguments or environment variables through the browser.

## Commands

```bash
npm run dev          # Fastify and Vite with reload
npm run typecheck    # all workspace type checks
npm test             # shared contract tests
npm run test:e2e     # real PostgreSQL + HTTP/WebSocket tests via Testcontainers
npm run test:e2e:web # Chromium UI tests via Playwright
npm run lint
npm run build        # production server, SPA, and MCP artifacts
npm start            # serve API + built SPA on port 3000
```

## Architecture

```text
apps/web  ── HTTP + WebSocket ──> apps/server ──> PostgreSQL
                                       │
apps/mcp ───────── HTTP ────────────────┤
                                       ├──> OpenAI Responses API
                                       └──> Local Codex CLI

packages/shared  block/op contracts used by every TypeScript surface
packages/db      Drizzle schema and migrations
```

The mutation protocol intentionally has only seven operations: `create`, `move`, `edit`, `setStatus`, `ref`, `unref`, and `delete`. Every accepted operation and state change share a transaction, and clients use block versions for optimistic conflict detection.

## MCP

Build and point an MCP client at the stdio entry:

```json
{
  "mcpServers": {
    "dryvre": {
      "command": "node",
      "args": ["/absolute/path/to/dryvre/dist/mcp/index.js"],
      "env": { "DRYVRE_URL": "http://localhost:3000" }
    }
  }
}
```

Set `DRYVRE_SESSION` to a session-cookie value outside development.

## Production notes

- Set a random `SESSION_SECRET` of at least 32 characters.
- Run `npm run db:migrate` before starting a newly deployed version.
- Run one application process initially. PostgreSQL `NOTIFY` is emitted for each committed op, leaving a direct path to multi-process fan-out later.
- Replace the seeded development identity and add a sign-in route before exposing the app publicly.

## License

MIT
