import assert from "node:assert/strict"
import {
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
import { mapSdkMessage } from "../src/modules/agent-sessions/runtime/sdk-message.mapper.js"
import { AgentSessionWorkspaceStore } from "../src/modules/agent-sessions/session-workspace.js"

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
          message: "Claude Agent SDK authentication failed.",
        },
      },
    ],
  )
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
          "assistant.message",
          "tool.completed",
          "usage.updated",
          "turn.completed",
        ],
      )
      assert.deepEqual(
        firstEvents.map((event) => event.sequence),
        [3, 4, 5, 6],
      )
      assert.equal(
        firstEvents.some((event) => event.type.includes("delta")),
        false,
      )

      const liveStream = await fetch(
        `${address}/api/agent-sessions/${created.id}/events`,
        { headers: { "Last-Event-ID": "6" } },
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
      assert.ok(liveEvents.every((event) => event.sequence > 6))
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
