# Evaluation

`packages/evaluation` contains deterministic assertion evaluators.

## Responsibilities

- Evaluate text, regular-expression, JSON, file, tool, Skill-activation, timeout, and budget assertions.
- Return `passed`, `failed`, `blocked`, or `error` with evidence references.
- Keep evaluation independent from UI presentation.

Evaluators consume normalized Run evidence. They must not infer unavailable events from final output text and must not call a model in the first release.
