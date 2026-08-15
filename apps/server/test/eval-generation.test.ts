import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import type { Database } from "../src/infrastructure/database/index.js"
import { AgentSessionWorkspaceStore } from "../src/modules/agent-sessions/session-workspace.js"
import { EvalOutputValidator } from "../src/modules/evals/eval-output-validator.js"
import { buildEvalGenerationPrompt } from "../src/modules/evals/eval-prompt.js"
import { EvalStorage } from "../src/modules/evals/eval-storage.js"
import { EvalWorkspacePreparer } from "../src/modules/evals/eval-workspace.js"

const provenance = {
  taskId: "00000000-0000-4000-8000-000000000001",
  targetSnapshotId: "00000000-0000-4000-8000-000000000002",
  promptContractVersion: "test-v1",
  configurationFingerprint: "c".repeat(64),
} as const

async function withTempRoot(
  callback: (root: string) => Promise<void>,
): Promise<void> {
  const root = path.join(os.tmpdir(), `skillconsole-eval-${randomUUID()}`)
  await mkdir(root)
  try {
    await callback(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test("injects the selected generation options into the Agent prompt", () => {
  const prompt = buildEvalGenerationPrompt({
    skillName: "sample-skill",
    maxEvalCount: 3,
    generationBrief: "覆盖文件输入场景",
  })

  assert.match(prompt, /目标 Skill：\{sample-skill\}/)
  assert.match(prompt, /目标用例数：\{3\}/)
  assert.match(prompt, /补充要求：\{覆盖文件输入场景\}/)
})

test("reads recognizable cases from a JSON Evals document", async () => {
  await withTempRoot(async (root) => {
    const generationId = randomUUID()
    const storage = new EvalStorage(root)
    await storage.initialize()
    await mkdir(storage.getGenerationFilesPath(generationId), {
      recursive: true,
    })
    await writeFile(
      storage.getGenerationEvalsJsonPath(generationId),
      JSON.stringify({
        evals: [
          {
            id: 1,
            name: "sample",
            prompt: "请根据输入内容生成摘要",
            expected_output: "生成包含关键结论的摘要",
            files: ["input.txt"],
            expectations: ["摘要包含输入中的关键结论"],
          },
        ],
      }),
      "utf8",
    )
    await writeFile(
      storage.getGenerationFilePath(
        generationId,
        "files/input.txt",
      ),
      "source",
      "utf8",
    )

    const result = await new EvalOutputValidator(storage).validate({
      generationId,
      skillName: "sample-skill",
      provenance,
    })
    assert.equal(result.sourceSchemaVariant, "expectations")
    assert.deepEqual(result.cases[0]?.assertions, [
      "摘要包含输入中的关键结论",
    ])
    assert.equal(result.files.length, 1)
    assert.deepEqual(result.cases[0]?.files, ["files/input.txt"])
    assert.match(result.manifestHash, /^[0-9a-f]{64}$/)
  })
})

test("ignores generated files that are not referenced by an Eval", async () => {
  await withTempRoot(async (root) => {
    const generationId = randomUUID()
    const storage = new EvalStorage(root)
    await storage.initialize()
    await mkdir(storage.getGenerationFilesPath(generationId), {
      recursive: true,
    })
    await writeFile(
      storage.getGenerationEvalsJsonPath(generationId),
      JSON.stringify({
        evals: [
          {
            id: 1,
            name: "sample",
            prompt: "生成摘要",
            expected_output: "摘要",
            files: [],
            assertions: ["输出包含摘要正文"],
          },
        ],
      }),
      "utf8",
    )
    await writeFile(
      storage.getGenerationFilePath(generationId, "files/hidden.txt"),
      "undeclared",
      "utf8",
    )

    const result = await new EvalOutputValidator(storage).validate({
      generationId,
      skillName: "sample-skill",
      provenance,
    })
    assert.equal(result.files.length, 0)
  })
})

test("accepts any parseable JSON and omits unrecognizable content", async () => {
  await withTempRoot(async (root) => {
    const generationId = randomUUID()
    const storage = new EvalStorage(root)
    await storage.initialize()
    await mkdir(path.dirname(storage.getGenerationEvalsJsonPath(generationId)), {
      recursive: true,
    })
    await writeFile(
      storage.getGenerationEvalsJsonPath(generationId),
      JSON.stringify({ unexpected: { arbitrary: true } }),
      "utf8",
    )

    const result = await new EvalOutputValidator(storage).validate({
      generationId,
      skillName: "sample-skill",
      provenance,
    })
    assert.equal(result.cases.length, 0)
    assert.equal(result.files.length, 0)
  })
})

test("omits unavailable input files without failing the JSON result", async () => {
  await withTempRoot(async (root) => {
    const generationId = randomUUID()
    const storage = new EvalStorage(root)
    await storage.initialize()
    await mkdir(storage.getGenerationFilesPath(generationId), {
      recursive: true,
    })
    await writeFile(
      storage.getGenerationEvalsJsonPath(generationId),
      JSON.stringify({
        evals: [
          {
            id: 1,
            name: "sample",
            prompt: "生成摘要",
            expected_output: "摘要",
            files: ["missing.txt", "../outside.txt"],
            assertions: ["输出包含摘要正文"],
          },
        ],
      }),
      "utf8",
    )

    const result = await new EvalOutputValidator(storage).validate({
      generationId,
      skillName: "sample-skill",
      provenance,
    })
    assert.equal(result.cases.length, 1)
    assert.deepEqual(result.cases[0]?.files, [])
  })
})

test("accepts only server-controlled Agent workspace locators", async () => {
  await withTempRoot(async (root) => {
    const store = new AgentSessionWorkspaceStore(
      root,
      path.join(root, "settings.json"),
    )
    const generationId = randomUUID()
    assert.equal(
      store.resolve(
        `eval-generations/${generationId}/workspace`,
      ),
      path.join(root, "eval-generations", generationId, "workspace"),
    )
    assert.throws(() =>
      store.resolve(
        `eval-generations/${generationId}/workspace/../../outside`,
      ),
    )
    assert.throws(() =>
      store.resolve(`uncontrolled/${generationId}/workspace`),
    )
  })
})

test("detects Claude settings changes after workspace installation", async () => {
  await withTempRoot(async (root) => {
    const sourceSettingsPath = path.join(root, "settings.json")
    await writeFile(sourceSettingsPath, '{"env":{"TOKEN":"one"}}', "utf8")
    const store = new AgentSessionWorkspaceStore(root, sourceSettingsPath)
    const workspace = await store.prepare(randomUUID())
    await store.installSettings(workspace.absolutePath)

    await assert.rejects(() =>
      store.assertSettingsFingerprint(
        workspace.absolutePath,
        "0".repeat(64),
      ),
    )
  })
})

test("captures the generation configuration fingerprint", async () => {
  await withTempRoot(async (root) => {
    const settingsPath = path.join(root, "settings.json")
    await writeFile(settingsPath, '{"env":{"TOKEN":"secret"}}', "utf8")
    const storage = new EvalStorage(root)
    const preparer = new EvalWorkspacePreparer(
      {} as Database,
      storage,
      root,
      settingsPath,
    )
    const inspected = await preparer.inspectProvenance()
    assert.match(inspected.configurationFingerprint, /^[0-9a-f]{64}$/)
  })
})
