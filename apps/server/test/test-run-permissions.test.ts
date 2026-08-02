import assert from "node:assert/strict"
import test from "node:test"

import { detectRuntimeCapabilityRequirements } from "../src/modules/test-runs/test-run-storage.js"
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

test("limits test-run tool permissions to the controlled workspace", async () => {
  const policy = createTestRunToolPermissionPolicy(
    "C:/skillconsole/test-runs/run/cases/case/workspace",
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
  assert.deepEqual(
    await policy(
      "Bash",
      { command: "python script.py > outputs/result.md" },
      context,
    ),
    { behavior: "allow" },
  )
  assert.equal(
    (
      await policy("Bash", { command: "python ../outside.py" }, context)
    ).behavior,
    "deny",
  )
  assert.equal(
    (
      await policy(
        "Bash",
        { command: "python script.py inputs/data.csv" },
        context,
      )
    ).behavior,
    "deny",
  )
})
