import {
  Activity,
  CircleDashed,
  FileChartColumn,
  Files,
  FlaskConical,
  GitCompareArrows,
  PencilLine,
  Tags,
} from "lucide-react"
import { Link } from "react-router-dom"

import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import type { WorkbenchHomeCopy } from "@/features/workbench-home/model/workbench-home-copy"
import { Button } from "@/shared/components/ui/button"

interface WorkbenchOverviewProps {
  workspace: SkillWorkspace
  copy: WorkbenchHomeCopy
  locale: string
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string
  value: React.ReactNode
  hint?: string
}) {
  return (
    <article className="min-w-0 border-r border-rule-soft px-5 py-5 last:border-r-0">
      <span className="font-mono text-[10px] tracking-[0.05em] text-muted-foreground uppercase">
        {label}
      </span>
      <strong className="mt-2 block truncate text-lg">{value}</strong>
      {hint ? (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </article>
  )
}

function TodoPanel({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Activity
  title: string
  description: string
}) {
  return (
    <article className="border border-rule bg-paper-raised p-5">
      <div className="flex items-center justify-between gap-4">
        <Icon className="size-5 text-technical" />
        <span className="border border-rule bg-paper-muted px-2 py-1 font-mono text-[9px] text-muted-foreground uppercase">
          TODO
        </span>
      </div>
      <strong className="mt-4 block text-sm">{title}</strong>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    </article>
  )
}

export function WorkbenchOverview({
  workspace,
  locale,
}: WorkbenchOverviewProps) {
  const draft = workspace.activeDraft
  const online = workspace.onlineVersion
  const updatedAt = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(workspace.updatedAt))

  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto px-8 py-7">
      <header>
        <div className="font-mono text-[11px] font-bold tracking-[0.1em] text-signal-dark uppercase">
          Workbench overview · 工作台概览
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-[clamp(2rem,3vw,3rem)] leading-none font-[780] tracking-[-0.04em]">
            {workspace.name}
          </h1>
          {online ? (
            <span className="border border-technical/50 bg-technical/8 px-3 py-1.5 font-mono text-[10px] font-bold text-technical-foreground">
              当前上线 · {online.name}
            </span>
          ) : (
            <span className="border border-rule bg-paper-muted px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
              尚未标记上线版本
            </span>
          )}
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          管理 Skill 的工作副本、不可变版本、测试任务、版本对比与用户标签。系统提供证据，不替用户决定哪个版本验收通过。
        </p>
      </header>

      <section className="mt-7 border border-foreground bg-paper-raised">
        <h2 className="border-b border-rule px-5 py-3 font-mono text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          Workbench status · 工作台状态
        </h2>
        <div className="grid grid-cols-3">
          <Metric
            hint={online?.labels.join("、") || "由用户手动标记"}
            label="当前上线版本"
            value={online?.name ?? "未设置"}
          />
          <Metric
            hint="内容冻结，可参与目录与报告对比"
            label="已保存版本"
            value={workspace.versionCount}
          />
          <Metric
            hint={draft ? `最近更新 ${updatedAt}` : "可从上线版本创建"}
            label="工作副本"
            value={draft ? `Revision ${draft.contentRevision}` : "无"}
          />
        </div>
      </section>

      <div className="mt-4 flex flex-wrap gap-2.5">
        <Button asChild className="h-10 rounded-none">
          <Link to={`/workbenches/${workspace.id}/versions`}>
            <PencilLine data-icon="inline-start" />
            {draft ? "继续编辑工作副本" : "查看 Skill 版本"}
          </Link>
        </Button>
        {workspace.versionCount >= 2 ? (
          <Button asChild className="h-10 rounded-none" variant="outline">
            <Link to={`/workbenches/${workspace.id}/versions/compare`}>
              <GitCompareArrows data-icon="inline-start" />
              对比两个版本
            </Link>
          </Button>
        ) : null}
      </div>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="font-mono text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            Evidence workspace · 证据工作区
          </h2>
          <span className="font-mono text-[10px] text-muted-foreground">
            后续迭代逐步填充
          </span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <TodoPanel
            description="维护每个 Skill 的测试点、输入与预期评估维度。"
            icon={FlaskConical}
            title="测试用例"
          />
          <TodoPanel
            description="沉淀可复用的输入数据、附件和评估素材。"
            icon={Files}
            title="数据集"
          />
          <TodoPanel
            description="选择版本和测试集，一键发起并跟踪运行任务。"
            icon={Activity}
            title="测试任务"
          />
          <TodoPanel
            description="汇总版本差异、测试结果和用户标注，不输出强制得分。"
            icon={FileChartColumn}
            title="对比报告"
          />
        </div>
      </section>

      <section className="mt-6 border border-rule bg-paper-muted p-5">
        <div className="flex items-start gap-3">
          <Tags className="mt-0.5 size-5 text-technical" />
          <div>
            <strong className="text-sm">版本标签由用户定义</strong>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              “候选”“实验”“当前上线”等均是可追溯的用户标注；测试点和评估结果作为决策证据展示，不自动生成“验收通过”结论。
            </p>
          </div>
          <CircleDashed className="ml-auto size-5 text-muted-foreground" />
        </div>
      </section>
    </main>
  )
}
