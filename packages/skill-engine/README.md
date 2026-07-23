# Skill engine

`packages/skill-engine` handles Skill files before they are executed.

## Responsibilities

- Discover and parse `SKILL.md`.
- Validate metadata, paths, references, file limits, and supported structure.
- Detect symbolic-link and path-escape risks.
- Calculate content hashes and create immutable Skill snapshots.
- Materialize approved snapshots into a Run workspace.

Scanning must never execute scripts found in a Skill directory. This package does not start Agent sessions or make model requests.
