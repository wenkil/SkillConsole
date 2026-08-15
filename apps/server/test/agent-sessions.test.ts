import assert from "node:assert/strict"
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { migrate } from "drizzle-orm/node-postgres/migrator"
import type {
  SDKAssistantMessageError,
  TerminalReason,
} from "@anthropic-ai/claude-agent-sdk"

import { buildApplication } from "../src/app.js"
import {
  closeDatabaseClient,
  createDatabaseClient,
} from "../src/infrastructure/database/client.js"
import type {
  AgentRuntimeAdapter,
  AgentRuntimeSession,
  AgentSessionEvent,
  AgentSessionView,
  OpenAgentRuntimeSessionInput,
  RuntimeTurnInput,
} from "../src/modules/agent-sessions/agent-session.domain.js"
import {
  AgentSystemPromptStore,
  agentSystemPromptRoles,
} from "../src/modules/agent-sessions/agent-system-prompt.js"
import {
  classifyClaudeAssistantError,
  classifyClaudeResult,
} from "../src/modules/agent-sessions/runtime/claude-error-classifier.js"
import { mapSdkMessage } from "../src/modules/agent-sessions/runtime/sdk-message.mapper.js"
import { AgentSessionWorkspaceStore } from "../src/modules/agent-sessions/session-workspace.js"
import { AgentSessionJsonlWriter } from "../src/modules/agent-sessions/agent-session-jsonl-writer.js"
import { AgentSessionTranscriptStore } from "../src/modules/agent-sessions/agent-session-transcript-store.js"
import { recordFakeNativeTurn } from "./fake-native-agent-log.js"

const folderIgnorePolicyPath = fileURLToPath(
  new URL("../config/upload-folder-ignore.json", import.meta.url),
)
const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
)
const uploadLimits = {
  maxFiles: 100,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  maxDirectoryDepth: 16,
  maxPathLength: 512,
  maxZipBytes: 5 * 1024 * 1024,
  maxZipCompressionRatio: 100,
} as const

class FakeRuntimeSession implements AgentRuntimeSession {
  private initialized = false
  private activeTurnId: string | null = null
  private closed = false

  constructor(
    private readonly input: OpenAgentRuntimeSessionInput,
    private readonly sdkSessionId: string,
  ) {}

  async send(turn: RuntimeTurnInput): Promise<void> {
    if (this.closed) throw new Error("Fake runtime is closed.")
    if (this.activeTurnId) throw new Error("Fake runtime is busy.")

    this.activeTurnId = turn.turnId
    if (!this.initialized && turn.prompt !== "no-init-hold") {
      this.initialized = true
      await this.input.onEvent(null, {
        type: "initialized",
        sdkSessionId: this.sdkSessionId,
        model: "claude-fake-analyzer",
        tools: ["Read", "Write", "Edit", "Skill", "Bash"],
        skills: [],
        mcpServers: [],
      })
    }
    if (turn.prompt === "hold" || turn.prompt === "no-init-hold") return

    await this.input.onEvent(turn.turnId, {
      type: "assistant_message",
      messageId: `message-${turn.turnId}`,
      content: [
        { type: "text", text: `complete:${turn.prompt}` },
        {
          type: "tool_use",
          toolUseId: `tool-${turn.turnId}`,
          name: "Read",
          input: { path: "fixture.txt" },
        },
      ],
    })
    await this.input.onEvent(turn.turnId, {
      type: "tool_completed",
      toolUseId: `tool-${turn.turnId}`,
      content: "fixture contents",
      isError: false,
    })
    await this.finish(turn.turnId, true, "success")
  }

  async interrupt(): Promise<void> {
    if (!this.activeTurnId) throw new Error("Fake runtime is idle.")
    await this.finish(this.activeTurnId, false, "error_during_execution")
  }

  close(): void {
    this.closed = true
  }

  private async finish(
    turnId: string,
    success: boolean,
    subtype: string,
  ): Promise<void> {
    await recordFakeNativeTurn(
      this.input,
      this.sdkSessionId,
      turnId,
      success,
      `complete:${turnId}`,
    )
    await this.input.onEvent(turnId, {
      type: "turn_result",
      success,
      subtype,
      durationMs: 12,
      durationApiMs: 8,
      numTurns: 1,
      totalCostUsd: 0.001,
      usage: {
        inputTokens: 4,
        outputTokens: 5,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      error: success
        ? null
        : {
            code: "CLAUDE_EXECUTION_FAILED",
            message: "The fake turn was interrupted.",
          },
    })
    this.activeTurnId = null
  }
}

class FakeRuntimeAdapter implements AgentRuntimeAdapter {
  readonly opens: OpenAgentRuntimeSessionInput[] = []
  private nextSdkSession = 1

  open(input: OpenAgentRuntimeSessionInput): AgentRuntimeSession {
    this.opens.push(input)
    return new FakeRuntimeSession(
      input,
      input.resumeSessionId ?? `sdk-session-${this.nextSdkSession++}`,
    )
  }
}

function readJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>
}

async function readSseUntil(
  response: Response,
  eventType: string,
): Promise<AgentSessionEvent[]> {
  assert.equal(response.status, 200)
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/)
  assert.ok(response.body)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const events: AgentSessionEvent[] = []
  let buffer = ""

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })

      let boundary = buffer.indexOf("\n\n")
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = frame
          .split("\n")
          .find((line) => line.startsWith("data: "))
        if (data) {
          const event = JSON.parse(data.slice(6)) as AgentSessionEvent
          events.push(event)
          if (event.type === eventType) return events
        }
        boundary = buffer.indexOf("\n\n")
      }
    }
  } finally {
    await reader.cancel()
  }

  throw new Error(`SSE stream ended before ${eventType}.`)
}

test("maps only complete Claude SDK messages and tool results", () => {
  assert.deepEqual(
    mapSdkMessage({
      type: "system",
      subtype: "init",
      session_id: "sdk-session-1",
      model: "claude-test",
      tools: [],
      skills: [],
      mcp_servers: [],
    } as never),
    [
      {
        type: "initialized",
        sdkSessionId: "sdk-session-1",
        model: "claude-test",
        tools: [],
        skills: [],
        mcpServers: [],
      },
    ],
  )

  const assistantEvents = mapSdkMessage(
    {
      type: "assistant",
      uuid: "message-1",
      aborted: false,
      message: {
        content: [
          {
            type: "text",
            text: "complete answer from C:\\private\\workspace",
          },
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "C:\\private\\workspace\\fixture.txt" },
          },
        ],
      },
    } as never,
    { redactedValues: ["C:\\private\\workspace"] },
  )
  assert.deepEqual(assistantEvents, [
    {
      type: "assistant_message",
      messageId: "message-1",
      content: [
        { type: "text", text: "complete answer from [REDACTED]" },
        {
          type: "tool_use",
          toolUseId: "tool-1",
          name: "Read",
          input: { file_path: "[REDACTED]\\fixture.txt" },
        },
      ],
    },
  ])

  const relativeReadPath = mapSdkMessage(
    {
      type: "assistant",
      uuid: "message-2",
      aborted: false,
      message: {
        content: [
          {
            type: "tool_use",
            id: "tool-2",
            name: "Read",
            input: {
              file_path: "C:\\private\\workspace\\target-skill\\SKILL.md",
            },
          },
        ],
      },
    } as never,
    {
      redactedValues: ["C:\\private\\workspace"],
      workspacePath: "C:\\private\\workspace",
    },
  )
  assert.deepEqual(relativeReadPath, [
    {
      type: "assistant_message",
      messageId: "message-2",
      content: [
        {
          type: "tool_use",
          toolUseId: "tool-2",
          name: "Read",
          input: { file_path: "target-skill/SKILL.md" },
        },
      ],
    },
  ])

  assert.deepEqual(
    mapSdkMessage({
      type: "assistant",
      aborted: true,
      uuid: "partial-message",
      message: { content: [{ type: "text", text: "partial" }] },
    } as never),
    [],
  )
  assert.deepEqual(
    mapSdkMessage({
      type: "user",
      isReplay: true,
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: "replayed",
          },
        ],
      },
    } as never),
    [],
  )
  assert.deepEqual(
    mapSdkMessage({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: "complete result",
            is_error: false,
          },
        ],
      },
    } as never),
    [
      {
        type: "tool_completed",
        toolUseId: "tool-1",
        content: "complete result",
        isError: false,
      },
    ],
  )
  assert.deepEqual(
    mapSdkMessage({
      type: "result",
      subtype: "error_during_execution",
      duration_ms: 1,
      duration_api_ms: 1,
      num_turns: 0,
      total_cost_usd: 0,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      errors: ["Not logged in with API key sk-must-not-leak"],
    } as never),
    [
      {
        type: "turn_result",
        success: false,
        subtype: "error_during_execution",
        durationMs: 1,
        durationApiMs: 1,
        numTurns: 0,
        totalCostUsd: 0,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        },
        error: {
          code: "CLAUDE_AUTHENTICATION_FAILED",
          message: "Claude authentication is missing or invalid.",
        },
      },
    ],
  )
})

test("classifies every Claude SDK assistant error and terminal reason", () => {
  const assistantCases = {
    authentication_failed: "CLAUDE_AUTHENTICATION_FAILED",
    oauth_org_not_allowed: "CLAUDE_ORGANIZATION_NOT_ALLOWED",
    billing_error: "CLAUDE_BILLING_ERROR",
    rate_limit: "CLAUDE_RATE_LIMITED",
    overloaded: "CLAUDE_SERVICE_OVERLOADED",
    invalid_request: "CLAUDE_INVALID_REQUEST",
    model_not_found: "CLAUDE_MODEL_NOT_FOUND",
    server_error: "CLAUDE_SERVER_ERROR",
    unknown: "CLAUDE_API_ERROR",
    max_output_tokens: "CLAUDE_MAX_OUTPUT_TOKENS",
  } satisfies Record<SDKAssistantMessageError, string>

  for (const [error, expectedCode] of Object.entries(assistantCases)) {
    assert.equal(
      classifyClaudeAssistantError(error as SDKAssistantMessageError).code,
      expectedCode,
    )
  }

  const terminalCases = {
    blocking_limit: "CLAUDE_BLOCKING_LIMIT_REACHED",
    rapid_refill_breaker: "CLAUDE_RAPID_REFILL_BLOCKED",
    prompt_too_long: "CLAUDE_PROMPT_TOO_LONG",
    image_error: "CLAUDE_IMAGE_ERROR",
    model_error: "CLAUDE_MODEL_ERROR",
    api_error: "CLAUDE_API_ERROR",
    malformed_tool_use_exhausted: "CLAUDE_MALFORMED_TOOL_USE",
    aborted_streaming: "CLAUDE_STREAM_ABORTED",
    aborted_tools: "CLAUDE_TOOLS_ABORTED",
    stop_hook_prevented: "CLAUDE_HOOK_BLOCKED",
    hook_stopped: "CLAUDE_HOOK_BLOCKED",
    tool_deferred: "CLAUDE_TOOL_DEFERRED",
    background_requested: "CLAUDE_BACKGROUND_TASK_UNSUPPORTED",
    completed: null,
    structured_output_retry_exhausted:
      "CLAUDE_STRUCTURED_OUTPUT_FAILED",
    tool_deferred_unavailable: "CLAUDE_TOOL_UNAVAILABLE",
    turn_setup_failed: "CLAUDE_TURN_SETUP_FAILED",
  } satisfies Partial<Record<TerminalReason, string | null>>

  for (const [terminalReason, expectedCode] of Object.entries(
    terminalCases,
  )) {
    const result = classifyClaudeResult({
      type: "result",
      subtype: "success",
      duration_ms: 1,
      duration_api_ms: 1,
      is_error: false,
      num_turns: 1,
      result: "done",
      stop_reason: null,
      total_cost_usd: 0,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      permission_denials: [],
      terminal_reason: terminalReason,
    } as never)
    assert.equal(result?.code ?? null, expectedCode)
  }
})

test("maps structured output and disguised successful errors to failed turns", () => {
  const subtypeCases = {
    error_max_structured_output_retries:
      "CLAUDE_STRUCTURED_OUTPUT_FAILED",
  } as const

  for (const [subtype, expectedCode] of Object.entries(subtypeCases)) {
    const result = classifyClaudeResult({
      type: "result",
      subtype,
      duration_ms: 1,
      duration_api_ms: 1,
      is_error: true,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      permission_denials: [],
      errors: [],
    } as never)
    assert.equal(result?.code, expectedCode)
  }

  const disguisedFailure = mapSdkMessage({
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 1,
    result: "Not logged in · Please run /login",
    stop_reason: null,
    total_cost_usd: 0,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    permission_denials: [],
  } as never)
  assert.equal(disguisedFailure[0]?.type, "turn_result")
  assert.equal(
    disguisedFailure[0]?.type === "turn_result"
      ? disguisedFailure[0].error?.code
      : null,
    "CLAUDE_AUTHENTICATION_FAILED",
  )

  const hintedFailure = classifyClaudeResult(
    {
      type: "result",
      subtype: "success",
      duration_ms: 1,
      duration_api_ms: 0,
      is_error: false,
      num_turns: 1,
      result: "",
      stop_reason: null,
      total_cost_usd: 0,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      permission_denials: [],
    } as never,
    classifyClaudeAssistantError("billing_error"),
  )
  assert.equal(hintedFailure?.code, "CLAUDE_BILLING_ERROR")

  const legitimateAnswer = classifyClaudeResult({
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: "Document the rate limit behavior in the test case.",
    stop_reason: "end_turn",
    total_cost_usd: 0,
    usage: {
      input_tokens: 10,
      output_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    permission_denials: [],
  } as never)
  assert.equal(legitimateAnswer, null)
})

test("loads every fixed Agent System Prompt with a content-addressed version", async () => {
  const store = new AgentSystemPromptStore(path.resolve("agent-prompts"))
  for (const role of agentSystemPromptRoles) {
    const prompt = await store.load(role)
    assert.equal(prompt.role, role)
    assert.match(prompt.fileName, /\.system\.md$/)
    assert.match(prompt.sha256, /^[0-9a-f]{64}$/)
    assert.equal(
      prompt.version,
      `${prompt.fileName}@sha256:${prompt.sha256}`,
    )
    assert.ok(prompt.content.trim().length > 0)
  }
})

test("persists ordered raw JSONL and idempotent main and subagent transcripts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillconsole-native-log-"))
  const rawPath = path.join(root, "sdk-messages.jsonl")
  const writer = new AgentSessionJsonlWriter(rawPath)
  const bound: string[] = []
  const failures: unknown[] = []
  const store = new AgentSessionTranscriptStore(
    path.join(root, "transcript"),
    async (sessionId) => {
      bound.push(sessionId)
    },
    async (error) => {
      failures.push(error)
    },
  )
  try {
    await writer.initialize()
    await store.initialize()
    await writer.append({ sequence: 1, type: "system" })
    await writer.append({ sequence: 2, type: "assistant", text: "raw" })
    const key = { projectKey: "fixture", sessionId: "sdk-fixture" }
    await store.append(key, [
      { type: "assistant", uuid: "message-1", value: "first" },
      { type: "mode", value: "default" },
    ])
    await store.append(key, [
      { type: "assistant", uuid: "message-1", value: "duplicate" },
      { type: "assistant", uuid: "message-2", value: "second" },
    ])
    await store.append(
      { ...key, subpath: "subagents/agent-worker.jsonl" },
      [{ type: "assistant", uuid: "subagent-1", value: "nested" }],
    )
    await Promise.all([writer.close(), store.close()])

    assert.deepEqual(
      (await readFile(rawPath, "utf8"))
        .trim()
        .split(/\r?\n/u)
        .map((line) => JSON.parse(line)),
      [
        { sequence: 1, type: "system" },
        { sequence: 2, type: "assistant", text: "raw" },
      ],
    )
    assert.deepEqual(
      (await store.load(key))?.map((entry) => entry.uuid ?? entry.type),
      ["message-1", "mode", "message-2"],
    )
    assert.deepEqual(await store.listSubkeys(key), [
      "subagents/agent-worker.jsonl",
    ])
    assert.ok(bound.every((sessionId) => sessionId === "sdk-fixture"))
    assert.deepEqual(failures, [])
  } finally {
    await writer.close().catch(() => undefined)
    await store.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test("copies root Claude settings into an isolated session workspace once", async () => {
  const dataRoot = await mkdtemp(
    path.join(tmpdir(), "skillconsole-agent-workspace-"),
  )
  const sourceSettingsPath = path.join(dataRoot, "root-settings.json")
  const sourceSettings = JSON.stringify(
    {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
      env: {
        ANTHROPIC_API_KEY: "workspace-secret",
        ANTHROPIC_BASE_URL: "https://example.invalid",
      },
    },
    null,
    2,
  )

  try {
    await writeFile(sourceSettingsPath, sourceSettings, "utf8")
    const store = new AgentSessionWorkspaceStore(
      dataRoot,
      sourceSettingsPath,
    )
    const workspace = await store.prepare(
      "01900000-0000-7000-8000-000000000001",
    )
    const redactedValues = await store.installSettings(
      workspace.absolutePath,
    )
    const copiedSettingsPath = path.join(
      workspace.absolutePath,
      ".claude",
      "settings.json",
    )

    assert.equal(
      workspace.locator,
      "agent-sessions/01900000-0000-7000-8000-000000000001/workspace",
    )
    assert.equal(
      await readFile(copiedSettingsPath, "utf8"),
      sourceSettings,
    )
    assert.ok(redactedValues.includes(sourceSettings))
    assert.ok(redactedValues.includes("workspace-secret"))
    assert.ok(redactedValues.includes("https://example.invalid"))

    await writeFile(sourceSettingsPath, '{"changed":true}', "utf8")
    assert.equal(
      await readFile(copiedSettingsPath, "utf8"),
      sourceSettings,
    )
  } finally {
    await rm(dataRoot, { recursive: true, force: true })
  }
})

test("creates the Claude settings directory for a prepared external workspace", async () => {
  const dataRoot = await mkdtemp(
    path.join(tmpdir(), "skillconsole-agent-external-workspace-"),
  )
  const sourceSettingsPath = path.join(dataRoot, "root-settings.json")
  const workspacePath = path.join(dataRoot, "eval-generations", "task", "workspace")

  try {
    await writeFile(sourceSettingsPath, '{"env":{"TOKEN":"value"}}', "utf8")
    await mkdir(workspacePath, { recursive: true })
    const store = new AgentSessionWorkspaceStore(dataRoot, sourceSettingsPath)

    await store.installSettings(workspacePath)

    assert.equal(
      await readFile(path.join(workspacePath, ".claude", "settings.json"), "utf8"),
      '{"env":{"TOKEN":"value"}}',
    )
  } finally {
    await rm(dataRoot, { recursive: true, force: true })
  }
})

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim()

test(
  "provides durable Agent Session HTTP, SSE, cancellation, and recovery contracts",
  { skip: !testDatabaseUrl, timeout: 60_000 },
  async () => {
    assert.ok(testDatabaseUrl)
    const dataRoot = await mkdtemp(
      path.join(tmpdir(), "skillconsole-agent-sessions-"),
    )
    const claudeSettingsPath = path.join(dataRoot, "settings.json")
    const claudeSettings = JSON.stringify({
      env: { ANTHROPIC_API_KEY: "integration-secret" },
    })
    await writeFile(claudeSettingsPath, claudeSettings, "utf8")
    const migrationClient = createDatabaseClient(testDatabaseUrl, {
      applicationName: "skillconsole-agent-session-migration-test",
      maxConnections: 2,
    })

    try {
      await migrate(migrationClient.database, {
        migrationsFolder,
        migrationsSchema: "drizzle",
        migrationsTable: "migrations",
      })
    } finally {
      await closeDatabaseClient(migrationClient)
    }

    const config = {
      nodeEnvironment: "test",
      host: "127.0.0.1",
      port: 3000,
      databaseUrl: testDatabaseUrl,
      logLevel: "silent",
      openApiEnabled: false,
      dataRoot,
      claudeSettingsPath,
      agentPromptsRoot: path.resolve("agent-prompts"),
      uploadFolderIgnoreConfigPath: folderIgnorePolicyPath,
      uploadLimits,
    } as const
    const adapter = new FakeRuntimeAdapter()
    let application = await buildApplication({
      config,
      logger: false,
      agentRuntimeAdapter: adapter,
    })
    let address = await application.listen({
      host: "127.0.0.1",
      port: 0,
    })

    try {
      const createdResponse = await fetch(`${address}/api/agent-sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "first" }),
      })
      assert.equal(createdResponse.status, 202)
      const created = await readJson<AgentSessionView>(createdResponse)
      assert.equal(created.status, "STARTING")
      assert.equal(
        JSON.stringify(created).includes("sdk-session"),
        false,
      )
      assert.equal(JSON.stringify(created).includes(dataRoot), false)
      assert.equal(
        JSON.stringify(created).includes("integration-secret"),
        false,
      )
      assert.equal(adapter.opens[0]?.cwd.endsWith("workspace"), true)
      assert.ok(
        adapter.opens[0]?.redactedValues.includes(
          "integration-secret",
        ),
      )
      assert.equal(
        await readFile(
          path.join(
            dataRoot,
            "agent-sessions",
            created.id,
            "workspace",
            ".claude",
            "settings.json",
          ),
          "utf8",
        ),
        claudeSettings,
      )

      const firstStateResponse = await fetch(
        `${address}/api/agent-sessions/${created.id}`,
      )
      assert.equal(firstStateResponse.status, 200)
      const firstState = await readJson<AgentSessionView>(
        firstStateResponse,
      )
      assert.equal(firstState.status, "IDLE")
      assert.equal(firstState.resumable, true)
      assert.equal(firstState.latestTurn?.status, "COMPLETED")

      const nativeLogRoot = path.join(
        dataRoot,
        "agent-session-logs",
        created.id,
      )
      const metadata = JSON.parse(
        await readFile(path.join(nativeLogRoot, "metadata.json"), "utf8"),
      ) as { readonly status: string; readonly origin: { readonly type: string } }
      assert.equal(metadata.status, "COMPLETE")
      assert.equal(metadata.origin.type, "generic")
      assert.ok(
        (await readFile(path.join(nativeLogRoot, "sdk-messages.jsonl"), "utf8"))
          .trim()
          .split(/\r?\n/u).length >= 2,
      )
      assert.match(
        await readFile(
          path.join(nativeLogRoot, "transcript", "main.jsonl"),
          "utf8",
        ),
        /transcript-/,
      )
      const usage = JSON.parse(
        await readFile(path.join(nativeLogRoot, "usage.json"), "utf8"),
      ) as { readonly status: string; readonly inputTokens: number }
      assert.equal(usage.status, "COMPLETE")
      assert.equal(usage.inputTokens, 10)
      const finalOutput = JSON.parse(
        await readFile(path.join(nativeLogRoot, "final-output.json"), "utf8"),
      ) as {
        readonly status: string
        readonly complete: boolean
        readonly text: string
        readonly messageId: string
      }
      assert.equal(finalOutput.status, "AVAILABLE")
      assert.equal(finalOutput.complete, true)
      assert.match(finalOutput.text, /^complete:/u)
      assert.match(finalOutput.messageId, /^message-/u)
      assert.equal(JSON.stringify(usage).includes("complete:"), false)
      assert.match(
        adapter.opens[0]?.claudeConfigDir ?? "",
        new RegExp(`claude-runtime[\\\\/]${created.id}$`, "u"),
      )

      const firstEventsResponse = await fetch(
        `${address}/api/agent-sessions/${created.id}/events`,
        { headers: { "Last-Event-ID": "2" } },
      )
      const firstEvents = await readSseUntil(
        firstEventsResponse,
        "turn.completed",
      )
      assert.deepEqual(
        firstEvents.map((event) => event.type),
        [
          "session.initialized",
          "assistant.message",
          "tool.completed",
          "usage.updated",
          "turn.completed",
        ],
      )
      assert.deepEqual(
        firstEvents.map((event) => event.sequence),
        [3, 4, 5, 6, 7],
      )
      assert.equal(
        firstEvents.some((event) => event.type.includes("delta")),
        false,
      )

      const liveStream = await fetch(
        `${address}/api/agent-sessions/${created.id}/events`,
        { headers: { "Last-Event-ID": "7" } },
      )
      const liveEventsPromise = readSseUntil(
        liveStream,
        "turn.completed",
      )
      const continuedResponse = await fetch(
        `${address}/api/agent-sessions/${created.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "second" }),
        },
      )
      assert.equal(continuedResponse.status, 202)
      const liveEvents = await liveEventsPromise
      assert.equal(liveEvents[0]?.type, "turn.started")
      assert.equal(liveEvents.at(-1)?.type, "turn.completed")
      assert.ok(liveEvents.every((event) => event.sequence > 7))
      assert.equal(adapter.opens.length, 1)

      const holdResponse = await fetch(
        `${address}/api/agent-sessions/${created.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "hold" }),
        },
      )
      assert.equal(holdResponse.status, 202)

      const busyResponse = await fetch(
        `${address}/api/agent-sessions/${created.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "must conflict" }),
        },
      )
      assert.equal(busyResponse.status, 409)

      const cancelResponse = await fetch(
        `${address}/api/agent-sessions/${created.id}/cancel`,
        { method: "POST" },
      )
      assert.equal(cancelResponse.status, 202)
      const canceled = await readJson<AgentSessionView>(cancelResponse)
      assert.equal(canceled.status, "IDLE")
      assert.equal(canceled.latestTurn?.status, "CANCELED")

      const idleCancelResponse = await fetch(
        `${address}/api/agent-sessions/${created.id}/cancel`,
        { method: "POST" },
      )
      assert.equal(idleCancelResponse.status, 409)

      const resumedHoldResponse = await fetch(
        `${address}/api/agent-sessions/${created.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "hold" }),
        },
      )
      assert.equal(resumedHoldResponse.status, 202)

      const noIdResponse = await fetch(`${address}/api/agent-sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "no-init-hold" }),
      })
      assert.equal(noIdResponse.status, 202)
      const noIdSession = await readJson<AgentSessionView>(noIdResponse)

      const unknownResponse = await fetch(
        `${address}/api/agent-sessions/01900000-0000-7000-8000-000000000001`,
      )
      assert.equal(unknownResponse.status, 404)

      await application.close()

      application = await buildApplication({
        config,
        logger: false,
        agentRuntimeAdapter: adapter,
      })
      address = await application.listen({
        host: "127.0.0.1",
        port: 0,
      })

      const interruptedResponse = await fetch(
        `${address}/api/agent-sessions/${created.id}`,
      )
      const interrupted = await readJson<AgentSessionView>(
        interruptedResponse,
      )
      assert.equal(interrupted.status, "INTERRUPTED")
      assert.equal(interrupted.resumable, true)
      assert.equal(interrupted.latestTurn?.status, "INTERRUPTED")

      const resumedResponse = await fetch(
        `${address}/api/agent-sessions/${created.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "after-restart" }),
        },
      )
      assert.equal(resumedResponse.status, 202)
      assert.equal(
        adapter.opens.at(-1)?.resumeSessionId,
        "sdk-session-1",
      )

      const nonResumableResponse = await fetch(
        `${address}/api/agent-sessions/${noIdSession.id}`,
      )
      const nonResumable = await readJson<AgentSessionView>(
        nonResumableResponse,
      )
      assert.equal(nonResumable.status, "INTERRUPTED")
      assert.equal(nonResumable.resumable, false)
      const rejectedResume = await fetch(
        `${address}/api/agent-sessions/${noIdSession.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "cannot resume" }),
        },
      )
      assert.equal(rejectedResume.status, 409)
    } finally {
      await application.close()
      await rm(dataRoot, { recursive: true, force: true })
    }
  },
)
