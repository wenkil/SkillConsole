# Agent System Prompts

This directory centrally stores all System Prompts used by SkillConsole Agent Sessions. The service re-reads the corresponding file per role each time a Session is created. Modifying these files does not require rebuilding the application, but changes only affect tasks or Revisions created after the modification.

| Session Role | System Prompt File | Workspace Task Entrypoint |
| --- | --- | --- |
| Generic Agent | `generic-agent.system.md` | User message |
| Eval Generation | `eval-generation.system.md` | Absolute `taskPath` injected via startup prompt |
| Test Run Execution | `test-run-execution.system.md` | Absolute `taskPath` injected via startup prompt |
| Test Run Execution (Required Skill Mode) | `test-run-execution-required-skill.system.md` | Absolute `taskPath` injected via startup prompt |
| Test Run Execution (No Skill Mode) | `test-run-execution-no-skill.system.md` | Absolute `taskPath` injected via startup prompt |
| Test Run Assertion | `test-run-assertion.system.md` | Absolute `taskPath` injected via startup prompt |
| Test Run Skill Score | `test-run-skill-score.system.md` | Absolute `taskPath` injected via startup prompt |
| Test Run Grading | `test-run-grader.system.md` | Absolute `taskPath` injected via startup prompt |

Task context, test evidence, rubrics, and output paths are written by the service into Session workspace files instead of being concatenated into a large startup prompt. The service injects a validated, boundary-checked absolute `taskPath` into the startup prompt; the physical paths in the task manifest used by tools for actual read/write operations are also backend-generated absolute paths. Each System Prompt must explicitly require Agents to use these paths as-is, without replacing, re-parsing, or guessing alternative paths.

Business protocol fields such as `files` in Evals and `reference` in grading evidence still use logical relative paths; they are not physical paths passed directly to file tools.

All roles share the same project `settings.json` as the source of project settings and capabilities for the Claude Agent SDK. Permissions for tools, Skills, MCPs, and commands must be configured uniformly in `settings.json`; role behavior, reading order, and writable scope requirements are specified in the corresponding System Prompts.

The service records the prompt filename along with its SHA-256 version. After a task is created, if the corresponding prompt changes before execution, the task will fail and require the creation of a new task or Revision, preventing the same task from continuing under different prompts.

The directory location can be overridden via `SKILLCONSOLE_AGENT_PROMPTS_ROOT`. Docker Compose mounts the host `./agent-prompts` directory read-only into the container at `/workspace/agent-prompts` by default, so users can still edit these files directly on the host, while running Agents cannot modify these System Prompts back.
