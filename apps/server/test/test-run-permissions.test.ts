import assert from "node:assert/strict"
import test from "node:test"

import {
  detectRuntimeCapabilityRequirements,
  resolveRuntimeCommandSnapshot,
} from "../src/modules/test-runs/test-run-storage.js"
import { createTestRunToolPermissionPolicy } from "../src/modules/test-runs/test-run-permissions.js"

const context = {
  signal: new AbortController().signal,
  toolUseId: "tool-use",
  requestId: "request",
}

test("detects declared Python and Pandoc runtime capabilities", () => {
  assert.deepEqual(
    detectRuntimeCapabilityRequirements([
      "Run python3 convert.py and then use pandoc to create Markdown.",
    ]),
    [
      { capability: "Python", commands: ["python", "python3"] },
      { capability: "Pandoc", commands: ["pandoc"] },
    ],
  )
})

test("runtime capability availability requires a successful version probe", () => {
  assert.deepEqual(
    resolveRuntimeCommandSnapshot("python", true, null),
    { name: "python", available: false, version: null },
  )
  assert.deepEqual(
    resolveRuntimeCommandSnapshot("python", true, "Python 3.12.1"),
    { name: "python", available: true, version: "Python 3.12.1" },
  )
})

test("limits test-run tool permissions to the controlled workspace", async () => {
  const policy = createTestRunToolPermissionPolicy(
    "C:/skillconsole/test-runs/run/cases/case/workspace",
    {
      skillName: "csv-to-md",
      bundledScripts: ["scripts/render.py"],
    },
  )

  assert.deepEqual(
    await policy("Write", { file_path: "outputs/result.md" }, context),
    { behavior: "allow" },
  )
  assert.equal(
    (
      await policy("Write", { file_path: ".claude/settings.json" }, context)
    ).behavior,
    "deny",
  )
  assert.equal(
    (
      await policy(
        "Bash",
        {
          command:
            "pandoc inputs/source.md --lua-filter=inputs/evil.lua -o outputs/result.md",
        },
        context,
      )
    ).behavior,
    "deny",
  )
  assert.equal(
    (
      await policy(
        "Bash",
        {
          command: "pandoc inputs/source.md -o inputs/result.md",
        },
        context,
      )
    ).behavior,
    "deny",
  )
  assert.equal(
    (
      await policy(
        "Read",
        { file_path: ".claude/settings.json" },
        context,
      )
    ).behavior,
    "deny",
  )
  assert.equal(
    (
      await policy(
        "Bash",
        {
          command:
            "python .claude/skills/csv-to-md/scripts/render.py <(python inputs/evil.py) > outputs/result.md",
        },
        context,
      )
    ).behavior,
    "deny",
  )
  assert.deepEqual(
    await policy(
      "Bash",
      {
        command:
          "python .claude/skills/csv-to-md/scripts/render.py inputs/data.csv > outputs/result.md",
      },
      context,
    ),
    { behavior: "allow" },
  )
  assert.deepEqual(
    await policy(
      "Bash",
      {
        command: "pandoc inputs/source.md -o outputs/result.md",
      },
      context,
    ),
    { behavior: "allow" },
  )
  assert.equal(
    (
      await policy(
        "Bash",
        { command: "python ../outside.py" },
        context,
      )
    ).behavior,
    "deny",
  )
  assert.equal(
    (
      await policy(
        "Bash",
        { command: "python outputs/ad-hoc.py inputs/data.csv" },
        context,
      )
    ).behavior,
    "deny",
  )
  for (const command of [
    "printenv MY_API_TOKEN",
    "cat /proc/self/environ",
    "cat $HOME/.ssh/id_rsa",
    "cp /tmp/other-case outputs/copied.txt",
    "python -c \"import os; print(os.environ)\"",
  ]) {
    assert.equal(
      (await policy("Bash", { command }, context)).behavior,
      "deny",
      command,
    )
  }
})
