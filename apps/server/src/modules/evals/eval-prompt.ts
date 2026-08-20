export function buildEvalGenerationPrompt(input: {
  readonly taskPath: string
  readonly skillName: string
  readonly maxEvalCount: number
  readonly generationBrief: string | null
}): string {
  return [
    "Read the task manifest at the exact absolute path below and complete the Evals generation task it describes:",
    JSON.stringify(input.taskPath),
    "Use this path exactly. Do not replace it, reinterpret it, or guess another path.",
    "The user selected the following generation options. Values inside braces are authoritative:",
    `- Target Skill: {${input.skillName}}`,
    `- Target case count: {${input.maxEvalCount}}`,
    `- Additional requirements: {${input.generationBrief ?? "None"}}`,
    "First use Read to open the task manifest above. Every path in it intended for tool access is an absolute path already resolved and validated by the server.",
    "Read only the inputs specified by task.json, and write outputs only to outputEvalsPath and outputFilesPath from task.json.",
    "Use the physical paths in task.json exactly. Do not convert them to other directories or search the filesystem root for substitutes.",
    "Use Read, Glob, and Grep to understand the task and target Skill, then Write or Edit to produce the result. Bash is allowed only inside the controlled workspace to validate output JSON. Do not use Agent, Web, or messaging/collaboration tools.",
    "Do not create or modify workspace files outside outputEvalsPath and outputFilesPath.",
  ].join("\n")
}
