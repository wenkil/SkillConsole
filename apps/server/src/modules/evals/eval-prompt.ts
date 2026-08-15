export function buildEvalGenerationPrompt(input: {
  readonly skillName: string
  readonly maxEvalCount: number
  readonly generationBrief: string | null
}): string {
  return [
    "在当前工作目录内完成 inputs/task.json 中描述的 Evals 生成任务。",
    "以下是用户已经选择的生成选项；花括号内为实际值，必须作为生成时的优先参考：",
    `- 目标 Skill：{${input.skillName}}`,
    `- 目标用例数：{${input.maxEvalCount}}`,
    `- 补充要求：{${input.generationBrief ?? "无"}}`,
    "第一步使用 Read 读取 inputs/task.json；其中所有路径都是相对于当前工作目录的相对路径。",
    "只读取 task.json 指定的输入，并将生成结果写入 task.json 指定的 output/evals.json 和 output/files。",
    "不要猜测或访问 /app、/workspace、/root 等绝对路径，也不要从文件系统根目录搜索。",
    "使用 Read、Glob、Grep 理解任务与目标 Skill，并使用 Write/Edit 生成结果；不要使用 Bash、Agent、Web 或消息协作工具。",
    "除 output/evals.json 与 output/files 外，不要在工作区创建或修改文件。",
  ].join("\n")
}
