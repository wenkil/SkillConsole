# Test kit

`packages/testkit` contains development-only helpers shared by package and application tests.

## Responsibilities

- Domain builders and deterministic clocks and identifiers.
- Sample Run events and assertion evidence.
- Temporary Skill and workspace fixtures.
- Fastify test helpers and PostgreSQL integration-test setup.

Production applications must not import this package.
