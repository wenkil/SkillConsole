# Agent System Prompts

这个目录集中保存 SkillConsole 所有 Agent Session 使用的 System Prompt。服务会在每次创建 Session 时按角色重新读取对应文件；修改文件后，不需要重新构建应用，但只会影响修改后新建的任务或 Revision。

| Session 角色 | System Prompt 文件 | 工作区任务入口 |
| --- | --- | --- |
| 通用 Agent | `generic-agent.system.md` | 用户消息 |
| 测试用例生成 | `eval-generation.system.md` | 启动 Prompt 注入的绝对 `taskPath` |
| 测试任务执行 | `test-run-execution.system.md` | 启动 Prompt 注入的绝对 `taskPath` |
| 测试结果评分 | `test-run-grader.system.md` | 启动 Prompt 注入的绝对 `taskPath` |
| 测试报告分析 | `test-report-analyzer.system.md` | 启动 Prompt 注入的绝对 `taskPath` |

任务上下文、事实报告、证据、Rubric 和输出路径均由服务写入 Session 工作区文件，不会拼接成大型启动 Prompt。服务在启动 Prompt 中注入经过解析和边界校验的绝对 `taskPath`；任务清单中供工具实际读写的物理路径同样使用后端生成的绝对路径。每个 System Prompt 应明确要求 Agent 原样使用这些路径，不得替换、重新解析或猜测其他路径。

Evals 的 `files` 和评分证据的 `reference` 等业务协议字段仍使用逻辑相对路径；它们不是直接传给文件工具的物理路径。

所有角色使用同一份项目 `settings.json` 作为 Claude Agent SDK 的项目设置和能力来源。工具、Skill、MCP 和命令权限请统一在 `settings.json` 中配置；角色行为、读取顺序和可写范围要求写在对应的 System Prompt 中。

服务会记录 Prompt 文件名与 SHA-256 版本。任务创建后，如果对应 Prompt 在执行前发生变化，该任务会失败并要求创建新任务或 Revision，避免同一任务在不同 Prompt 下继续执行。

可通过 `SKILLCONSOLE_AGENT_PROMPTS_ROOT` 修改目录位置。Docker Compose 默认将宿主机 `./agent-prompts` 只读挂载到容器 `/workspace/agent-prompts`，因此用户仍可直接在宿主机编辑，而运行中的 Agent 不能反向修改这些 System Prompt。
