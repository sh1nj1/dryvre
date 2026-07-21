# Development database and E2E tests

Dryvre always tests against real PostgreSQL. Development automatically chooses an existing local server or an ephemeral Testcontainers server.

## Initialize local PostgreSQL

The development credentials are:

```text
role:     dryvre
password: dryvre
database: dryvre
port:     5432
```

The idempotent initialization script is [`scripts/init-local-postgres.sql`](../scripts/init-local-postgres.sql). It creates the role and database only when missing, assigns ownership, and grants access to the public schema. Run it once as a PostgreSQL administrator.

Standard PostgreSQL installation:

```bash
psql -h localhost -p 5432 -U postgres -d postgres \
  -f scripts/init-local-postgres.sql
```

Homebrew PostgreSQL commonly uses the current macOS account as the administrator:

```bash
psql -d postgres -f scripts/init-local-postgres.sql
```

On Linux installations using peer authentication:

```bash
sudo -u postgres psql -d postgres \
  -f scripts/init-local-postgres.sql
```

Verify the new login:

```bash
PGPASSWORD=dryvre psql \
  'postgres://dryvre@localhost:5432/dryvre' \
  -c 'select current_user, current_database();'
```

The SQL script creates the role and empty database. Drizzle owns application tables and applies them automatically when `npm run dev` starts. They can also be applied explicitly:

```bash
DATABASE_URL='postgres://dryvre:dryvre@localhost:5432/dryvre' \
  npm run db:migrate
```

The password in this script is for local development only. Do not reuse it in a deployed environment.

## Automatic development mode

Start development normally:

```bash
npm run dev
```

The bootstrap follows this sequence:

1. Read `DATABASE_URL`, or default to `postgres://dryvre:dryvre@localhost:5432/dryvre`.
2. Probe the configured PostgreSQL host and port.
3. If it is open, use that configured database.
4. If it is closed, start `postgres:17-alpine` with Testcontainers.
5. Apply all Drizzle migrations.
6. Start Fastify and Vite with the selected `DATABASE_URL`.
7. Stop the ephemeral container when the development process exits.

When the configured PostgreSQL endpoint is reachable but the `dryvre` role or database is missing, the bootstrap exits with the `psql` initialization command instead of silently using a container.

Mode selection can be forced when diagnosing environment issues:

```bash
DRYVRE_DB_MODE=local npm run dev
DRYVRE_DB_MODE=container npm run dev
```

`auto` is the default. Container mode requires a working Docker-compatible container runtime.

Before starting a container, Dryvre runs `docker info` with a 10-second timeout. If it reports that the Docker engine is unresponsive:

1. Start or restart Docker Desktop.
2. Wait until Docker Desktop reports that the engine is running.
3. Confirm that both client and server sections return immediately:

   ```bash
   docker version
   docker info
   ```

4. Retry `npm run dev` or `npm run test:e2e`.

A Docker socket file can remain present while the Docker Desktop engine behind it is stopped or hung; the socket's existence alone is not a readiness check.

## E2E tests

Run unit tests without a database:

```bash
npm test
```

Run full PostgreSQL integration tests:

```bash
npm run test:e2e
```

Run browser UI end-to-end tests independently of PostgreSQL:

```bash
npx playwright install chromium # first run only
npm run test:e2e:web
```

Run the complete seeded PM → Inbox → Developer scenario against a real server, ephemeral PostgreSQL, WebSocket, and Chromium:

```bash
npm run test:e2e:demo
```

The UI suite starts the Vite application with its deterministic mock data and verifies the document editor, view navigation, and responsive interactions in Chromium. Tests live under `tests/ui` and use `playwright.config.ts`.

The demo suite uses dedicated ports, starts the full development stack in `DRYVRE_AGENT_FAKE=true` mode, and validates the canonical task ID, Inbox reference, state transitions, result, and verification evidence. It lives under `tests/demo` and uses `playwright.demo.config.ts`.

The E2E harness creates a fresh `postgres:17-alpine` container, applies the production Drizzle migrations, starts a real Fastify HTTP/WebSocket server on a random local port, runs the tests, and removes the container. It currently covers:

- migration and seeded root-tree reads;
- WebSocket readiness;
- operation persistence through HTTP;
- optimistic-version conflict rejection.

Tests live under `tests/e2e` and use `vitest.e2e.config.ts`. Add API-level scenarios there when a feature crosses the server/database boundary. Tests should not depend on a developer's local database.

## CI

`.github/workflows/ci.yml` runs unit checks, the Testcontainers E2E suite, and the Playwright Chromium UI suite on an Ubuntu runner. No static CI database credentials or PostgreSQL service declaration are needed; Testcontainers supplies a random host port and disposes of the database after the job.
