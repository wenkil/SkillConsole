# SkillConsole

[English](./README.md) | **简体中文**

<p align="center">
  <strong>面向 Agent Skills 的 Local First 可视化测试工作台。</strong>
</p>

<p align="center">
  Skill 版本 · 可复现测试 · Trace 与产物 · 回归对比 · 测试报告
</p>

## SkillConsole 是什么？

SkillConsole 是一个面向 **Agent Skills** 的开源 Web 可视化质量工作台。

它为 Skill 作者、测试工程师、领域审核人员、AI 平台团队和项目负责人提供统一入口，用于：

- 管理 Skill 及其版本；
- 管理测试集、测试用例、Fixtures、断言和审核标准；
- 通过真实 Agent Session 执行 Skill；
- 查看消息、工具调用、文件、费用、耗时和错误；
- 对比不同 Skill 版本、模型、API 服务和执行策略；
- 通过重复测试识别回归和不稳定问题；
- 完成人工 Review，并生成可复用、可分享的测试报告。

SkillConsole 不只是 CLI 的 Web 外壳，也不只是聊天页面、Benchmark 排行榜或日志查看器。它的目标是让 Agent Skill 的质量变得**可见、可复现、可审核、可汇报**。

## 为什么需要 SkillConsole？

团队通常使用 Git、命令行脚本、表格和分散的报告完成 Skill 测试。文件版本虽然被保存了，但测试输入、运行环境、执行过程和最终结论往往没有形成稳定关系。

这会带来几个直接问题：

- 不清楚某份测试报告对应哪个 Skill 文件版本；
- 修改目录或文件后，难以快速判断具体变化；
- 测试用例、数据集、Trace 和生成文件分散在不同位置；
- Skill 更新后，只能重新运行测试，却难以看出新增失败和已经修复的问题；
- 一个分数无法解释 Agent 为什么成功或失败；
- 非开发人员很难通过 Git 和命令行理解完整测试过程。

SkillConsole 将 Skill 视为一个持续演进、可以测试和比较的产品，而不只是一份 Markdown 文件。

## SkillConsole 如何解决这些问题？

### Skill 版本

- 上传单文件或完整文件夹；
- 从最新正式版本创建可编辑草稿；
- 在一次修改过程中反复保存，不因每次保存产生新版本；
- 完成修改后生成不可编辑的正式版本；
- 查看版本间的目录变化和文件内容 Diff；
- 第一个正式版本自动成为默认回归基线。

SkillConsole 自己管理版本，不接入 Git，也不向用户暴露 Branch、Commit 或 Tag。

### 可复现测试

每次测试任务都固定关联：

- Skill 版本或测试时冻结的草稿快照；
- 测试集和测试用例；
- 数据集版本；
- Endpoint、模型和执行环境；
- Trace、工具调用、生成文件和报告。

后续修改 Skill 或数据集不会改变已有任务的结果和证据。

### 任务结果与回归

工作台首页以任务列表为主要入口。每个任务都可以展开查看：

- 任务总结；
- 测试用例结果；
- Agent 输出和 Trace；
- 工具调用；
- 生成文件与其他产物；
- 测试报告和总结报告。

回归任务使用同一套测试输入比较候选版本和基线版本，重点展示新增失败、已经修复、持续失败、持续通过和不稳定结果。

## 如何使用？

1. **创建 Skill 测试工作台**：一个工作台对应一个需要持续测试的 Skill。
2. **上传 Skill**：选择单个文件或完整文件夹，形成第一个正式版本和默认基线。
3. **修改 Skill**：创建新草稿，在线编辑 Markdown，或继续上传文件和文件夹。
4. **确认版本**：查看文件变化，完成修改后生成新的不可编辑版本。
5. **准备测试**：使用列表维护测试用例，并从 JSON、CSV 或 Excel 导入数据。
6. **运行任务**：选择 Skill 版本、测试集、数据集和执行环境。
7. **查看结果**：检查任务总结、Trace、产物和测试报告。
8. **执行回归**：比较最新候选版本与基线版本的行为变化。

SkillConsole 使用 **Claude Agent SDK** 执行 Agent Session。推理 Endpoint、API Key 和模型由用户自行管理，Endpoint 需要满足 Claude Agent SDK 使用的 Anthropic Messages API 契约。

## 设计原则

1. **Local First。** 用户应能够在自己的机器或内部环境中保存 Skill、测试数据和运行证据，不依赖托管 SaaS。
2. **一个工作台，一个 Skill。** 版本、测试、数据集和任务始终围绕明确的测试对象组织。
3. **正式版本不可变。** 文件修改发生在草稿中，任务必须引用可以恢复的版本或冻结快照。
4. **证据优先于分数。** 结论必须能够回溯到用例、Trace、工具调用、文件产物和断言证据。
5. **对比是一等工作流。** Skill 质量的变化通常比一次孤立评分更容易理解。
6. **开放数据格式。** 测试用例、数据集、任务结果和报告应尽可能保持可导入、可导出和机器可读。
7. **安全的本地默认值。** 文件路径、Secret、网络和工具权限必须有明确边界。
8. **不替用户定义 Skill。** 平台提供测试和证据，不规定 Skill 必须包含哪些非强制文件。

## SkillConsole 不做什么？

| 不做的事情 | 原因 |
| --- | --- |
| 不接入或替代 Git | SkillConsole 的版本模型服务于草稿、测试快照和回归证据，不承担源码协作、Branch 和 Merge |
| 不建设完整 Web IDE | 产品重点是测试 Skill；在线编辑只服务于必要的 Skill 调整，不复制通用开发工具 |
| 不评判 Skill 是否“完整” | 脚本、图片、模板和引用文件不是所有 Skill 都必须具备，内容结构由用户负责 |
| 不建设通用多模型 Agent Framework | Agent 执行由 Claude Agent SDK 负责，SkillConsole 聚焦测试、版本和证据 |
| 不内置所有模型厂商接入 | Endpoint 和协议转换由用户管理，避免维护不稳定的厂商适配层 |
| 不建设账号、团队权限和多租户 SaaS | 产品坚持 Local First，也可以被部署在内部网络中直接使用 |
| 不做 Skill 下载市场 | 测试用户主动提供的 Skill，避免把不可信内容分发和执行引入核心范围 |
| 不用单一、不透明的 LLM 分数定义质量 | 分数必须与可查看的测试结果和运行证据一起解释 |

## 快速启动

需要 Docker Desktop，或 Docker Engine 与 Docker Compose。

在仓库根目录执行：

```powershell
docker compose -f compose.yaml -f compose.development.yaml --profile development up --build
```

容器健康后打开：

```text
http://localhost:5173
```

数据库、生产部署、镜像仓库和常用运维命令见[部署与本地开发](./docs/deployment.md)。

## 文档

- [Skill 测试工作台产品定义](./docs/skill-workspace-product-definition.md)
- [部署与本地开发](./docs/deployment.md)
- [系统架构设计](./docs/system-architecture-design.md)
- [项目结构设计](./docs/project-structure.md)

## 参与贡献

欢迎提交真实 Skill 测试流程、失败案例、版本管理建议、Evals Schema 研究、文件 Diff 方案、可复现数据集和交互体验反馈。

在提交会改变公开数据模型或运行协议的大型实现前，建议先创建 Issue 或 Design Proposal。

## 许可证与声明

SkillConsole 自身的原创源代码与文档采用 [MIT License](./LICENSE)。第三方 SDK、依赖、API、服务、模型、文档和商标仍分别受其自身许可证和条款约束。

SkillConsole 使用 [`@anthropic-ai/claude-agent-sdk`](https://github.com/anthropics/claude-agent-sdk-typescript)，但它是独立开源项目，不是 Anthropic 官方产品。使用和分发前请核对 Claude Agent SDK 的当前许可证与服务条款。

---

<p align="center">
  <strong>管理 Skill 版本，测试真实行为，解释每一个结果。</strong>
</p>
