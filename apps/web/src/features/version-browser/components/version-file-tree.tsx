import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
  Search,
} from "lucide-react"
import {
  Tree,
  type NodeRendererProps,
} from "react-arborist"
import { useResizeDetector } from "react-resize-detector"

import type {
  DraftDiffStatus,
  VersionFileTreeNode,
} from "@/features/version-browser/model/version-browser"
import type { VersionBrowserCopy } from "@/features/version-browser/model/version-browser-copy"
import { Input } from "@/shared/components/ui/input"
import { cn } from "@/shared/lib/utils"

interface VersionFileTreeProps {
  tree: VersionFileTreeNode[]
  fileCount: number
  selectedPath: string | null
  searchTerm: string
  copy: VersionBrowserCopy
  actions?: React.ReactNode
  statusByPath?: Partial<Record<string, DraftDiffStatus>> | undefined
  onSearchTermChange: (value: string) => void
  onFileSelect: (relativePath: string) => void
}

function FileTypeIcon({
  node,
  isOpen,
}: {
  node: VersionFileTreeNode
  isOpen: boolean
}) {
  if (node.kind === "directory") {
    return isOpen ? (
      <FolderOpen aria-hidden="true" className="size-4 text-technical" />
    ) : (
      <Folder aria-hidden="true" className="size-4 text-technical" />
    )
  }

  switch (node.file?.previewKind) {
    case "markdown":
    case "text":
      return <FileText aria-hidden="true" className="size-4 text-technical" />
    case "json":
    case "yaml":
      return <FileJson2 aria-hidden="true" className="size-4 text-technical" />
    case "image":
      return <FileImage aria-hidden="true" className="size-4 text-technical" />
    case "binary":
      return <File aria-hidden="true" className="size-4 text-muted-foreground" />
    default:
      return <FileCode2 aria-hidden="true" className="size-4 text-technical" />
  }
}

function TreeNode({
  node,
  style,
  statusByPath,
}: NodeRendererProps<VersionFileTreeNode> & {
  statusByPath?: Partial<Record<string, DraftDiffStatus>> | undefined
}) {
  const status =
    node.data.kind === "file" ? statusByPath?.[node.data.path] : undefined
  const visibleStatus =
    status && status !== "UNCHANGED" ? status : undefined

  return (
    <div
      className={cn(
        "group flex h-full min-w-0 cursor-default items-center gap-1.5 border-l-2 border-transparent pr-2 text-xs",
        node.isSelected &&
          "border-primary bg-accent text-accent-foreground",
      )}
      onClick={() => {
        if (node.isInternal) node.toggle()
        else node.activate()
      }}
      style={style}
      title={node.data.path}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {node.isInternal ? (
          node.isOpen ? (
            <ChevronDown aria-hidden="true" className="size-3.5" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-3.5" />
          )
        ) : null}
      </span>
      <FileTypeIcon isOpen={node.isOpen} node={node.data} />
      <span className="min-w-0 truncate font-mono">{node.data.name}</span>
      {visibleStatus ? (
        <span
          className="ml-auto shrink-0 font-mono text-[11px] leading-4 font-bold text-technical-foreground"
          title={visibleStatus}
        >
          {visibleStatus.slice(0, 1)}
        </span>
      ) : null}
    </div>
  )
}

export function VersionFileTree({
  tree,
  fileCount,
  selectedPath,
  searchTerm,
  copy,
  actions,
  statusByPath,
  onSearchTermChange,
  onFileSelect,
}: VersionFileTreeProps) {
  const { width, height, ref } = useResizeDetector<HTMLDivElement>({
    refreshMode: "debounce",
    refreshRate: 60,
  })
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase()
  const hasSearchMatches =
    !normalizedSearch ||
    tree.some(function containsMatch(node): boolean {
      return (
        node.path.toLocaleLowerCase().includes(normalizedSearch) ||
        node.children?.some(containsMatch) === true
      )
    })

  return (
    <section className="flex min-h-0 flex-col border-r border-border-strong bg-paper-raised">
      <header className="border-b border-border-default px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="ui-label truncate">
            {copy.files}
          </h2>
          <span className="ui-meta">
            {String(fileCount).padStart(3, "0")}
          </span>
        </div>
        {actions ? (
          <div className="mt-2 flex items-center justify-end gap-1.5">
            {actions}
          </div>
        ) : null}
        <div className="relative mt-2">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={copy.searchFiles}
            className="h-9 rounded-xl border-border-default bg-background pl-8 font-mono text-sm shadow-none"
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder={copy.searchFiles}
            type="search"
            value={searchTerm}
          />
        </div>
      </header>

      <div
        className="relative min-h-0 flex-1 overflow-hidden px-1 py-2"
        ref={ref}
      >
        {hasSearchMatches ? (
          <Tree<VersionFileTreeNode>
            data={tree}
            disableDrag
            disableDrop
            disableEdit
            disableMultiSelection
            height={Math.max(height ?? 240, 1)}
            indent={17}
            onActivate={(node) => {
              if (node.data.kind === "file") onFileSelect(node.data.path)
            }}
            openByDefault={false}
            overscanCount={12}
            rowHeight={30}
            searchMatch={(node, term) =>
              node.data.path
                .toLocaleLowerCase()
                .includes(term.toLocaleLowerCase())
            }
            searchTerm={searchTerm}
            selection={selectedPath ? `file:${selectedPath}` : ""}
            selectionFollowsFocus
            width={Math.max(width ?? 260, 220)}
          >
            {(props) => (
              <TreeNode {...props} statusByPath={statusByPath} />
            )}
          </Tree>
        ) : (
          <div className="flex h-full min-h-60 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {copy.noSearchResults}
          </div>
        )}
      </div>

      <p className="ui-meta border-t border-border-subtle px-4 py-2.5 uppercase">
        {copy.fileTreeHelp}
      </p>
    </section>
  )
}
