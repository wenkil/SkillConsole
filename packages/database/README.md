# Database

`packages/database` owns PostgreSQL persistence through Drizzle ORM and `node-postgres`.

## Responsibilities

- Drizzle table and relation definitions.
- Version-controlled SQL migrations.
- PostgreSQL connection-pool creation.
- Repository implementations and transaction boundaries.
- Mapping between database rows and domain objects.

## Planned structure

```text
src/
├── schema/              # Drizzle PostgreSQL schema
├── repositories/        # Domain repository implementations
├── client.ts            # Pool and Drizzle client
└── index.ts             # Public package exports

migrations/              # Generated and reviewed SQL migrations
drizzle.config.ts
```

Structured fields used for filtering and state transitions belong in relational columns. Versioned event payloads may use `jsonb`. Artifact bytes and plaintext secrets must not be stored in PostgreSQL.
