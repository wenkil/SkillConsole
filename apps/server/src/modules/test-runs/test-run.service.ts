import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"

import { DomainError } from "../../core/errors/domain-error.js"
import type {
  SkillTestRunCaseRow,
  StoredTestRunUsage,
  TestRunMode,
} from "../../infrastructure/database/index.js"
import {
  claudeAgentSdkVersion,
  type AgentSessionEvent,
} from "../agent-sessions/agent-session.domain.js"
import type { AgentSessionService } from "../agent-sessions/agent-session.service.js"
import { DraftRevisionService } from "../skill-workspaces/draft-revision.service.js"
import type {
  CreateTestRunInput,
  TestRunDetailView,
  TestRunEvent,
  TestRunEnvironmentSnapshot,
  TestRunLogPage,
  TestRunLogQuery,
  TestRunPage,
  TestRunRuntimeCapabilitySnapshot,
  TestRunView,
} from "./test-run.domain.js"
import { TestRunEventBus } from "./test-run-event-bus.js"
import {
  buildExecutionPrompt,
  buildExecutionPromptProtocolVersion,
  buildExecutionSkillPolicyFingerprint,
  buildAssertionPrompt,
  buildSkillScorePrompt,
  type TestRunExecutionSkillPolicy,
} from "./test-run-prompt.js"
import {
  TestRunRepository,
  type FrozenTestRunSelection,
} from "./test-run.repository.js"
import {
  containsPublicRuntimeLeakContent,
  sanitizeTestRunPublicValue,
} from "./test-run-public-safety.js"
import {
  buildTestRunRuntimeEnvironment,
  forTestRunWorkspace,
  type TestRunRuntimeEnvironment,
} from "./test-run-runtime-environment.js"
import { TestRunStorage } from "./test-run-storage.js"

export const testRunProtocolVersion = "skill-test-run-agent-chain-v6"
const projectSettingsPermissionPolicyVersion = "root-settings-explicit-v2"
const executionLimits = {
  timeoutMs: 1_800_000,
} as const
const gradingLimits = {
  timeoutMs: 1_800_000,
} as const

interface TestRunLogger {
  readonly error: (
    bindings: Readonly<Record<string, unknown>>,
    message: string,
  ) => void
  readonly warn?: (
    bindings: Readonly<Record<string, unknown>>,
    message: string,
  ) => void
}

export interface TestRunServiceOptions {
  readonly claudeSettingsPath: string
  readonly repository: TestRunRepository
  readonly draftRevisions: DraftRevisionService
  readonly storage: TestRunStorage
  readonly agentSessions: AgentSessionService
  readonly logger: TestRunLogger
}

interface MonitoredSessionResult {
  readonly status: "COMPLETED" | "CANCELED" | "INTERRUPTED" | "FAILED"
  readonly finalOutput: string
  readonly usage: StoredTestRunUsage | null
  readonly observations: ExecutionObservations
  readonly error: {
    readonly code: string
    readonly message: string
  } | null
}

interface MonitoredScoreSessionResult {
  readonly status: "COMPLETED" | "CANCELED" | "INTERRUPTED" | "FAILED"
  readonly finalOutput: string
  readonly usage: StoredTestRunUsage | null
  readonly error: {
    readonly code: string
    readonly message: string
  } | null
}

interface ExecutionObservations {
  readonly skillInvocationObserved:
    | "OBSERVED"
    | "NOT_OBSERVED"
    | "NOT_APPLICABLE"
  readonly skillToolCallCount: number
  readonly bundledScriptUses: readonly {
    readonly relativePath: string
    readonly count: number
    readonly evidenceSequences: readonly number[]
  }[]
}

interface SemanticRuntimeConfiguration {
  readonly model: string
  readonly subagentModel: string
  readonly apiEndpointHash: string | null
}

export interface TestRunPromptVersions {
  readonly executionPromptVersion: string
  readonly graderProtocolVersion: string
}

function buildAgentChainProtocolVersion(
  assertionPromptVersion: string,
  scorePromptVersion: string,
): string {
  return `test-run-agent-chain@sha256:${sha256(
    JSON.stringify({ assertionPromptVersion, scorePromptVersion }),
  )}`
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableHash(value: unknown): string {
  return sha256(JSON.stringify(value))
}

function executionSkillPolicy(
  installSkill: boolean,
  skillName: string,
): TestRunExecutionSkillPolicy {
  return installSkill
    ? { kind: "required", skillName }
    : { kind: "forbidden", skillName }
}

function parseSemanticRuntimeConfiguration(
  settings: Buffer,
): SemanticRuntimeConfiguration {
  try {
    const parsed = JSON.parse(settings.toString("utf8")) as {
      readonly model?: unknown
      readonly env?: Readonly<Record<string, unknown>>
    }
    const configuredModel =
      typeof parsed.env?.ANTHROPIC_MODEL === "string"
        ? parsed.env.ANTHROPIC_MODEL.trim()
        : typeof parsed.model === "string"
          ? parsed.model.trim()
          : ""
    const endpoint =
      typeof parsed.env?.ANTHROPIC_BASE_URL === "string"
        ? parsed.env.ANTHROPIC_BASE_URL.trim()
        : ""
    const configuredSubagentModel =
      typeof parsed.env?.CLAUDE_CODE_SUBAGENT_MODEL === "string"
        ? parsed.env.CLAUDE_CODE_SUBAGENT_MODEL.trim()
        : ""
    return {
      model: configuredModel || "sdk_default",
      subagentModel: configuredSubagentModel || "sdk_default",
      apiEndpointHash: endpoint ? sha256(endpoint) : null,
    }
  } catch {
    return {
      model: "sdk_default",
      subagentModel: "sdk_default",
      apiEndpointHash: null,
    }
  }
}

function buildEnvironmentSnapshot(
  semantic: SemanticRuntimeConfiguration,
  runtimeCapabilities: readonly TestRunRuntimeCapabilitySnapshot[],
  executionPolicy:
    | "target_then_no_skill_serial_v1"
    | "paired_serial_alternating_v1",
  promptVersions: TestRunPromptVersions,
): TestRunEnvironmentSnapshot {
  return {
    status: "captured",
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    sdkVersion: claudeAgentSdkVersion,
    model: semantic.model,
    apiEndpointHash: semantic.apiEndpointHash,
    executionLimits,
    gradingLimits,
    executionPromptVersion: promptVersions.executionPromptVersion,
    graderProtocolVersion: promptVersions.graderProtocolVersion,
    toolPermissionPolicyVersion: projectSettingsPermissionPolicyVersion,
    executionPolicy,
    runtimeCapabilities,
  }
}

function frozenRuntimeCapabilities(
  environment: Readonly<Record<string, unknown>>,
): readonly TestRunRuntimeCapabilitySnapshot[] | null {
  if (
    environment.status !== "captured" ||
    !Array.isArray(environment.runtimeCapabilities)
  ) {
    return null
  }
  const capabilities: TestRunRuntimeCapabilitySnapshot[] = []
  for (const rawCapability of environment.runtimeCapabilities) {
    if (
      !rawCapability ||
      typeof rawCapability !== "object" ||
      !("capability" in rawCapability) ||
      typeof rawCapability.capability !== "string" ||
      !("commands" in rawCapability) ||
      !Array.isArray(rawCapability.commands)
    ) {
      return null
    }
    const commands: TestRunRuntimeCapabilitySnapshot["commands"][number][] = []
    for (const rawCommand of rawCapability.commands) {
      if (
        !rawCommand ||
        typeof rawCommand !== "object" ||
        !("name" in rawCommand) ||
        typeof rawCommand.name !== "string" ||
        !("available" in rawCommand) ||
        typeof rawCommand.available !== "boolean" ||
        !("version" in rawCommand) ||
        (rawCommand.version !== null &&
          typeof rawCommand.version !== "string")
      ) {
        return null
      }
      commands.push({
        name: rawCommand.name,
        available: rawCommand.available,
        version: rawCommand.version,
      })
    }
    capabilities.push({
      capability: rawCapability.capability,
      commands,
    })
  }
  return capabilities
}

export function buildTestRunSemanticConfigurationFingerprint(
  settings: Buffer,
  promptVersions: TestRunPromptVersions,
): string {
  return stableHash({
    ...parseSemanticRuntimeConfiguration(settings),
    executionLimits,
    gradingLimits,
    executionPromptVersion: promptVersions.executionPromptVersion,
    graderProtocolVersion: promptVersions.graderProtocolVersion,
    toolPermissionPolicyVersion: projectSettingsPermissionPolicyVersion,
  })
}

export function getTestRunCaseSideOrder(
  mode: TestRunMode,
  evalIndex: number,
): readonly ["TARGET" | "BASELINE", "TARGET" | "BASELINE"] {
  return mode === "version_vs_version" && evalIndex % 2 === 0
    ? ["BASELINE", "TARGET"]
    : ["TARGET", "BASELINE"]
}

function subjectFacts(
  run: Awaited<ReturnType<TestRunRepository["getRow"]>>,
  runCase: SkillTestRunCaseRow,
  selection: FrozenTestRunSelection,
) {
  if (runCase.side === "BASELINE" && run.mode === "target_vs_no_skill") {
    return {
      subjectKind: "no_skill" as const,
      versionId: null,
      versionNumber: null,
    }
  }
  return {
    subjectKind:
      runCase.side === "TARGET" && run.skillDraftRevisionId
        ? ("draft_snapshot" as const)
        : ("skill_version" as const),
    versionId:
      selection.skill.version?.id ?? null,
    versionNumber: selection.skill.version?.sequenceNumber ?? null,
  }
}

function referencedFileFacts(
  selection: FrozenTestRunSelection,
  paths: readonly string[],
) {
  const filesByPath = new Map(
    selection.files.map((file) => [file.relativePath, file]),
  )
  return paths.map((relativePath) => {
    const file = filesByPath.get(relativePath)
    if (!file) {
      throw new DomainError({
        code: "TEST_RUN_EVAL_INPUT_MISSING",
        message:
          "The selected Evals revision references an input file that is not present in its immutable file index.",
        kind: "conflict",
        details: {
          evalRevisionId: selection.revision.id,
          relativePath,
        },
      })
    }
    return {
      relativePath: file.relativePath,
      sha256: file.sha256,
      byteSize: file.byteSize,
      mediaTypeHint: file.mediaTypeHint,
      contentKind: file.contentKind,
    }
  })
}

function eventError(
  event: AgentSessionEvent,
  fallbackCode: string,
  fallbackMessage: string,
) {
  const raw =
    event.payload.error &&
    typeof event.payload.error === "object" &&
    !Array.isArray(event.payload.error)
      ? (event.payload.error as Record<string, unknown>)
      : null
  return {
    code:
      typeof raw?.code === "string" ? raw.code : fallbackCode,
    message:
      typeof raw?.message === "string" ? raw.message : fallbackMessage,
  }
}

function assistantText(event: AgentSessionEvent): string | null {
  if (
    event.type !== "assistant.message" ||
    !Array.isArray(event.payload.content)
  ) {
    return null
  }
  const parts = event.payload.content
    .filter(
      (item): item is { readonly type: "text"; readonly text: string } =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string",
    )
    .map((item) => item.text)
  return parts.length > 0 ? parts.join("\n") : null
}

function usageFromEvent(
  event: AgentSessionEvent,
): StoredTestRunUsage | null {
  if (event.type !== "usage.updated") return null
  const usage =
    event.payload.usage &&
    typeof event.payload.usage === "object" &&
    !Array.isArray(event.payload.usage)
      ? (event.payload.usage as Record<string, unknown>)
      : null
  const number = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : 0
  return {
    inputTokens: number(usage?.inputTokens),
    outputTokens: number(usage?.outputTokens),
    cacheCreationInputTokens: number(usage?.cacheCreationInputTokens),
    cacheReadInputTokens: number(usage?.cacheReadInputTokens),
    totalCostUsd: number(event.payload.totalCostUsd),
    durationMs: number(event.payload.durationMs),
    durationApiMs: number(event.payload.durationApiMs),
    numTurns: number(event.payload.numTurns),
  }
}

function toolUsesFromEvent(event: AgentSessionEvent): readonly {
  readonly toolUseId: string
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
}[] {
  if (
    event.type !== "assistant.message" ||
    !Array.isArray(event.payload.content)
  ) {
    return []
  }
  return event.payload.content.flatMap((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("type" in item) ||
      item.type !== "tool_use" ||
      !("name" in item) ||
      typeof item.name !== "string" ||
      !("toolUseId" in item) ||
      typeof item.toolUseId !== "string"
    ) {
      return []
    }
    return [
      {
        toolUseId: item.toolUseId,
        name: item.name,
        input:
          "input" in item &&
          typeof item.input === "object" &&
          item.input !== null &&
          !Array.isArray(item.input)
            ? (item.input as Readonly<Record<string, unknown>>)
            : {},
      },
    ]
  })
}

function collectStringValues(value: unknown): readonly string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(collectStringValues)
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectStringValues)
  }
  return []
}

export function extractInvokedSkillName(
  input: Readonly<Record<string, unknown>>,
): string | null {
  for (const key of ["skill", "skillName", "name", "command"]) {
    const value = input[key]
    if (typeof value !== "string") continue
    const normalized = value.trim().replace(/^\/+/, "").split(/\s+/u)[0]
    if (normalized) return normalized
  }
  return null
}

export function extractObservedBundledScriptPaths(
  input: Readonly<Record<string, unknown>>,
  skillName: string,
  declaredBundledScripts: ReadonlySet<string>,
): readonly string[] {
  const observed = new Set<string>()
  for (const value of collectStringValues(input)) {
    const installedMatches = value.matchAll(
      /\.claude[\\/]+skills[\\/]+([^\\/\s"'`]+)[\\/]+scripts[\\/]+([^\s"'`,};)]+)/giu,
    )
    for (const match of installedMatches) {
      if (match[1] !== skillName) continue
      const relativePath = `scripts/${match[2]!.replace(/[\\/]+/gu, "/")}`
      if (declaredBundledScripts.has(relativePath)) {
        observed.add(relativePath)
      }
    }

    const relativeMatches = value.matchAll(
      /(?:^|[\s"'`=:(])(?:\.[\\/]+)?scripts[\\/]+([^\s"'`,};)]+)/giu,
    )
    for (const match of relativeMatches) {
      const relativePath = `scripts/${match[1]!.replace(/[\\/]+/gu, "/")}`
      if (declaredBundledScripts.has(relativePath)) {
        observed.add(relativePath)
      }
    }
  }
  return [...observed]
}

export class TestRunService {
  private readonly eventBus = new TestRunEventBus()
  private readonly workers = new Map<string, Promise<void>>()
  private readonly activeSessions = new Map<string, string>()
  private readonly lastPublishedSequences = new Map<string, number>()
  private readonly runtimeEnvironments = new Map<
    string,
    TestRunRuntimeEnvironment
  >()
  private shuttingDown = false

  constructor(private readonly options: TestRunServiceOptions) {}

  async initialize(): Promise<void> {
    const events = await this.options.repository.reconcileInterruptedRuns()
    this.eventBus.publish(events)
  }

  async start(input: CreateTestRunInput): Promise<TestRunDetailView> {
    const requestHash = stableHash({
      workspaceId: input.workspaceId,
      evalRevisionId: input.evalRevisionId,
      mode: input.mode,
      ...(input.mode === "target_vs_no_skill"
        ? {
            draftId: input.draftId,
            draftContentRevision: input.draftContentRevision,
          }
        : {
            baselineVersionId: input.baselineVersionId,
            candidateVersionId: input.candidateVersionId,
          }),
    })
    const replay = await this.options.repository.findByIdempotencyKey(
      input.workspaceId,
      input.idempotencyKey,
    )
    if (replay) {
      if (replay.requestHash !== requestHash) {
        throw new DomainError({
          code: "TEST_RUN_IDEMPOTENCY_CONFLICT",
          message:
            "The idempotency key was already used with a different test run selection.",
          kind: "conflict",
        })
      }
      return this.options.repository.getDetail(replay.id)
    }

    let targetSelection: FrozenTestRunSelection
    let baselineSelection: FrozenTestRunSelection | null = null
    if (input.mode === "target_vs_no_skill") {
      const draftRevision = await this.options.draftRevisions.freeze(
        input.workspaceId,
        {
          draftId: input.draftId,
          contentRevision: input.draftContentRevision,
        },
        "TRIAL",
      )
      targetSelection = await this.options.repository.freezeSelection({
        workspaceId: input.workspaceId,
        skillDraftRevisionId: draftRevision.draftRevisionId,
        skillVersionId: null,
        evalRevisionId: input.evalRevisionId,
      })
    } else {
      if (input.baselineVersionId === input.candidateVersionId) {
        throw new DomainError({
          code: "TEST_RUN_VERSIONS_MUST_DIFFER",
          message: "Select two different Skill versions to compare.",
          kind: "conflict",
        })
      }
      ;[targetSelection, baselineSelection] = await Promise.all([
        this.options.repository.freezeSelection({
          workspaceId: input.workspaceId,
          skillDraftRevisionId: null,
          skillVersionId: input.candidateVersionId,
          evalRevisionId: input.evalRevisionId,
        }),
        this.options.repository.freezeSelection({
          workspaceId: input.workspaceId,
          skillDraftRevisionId: null,
          skillVersionId: input.baselineVersionId,
          evalRevisionId: input.evalRevisionId,
        }),
      ])
    }

    const settings = await readFile(this.options.claudeSettingsPath)
    const configurationFingerprint = sha256(settings)
    const [
      executionSystemPrompt,
      requiredSkillConstraint,
      noSkillConstraint,
      assertionSystemPrompt,
      scoreSystemPrompt,
    ] = await Promise.all([
      this.options.agentSessions.getSystemPrompt("test-run-execution"),
      this.options.agentSessions.getSystemPrompt(
        "test-run-execution-required-skill",
      ),
      this.options.agentSessions.getSystemPrompt(
        "test-run-execution-no-skill",
      ),
      this.options.agentSessions.getSystemPrompt("test-run-assertion"),
      this.options.agentSessions.getSystemPrompt("test-run-skill-score"),
    ])
    const executionPromptVersion = buildExecutionPromptProtocolVersion({
      systemPromptContent: executionSystemPrompt.content,
      requiredSkillConstraintTemplate: requiredSkillConstraint.content,
      noSkillConstraintTemplate: noSkillConstraint.content,
    })
    const semantic = parseSemanticRuntimeConfiguration(settings)
    const executionPolicy =
      input.mode === "version_vs_version"
        ? ("paired_serial_alternating_v1" as const)
        : ("target_then_no_skill_serial_v1" as const)
    const promptVersions = {
      executionPromptVersion,
      graderProtocolVersion: buildAgentChainProtocolVersion(
        assertionSystemPrompt.version,
        scoreSystemPrompt.version,
      ),
    }
    const semanticConfigurationFingerprint =
      buildTestRunSemanticConfigurationFingerprint(settings, promptVersions)
    const runtimeCapabilities =
      await this.options.storage.captureRuntimeCapabilities()
    const runtimeEnvironment = buildTestRunRuntimeEnvironment(settings)
    const environment = buildEnvironmentSnapshot(
      semantic,
      runtimeCapabilities,
      executionPolicy,
      promptVersions,
    )
    const environmentFingerprint = stableHash(environment)
    const comparabilityFingerprint = stableHash({
      mode: input.mode,
      executionPolicy,
      evalRevisionId: targetSelection.revision.id,
      evalManifestHash: targetSelection.revision.manifestHash,
      semanticConfigurationFingerprint,
      environmentFingerprint,
      sdkVersion: claudeAgentSdkVersion,
      protocolVersion: testRunProtocolVersion,
      executionPromptVersion,
      graderProtocolVersion: promptVersions.graderProtocolVersion,
      toolPermissionPolicyVersion: projectSettingsPermissionPolicyVersion,
    })
    const runInputFingerprint = stableHash({
      comparabilityFingerprint,
      targetSnapshotId: targetSelection.skill.snapshotId,
      targetSkillManifestHash: targetSelection.skill.manifestHash,
      baselineSnapshotId: baselineSelection?.skill.snapshotId ?? null,
      baselineSkillManifestHash:
        baselineSelection?.skill.manifestHash ?? null,
    })
    const cases = targetSelection.cases.flatMap((evalCase, index) => {
      const inputFingerprint = stableHash({
        evalRevisionId: targetSelection.revision.id,
        externalId: evalCase.externalId,
        prompt: evalCase.prompt,
        expectedOutput: evalCase.expectedOutput,
        assertions: evalCase.assertions,
        files: referencedFileFacts(targetSelection, evalCase.files),
      })
      const sideOrder = getTestRunCaseSideOrder(input.mode, index)
      return sideOrder.map((side, sideIndex) => {
        const subjectKind =
          input.mode === "target_vs_no_skill" && side === "BASELINE"
            ? "no_skill"
            : "skill_snapshot"
        const skillManifestHash =
          side === "TARGET"
            ? targetSelection.skill.manifestHash
            : baselineSelection?.skill.manifestHash ?? null
        return {
          id: randomUUID(),
          evalCase,
          side,
          executionOrder: index * 2 + sideIndex + 1,
          inputFingerprint,
          participantExecutionFingerprint: stableHash({
            comparabilityFingerprint,
            inputFingerprint,
            subjectKind,
            skillManifestHash,
            executionSkillPolicyFingerprint:
              buildExecutionSkillPolicyFingerprint(
                subjectKind === "no_skill"
                  ? noSkillConstraint.content
                  : requiredSkillConstraint.content,
              ),
          }),
          skillInvocationObserved:
            subjectKind === "no_skill"
              ? ("NOT_APPLICABLE" as const)
              : null,
        }
      })
    })
    const run = await this.options.repository.create({
      id: randomUUID(),
      mode: input.mode,
      executionPolicy,
      targetSelection,
      baselineSelection,
      environment,
      traceability: {
        protocolVersion: testRunProtocolVersion,
        sdkVersion: claudeAgentSdkVersion,
        configurationFingerprint,
        semanticConfigurationFingerprint,
        executionSettingsFingerprint: configurationFingerprint,
        gradingSettingsFingerprint: configurationFingerprint,
        environmentFingerprint,
        skillManifestHash: targetSelection.skill.manifestHash,
        baselineSkillManifestHash:
          baselineSelection?.skill.manifestHash ?? null,
        evalManifestHash: targetSelection.revision.manifestHash,
        comparabilityFingerprint,
        runInputFingerprint,
        executionPromptVersion,
        graderProtocolVersion: promptVersions.graderProtocolVersion,
        toolPermissionPolicyVersion: projectSettingsPermissionPolicyVersion,
      },
      idempotencyKey: input.idempotencyKey,
      requestHash,
      cases,
    })
    this.runtimeEnvironments.set(run.id, runtimeEnvironment)
    await this.publishNewEvents(run.id)
    this.launch(run.id)
    return run
  }

  get(runId: string): Promise<TestRunView> {
    return this.options.repository.get(runId)
  }

  getDetail(runId: string): Promise<TestRunDetailView> {
    return this.options.repository.getDetail(runId)
  }

  getSkillScoreReportHtml(reportId: string): Promise<string> {
    return this.options.repository.getSkillScoreReportHtml(reportId)
  }

  list(
    workspaceId: string,
    page: number,
    pageSize: number,
  ): Promise<TestRunPage> {
    return this.options.repository.list(workspaceId, page, pageSize)
  }

  listEvents(
    runId: string,
    afterSequence: number,
  ): Promise<readonly TestRunEvent[]> {
    return this.options.repository.listEvents(runId, afterSequence)
  }

  listLogs(
    runId: string,
    query: TestRunLogQuery,
  ): Promise<TestRunLogPage> {
    return this.options.repository.listLogs(runId, query)
  }

  subscribe(
    runId: string,
    listener: (event: TestRunEvent) => void,
  ): () => void {
    return this.eventBus.subscribe(runId, listener)
  }

  subscribeAll(
    listener: (event: TestRunEvent) => void,
  ): () => void {
    return this.eventBus.subscribeAll(listener)
  }

  async cancel(runId: string): Promise<TestRunView> {
    const run = await this.options.repository.getRow(runId)
    if (
      !["PREPARING", "RUNNING", "SCORING", "CANCELING"].includes(
        run.status,
      )
    ) {
      return this.options.repository.get(runId)
    }
    if (run.status !== "CANCELING") {
      await this.options.repository.markCanceling(runId)
      await this.publishNewEvents(runId)
    }
    const sessionId = this.activeSessions.get(runId)
    if (sessionId) {
      try {
        await this.options.agentSessions.cancel(sessionId)
      } catch (error) {
        this.options.logger.error(
          { runId, sessionId, error },
          "Active test run Agent Session could not be canceled",
        )
      }
    } else if (!this.workers.has(runId)) {
      await this.options.repository.finalizeCanceled(runId)
      await this.publishNewEvents(runId)
    }
    return this.options.repository.get(runId)
  }

  async getArtifactDownload(
    runId: string,
    artifactId: string,
  ): Promise<{
    readonly content: Buffer
    readonly fileName: string
    readonly mediaType: string
  }> {
    const record = await this.options.repository.getArtifactRecord(
      runId,
      artifactId,
    )
    const content = await readFile(
      this.options.storage.getArtifactPath(
        runId,
        record.caseId,
        record.artifact.relativePath,
      ),
    )
    if (sha256(content) !== record.artifact.sha256) {
      throw new DomainError({
        code: "TEST_RUN_ARTIFACT_CORRUPTED",
        message: "The requested Artifact failed its integrity check.",
        kind: "conflict",
        details: { runId, artifactId },
      })
    }
    if (containsPublicRuntimeLeakContent(content)) {
      throw new DomainError({
        code: "TEST_RUN_ARTIFACT_UNSAFE",
        message:
          "The requested Artifact contains protected runtime information.",
        kind: "conflict",
        details: { runId, artifactId },
      })
    }
    return {
      content,
      fileName:
        record.artifact.relativePath.split("/").at(-1) ?? "artifact",
      mediaType: record.artifact.mediaTypeHint,
    }
  }

  shutdown(): void {
    this.shuttingDown = true
    this.eventBus.clear()
  }

  private launch(runId: string): void {
    if (this.workers.has(runId) || this.shuttingDown) return
    const worker = this.executeRun(runId)
      .catch(async (error) => {
        this.options.logger.error(
          { runId, error },
          "Skill test run orchestration failed",
        )
        try {
          const run = await this.options.repository.getRow(runId)
          if (run.status === "CANCELING") {
            await this.options.repository.finalizeCanceled(runId)
          } else if (
            !["COMPLETED", "CANCELED", "INTERRUPTED", "FAILED"].includes(
              run.status,
            )
          ) {
            await this.options.repository.failRun(
              runId,
              error instanceof DomainError
                ? error.code
                : "TEST_RUN_ORCHESTRATION_FAILED",
              error instanceof DomainError
                ? error.message
                : "The Skill test run could not continue.",
            )
          }
          await this.publishNewEvents(runId)
        } catch (finalizeError) {
          this.options.logger.error(
            { runId, error: finalizeError },
            "Skill test run failure could not be persisted",
          )
        }
      })
      .finally(() => {
        this.workers.delete(runId)
        this.activeSessions.delete(runId)
        this.runtimeEnvironments.delete(runId)
      })
    this.workers.set(runId, worker)
  }

  private async executeRun(runId: string): Promise<void> {
    let run = await this.options.repository.getRow(runId)
    if (
      ["COMPLETED", "FAILED", "CANCELED", "INTERRUPTED"].includes(
        run.status,
      )
    ) {
      return
    }
    await this.options.repository.appendOrchestrationEvent(
      runId,
      null,
      "run.preflight.started",
      { mode: run.mode },
    )
    await this.publishNewEvents(runId)
    let targetSelection!: FrozenTestRunSelection
    let baselineSelection: FrozenTestRunSelection | null = null
    try {
      targetSelection = await this.options.repository.freezeSelection({
        workspaceId: run.workspaceId,
        skillDraftRevisionId: run.skillDraftRevisionId,
        skillVersionId: run.skillVersionId,
        evalRevisionId: run.evalRevisionId,
      })
      baselineSelection = run.baselineSkillVersionId
        ? await this.options.repository.freezeSelection({
            workspaceId: run.workspaceId,
            skillDraftRevisionId: null,
            skillVersionId: run.baselineSkillVersionId,
            evalRevisionId: run.evalRevisionId,
          })
        : null
      if (
        targetSelection.skill.manifestHash !== run.skillManifestHash ||
        targetSelection.revision.manifestHash !== run.evalManifestHash ||
        (baselineSelection?.skill.manifestHash ?? null) !==
          run.baselineSkillManifestHash
      ) {
        throw new DomainError({
          code: "TEST_RUN_FROZEN_INPUT_MISMATCH",
          message: "The frozen test run input facts no longer match.",
          kind: "conflict",
        })
      }
      const runtimeCapabilities = frozenRuntimeCapabilities(
        run.environmentSnapshot,
      )
      if (!runtimeCapabilities) {
        throw new DomainError({
          code: "TEST_RUN_ENVIRONMENT_UNAVAILABLE",
          message: "The frozen test run environment is unavailable.",
          kind: "precondition_failed",
        })
      }
      const preflights = await Promise.all([
        this.options.storage.preflightSelection(
          targetSelection,
          runtimeCapabilities,
        ),
        ...(baselineSelection
          ? [
              this.options.storage.preflightSelection(
                baselineSelection,
                runtimeCapabilities,
              ),
            ]
          : []),
      ])
      const missing = preflights.flatMap((result) => result.missing)
      if (missing.length > 0) {
        throw new DomainError({
          code: "TEST_RUN_RUNTIME_CAPABILITY_MISSING",
          message: `The test run environment is missing required capability: ${missing
            .map(
              (item) =>
                `${item.capability} (${item.commands.join(" or ")})`,
            )
            .join(", ")}.`,
          kind: "precondition_failed",
          details: { missing },
        })
      }
      await this.options.repository.appendOrchestrationEvent(
        runId,
        null,
        "run.preflight.completed",
        {
          mode: run.mode,
          runtimeCapabilities,
          environmentFingerprint: run.environmentFingerprint,
        },
      )
    } catch (error) {
      const current = await this.options.repository.getRow(runId)
      if (current.status === "CANCELING") {
        await this.options.repository.finalizeCanceled(runId)
        await this.publishNewEvents(runId)
        return
      }
      if (
        ["COMPLETED", "FAILED", "CANCELED", "INTERRUPTED"].includes(
          current.status,
        )
      ) {
        return
      }
      const code =
        error instanceof DomainError
          ? error.code
          : "TEST_RUN_PREFLIGHT_FAILED"
      const message =
        error instanceof DomainError
          ? error.message
          : "The test run preflight failed."
      if (!(error instanceof DomainError)) {
        this.options.logger.error(
          { runId, error },
          "Skill test run preflight failed",
        )
      }
      await this.options.repository.appendOrchestrationEvent(
        runId,
        null,
        "run.preflight.failed",
        { mode: run.mode, error: { code, message } },
      )
      throw error
    }
    const startedEvent = await this.options.repository.markRunRunning(runId)
    if (!startedEvent) {
      const current = await this.options.repository.getRow(runId)
      if (current.status === "CANCELING") {
        await this.options.repository.finalizeCanceled(runId)
      }
      await this.publishNewEvents(runId)
      return
    }
    await this.publishNewEvents(runId)
    run = await this.options.repository.getRow(runId)
    const cases = await this.options.repository.listCaseRows(runId)
    let activePair: number | null = null
    for (const runCase of cases) {
      const current = await this.options.repository.getRow(runId)
      if (current.status === "CANCELING") {
        await this.options.repository.finalizeCanceled(runId)
        await this.publishNewEvents(runId)
        return
      }
      if (run.mode === "version_vs_version") {
        if (activePair !== runCase.externalId) {
          activePair = runCase.externalId
          await this.options.repository.appendOrchestrationEvent(
            runId,
            null,
            "pair.started",
            {
              mode: run.mode,
              evalRevisionCaseId: runCase.evalRevisionCaseId,
              externalId: activePair,
            },
          )
          await this.publishNewEvents(runId)
        }
      }
      const selection =
        runCase.side === "BASELINE" && baselineSelection
          ? baselineSelection
          : targetSelection
      await this.executeCase(runId, run, runCase, selection)
      if (
        run.mode === "version_vs_version" &&
        [...cases]
          .reverse()
          .find((item) => item.externalId === runCase.externalId)?.id ===
          runCase.id
      ) {
        await this.options.repository.appendOrchestrationEvent(
          runId,
          null,
          "pair.completed",
          {
            mode: run.mode,
            evalRevisionCaseId: runCase.evalRevisionCaseId,
            externalId: runCase.externalId,
          },
        )
        await this.publishNewEvents(runId)
      }
    }
    const current = await this.options.repository.getRow(runId)
    if (current.status === "CANCELING") {
      await this.options.repository.finalizeCanceled(runId)
      await this.publishNewEvents(runId)
      return
    }
    await this.scoreRun(runId, run)
    await this.publishNewEvents(runId)
    await this.options.repository.completeRun({ runId })
    await this.publishNewEvents(runId)
  }

  private async executeCase(
    runId: string,
    run: Awaited<ReturnType<TestRunRepository["getRow"]>>,
    runCase: SkillTestRunCaseRow,
    selection: FrozenTestRunSelection,
  ): Promise<void> {
    const workspaceLocator = this.options.storage.getWorkspaceLocator(
      runId,
      runCase.id,
    )
    const runtimeEnvironment = this.runtimeEnvironments.get(runId)
    if (!runtimeEnvironment) {
      throw new DomainError({
        code: "TEST_RUN_RUNTIME_ENVIRONMENT_UNAVAILABLE",
        message: "The frozen test run runtime environment is unavailable.",
        kind: "precondition_failed",
      })
    }
    const installSkill = !(
      run.mode === "target_vs_no_skill" &&
      runCase.side === "BASELINE"
    )
    await this.options.repository.markCasePreparing(
      runCase.id,
      workspaceLocator,
    )
    await this.publishNewEvents(runId)

    let executionSessionId: string | null = null
    let completedExecutionResult: MonitoredSessionResult | null = null
    try {
      const workspace = await this.options.storage.prepareCase(
        runId,
        runCase.id,
        installSkill,
        selection,
        runCase.files,
        {
          userTask: runCase.prompt,
          side: runCase.side,
          skillName: installSkill ? selection.revision.skillName : null,
        },
      )
      const caseRuntimeEnvironment = forTestRunWorkspace(
        runtimeEnvironment,
        workspace.absolutePath,
      )
      const [
        executionSystemPrompt,
        requiredSkillConstraint,
        noSkillConstraint,
      ] = await Promise.all([
        this.options.agentSessions.getSystemPrompt("test-run-execution"),
        this.options.agentSessions.getSystemPrompt(
          "test-run-execution-required-skill",
        ),
        this.options.agentSessions.getSystemPrompt(
          "test-run-execution-no-skill",
        ),
      ])
      const executionPromptVersion = buildExecutionPromptProtocolVersion({
        systemPromptContent: executionSystemPrompt.content,
        requiredSkillConstraintTemplate: requiredSkillConstraint.content,
        noSkillConstraintTemplate: noSkillConstraint.content,
      })
      if (executionPromptVersion !== run.executionPromptVersion) {
        throw new DomainError({
          code: "TEST_RUN_EXECUTION_PROMPT_CHANGED",
          message:
            "The test execution System Prompt changed after the run was frozen.",
          kind: "conflict",
        })
      }
      const session = await this.options.agentSessions.createInWorkspace({
        origin: {
          type: "test_run_execution",
          runId,
          caseId: runCase.id,
          externalId: runCase.externalId,
          side: runCase.side,
          phase: "execution",
        },
        prompt: buildExecutionPrompt({
          taskPath: workspace.taskPath,
          skillPolicy: executionSkillPolicy(
            installSkill,
            selection.revision.skillName,
          ),
          skillConstraintTemplate: installSkill
            ? requiredSkillConstraint.content
            : noSkillConstraint.content,
        }),
        workspaceLocator: workspace.locator,
        expectedConfigurationFingerprint: run.configurationFingerprint,
        systemPromptRole: "test-run-execution",
        expectedSystemPromptFingerprint: executionSystemPrompt.sha256,
        environment: caseRuntimeEnvironment.values,
        protectedEnvironmentNames:
          caseRuntimeEnvironment.protectedNames,
        ...(installSkill
          ? {
              runtimeSkillNames: [selection.revision.skillName],
              requiredSkills: [selection.revision.skillName],
            }
          : {}),
        additionalRedactedValues: [
          workspace.absolutePath,
          workspace.taskPath,
          ...caseRuntimeEnvironment.sensitiveValues,
        ],
      })
      executionSessionId = session.id
      this.activeSessions.set(runId, session.id)
      const sessionRun = await this.options.repository.getRow(runId)
      if (["CANCELING", "CANCELED"].includes(sessionRun.status)) {
        try {
          await this.options.agentSessions.cancel(session.id)
        } catch (error) {
          this.options.logger.error(
            { runId, sessionId: session.id, error },
            "New test run Agent Session could not be canceled",
          )
        }
        return
      }
      await this.options.repository.bindExecutionSession(
        runCase.id,
        session.id,
      )
      await this.publishNewEvents(runId)
      const result = await this.monitorSession({
        runId,
        caseId: runCase.id,
        sessionId: session.id,
        phase: "execution",
        run,
        runCase,
        selection,
        timeoutMs: executionLimits.timeoutMs,
      })
      completedExecutionResult = result
      await this.options.agentSessions.annotateFinalOutputProtocol(
        session.id,
        "NOT_APPLICABLE",
      )
      this.options.agentSessions.release(session.id)
      executionSessionId = null
      this.activeSessions.delete(runId)
      if (result.status !== "COMPLETED" || !result.usage) {
        await this.options.repository.failExecution({
          caseId: runCase.id,
          status:
            result.status === "COMPLETED" ? "FAILED" : result.status,
          code:
            result.error?.code ??
            "TEST_RUN_EXECUTION_RESULT_INCOMPLETE",
          message:
            result.error?.message ??
            "The Agent execution did not provide complete usage facts.",
          usage: result.usage,
          observations: result.observations,
        })
        this.options.logger.warn?.(
          {
            runId,
            caseId: runCase.id,
            phase: "execution",
            errorCode:
              result.error?.code ??
              "TEST_RUN_EXECUTION_RESULT_INCOMPLETE",
            usage: result.usage,
          },
          "Skill test Case execution stopped before completion",
        )
        await this.publishNewEvents(runId)
        return
      }
      await this.options.agentSessions.assertWorkspaceConfigurationFingerprint(
        workspace.locator,
        run.configurationFingerprint,
      )
      await this.options.storage.verifyImmutableInputs(
        runId,
        runCase.id,
        installSkill,
        selection,
        runCase.files,
        {
          userTask: runCase.prompt,
          side: runCase.side,
          skillName: installSkill ? selection.revision.skillName : null,
        },
      )
      const artifacts = await this.options.storage.collectArtifacts(
        runId,
        runCase.id,
      )
      await this.options.storage.assertArtifactsSafe(
        runId,
        runCase.id,
        artifacts,
        [
          workspace.absolutePath,
          ...caseRuntimeEnvironment.sensitiveValues,
        ],
      )
      await this.options.repository.completeExecution({
        caseId: runCase.id,
        finalOutput: result.finalOutput,
        usage: result.usage,
        skillInvocationObserved:
          result.observations.skillInvocationObserved,
        skillToolCallCount: result.observations.skillToolCallCount,
        bundledScriptUses: result.observations.bundledScriptUses,
        artifacts: artifacts.map((artifact) => ({
          id: randomUUID(),
          relativePath: artifact.relativePath,
          storageLocator: this.options.storage.getArtifactLocator(
            runId,
            runCase.id,
            artifact.relativePath,
          ),
          sha256: artifact.sha256,
          byteSize: artifact.byteSize,
          mediaTypeHint: artifact.mediaTypeHint,
          contentKind: artifact.contentKind,
        })),
      })
      await this.publishNewEvents(runId)
      if (
        (await this.options.repository.getRow(runId)).status ===
        "CANCELING"
      ) {
        return
      }
      await this.assessCase(
        runId,
        run,
        runCase,
        workspace.assertionLocator,
        result.finalOutput,
        selection,
      )
    } catch (error) {
      const [current, runState] = await Promise.all([
        this.options.repository.getCaseRow(runCase.id),
        this.options.repository.getRow(runId),
      ])
      if (
        !["COMPLETED", "FAILED", "CANCELED", "INTERRUPTED"].includes(
          current.executionStatus,
        )
      ) {
        const setupFailure =
          error instanceof DomainError
            ? { code: error.code, message: error.message }
            : {
                code: "TEST_RUN_CASE_SETUP_FAILED",
                message:
                  "The test Case workspace or Agent Session could not be prepared.",
              }
        await this.options.repository.failExecution({
          caseId: runCase.id,
          status:
            runState.status === "CANCELING" ? "CANCELED" : "FAILED",
          code:
            runState.status === "CANCELING"
              ? "TEST_RUN_CANCELED"
              : setupFailure.code,
          message:
            runState.status === "CANCELING"
              ? "The test run was canceled."
              : setupFailure.message,
          ...(completedExecutionResult
            ? {
                usage: completedExecutionResult.usage,
                observations: completedExecutionResult.observations,
              }
            : {}),
        })
        this.options.logger.warn?.(
          {
            runId,
            caseId: runCase.id,
            phase: "execution",
            errorCode:
              runState.status === "CANCELING"
                ? "TEST_RUN_CANCELED"
                : setupFailure.code,
          },
          "Skill test Case execution failed",
        )
        await this.publishNewEvents(runId)
      } else if (
        current.assessmentStatus === "RUNNING" &&
        runState.status !== "CANCELING"
      ) {
        await this.options.repository.failAssertion({
          caseId: runCase.id,
          code: "TEST_RUN_ASSERTION_FAILED",
          message: "The assertion Agent could not complete.",
        })
        await this.publishNewEvents(runId)
      }
      this.options.logger.error(
        { runId, caseId: runCase.id, error },
        "Skill test Case failed",
      )
    } finally {
      if (executionSessionId) {
        this.options.agentSessions.release(executionSessionId)
      }
      this.activeSessions.delete(runId)
      await this.options.storage.scrubSettings(runId, runCase.id)
    }
  }

  private async assessCase(
    runId: string,
    run: Awaited<ReturnType<TestRunRepository["getRow"]>>,
    runCase: SkillTestRunCaseRow,
    assertionLocator: string,
    finalOutput: string,
    selection: FrozenTestRunSelection,
  ): Promise<void> {
    const runtimeEnvironment = this.runtimeEnvironments.get(runId)
    if (!runtimeEnvironment) {
      throw new DomainError({
        code: "TEST_RUN_RUNTIME_ENVIRONMENT_UNAVAILABLE",
        message: "The frozen test run runtime environment is unavailable.",
        kind: "precondition_failed",
      })
    }
    const assertionRuntimeEnvironment = forTestRunWorkspace(
      runtimeEnvironment,
      this.options.storage.getAssertionPath(runId, runCase.id),
    )
    await this.options.repository.beginAssertion(runCase.id)
    await this.publishNewEvents(runId)
    const [assertionSystemPrompt, scoreSystemPrompt] = await Promise.all([
      this.options.agentSessions.getSystemPrompt("test-run-assertion"),
      this.options.agentSessions.getSystemPrompt("test-run-skill-score"),
    ])
    if (
      buildAgentChainProtocolVersion(
        assertionSystemPrompt.version,
        scoreSystemPrompt.version,
      ) !== run.graderProtocolVersion
    ) {
      throw new DomainError({
        code: "TEST_RUN_AGENT_CHAIN_PROMPT_CHANGED",
        message:
          "The test assertion or Skill score System Prompt changed after the run was frozen.",
        kind: "conflict",
      })
    }
    const session = await this.options.agentSessions.createInWorkspace({
      origin: {
        type: "test_run_assertion",
        runId,
        caseId: runCase.id,
        externalId: runCase.externalId,
        side: runCase.side,
        phase: "assertion",
      },
      prompt: buildAssertionPrompt({
        userTask: runCase.prompt,
        assertions: runCase.assertions,
        executionFinalResponse: finalOutput,
      }),
      workspaceLocator: assertionLocator,
      expectedConfigurationFingerprint: run.configurationFingerprint,
      systemPromptRole: "test-run-assertion",
      expectedSystemPromptFingerprint: assertionSystemPrompt.sha256,
      environment: assertionRuntimeEnvironment.values,
      protectedEnvironmentNames:
        assertionRuntimeEnvironment.protectedNames,
      additionalRedactedValues: [
        ...assertionRuntimeEnvironment.sensitiveValues,
      ],
    })
    this.activeSessions.set(runId, session.id)
    try {
      const sessionRun = await this.options.repository.getRow(runId)
      if (["CANCELING", "CANCELED"].includes(sessionRun.status)) {
        try {
          await this.options.agentSessions.cancel(session.id)
        } catch (error) {
          this.options.logger.error(
            { runId, sessionId: session.id, error },
            "New assertion Agent Session could not be canceled",
          )
        }
        return
      }
      await this.options.repository.bindAssertionSession(
        runCase.id,
        session.id,
      )
      const result = await this.monitorSession({
        runId,
        caseId: runCase.id,
        sessionId: session.id,
        phase: "assertion",
        run,
        runCase,
        selection,
        timeoutMs: gradingLimits.timeoutMs,
      })
      if (result.status !== "COMPLETED") {
        await this.options.repository.failAssertion({
          caseId: runCase.id,
          code: result.error?.code ?? "TEST_RUN_ASSERTION_FAILED",
          message:
            result.error?.message ??
            "The assertion Agent did not complete.",
          usage: result.usage,
          rawResponse: result.finalOutput,
        })
      } else {
        let parsedJson: unknown | null = null
        let parseError: string | null = null
        try {
          parsedJson = JSON.parse(result.finalOutput) as unknown
        } catch (error) {
          parseError = error instanceof Error ? error.message : "Invalid JSON."
        }
        await this.options.repository.completeAssertion({
          caseId: runCase.id,
          rawResponse: result.finalOutput,
          parsedJson,
          parseError,
          usage: result.usage,
        })
      }
      await this.publishNewEvents(runId)
    } finally {
      this.options.agentSessions.release(session.id)
      this.activeSessions.delete(runId)
    }
  }

  private async scoreRun(
    runId: string,
    run: Awaited<ReturnType<TestRunRepository["getRow"]>>,
  ): Promise<void> {
    const runtimeEnvironment = this.runtimeEnvironments.get(runId)
    if (!runtimeEnvironment) {
      throw new DomainError({
        code: "TEST_RUN_RUNTIME_ENVIRONMENT_UNAVAILABLE",
        message: "The frozen test run runtime environment is unavailable.",
        kind: "precondition_failed",
      })
    }
    const report = await this.options.repository.beginSkillScoreReport(runId)
    await this.publishNewEvents(runId)
    const [assertionPrompt, scorePrompt] = await Promise.all([
      this.options.agentSessions.getSystemPrompt("test-run-assertion"),
      this.options.agentSessions.getSystemPrompt("test-run-skill-score"),
    ])
    if (
      buildAgentChainProtocolVersion(
        assertionPrompt.version,
        scorePrompt.version,
      ) !== run.graderProtocolVersion
    ) {
      await this.options.repository.failSkillScoreReport({
        reportId: report.id,
        code: "TEST_RUN_AGENT_CHAIN_PROMPT_CHANGED",
        message:
          "The test assertion or Skill score System Prompt changed after the run was frozen.",
      })
      return
    }
    const cases = await this.options.repository.listCaseRows(runId)
    const scoreCases = [...new Set(cases.map((item) => item.externalId))].map(
      (externalId) => {
        const target = cases.find(
          (item) => item.externalId === externalId && item.side === "TARGET",
        )
        const baseline = cases.find(
          (item) => item.externalId === externalId && item.side === "BASELINE",
        )
        const source = target ?? baseline
        return {
          externalId,
          name: source?.name ?? `Case ${externalId}`,
          prompt: source?.prompt ?? "",
          target: target
            ? {
                executionFinalResponse: target.finalOutput,
                assertionAgentRawResponse: target.assertionAgentRawResponse,
                assertionAgentJson: target.assertionAgentJson ?? null,
                assertionJsonParseError: target.assertionJsonParseError,
              }
            : null,
          baseline: baseline
            ? {
                executionFinalResponse: baseline.finalOutput,
                assertionAgentRawResponse: baseline.assertionAgentRawResponse,
                assertionAgentJson: baseline.assertionAgentJson ?? null,
                assertionJsonParseError: baseline.assertionJsonParseError,
              }
            : null,
        }
      },
    )
    const sessionCase = cases[0]
    if (!sessionCase) {
      await this.options.repository.failSkillScoreReport({
        reportId: report.id,
        code: "TEST_RUN_SKILL_SCORE_INPUT_UNAVAILABLE",
        message: "The test run has no Case data for the Skill score Agent.",
      })
      return
    }
    const scoreRuntimeEnvironment = forTestRunWorkspace(
      runtimeEnvironment,
      this.options.storage.getAssertionPath(runId, sessionCase.id),
    )
    const session = await this.options.agentSessions.createInWorkspace({
      origin: {
        type: "test_run_skill_score",
        runId,
        reportId: report.id,
        phase: "skill-score",
      },
      prompt: buildSkillScorePrompt({ runId, cases: scoreCases }),
      workspaceLocator: this.options.storage.getAssertionLocator(
        runId,
        sessionCase.id,
      ),
      expectedConfigurationFingerprint: run.configurationFingerprint,
      systemPromptRole: "test-run-skill-score",
      expectedSystemPromptFingerprint: scorePrompt.sha256,
      environment: scoreRuntimeEnvironment.values,
      protectedEnvironmentNames: scoreRuntimeEnvironment.protectedNames,
      additionalRedactedValues: [...scoreRuntimeEnvironment.sensitiveValues],
    })
    this.activeSessions.set(runId, session.id)
    try {
      await this.options.repository.bindSkillScoreReportSession(report.id, session.id)
      const result = await this.monitorSkillScoreSession({
        runId,
        sessionId: session.id,
        timeoutMs: gradingLimits.timeoutMs,
      })
      if (result.status === "COMPLETED" && result.finalOutput.length > 0) {
        await this.options.repository.completeSkillScoreReport(
          report.id,
          result.finalOutput,
        )
      } else {
        await this.options.repository.failSkillScoreReport({
          reportId: report.id,
          code:
            result.error?.code ??
            (result.status === "COMPLETED"
              ? "TEST_RUN_SKILL_SCORE_EMPTY"
              : "TEST_RUN_SKILL_SCORE_FAILED"),
          message:
            result.error?.message ??
            "The Skill score Agent did not return a final response.",
        })
      }
    } catch (error) {
      await this.options.repository
        .failSkillScoreReport({
          reportId: report.id,
          code:
            error instanceof DomainError
              ? error.code
              : "TEST_RUN_SKILL_SCORE_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "The Skill score Agent could not complete.",
        })
        .catch((failureError) => {
          this.options.logger.error(
            { runId, reportId: report.id, error: failureError },
            "Skill score failure could not be persisted",
          )
        })
    } finally {
      this.options.agentSessions.release(session.id)
      this.activeSessions.delete(runId)
    }
  }

  private async monitorSkillScoreSession(input: {
    readonly runId: string
    readonly sessionId: string
    readonly timeoutMs: number
  }): Promise<MonitoredScoreSessionResult> {
    let finalOutput = ""
    let usage: StoredTestRunUsage | null = null
    const seen = new Set<number>()
    let settled = false
    let resolveResult: ((value: MonitoredScoreSessionResult) => void) | null = null
    const completion = new Promise<MonitoredScoreSessionResult>((resolve) => {
      resolveResult = resolve
    })
    const complete = (result: MonitoredScoreSessionResult): void => {
      if (settled) return
      settled = true
      resolveResult?.(result)
    }
    const handle = (event: AgentSessionEvent): void => {
      if (seen.has(event.sequence)) return
      seen.add(event.sequence)
      const text = assistantText(event)
      if (text !== null) finalOutput = text
      usage = usageFromEvent(event) ?? usage
      if (event.type === "turn.completed") {
        complete({ status: "COMPLETED", finalOutput, usage, error: null })
      } else if (event.type === "turn.canceled") {
        complete({
          status: "CANCELED",
          finalOutput,
          usage,
          error: eventError(event, "TEST_RUN_CANCELED", "The Skill score Agent was canceled."),
        })
      } else if (event.type === "turn.interrupted") {
        complete({
          status: "INTERRUPTED",
          finalOutput,
          usage,
          error: eventError(event, "CLAUDE_RUNTIME_INTERRUPTED", "The Skill score Agent was interrupted."),
        })
      } else if (event.type === "turn.failed" || event.type === "session.failed") {
        complete({
          status: "FAILED",
          finalOutput,
          usage,
          error: eventError(event, "CLAUDE_EXECUTION_FAILED", "The Skill score Agent failed."),
        })
      }
    }
    const unsubscribe = this.options.agentSessions.subscribe(input.sessionId, handle)
    const timeout = setTimeout(() => {
      void this.options.agentSessions.cancel(input.sessionId).catch((error) => {
        this.options.logger.error(
          { runId: input.runId, sessionId: input.sessionId, error },
          "Skill score timeout cancellation failed",
        )
      })
      complete({
        status: "FAILED",
        finalOutput,
        usage,
        error: {
          code: "TEST_RUN_SKILL_SCORE_TIMEOUT",
          message: "The Skill score Agent session exceeded its time limit.",
        },
      })
    }, input.timeoutMs)
    try {
      for (const event of await this.options.agentSessions.listEvents(
        input.sessionId,
        0,
      )) {
        handle(event)
      }
      return await completion
    } finally {
      clearTimeout(timeout)
      unsubscribe()
    }
  }

  private async monitorSession(input: {
    readonly runId: string
    readonly caseId: string
    readonly sessionId: string
    readonly phase: "execution" | "assertion"
    readonly run: Awaited<ReturnType<TestRunRepository["getRow"]>>
    readonly runCase: SkillTestRunCaseRow
    readonly selection: FrozenTestRunSelection
    readonly timeoutMs: number
  }): Promise<MonitoredSessionResult> {
    let finalOutput = ""
    let usage: StoredTestRunUsage | null = null
    const skillToolEvidence: number[] = []
    const selectedSkillToolEvidence: number[] = []
    const skillPolicy = executionSkillPolicy(
      !(
        input.run.mode === "target_vs_no_skill" &&
        input.runCase.side === "BASELINE"
      ),
      input.selection.revision.skillName,
    )
    const bundledScripts = new Map<string, number[]>()
    const declaredBundledScripts = new Set(
      input.selection.skill.files
        .map((file) => file.relativePath.replaceAll("\\", "/"))
        .filter((relativePath) => relativePath.startsWith("scripts/")),
    )
    const observation = (): ExecutionObservations => ({
      skillInvocationObserved:
        input.phase !== "execution" || skillPolicy.kind === "forbidden"
          ? "NOT_APPLICABLE"
          : selectedSkillToolEvidence.length > 0
            ? "OBSERVED"
            : "NOT_OBSERVED",
      skillToolCallCount: skillToolEvidence.length,
      bundledScriptUses: [...bundledScripts.entries()].map(
        ([relativePath, evidenceSequences]) => ({
          relativePath,
          count: evidenceSequences.length,
          evidenceSequences,
        }),
      ),
    })
    const seen = new Set<number>()
    let resolveResult:
      | ((value: MonitoredSessionResult) => void)
      | null = null
    let rejectResult: ((reason: unknown) => void) | null = null
    const completion = new Promise<MonitoredSessionResult>(
      (resolve, reject) => {
        resolveResult = resolve
        rejectResult = reject
      },
    )
    let settled = false
    let queue = Promise.resolve()
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      this.options.logger.warn?.(
        {
          runId: input.runId,
          caseId: input.caseId,
          phase: input.phase,
          timeoutMs: input.timeoutMs,
          usage,
        },
        "Skill test Agent session exceeded its time limit",
      )
      void this.options.agentSessions.cancel(input.sessionId).catch((error) => {
        this.options.logger.error(
          { runId: input.runId, caseId: input.caseId, error },
          "Skill test Agent session timeout cancellation failed",
        )
      })
      resolveResult?.({
        status: "FAILED",
        finalOutput,
        usage,
        observations: observation(),
        error: {
          code:
            input.phase === "execution"
              ? "TEST_RUN_EXECUTION_TIMEOUT"
              : "TEST_RUN_ASSERTION_TIMEOUT",
          message: "The Skill test Agent session exceeded its time limit.",
        },
      })
    }, input.timeoutMs)

    const handle = async (event: AgentSessionEvent): Promise<void> => {
      if (seen.has(event.sequence)) return
      seen.add(event.sequence)
      const mapped = await this.options.repository.recordAgentEvent({
        runId: input.runId,
        caseId: input.caseId,
        sessionId: input.sessionId,
        sourceSequence: event.sequence,
        phase: input.phase,
        mode: input.run.mode,
        side: input.runCase.side,
        ...subjectFacts(input.run, input.runCase, input.selection),
        evalRevisionCaseId: input.runCase.evalRevisionCaseId,
        externalId: input.runCase.externalId,
        type: event.type,
        payload: event.payload,
      })
      if (mapped) this.eventBus.publish([mapped])
      if (input.phase === "execution" && mapped) {
        for (const toolUse of toolUsesFromEvent(event)) {
          if (toolUse.name === "Skill") {
            skillToolEvidence.push(mapped.sequence)
            if (
              extractInvokedSkillName(toolUse.input) ===
              input.selection.revision.skillName
            ) {
              selectedSkillToolEvidence.push(mapped.sequence)
            }
          }
          for (const relativePath of extractObservedBundledScriptPaths(
            toolUse.input,
            input.selection.revision.skillName,
            declaredBundledScripts,
          )) {
            const evidence = bundledScripts.get(relativePath) ?? []
            evidence.push(mapped.sequence)
            bundledScripts.set(relativePath, evidence)
          }
        }
      }
      const text = assistantText(event)
      if (text !== null) {
        finalOutput = text
      }
      usage = usageFromEvent(event) ?? usage
      if (settled) return

      let terminal: MonitoredSessionResult | null = null
      if (event.type === "turn.completed") {
        terminal = {
          status: "COMPLETED",
          finalOutput,
          usage,
          observations: observation(),
          error: null,
        }
      } else if (event.type === "turn.canceled") {
        terminal = {
          status: "CANCELED",
          finalOutput,
          usage,
          observations: observation(),
          error: eventError(
            event,
            "TEST_RUN_CANCELED",
            "The Agent execution was canceled.",
          ),
        }
      } else if (event.type === "turn.interrupted") {
        terminal = {
          status: "INTERRUPTED",
          finalOutput,
          usage,
          observations: observation(),
          error: eventError(
            event,
            "CLAUDE_RUNTIME_INTERRUPTED",
            "The Agent execution was interrupted.",
          ),
        }
      } else if (
        event.type === "turn.failed" ||
        event.type === "session.failed"
      ) {
        const error = eventError(
          event,
          "CLAUDE_EXECUTION_FAILED",
          "The Agent execution failed.",
        )
        terminal = {
          status: "FAILED",
          finalOutput,
          usage,
          observations: observation(),
          error:
            input.phase === "execution" &&
            error.code === "CLAUDE_REQUIRED_SKILL_UNAVAILABLE"
              ? {
                  code: "TEST_RUN_TARGET_SKILL_UNAVAILABLE",
                  message:
                    "The selected target Skill was unavailable when the test Agent initialized.",
                }
              : error,
        }
      }
      if (terminal) {
        settled = true
        resolveResult?.(terminal)
      }
    }

    const enqueue = (event: AgentSessionEvent): void => {
      queue = queue
        .then(() => handle(event))
        .catch((error) => {
          if (!settled) {
            settled = true
            rejectResult?.(error)
          }
        })
    }
    const unsubscribe = this.options.agentSessions.subscribe(
      input.sessionId,
      enqueue,
    )
    try {
      const backlog = await this.options.agentSessions.listEvents(
        input.sessionId,
        0,
      )
      for (const event of backlog) enqueue(event)
      return await completion
    } finally {
      clearTimeout(timeout)
      unsubscribe()
      await queue
    }
  }

  private async publishNewEvents(runId: string): Promise<void> {
    const events = await this.options.repository.listEvents(
      runId,
      this.lastPublishedSequences.get(runId) ?? 0,
    )
    for (const event of events) {
      this.lastPublishedSequences.set(runId, event.sequence)
      this.eventBus.publish([event])
    }
  }
}
