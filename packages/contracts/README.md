# Contracts

`packages/contracts` owns the versioned boundaries shared between applications.

## Responsibilities

- Fastify request and response schemas.
- Server-Sent Event payload schemas.
- Server-to-Worker IPC command and event schemas.
- Run event names, payloads, schema versions, and redaction metadata.
- Browser-safe TypeScript types derived from runtime schemas.

Use TypeBox and JSON Schema-compatible definitions. This package must remain browser-safe and must not import Fastify instances, PostgreSQL clients, file-system APIs, secrets, or Claude Agent SDK.
