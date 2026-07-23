# Artifact storage

`packages/artifact-storage` defines how Skill snapshots, fixtures, Run artifacts, and large diagnostic payloads are stored.

## Responsibilities

- Provide storage interfaces used by the Server.
- Implement local file-system storage for the first release.
- Generate controlled references instead of exposing host file paths.
- Enforce path, size, retention, and content-access policies.

PostgreSQL stores artifact metadata and controlled references. It does not store large artifact bytes. A future S3-compatible implementation must preserve the same interface.
