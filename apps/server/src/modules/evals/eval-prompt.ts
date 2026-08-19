export function buildEvalGenerationPrompt(input: {
  readonly taskPath: string
  readonly skillName: string
  readonly maxEvalCount: number
  readonly generationBrief: string | null
}): string {
  return [
    "读取下面精确绝对路径中的任务清单，并完成其中描述的 Evals 生成任务：",
    JSON.stringify(input.taskPath),
    "必须原样使用该路径，不得替换、重新解析或猜测其他路径。",
    "以下是用户已经选择的生成选项；花括号内为实际值，必须作为生成时的优先参考：",
    `- 目标 Skill：{${input.skillName}}`,
    `- 目标用例数：{${input.maxEvalCount}}`,
    `- 补充要求：{${input.generationBrief ?? "无"}}`,
    "第一步使用 Read 读取上面提供的任务清单；其中供工具实际读写的路径都是后端解析和校验后的绝对路径。",
    "只读取 task.json 指定的输入，并将生成结果写入 task.json 指定的 outputEvalsPath 和 outputFilesPath。",
    "必须原样使用 task.json 中的物理路径，不要转换到其他目录，也不要从文件系统根目录搜索替代路径。",
    "使用 Read、Glob、Grep 理解任务与目标 Skill，并使用 Write/Edit 生成结果；不要使用 Bash、Agent、Web 或消息协作工具。",
    "除 outputEvalsPath 与 outputFilesPath 外，不要在工作区创建或修改文件。",
  ].join("\n")
}
