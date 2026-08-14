export function buildExecutionPrompt(): string {
  return "Read inputs/task.json and execute the test Case described there."
}

export function buildGraderPrompt(): string {
  return "Read inputs/task.json, grade every assertion, and write the required JSON output."
}
