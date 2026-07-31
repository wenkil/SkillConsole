import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { AgentSessionWorkspaceStore } from "../src/modules/agent-sessions/session-workspace.js"
import { buildExecutionPrompt } from "../src/modules/test-runs/test-run-prompt.js"
import { TestRunScorer } from "../src/modules/test-runs/test-run-scorer.js"
import { TestRunStorage } from "../src/modules/test-runs/test-run-storage.js"

test("test run scorer requires one independently evidenced result per assertion", () => {
  const scorer = new TestRunScorer()
  const result = scorer.parse(
    JSON.stringify({
      assertions: [
        {
          index: 1,
          status: "INSUFFICIENT_EVIDENCE",
          reason: "The output does not prove the second assertion.",
          evidence: [],
        },
        {
          index: 0,
          status: "PASSED",
          reason: "The final output contains the required summary.",
          evidence: [
            {
              source: "assistant_output",
              reference: "final-output",
              excerpt: "Summary complete.",
            },
          ],
        },
      ],
    }),
    ["Contains a summary", "Uses the requested structure"],
  )

  assert.deepEqual(
    result.map((item) => ({
      assertionIndex: item.assertionIndex,
      status: item.status,
    })),
    [
      { assertionIndex: 0, status: "PASSED" },
      { assertionIndex: 1, status: "INSUFFICIENT_EVIDENCE" },
    ],
  )
  assert.throws(
    () =>
      scorer.parse(
        JSON.stringify({
          assertions: [
            {
              index: 0,
              status: "INSUFFICIENT_EVIDENCE",
              reason: "First copy.",
              evidence: [],
            },
            {
              index: 0,
              status: "INSUFFICIENT_EVIDENCE",
              reason: "Duplicate copy.",
              evidence: [],
            },
          ],
        }),
        ["First", "Second"],
      ),
    /duplicate indexes/i,
  )
  assert.throws(
    () =>
      scorer.parse(
        JSON.stringify({
          assertions: [
            {
              index: 0,
              status: "NOT_EVALUATED",
              reason: "Not a grader status.",
              evidence: [],
            },
          ],
        }),
        ["First"],
      ),
    /failed validation/i,
  )
  assert.throws(
    () =>
      scorer.parse(
        `Grading complete: ${JSON.stringify({
          assertions: [
            {
              index: 0,
              status: "PASSED",
              reason: "Has evidence.",
              evidence: [
                {
                  source: "assistant_output",
                  reference: "final-output",
                  excerpt: "Summary complete.",
                },
              ],
            },
          ],
        })}`,
        ["First"],
      ),
    /exactly one JSON object/i,
  )
})

test("Agent Session workspace resolver accepts only controlled test run locators", () => {
  const dataRoot = path.join(os.tmpdir(), "controlled-data")
  const store = new AgentSessionWorkspaceStore(
    dataRoot,
    path.join(dataRoot, "settings.json"),
  )
  const runId = randomUUID()
  const caseId = randomUUID()

  assert.equal(
    store.resolve(
      `test-runs/${runId}/cases/${caseId}/workspace`,
    ),
    path.resolve(
      dataRoot,
      "test-runs",
      runId,
      "cases",
      caseId,
      "workspace",
    ),
  )
  assert.equal(
    store.resolve(`test-runs/${runId}/cases/${caseId}/grading`),
    path.resolve(
      dataRoot,
      "test-runs",
      runId,
      "cases",
      caseId,
      "grading",
    ),
  )
  assert.throws(
    () =>
      store.resolve(
        `test-runs/${runId}/cases/${caseId}/../workspace`,
      ),
    /locator is invalid/i,
  )
  assert.throws(
    () =>
      store.resolve(
        `test-runs/${runId}/cases/not-a-case/workspace`,
      ),
    /locator is invalid/i,
  )
})

test("target and baseline use the same execution prompt envelope", () => {
  const input = {
    userPrompt: "Summarize the attached fixture.",
    inputPaths: ["inputs/files/fixture.txt"],
  }

  assert.equal(buildExecutionPrompt(input), buildExecutionPrompt(input))
  assert.equal(buildExecutionPrompt(input).includes("TARGET"), false)
  assert.equal(buildExecutionPrompt(input).includes("BASELINE"), false)
})

test("test run Artifact safety gate removes outputs containing protected values", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "skillconsole-artifact-safety-"),
  )
  const runId = randomUUID()
  const caseId = randomUUID()
  const storage = new TestRunStorage(dataRoot, {
    maxFiles: 10,
    maxFileBytes: 1024,
    maxTotalBytes: 4096,
    maxDirectoryDepth: 8,
    maxPathLength: 256,
    maxZipBytes: 4096,
    maxZipCompressionRatio: 100,
  })
  const outputRoot = path.join(
    storage.getWorkspacePath(runId, caseId),
    "outputs",
  )
  const content = "result contains integration-secret"
  await mkdir(outputRoot, { recursive: true })
  await writeFile(path.join(outputRoot, "result.txt"), content, "utf8")

  try {
    await assert.rejects(
      () =>
        storage.assertArtifactsSafe(
          runId,
          caseId,
          [
            {
              relativePath: "result.txt",
              sha256: createHash("sha256").update(content).digest("hex"),
              byteSize: Buffer.byteLength(content),
              mediaTypeHint: "text/plain",
              contentKind: "text",
            },
          ],
          ["integration-secret"],
        ),
      /protected configuration/i,
    )
    await assert.rejects(() =>
      readFile(path.join(outputRoot, "result.txt")),
    )
  } finally {
    await rm(dataRoot, { recursive: true, force: true })
  }
})
