import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import type { Database } from "../src/infrastructure/database/index.js"
import { AgentSessionWorkspaceStore } from "../src/modules/agent-sessions/session-workspace.js"
import { EvalOutputValidator } from "../src/modules/evals/eval-output-validator.js"
import { EvalGenerationFailureSummaryReader } from "../src/modules/evals/eval-generation-failure-summary.js"
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

test("accepts a valid Evals document without skill name or target-count matching", async () => {
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
            files: ["files/input.txt"],
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

test("summarizes failed output without exposing file content", async () => {
  await withTempRoot(async (root) => {
    const generationId = randomUUID()
    const storage = new EvalStorage(root)
    await storage.initialize()
    await mkdir(storage.getGenerationFilesPath(generationId), {
      recursive: true,
    })
    await writeFile(
      storage.getGenerationEvalsJsonPath(generationId),
      JSON.stringify({ evals: [{ id: 1 }] }),
      "utf8",
    )
    await writeFile(
      storage.getGenerationFilePath(generationId, "files/README.md"),
      "do not expose this content",
      "utf8",
    )

    const summary = await new EvalGenerationFailureSummaryReader(storage).read(
      generationId,
    )
    assert.equal(summary.evalsJsonState, "VALID")
    assert.equal(summary.evalCount, 1)
    assert.deepEqual(summary.incompleteCaseIndexes, [1])
    assert.deepEqual(summary.ignoredFiles, ["files/README.md"])
  })
})

test("rejects case-insensitive generated file path collisions", async () => {
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
            files: ["files/Input.txt", "files/input.txt"],
            assertions: ["输出包含摘要正文"],
          },
        ],
      }),
      "utf8",
    )

    await assert.rejects(
      () =>
        new EvalOutputValidator(storage).validate({
          generationId,
          skillName: "sample-skill",
          provenance,
        }),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "EVAL_OUTPUT_FILE_PATH_COLLISION",
        ),
    )
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

test("rejects a target Skill copy changed during Agent execution", async () => {
  await withTempRoot(async (root) => {
    const snapshotId = randomUUID()
    const generationId = randomUUID()
    const settingsPath = path.join(root, "settings.json")
    const skillContent =
      "---\nname: sample-skill\ndescription: test\n---\n"
    const snapshotSkillPath = path.join(
      root,
      "snapshots",
      snapshotId,
      "files",
      "SKILL.md",
    )
    await mkdir(path.dirname(snapshotSkillPath), { recursive: true })
    await writeFile(snapshotSkillPath, skillContent, "utf8")
    await writeFile(settingsPath, '{"env":{"TOKEN":"secret"}}', "utf8")
    const fileRecord = {
      relativePath: "SKILL.md",
      byteSize: Buffer.byteLength(skillContent),
      sha256: createHash("sha256").update(skillContent).digest("hex"),
    }
    const database = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: async () => [fileRecord],
          }),
        }),
      }),
    } as unknown as Database
    const storage = new EvalStorage(root)
    await storage.initialize()
    const preparer = new EvalWorkspacePreparer(
      database,
      storage,
      root,
      settingsPath,
    )
    const inspected = await preparer.inspectProvenance()
    await preparer.prepare(
      generationId,
      {
        sourceKind: "SKILL_VERSION",
        versionId: randomUUID(),
        draftRevisionId: null,
        snapshotId,
        skillName: "sample-skill",
        manifestHash: "d".repeat(64),
        fileCount: 1,
        totalBytes: fileRecord.byteSize,
      },
      inspected,
      {
        maxEvalCount: 3,
        generationBrief: null,
      },
    )
    await writeFile(
      path.join(
        storage.getGenerationWorkspacePath(generationId),
        "target-skill",
        "sample-skill",
        "SKILL.md",
      ),
      `${skillContent}\nchanged`,
      "utf8",
    )

    await assert.rejects(
      () =>
        preparer.verifyImmutableInputs(
          generationId,
          {
            snapshotId,
            skillName: "sample-skill",
            maxEvalCount: 3,
            generationBrief: null,
          },
        ),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "EVAL_WORKSPACE_INPUT_CHANGED",
        ),
    )
  })
})
