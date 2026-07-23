# Domain

`packages/domain` contains the product rules that do not depend on delivery or infrastructure frameworks.

## Responsibilities

- Project, Skill source, Skill snapshot, test, environment, Run, artifact, and assertion concepts.
- Run state transitions and terminal-state rules.
- Value objects, identifiers, domain errors, and policy decisions.
- Repository and service interfaces required by domain use cases.

This package is pure TypeScript. It must not depend on React, Fastify, Drizzle, PostgreSQL, the file system, or Claude Agent SDK.
