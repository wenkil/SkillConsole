# Application server

`apps/server` is the Fastify application that exposes the SkillConsole API and coordinates product use cases.

The current executable foundation provides:

- `GET /api/health` and `GET /health`;
- PostgreSQL readiness checks;
- production hosting for the built React application;
- SPA fallback for non-API routes.

## Responsibilities

- Register Fastify plugins, route schemas, error handling, OpenAPI, and logging.
- Implement the project, Skill, test, environment, Run, and result modules.
- Create immutable Run input snapshots.
- Manage Run Worker processes and stream normalized events to the Web application.
- Coordinate PostgreSQL transactions and artifact metadata.

## Internal structure

```text
src/
├── app/                 # Fastify construction and lifecycle
├── plugins/             # Config, database, OpenAPI, errors, and observability
├── modules/             # Product modules implemented as encapsulated Fastify plugins
├── orchestration/       # Worker lifecycle and Run scheduling
├── shared/              # Server-only cross-module infrastructure
├── app.ts               # Builds a testable Fastify instance
└── main.ts              # Starts the HTTP server
```

Route handlers should translate HTTP requests into application operations. They should not contain database queries or Claude Agent SDK calls.

## Docker development

Use the repository-level Compose command:

```bash
docker compose --profile development up --build
```

The API is available at `http://localhost:3000`, and the health endpoint is `http://localhost:3000/api/health`.

The production profile uses the root Dockerfile to build the Web and Server into one application image:

```bash
docker compose --profile production up --build --detach
```

The production UI and API share `http://localhost:3000`.
