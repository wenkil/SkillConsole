export function buildExecutionPrompt(input: {
  readonly taskPath: string
}): string {
  return [
    "Read the test task manifest from this exact absolute path:",
    JSON.stringify(input.taskPath),
    "Use this path exactly as provided. Do not replace it, resolve it to another directory, or guess an alternative path. Then execute the test Case described in the manifest.",
  ].join("\n")
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
