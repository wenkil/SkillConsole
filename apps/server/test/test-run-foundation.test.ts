import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { AgentSessionWorkspaceStore } from "../src/modules/agent-sessions/session-workspace.js"
import { mapSdkMessage } from "../src/modules/agent-sessions/runtime/sdk-message.mapper.js"
import { buildExecutionPrompt } from "../src/modules/test-runs/test-run-prompt.js"
import {
  formatEvidenceWithLineNumbers,
  resolveEvidenceAnchors,
  TestRunGraderProtocolError,
} from "../src/modules/test-runs/test-run-grader-protocol.js"
import { TestRunScorer } from "../src/modules/test-runs/test-run-scorer.js"
import {
  containsPublicRuntimeLeakContent,
  containsPublicRuntimeLeakText,
  sanitizeTestRunPublicValue,
} from "../src/modules/test-runs/test-run-public-safety.js"
import {
  buildTestRunRuntimeEnvironment,
  forTestRunWorkspace,
} from "../src/modules/test-runs/test-run-runtime-environment.js"
import {
  buildTestRunSemanticConfigurationFingerprint,
  extractObservedBundledScriptPaths,
  getTestRunCaseSideOrder,
} from "../src/modules/test-runs/test-run.service.js"
import { TestRunStorage } from "../src/modules/test-runs/test-run-storage.js"

test("version comparison alternates the paired serial order by Eval", () => {
  assert.deepEqual(
    [0, 1, 2].map((index) =>
      getTestRunCaseSideOrder("version_vs_version", index),
    ),
    [
      ["BASELINE", "TARGET"],
      ["TARGET", "BASELINE"],
      ["BASELINE", "TARGET"],
    ],
  )
  assert.deepEqual(
    getTestRunCaseSideOrder("target_vs_no_skill", 1),
    ["TARGET", "BASELINE"],
  )
})

test("semantic configuration fingerprint ignores credentials but tracks model changes", () => {
  const settings = (apiKey: string, model: string, subagentModel = model) =>
    Buffer.from(
      JSON.stringify({
        model: "claude-top-level",
        env: {
          ANTHROPIC_API_KEY: apiKey,
          ANTHROPIC_BASE_URL: "https://api.example.test",
          ANTHROPIC_MODEL: model,
          CLAUDE_CODE_SUBAGENT_MODEL: subagentModel,
        },
      }),
      "utf8",
    )

  const promptVersions = {
    executionPromptVersion: "execution.system.md@sha256:test",
    graderProtocolVersion: "grader.system.md@sha256:test",
  }
  const first = buildTestRunSemanticConfigurationFingerprint(
    settings("secret-one", "claude-test"),
    promptVersions,
  )
  const credentialOnly = buildTestRunSemanticConfigurationFingerprint(
    settings("secret-two", "claude-test"),
    promptVersions,
  )
  const modelChanged = buildTestRunSemanticConfigurationFingerprint(
    settings("secret-two", "claude-test-next"),
    promptVersions,
  )
  const subagentModelChanged = buildTestRunSemanticConfigurationFingerprint(
    settings("secret-two", "claude-test", "claude-subagent-next"),
    promptVersions,
  )

  assert.equal(first, credentialOnly)
  assert.notEqual(first, modelChanged)
  assert.notEqual(first, subagentModelChanged)
})

test("test run log payloads redact host absolute paths recursively", () => {
  assert.deepEqual(
    sanitizeTestRunPublicValue({
      command: "python /usr/bin/tool.py C:\\Users\\tester\\secret.txt",
      nested: [
        "/tmp/work/result.txt",
        "/workspace/settings.json",
        "/nix/store/abcd/main.js",
        "\\\\fileserver\\private\\secret.txt",
        '"C:\\Program Files\\Secret App\\config.json"',
        "https://example.test/public/result",
        "file:///C:/Users/tester/secret.js",
        "outputs/result.txt",
      ],
      stack:
        "Error: fail at run (file:///nix/store/abcd/main.js:1:2)",
    }),
    {
      command: "python /usr/bin/tool.py [REDACTED_PATH]",
      nested: [
        "[REDACTED_PATH]",
        "[REDACTED_PATH]",
        "[REDACTED_PATH]",
        "[REDACTED_PATH]",
        '"[REDACTED_PATH]"',
        "https://example.test/public/result",
        "[REDACTED_PATH]",
        "outputs/result.txt",
      ],
      stack: "[REDACTED_STACK]",
    },
  )
  assert.equal(
    containsPublicRuntimeLeakText("GET /api/users and /v1/orders/:id"),
    false,
  )
  assert.equal(
    containsPublicRuntimeLeakText(
      "Error: fail at run (file:///nix/store/abcd/main.js:1:2)",
    ),
    true,
  )
  const sanitizedJson = String(
    sanitizeTestRunPublicValue(
      '{"reason":"/workspace/private.txt","reference":"file:///nix/store/main.js","passed":false}',
    ),
  )
  assert.deepEqual(JSON.parse(sanitizedJson), {
    reason: "[REDACTED_PATH]",
    reference: "[REDACTED_PATH]",
    passed: false,
  })
})

test("Artifact safety detects UTF-16 paths and sensitive values without rejecting ordinary binary", () => {
  const utf16be = (value: string) => {
    const littleEndian = Buffer.from(value, "utf16le")
    for (let index = 0; index + 1 < littleEndian.length; index += 2) {
      const first = littleEndian[index]
      littleEndian[index] = littleEndian[index + 1]!
      littleEndian[index + 1] = first!
    }
    return littleEndian
  }
  const absolutePath = "C:\\Users\\tester\\private.txt"
  const sensitiveValue = "integration-secret"

  assert.equal(
    containsPublicRuntimeLeakContent(Buffer.from(absolutePath, "utf16le")),
    false,
  )
  assert.equal(containsPublicRuntimeLeakContent(utf16be(absolutePath)), false)
  assert.equal(
    containsPublicRuntimeLeakContent(
      Buffer.from(absolutePath, "utf16le"),
      [absolutePath],
    ),
    true,
  )
  assert.equal(
    containsPublicRuntimeLeakContent(
      Buffer.from("Document GET /api/users and /v1/orders/:id", "utf8"),
    ),
    false,
  )
  assert.equal(
    containsPublicRuntimeLeakContent(
      Buffer.from(sensitiveValue, "utf16le"),
      [sensitiveValue],
    ),
    true,
  )
  assert.equal(
    containsPublicRuntimeLeakContent(utf16be(sensitiveValue), [
      sensitiveValue,
    ]),
    true,
  )
  assert.equal(
    containsPublicRuntimeLeakContent(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2]),
      [sensitiveValue],
    ),
    false,
  )
})

test("bundled script observations normalize Windows paths and reject Eval input paths", () => {
  const declared = new Set(["scripts/render.py"])
  assert.deepEqual(
    extractObservedBundledScriptPaths(
      {
        command:
          "python scripts\\render.py && python .claude\\skills\\csv-to-md\\scripts\\render.py",
      },
      "csv-to-md",
      declared,
    ),
    ["scripts/render.py"],
  )
  assert.deepEqual(
    extractObservedBundledScriptPaths(
      { command: "python inputs\\scripts\\render.py" },
      "csv-to-md",
      declared,
    ),
    [],
  )
})

test("test run runtime environment excludes unrelated Server secrets", () => {
  const frozen = buildTestRunRuntimeEnvironment(
    Buffer.from(
      JSON.stringify({
        model: "claude-top-level",
        env: {
          ANTHROPIC_AUTH_TOKEN: "test-anthropic-token",
          ANTHROPIC_BASE_URL: "https://api.example.test",
          CLAUDE_CODE_SUBAGENT_MODEL: "qwen3.7-plus",
          INTERNAL_DATABASE_TOKEN: "must-not-reach-runtime",
        },
      }),
    ),
    {
      PATH: "C:\\Runtime\\bin",
      DATABASE_URL: "postgres://private.example.test/database",
      CLOUD_API_TOKEN: "host-cloud-secret",
    },
  )
  assert.equal(
    frozen.values.PATH
      ?.split(path.delimiter)
      .includes(path.dirname(process.execPath)),
    true,
  )
  assert.equal(frozen.values.PATH?.includes("C:\\Runtime\\bin"), false)
  assert.equal(
    frozen.values.ANTHROPIC_AUTH_TOKEN,
    "test-anthropic-token",
  )
  assert.equal(
    frozen.values.ANTHROPIC_BASE_URL,
    "https://api.example.test",
  )
  assert.equal(frozen.values.ANTHROPIC_MODEL, "claude-top-level")
  assert.equal(
    frozen.values.CLAUDE_CODE_SUBAGENT_MODEL,
    "qwen3.7-plus",
  )
  assert.deepEqual(frozen.sensitiveValues, [
    "test-anthropic-token",
    "https://api.example.test",
  ])
  assert.deepEqual(frozen.protectedNames, [
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
    "INTERNAL_DATABASE_TOKEN",
  ])
  assert.equal(
    JSON.stringify(frozen).includes("host-cloud-secret"),
    false,
  )
  assert.equal(
    JSON.stringify(frozen).includes("must-not-reach-runtime"),
    false,
  )

  const isolated = forTestRunWorkspace(
    frozen,
    "C:\\controlled\\case\\workspace",
  )
  assert.equal(
    isolated.values.HOME,
    "C:\\controlled\\case\\workspace",
  )
  assert.equal(isolated.values.PYTHONNOUSERSITE, "1")
  assert.equal(
    isolated.values.TMP,
    path.join("C:\\controlled\\case\\workspace", "outputs", ".tmp"),
  )
  assert.equal(isolated.values.TEMP, isolated.values.TMP)
  assert.equal(isolated.values.TMPDIR, isolated.values.TMP)
  assert.deepEqual(isolated.sensitiveValues, frozen.sensitiveValues)
})

test("runtime redaction ignores short control values but still removes secrets", () => {
  const events = mapSdkMessage(
    {
      type: "assistant",
      uuid: "message-redaction",
      aborted: false,
      message: {
        content: [
          {
            type: "text",
            text: '{"assertionIndex":1,"token":"real-secret"}',
          },
        ],
      },
    } as never,
    { redactedValues: ["1", "real-secret"] },
  )
  assert.equal(
    events[0]?.type === "assistant_message"
      ? events[0].content[0]?.type === "text"
        ? events[0].content[0].text
        : null
      : null,
    '{"assertionIndex":1,"token":"[REDACTED]"}',
  )
})

test("test execution bootstrap delegates task detail to the workspace file", () => {
  assert.equal(
    buildExecutionPrompt(),
    "Read inputs/task.json and execute the test Case described there.",
  )
  assert.doesNotMatch(buildExecutionPrompt(), /TARGET|BASELINE|fixture/)
})

test("test run scorer requires one independently evidenced result per assertion", () => {
  const scorer = new TestRunScorer()
  const result = scorer.parse(
    `\`\`\`json\n${JSON.stringify({
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
              startLine: 2,
              endLine: 2,
            },
          ],
        },
      ],
    })}\n\`\`\``,
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
    (error: unknown) =>
      error instanceof TestRunGraderProtocolError &&
      error.code === "TEST_RUN_GRADER_SCHEMA_INVALID" &&
      /failed validation/i.test(error.message),
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
                  startLine: 1,
                  endLine: 1,
                },
              ],
            },
          ],
        })}`,
        ["First"],
      ),
    (error: unknown) =>
      error instanceof TestRunGraderProtocolError &&
      error.code === "TEST_RUN_GRADER_JSON_INVALID" &&
      /not valid JSON/i.test(error.message),
  )
})

test("test run grader protocol resolves line anchors from original evidence", () => {
  assert.equal(
    formatEvidenceWithLineNumbers("Heading\r\nSummary complete."),
    "L1: Heading\nL2: Summary complete.",
  )

  const resolved = resolveEvidenceAnchors(
    [
      {
        assertionIndex: 0,
        status: "PASSED",
        reason: "The summary is present.",
        evidence: [
          {
            source: "assistant_output",
            reference: "final-output",
            startLine: 2,
            endLine: 2,
          },
          {
            source: "artifact",
            reference: "summary.txt",
            startLine: 1,
            endLine: 2,
          },
        ],
      },
    ],
    "Heading\r\nSummary complete.",
    [
      {
        relativePath: "summary.txt",
        content: "First line\nSecond line",
      },
    ],
  )

  assert.deepEqual(resolved[0]?.evidence, [
    {
      source: "assistant_output",
      reference: "final-output#L2-L2",
      excerpt: "Summary complete.",
    },
    {
      source: "artifact",
      reference: "summary.txt#L1-L2",
      excerpt: "First line\nSecond line",
    },
  ])
  assert.throws(
    () =>
      resolveEvidenceAnchors(
        [
          {
            assertionIndex: 0,
            status: "PASSED",
            reason: "Invalid citation.",
            evidence: [
              {
                source: "artifact",
                reference: "summary.txt",
                startLine: 3,
                endLine: 3,
              },
            ],
          },
        ],
        "Summary complete.",
        [{ relativePath: "summary.txt", content: "Only one line" }],
      ),
    (error: unknown) =>
      error instanceof TestRunGraderProtocolError &&
      error.code === "TEST_RUN_GRADER_EVIDENCE_INVALID",
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

test("target and baseline use the same execution bootstrap prompt", () => {
  assert.equal(buildExecutionPrompt(), buildExecutionPrompt())
  assert.equal(buildExecutionPrompt().includes("TARGET"), false)
  assert.equal(buildExecutionPrompt().includes("BASELINE"), false)
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
  await mkdir(path.join(outputRoot, ".tmp"), { recursive: true })
  await writeFile(
    path.join(outputRoot, ".tmp", "transient.txt"),
    "temporary data",
    "utf8",
  )

  try {
    const collected = await storage.collectArtifacts(runId, caseId)
    assert.deepEqual(
      collected.map((artifact) => artifact.relativePath),
      ["result.txt"],
    )
    await assert.rejects(() =>
      readFile(path.join(outputRoot, ".tmp", "transient.txt")),
    )
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

    const leakedPathContent =
      "execution diagnostics referenced /workspace/settings.json"
    await writeFile(
      path.join(outputRoot, "runtime-path.txt"),
      leakedPathContent,
      "utf8",
    )
    await assert.rejects(
      () =>
        storage.assertArtifactsSafe(
          runId,
          caseId,
          [
            {
              relativePath: "runtime-path.txt",
              sha256: createHash("sha256")
                .update(leakedPathContent)
                .digest("hex"),
              byteSize: Buffer.byteLength(leakedPathContent),
              mediaTypeHint: "text/plain",
              contentKind: "text",
            },
          ],
          [],
        ),
      /runtime information/i,
    )
    await assert.rejects(() =>
      readFile(path.join(outputRoot, "runtime-path.txt")),
    )

    const binaryLeakContent = Buffer.concat([
      Buffer.from([0]),
      Buffer.from("file:///workspace/private/secret.txt", "utf8"),
    ])
    await writeFile(
      path.join(outputRoot, "binary-leak.bin"),
      binaryLeakContent,
    )
    await assert.rejects(
      () =>
        storage.assertArtifactsSafe(
          runId,
          caseId,
          [
            {
              relativePath: "binary-leak.bin",
              sha256: createHash("sha256")
                .update(binaryLeakContent)
                .digest("hex"),
              byteSize: binaryLeakContent.byteLength,
              mediaTypeHint: "application/octet-stream",
              contentKind: "binary",
            },
          ],
          [],
        ),
      /runtime information/i,
    )
    await assert.rejects(() =>
      readFile(path.join(outputRoot, "binary-leak.bin")),
    )
  } finally {
    await rm(dataRoot, { recursive: true, force: true })
  }
})
