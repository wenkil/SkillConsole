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

export function buildGraderPrompt(input: {
  readonly taskPath: string
}): string {
  return [
    "Read the grading task manifest from this exact absolute path:",
    JSON.stringify(input.taskPath),
    "Use this path exactly as provided. Do not replace it, resolve it to another directory, or guess an alternative path. Grade every assertion and write the required JSON output to the exact outputPath declared in the manifest.",
  ].join("\n")
}
