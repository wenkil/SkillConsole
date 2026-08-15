import { MergeView } from "@codemirror/merge"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowLeft,
  FileWarning,
  GitCompareArrows,
  LoaderCircle,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router-dom"

import {
  compareSkillVersions,
  listSkillVersions,
  readTargetTextFilePreview,
} from "@/features/version-browser/api/version-browser-api"
import { VersionFileTree } from "@/features/version-browser/components/version-file-tree"
import {
  buildVersionFileTree,
  getDefaultFilePath,
} from "@/features/version-browser/model/version-browser"
import { getVersionBrowserCopy } from "@/features/version-browser/model/version-browser-copy"
import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import { Button } from "@/shared/components/ui/button"

const comparisonTheme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "0",
    backgroundColor: "var(--paper-raised)",
    color: "var(--foreground)",
    fontSize: "12px",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.65",
    overflow: "auto",
  },
})

function FileMergeView({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
}: {
  leftLabel: string
  leftValue: string
  rightLabel: string
  rightValue: string
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!parentRef.current) return
    const extensions = (label: string) => [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.contentAttributes.of({ "aria-label": label }),
      EditorView.lineWrapping,
      comparisonTheme,
    ]
    const view = new MergeView({
      a: { doc: leftValue, extensions: extensions(leftLabel) },
      b: { doc: rightValue, extensions: extensions(rightLabel) },
      parent: parentRef.current,
      orientation: "a-b",
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 8 },
      diffConfig: { timeout: 1_000 },
    })
    return () => view.destroy()
  }, [leftLabel, leftValue, rightLabel, rightValue])

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-rule border-b border-border-default bg-paper-muted font-mono text-xs font-bold uppercase">
        <div className="px-3 py-2">{leftLabel}</div>
        <div className="px-3 py-2">{rightLabel}</div>
      </div>
      <div
        className="min-h-0 flex-1 [&_.cm-mergeView]:h-full [&_.cm-mergeView]:overflow-auto [&_.cm-mergeViewEditors]:min-h-full"
        ref={parentRef}
      />
    </section>
  )
}

export function VersionCompareView({
  workspace,
}: {
  workspace: SkillWorkspace
}) {
  const { t } = useTranslation("versionBrowser")
  const copy = useMemo(() => getVersionBrowserCopy(t), [t])
  const [params, setParams] = useSearchParams()
  const [searchTerm, setSearchTerm] = useState("")
  const versionsQuery = useQuery({
    queryKey: ["skill-workspaces", workspace.id, "versions"],
    queryFn: () => listSkillVersions(workspace.id),
  })
  const versions = versionsQuery.data ?? []
  const defaultLeft = versions[1]?.id ?? versions[0]?.id ?? ""
  const defaultRight = versions[0]?.id ?? ""
  const leftVersionId = params.get("left") ?? defaultLeft
  const rightVersionId = params.get("right") ?? defaultRight
  const comparisonQuery = useQuery({
    queryKey: [
      "skill-workspaces",
      workspace.id,
      "compare",
      leftVersionId,
      rightVersionId,
    ],
    queryFn: () =>
      compareSkillVersions(workspace.id, leftVersionId, rightVersionId),
    enabled:
      Boolean(leftVersionId && rightVersionId) &&
      leftVersionId !== rightVersionId,
  })
  const comparison = comparisonQuery.data
  const files = useMemo(
    () =>
      comparison?.entries.map((entry) => entry.right ?? entry.left!) ?? [],
    [comparison],
  )
  const tree = useMemo(() => buildVersionFileTree(files), [files])
  const selectedPath =
    params.get("path") ?? getDefaultFilePath(files)
  const selectedEntry =
    comparison?.entries.find(
      (entry) => entry.relativePath === selectedPath,
    ) ?? null
  const statusByPath = comparison
    ? Object.fromEntries(
        comparison.entries.map((entry) => [
          entry.relativePath,
          entry.status,
        ]),
      )
    : undefined
  const leftPreviewQuery = useQuery({
    queryKey: [
      "skill-workspaces",
      workspace.id,
      leftVersionId,
      "compare-preview",
      selectedPath,
    ],
    queryFn: () =>
      readTargetTextFilePreview(
        workspace.id,
        { kind: "version", id: leftVersionId },
        selectedPath!,
      ),
    enabled: Boolean(
      selectedEntry?.left?.contentKind === "text" &&
        selectedEntry.left.previewKind !== "image" &&
        selectedPath,
    ),
  })
  const rightPreviewQuery = useQuery({
    queryKey: [
      "skill-workspaces",
      workspace.id,
      rightVersionId,
      "compare-preview",
      selectedPath,
    ],
    queryFn: () =>
      readTargetTextFilePreview(
        workspace.id,
        { kind: "version", id: rightVersionId },
        selectedPath!,
      ),
    enabled: Boolean(
      selectedEntry?.right?.contentKind === "text" &&
        selectedEntry.right.previewKind !== "image" &&
      selectedPath,
    ),
  })
  const canCompareSelectedText = Boolean(
    selectedEntry &&
      (selectedEntry.left === null ||
        (selectedEntry.left.contentKind === "text" &&
          selectedEntry.left.previewKind !== "image")) &&
      (selectedEntry.right === null ||
        (selectedEntry.right.contentKind === "text" &&
          selectedEntry.right.previewKind !== "image")),
  )
  const updateSelection = (
    updates: Partial<{ left: string; right: string; path: string }>,
  ) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border-strong bg-background px-6 py-5">
        <Button asChild className="mb-3 h-8 rounded-none" variant="ghost">
          <Link to={`/workbenches/${workspace.id}/versions`}>
            <ArrowLeft data-icon="inline-start" />
            返回版本
          </Link>
        </Button>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="ui-label mb-1 flex items-center gap-2 text-signal-dark">
              <GitCompareArrows className="size-3.5" />
              目录与文件对比
            </div>
            <h1 className="text-[clamp(2rem,3vw,2.75rem)] leading-[1.08] font-[780] tracking-[-0.04em]">
              {workspace.name}
            </h1>
          </div>
          <div className="flex items-end gap-2">
            {(["left", "right"] as const).map((side) => (
              <label
                className="ui-label grid gap-1"
                key={side}
              >
                {side === "left" ? "左侧版本" : "右侧版本"}
                <select
                  className="h-10 min-w-44 border border-border-default bg-paper-raised px-3 font-mono text-sm outline-none focus:border-focus-ring"
                  onChange={(event) =>
                    updateSelection({
                      [side]: event.target.value,
                      path: "",
                    })
                  }
                  value={
                    side === "left" ? leftVersionId : rightVersionId
                  }
                >
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.name}
                      {version.isOnline ? " · 当前上线" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
        {comparison ? (
          <div className="mt-4 flex flex-wrap gap-2 font-mono text-xs">
            <span className="border border-border-default px-2 py-1">
              新增 {comparison.summary.added}
            </span>
            <span className="border border-border-default px-2 py-1">
              修改 {comparison.summary.modified}
            </span>
            <span className="border border-border-default px-2 py-1">
              删除 {comparison.summary.deleted}
            </span>
            <span className="border border-border-default px-2 py-1 text-muted-foreground">
              未变化 {comparison.summary.unchanged}
            </span>
          </div>
        ) : null}
      </header>

      {versionsQuery.isPending ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" />
          正在读取版本…
        </div>
      ) : versionsQuery.isError ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-destructive">
          版本列表读取失败，请稍后重试。
        </div>
      ) : versions.length < 2 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          至少保存两个版本后才能进行对比。
        </div>
      ) : leftVersionId === rightVersionId ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          请选择两个不同的版本。
        </div>
      ) : comparisonQuery.isPending ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" />
          正在生成目录差异…
        </div>
      ) : comparisonQuery.isError ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-destructive">
          版本目录差异生成失败，请确认两个版本仍然可用。
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,19rem)_minmax(0,1fr)] overflow-hidden">
          <VersionFileTree
            copy={copy}
            fileCount={files.length}
            onFileSelect={(path) => updateSelection({ path })}
            onSearchTermChange={setSearchTerm}
            searchTerm={searchTerm}
            selectedPath={selectedPath}
            statusByPath={statusByPath}
            tree={tree}
          />
          {selectedEntry && canCompareSelectedText ? (
            (selectedEntry.left?.contentKind === "text" &&
              selectedEntry.left.previewKind !== "image" &&
              leftPreviewQuery.isPending) ||
            (selectedEntry.right?.contentKind === "text" &&
              selectedEntry.right.previewKind !== "image" &&
              rightPreviewQuery.isPending) ? (
              <div className="flex items-center justify-center gap-2">
                <LoaderCircle className="size-4 animate-spin" />
                正在读取文件…
              </div>
            ) : (
              <FileMergeView
                leftLabel={comparison?.leftVersion.name ?? "左侧"}
                leftValue={leftPreviewQuery.data?.content ?? ""}
                rightLabel={comparison?.rightVersion.name ?? "右侧"}
                rightValue={rightPreviewQuery.data?.content ?? ""}
              />
            )
          ) : (
            <div className="flex items-center justify-center px-8 text-center text-sm text-muted-foreground">
              <div>
                <FileWarning className="mx-auto mb-3 size-7" />
                请选择文本文件查看内容差异；二进制和图片文件仅显示目录层面的变化。
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  )
}
