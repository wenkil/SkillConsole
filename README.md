# SkillConsole

**English** | [简体中文](./README.zh-CN.md)

<p align="center">
  <strong>An open-source workbench for managing Agent Skills, running tests, and comparing versions.</strong>
</p>

<p align="center">
  Skill versions · Reproducible tests · Traces and artifacts · Regression comparison · Test reports
</p>

## What is SkillConsole?

SkillConsole is an open-source workbench for managing **Agent Skills**, running tests, and comparing versions.

It gives Skill authors, QA engineers, domain reviewers, AI platform teams, and project owners one place to:

- manage Skills and their versions;
- organize test suites, fixtures, assertions, and review rubrics;
- run Skills through real agent sessions;
- inspect messages, tool calls, files, costs, latency, and failures;
- compare Skill versions, models, endpoints, and execution profiles;
- detect regressions across repeated test runs;
- review results collaboratively and publish reusable test reports.

SkillConsole is not intended to be only a CLI wrapper, chat UI, benchmark leaderboard, or log viewer. Its goal is to make Agent Skill quality **visible, reproducible, reviewable, and reportable**.

## Why SkillConsole?

Teams often test Skills with a combination of Git, command-line scripts, spreadsheets, and disconnected reports. Source files may be versioned, but the test inputs, environment, execution trace, and final conclusions are rarely preserved as one reproducible record.

This creates practical problems:

- a report cannot be reliably traced back to the exact Skill files it tested;
- directory and file changes are difficult to review as one meaningful revision;
- test cases, datasets, traces, and generated files live in different places;
- rerunning tests after a change does not clearly identify new failures or fixes;
- a score alone cannot explain why an agent succeeded or failed;
- people who do not work in Git or a terminal cannot easily understand the full test process.

SkillConsole treats a Skill as a versioned, testable product—not just a Markdown file.

## How does SkillConsole help?

### Skill versions

- Upload one file or a complete directory.
- Create an editable draft from the latest finalized version.
- Save repeatedly during one editing cycle without producing a version for every change.
- Finalize an immutable version when the work is ready.
- Compare directory structure and file content between versions.
- Use the first finalized version as the default regression baseline.

SkillConsole manages this history itself. It does not integrate with Git or expose branches, commits, or tags.

### Reproducible tests

Every test task is pinned to:

- a finalized Skill version or frozen draft snapshot;
- a test suite and its cases;
- a dataset version;
- the endpoint, model, and execution environment;
- traces, tool calls, generated files, and reports.

Later changes to a Skill or dataset never rewrite the evidence behind an existing task.

### Results and regression

The workspace home centers on a task list. Each task exposes:

- a task summary;
- test-case results;
- agent output and traces;
- tool calls;
- generated files and other artifacts;
- detailed and summary reports.

A regression task runs the same inputs against a candidate and baseline, highlighting new failures, fixes, persistent failures, persistent passes, and unstable behavior.

## How do I use it?

1. **Create a Skill test workspace.** One workspace represents one Skill under continuous test.
2. **Upload the Skill.** Select one file or a complete directory to create the first finalized version and default baseline.
3. **Change the Skill.** Create a draft, edit Markdown in the browser, or upload more files and directories.
4. **Finalize a version.** Review the file changes and turn the draft into an immutable version.
5. **Prepare tests.** Manage cases in a list and import data from JSON, CSV, or Excel.
6. **Run a task.** Choose the Skill version, test suite, dataset, and execution environment.
7. **Inspect the result.** Review the summary, trace, artifacts, and reports.
8. **Run regression.** Compare the latest candidate with the baseline.

SkillConsole runs agent sessions through the **Claude Agent SDK**. Runtime configuration follows Anthropic's official Claude settings system and is not edited in the SkillConsole Web interface. Custom endpoints must implement the Anthropic Messages API contract required by the SDK.

## Design principles

1. **Local first.** Skills, test data, and evidence should remain usable on the user's machine or internal environment without requiring a hosted SaaS.
2. **One workspace, one Skill.** Versions, tests, datasets, and tasks stay organized around one explicit test target.
3. **Finalized versions are immutable.** Editing happens in drafts, and every task points to a recoverable version or frozen snapshot.
4. **Evidence over scores.** A conclusion must be traceable to cases, traces, tool calls, artifacts, and assertion evidence.
5. **Comparison is a first-class workflow.** A change in quality is usually more useful than an isolated score.
6. **Open data formats.** Cases, datasets, task results, and reports should remain importable, exportable, and machine-readable.
7. **Safe local defaults.** Filesystem paths, secrets, network access, and tool permissions require explicit boundaries.
8. **Do not define the Skill for the user.** The product provides tests and evidence without requiring optional files or one recommended Skill structure.

## What does SkillConsole not do?

| Non-goal | Why |
| --- | --- |
| Integrate with or replace Git | SkillConsole versions exist for drafts, test snapshots, and regression evidence—not source collaboration, branching, or merging |
| Build a complete Web IDE | Editing supports necessary Skill changes; the product stays focused on testing rather than duplicating general development tools |
| Decide whether a Skill is “complete” | Scripts, images, templates, and references are not mandatory for every Skill; users own their content structure |
| Build a general-purpose multi-model agent framework | Claude Agent SDK owns agent execution while SkillConsole focuses on testing, versions, and evidence |
| Bundle integrations for every model provider | Users manage endpoints and protocol conversion, avoiding a permanently changing vendor-adapter layer |
| Build accounts, team permissions, or multi-tenant SaaS | The product remains local first and can also be exposed directly on an internal network |
| Operate a Skill marketplace | SkillConsole tests user-supplied Skills without bringing untrusted distribution into its core scope |
| Define quality with one opaque LLM score | Scores must remain connected to inspectable test results and execution evidence |

## Quick start

Install Docker Desktop, or Docker Engine with Docker Compose.

### 1. Configure Claude

Before starting SkillConsole, edit `settings.json` in the repository root:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "env": {
    "ANTHROPIC_API_KEY": "replace-with-your-api-key",
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com"
  }
}
```

Use the fields documented in
[Anthropic's official settings reference](https://code.claude.com/docs/en/settings).
The file is ignored by Git. Changes apply to newly created Agent Sessions.

All Agent roles use this same project `settings.json` as their SDK settings and
capability source. Their editable System Prompts are centralized in
[`agent-prompts`](./agent-prompts/README.md). Task-specific reports, evidence,
Rubrics, and output paths are provided through files inside each Session
workspace instead of being concatenated into a large startup Prompt.

### 2. Start SkillConsole

```powershell
docker compose -f compose.yaml -f compose.development.yaml --profile development up --build -d
```

When the containers are healthy, open:

```text
http://localhost:5173
```

## Contributing

Contributions are welcome for real Skill testing workflows, failure cases, version-management ideas, Evals schema research, file-diff approaches, reproducible datasets, and interaction-design feedback.

Before submitting a large implementation that changes public data models or the run protocol, start with an issue or design proposal.

## License and notice

SkillConsole's original source code and documentation are released under the [MIT License](./LICENSE). Third-party SDKs, dependencies, APIs, services, models, documentation, and trademarks remain subject to their respective licenses and terms.

SkillConsole uses [`@anthropic-ai/claude-agent-sdk`](https://github.com/anthropics/claude-agent-sdk-typescript), but it is an independent open-source project and not an official Anthropic product. Review the current Claude Agent SDK license and terms before use or distribution.

---

<p align="center">
  <strong>Version the Skill. Test the behavior. Explain every result.</strong>
</p>
