# Application server

`apps/server` is the single backend application. It owns the Fastify API, PostgreSQL access, controlled file storage, Skill scanning, Run execution, deterministic evaluation, and the in-package Run Worker entry.

The current executable foundation provides:

- `GET /health/live` for process liveness;
- `GET /health/ready` for PostgreSQL-backed readiness;
- development-only OpenAPI documentation at `/documentation`;
- typed environment configuration, request IDs, security headers, and a uniform error envelope;
- a generated Drizzle migration and a one-shot Compose migration service;
- production hosting for the built React application;
- SPA fallback for non-API routes.
- Server-internal Claude Agent SDK sessions with start, status, complete-event
  streaming, multi-turn resume, and active-turn cancellation APIs.

## Responsibilities

- Register Fastify plugins, route schemas, error handling, OpenAPI, and logging.
- Implement the project, Skill, test, environment, Run, and result modules.
- Create immutable Run input snapshots.
- Manage package-internal Run Worker processes and stream normalized events to the Web application.
- Coordinate PostgreSQL transactions, Skill snapshots, file storage, evaluations, and artifacts.

## Internal structure

```text
src/
├── app/                         # Fastify construction and lifecycle
├── config/                      # Typed environment configuration
├── core/                        # Server-internal errors and HTTP primitives
├── infrastructure/
│   ├── database/                # Drizzle, schema, repositories, and migrations
│   ├── storage/                 # Controlled file-system implementation
│   └── observability/           # Logs, request IDs, and diagnostics
├── modules/
│   ├── health/
│   ├── projects/
│   ├── skills/                  # Import, scan, validate, and snapshot
│   ├── tests/
│   ├── environments/
│   └── runs/                    # Worker, runtime, evaluation, events, and artifacts
├── app.ts                       # Builds a testable Fastify instance
└── main.ts                      # Starts the HTTP server
```

Route handlers translate HTTP requests into application operations. They must not contain database queries, direct file-system access, or Claude Agent SDK calls. The SDK is isolated inside `modules/agent-sessions/runtime`; it is not a separate Workspace or service. A capability is extracted from Server only after it has a second real consumer or an independent deployment requirement.

## Agent Session API

- `POST /api/agent-sessions` starts a session with its first prompt.
- `GET /api/agent-sessions/:sessionId` reads public session state.
- `POST /api/agent-sessions/:sessionId/messages` continues an idle or
  resumable interrupted session.
- `GET /api/agent-sessions/:sessionId/events` replays and streams normalized
  complete events through SSE.
- `POST /api/agent-sessions/:sessionId/cancel` interrupts only the active turn.

## Claude configuration

- Source file: repository-root `settings.json`.
- Session copy:
  `SKILLCONSOLE_DATA_ROOT/agent-sessions/<sessionId>/workspace/.claude/settings.json`.
- SDK working directory: the session `workspace` root.
- Settings source: `project`.
- Capability source: the same copied project `settings.json` for every Agent
  role; the Server does not add role-specific tool, Skill, MCP, or write-path
  permission overrides.
- System Prompts: repository-root `agent-prompts/*.system.md`, selected by a
  fixed Session role and read again for each new Session.
- Task payloads: workspace `inputs/task.json` plus its referenced files; the
  initial user Prompt is only a short bootstrap instruction.
- Direct deployment override: `SKILLCONSOLE_CLAUDE_SETTINGS_PATH`.
- System Prompt directory override: `SKILLCONSOLE_AGENT_PROMPTS_ROOT`.
- Native log storage:
  `SKILLCONSOLE_DATA_ROOT/agent-session-logs/<agentSessionId>/` contains
  metadata, full SDK messages, the main/subagent transcript mirror,
  diagnostics, usage, and final output. The SDK runtime state is isolated at
  `SKILLCONSOLE_DATA_ROOT/claude-runtime/<agentSessionId>/` for recovery.
- Native log files are Server-side artifacts only. They are not returned by
  the Agent Session API or SSE stream.

Public responses exclude configuration content, sensitive values, absolute
paths, SDK session IDs, and SDK raw objects.

## Docker development

Use the repository-level Compose command:

```bash
docker compose --profile development up --build
```

The API is available at `http://localhost:3000`. Use
`http://localhost:3000/health/live` for liveness,
`http://localhost:3000/health/ready` for readiness, and
`http://localhost:3000/documentation` for development API documentation.

Compose waits for the one-shot database migration service to finish before it
starts the Server.

The production profile uses the root Dockerfile to build the Web and Server into one application image:

```bash
docker compose --profile production up --build --detach
```

The production UI and API share `http://localhost:3000`.
