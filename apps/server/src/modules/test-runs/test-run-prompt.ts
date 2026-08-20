import { createHash } from "node:crypto"

export type TestRunExecutionSkillPolicy =
  | {
      readonly kind: "required"
      readonly skillName: string
    }
  | {
      readonly kind: "forbidden"
      readonly skillName: string
    }

const executionBootstrapTemplate = [
  "Read the test task manifest from this exact absolute path:",
  "{{TASK_PATH}}",
  "Use this path exactly as provided. Do not replace it, resolve it to another directory, or guess an alternative path.",
].join("\n")

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function renderTemplate(
  template: string,
  replacements: Readonly<Record<string, string>>,
): string {
  return Object.entries(replacements).reduce(
    (result, [name, value]) =>
      result.replaceAll(`{{${name}}}`, () => value),
    template,
  )
}

export function buildExecutionPrompt(input: {
  readonly taskPath: string
  readonly skillPolicy: TestRunExecutionSkillPolicy
  readonly skillConstraintTemplate: string
}): string {
  const bootstrap = renderTemplate(executionBootstrapTemplate, {
    TASK_PATH: JSON.stringify(input.taskPath),
  })
  const constraint = renderTemplate(input.skillConstraintTemplate, {
    SKILL_NAME: JSON.stringify(input.skillPolicy.skillName),
  })
  return `${bootstrap}\n\n${constraint}`
}

export function buildExecutionSkillPolicyFingerprint(
  skillConstraintTemplate: string,
): string {
  return sha256(skillConstraintTemplate)
}

export function buildExecutionPromptProtocolVersion(input: {
  readonly systemPromptContent: string
  readonly requiredSkillConstraintTemplate: string
  readonly noSkillConstraintTemplate: string
}): string {
  const fingerprint = sha256(
    JSON.stringify({
      systemPromptContent: input.systemPromptContent,
      executionBootstrapTemplate,
      requiredSkillConstraintTemplate:
        input.requiredSkillConstraintTemplate,
      noSkillConstraintTemplate: input.noSkillConstraintTemplate,
    }),
  )
  return `test-run-execution.composed@sha256:${fingerprint}`
}

export function buildAssertionPrompt(input: {
  readonly userTask: string
  readonly assertions: readonly string[]
  readonly executionFinalResponse: string
}): string {
  return `You are receiving the complete response from the execution Agent. Analyze that response against the supplied task and assertions. Return the assertion result as JSON in your final response.\n\n<user_task>\n${input.userTask}\n</user_task>\n\n<assertions>\n${JSON.stringify(input.assertions, null, 2)}\n</assertions>\n\n<execution_agent_final_response>\n${input.executionFinalResponse}\n</execution_agent_final_response>`
}

export function buildSkillScorePrompt(input: {
  readonly runId: string
  readonly subjects: readonly {
    readonly id: "first" | "second"
    readonly displayName: string
    readonly cases: readonly {
      readonly externalId: number
      readonly name: string
      readonly prompt: string
      readonly executionFinalResponse: string | null
      readonly assertionAgentRawResponse: string | null
      readonly assertionAgentJson: unknown | null
      readonly assertionJsonParseError: string | null
    }[]
  }[]
}): string {
  return `Analyze this complete Skill test Run and return one HTML document in your final response. The HTML is shown directly to the user as the Skill comparison report.\n\n<skill_test_run>\n${JSON.stringify(input, null, 2)}\n</skill_test_run>`
}
