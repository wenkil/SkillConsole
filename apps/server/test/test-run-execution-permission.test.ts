import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createTestRunExecutionPermissionPolicy } from "../src/modules/test-runs/test-run-execution-permission.js"

function permissionOptions() {
  return {
    signal: new AbortController().signal,
    toolUseID: "toolu_test",
    requestId: "request_test",
  }
}

async function withWorkspace(
  callback: (workspace: string) => Promise<void>,
): Promise<void> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "skillconsole-case-"))
  try {
    await callback(workspace)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

test("test execution policy allows Write and Edit anywhere in its Case workspace", async () => {
  await withWorkspace(async (workspace) => {
    const policy = createTestRunExecutionPermissionPolicy(workspace)

    assert.deepEqual(
      await policy(
        "Write",
        { file_path: "outputs/research-notes/task-a.md" },
        permissionOptions(),
      ),
      { behavior: "allow" },
    )
    assert.deepEqual(
      await policy(
        "Edit",
        { file_path: path.join(workspace, ".claude", "settings.json") },
        permissionOptions(),
      ),
      { behavior: "allow" },
    )
  })
})

test("test execution policy rejects writes that escape the current Case workspace", async () => {
  await withWorkspace(async (workspace) => {
    const policy = createTestRunExecutionPermissionPolicy(workspace)

    assert.deepEqual(
      await policy(
        "Write",
        { file_path: "../another-case/output.md" },
        permissionOptions(),
      ),
      {
        behavior: "deny",
        message: "The file path is outside the current test Case workspace.",
      },
    )
    assert.deepEqual(
      await policy("Write", {}, permissionOptions()),
      {
        behavior: "deny",
        message: "The file write did not include a valid file path.",
      },
    )
  })
})
