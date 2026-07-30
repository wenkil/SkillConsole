import type { EvalGenerationWorkspace } from "./eval-workspace.js"

export const evalPromptContractVersion = "eval-generation-v1"

export function buildEvalGenerationPrompt(input: {
  readonly skillName: string
  readonly maxEvalCount: number
  readonly generationBrief: string | null
  readonly workspace: EvalGenerationWorkspace
}): string {
  const brief =
    input.generationBrief?.trim() ||
    "无补充要求。根据 Skill 的主要能力与关键边界设计用例。"
  return `你正在执行 SkillConsole 的 Evals 生成任务。

评估对象：
- Skill 名称：${input.skillName}
- Skill 目录：${input.workspace.targetSkillPath}

输出位置：
- Evals JSON：${input.workspace.outputEvalsPath}
- 测试文件目录：${input.workspace.outputFilesPath}

生成要求：
1. 使用工作区中已安装的 skill-creator，完整阅读目标 Skill 的 SKILL.md，以及完成分析所需的 references、scripts 和 assets。
2. 根据目标 Skill 的实际用途设计 ${input.maxEvalCount} 个测试用例。用例应来自真实用户任务，并覆盖主要能力、重要边界条件和容易失败的情况。
3. 结合以下补充要求设计用例：
   ${brief}
4. 每个用例必须包含 id、name、prompt、expected_output、files 和 assertions。
5. prompt 只表达用户要完成的任务，不写入 Skill 路径、输出目录、运行模式、provenance、评分或报告等运行器规则。
6. assertions 应描述能够从执行记录或输出文件中客观验证的结果，不得使用无法提供明确证据的主观条件。
7. 需要输入文件时，在指定测试文件目录中创建文件，并在 files 中使用相对 Evals 修订根目录的 files/... 路径。
8. 不得在 files 中写入绝对路径、父目录跳转或工作区外路径。
9. 不运行任何 Eval，不修改目标 Skill，不把测试产物写入目标 Skill 目录。
10. 只把任务产物写入指定输出位置。

evals.json 结构：
{
  "skill_name": "${input.skillName}",
  "evals": [
    {
      "id": 1,
      "name": "简短且可识别的用例名称",
      "prompt": "真实用户任务",
      "expected_output": "预期结果说明",
      "files": ["files/example.ext"],
      "assertions": ["可从结果中验证的条件"]
    }
  ]
}

完成前检查 JSON、Skill 名称、Eval ID、files 路径和 assertions。完成后仅汇报生成数量、覆盖范围、输出路径和需要人工确认的问题。`
}
