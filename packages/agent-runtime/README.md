# Agent runtime

`packages/agent-runtime` is the single adapter around `@anthropic-ai/claude-agent-sdk`.

## Responsibilities

- Convert a SkillConsole Run input into Claude Agent SDK options.
- Start and cancel an Agent session.
- Normalize SDK messages, usage, tool activity, permission decisions, and errors.
- Isolate SDK-specific types from the rest of the codebase.

The initial release supports only Claude Agent SDK for TypeScript. This package is an isolation boundary, not a general multi-provider Agent framework.
