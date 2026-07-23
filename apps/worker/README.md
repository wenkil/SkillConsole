# Run Worker

`apps/worker` is the isolated Node.js process responsible for one Agent Run.

## Responsibilities

- Materialize the Run workspace, Skill snapshot, and fixtures.
- Resolve the approved execution configuration and ephemeral secrets.
- Invoke the Claude Agent SDK adapter.
- Normalize SDK messages into versioned Run events.
- Collect artifacts and workspace changes.
- Enforce cancellation, timeout, budget, and output limits.
- Exit after the Run reaches a terminal state.

## Internal structure

```text
src/
├── bootstrap/           # IPC startup and process lifecycle
├── runner/              # Run state machine
├── workspace/           # Temporary workspace preparation and cleanup
├── events/              # Event normalization and emission
├── artifacts/           # Artifact and workspace-diff collection
├── policies/            # Limits and execution policy enforcement
└── main.ts
```

The Worker must not expose an HTTP API or mutate product records directly. It communicates with the Server through the versioned Worker protocol.
