import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { VersionFilePreview } from "@/features/version-browser/components/version-file-preview"
import type { SnapshotFile } from "@/features/version-browser/model/version-browser"
import { getVersionBrowserCopy } from "@/features/version-browser/model/version-browser-copy"
import { i18n } from "@/shared/i18n/i18n"

const copy = getVersionBrowserCopy(
  i18n.getFixedT("zh-CN", "versionBrowser"),
)
const markdownFile: SnapshotFile = {
  relativePath: "SKILL.md",
  sha256: "a".repeat(64),
  byteSize: 64,
  mediaTypeHint: "text/markdown",
  contentKind: "text",
  previewKind: "markdown",
  previewable: true,
}

describe("VersionFilePreview", () => {
  it("renders Markdown without executing or displaying raw HTML", () => {
    render(
      <VersionFilePreview
        copy={copy}
        downloadUrl="/download"
        file={markdownFile}
        imagePreviewUrl={null}
        loading={false}
        markdownView="rendered"
        onMarkdownViewChange={vi.fn()}
        onPathSelect={vi.fn()}
        onRetry={vi.fn()}
        previewIssue={null}
        textPreview={{
          kind: "markdown",
          relativePath: "SKILL.md",
          mediaType: "text/markdown",
          encoding: "utf-8",
          content:
            "---\nname: hidden-frontmatter\n---\n\n# 发票审核 Skill\n\n<script>alert('blocked')</script>\n\n| 列 | 值 |\n| --- | --- |\n| 名称 | 发票 |\n",
        }}
      />,
    )

    expect(
      screen.getByRole("heading", { name: "发票审核 Skill" }),
    ).toBeInTheDocument()
    expect(screen.getByText("原始 HTML 已禁用")).toBeInTheDocument()
    expect(screen.queryByText(/hidden-frontmatter/)).not.toBeInTheDocument()
    expect(screen.queryByText(/alert\('blocked'\)/)).not.toBeInTheDocument()
    expect(screen.getByRole("table")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "下载原文件" })).toHaveAttribute(
      "href",
      "/download",
    )
  })

  it("keeps binary files metadata-only with a controlled download", () => {
    render(
      <VersionFilePreview
        copy={copy}
        downloadUrl="/binary-download"
        file={{
          ...markdownFile,
          relativePath: "assets/data.bin",
          mediaTypeHint: "application/octet-stream",
          contentKind: "binary",
          previewKind: "binary",
          previewable: false,
        }}
        imagePreviewUrl={null}
        loading={false}
        markdownView="rendered"
        onMarkdownViewChange={vi.fn()}
        onPathSelect={vi.fn()}
        onRetry={vi.fn()}
        previewIssue="binary"
        textPreview={null}
      />,
    )

    expect(screen.getByText("二进制文件不进行内联预览")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "下载原文件" })).toHaveAttribute(
      "href",
      "/binary-download",
    )
  })

  it.each([
    {
      kind: "json" as const,
      relativePath: "config/settings.json",
      mediaType: "application/json",
      content: '{"名称":"发票审核","启用":true}\n',
    },
    {
      kind: "yaml" as const,
      relativePath: "config/settings.yaml",
      mediaType: "application/yaml",
      content: "名称: 发票审核\n启用: true\n",
    },
  ])("renders Chinese UTF-8 $kind source in read-only CodeMirror", (sample) => {
    render(
      <VersionFilePreview
        copy={copy}
        downloadUrl="/download"
        file={{
          ...markdownFile,
          relativePath: sample.relativePath,
          mediaTypeHint: sample.mediaType,
          previewKind: sample.kind,
        }}
        imagePreviewUrl={null}
        loading={false}
        markdownView="rendered"
        onMarkdownViewChange={vi.fn()}
        onPathSelect={vi.fn()}
        onRetry={vi.fn()}
        previewIssue={null}
        textPreview={{
          kind: sample.kind,
          relativePath: sample.relativePath,
          mediaType: sample.mediaType,
          encoding: "utf-8",
          content: sample.content,
        }}
      />,
    )

    const editor = screen.getByRole("textbox")
    expect(editor).toHaveAttribute("contenteditable", "false")
    expect(editor).toHaveTextContent("发票审核")
  })

  it("renders controlled raster images and reports inline image failures explicitly", () => {
    render(
      <VersionFilePreview
        copy={copy}
        downloadUrl="/image-download"
        file={{
          ...markdownFile,
          relativePath: "assets/logo.png",
          mediaTypeHint: "image/png",
          contentKind: "binary",
          previewKind: "image",
        }}
        imagePreviewUrl="/image-preview"
        loading={false}
        markdownView="rendered"
        onMarkdownViewChange={vi.fn()}
        onPathSelect={vi.fn()}
        onRetry={vi.fn()}
        previewIssue={null}
        textPreview={null}
      />,
    )

    const image = screen.getByRole("img", { name: "assets/logo.png" })
    expect(image).toHaveAttribute("src", "/image-preview")
    fireEvent.error(image)
    expect(
      screen.getByText("图片缺失、损坏或不允许内联预览"),
    ).toBeInTheDocument()
  })

  it.each([
    ["missing", "Manifest 中不存在所选文件"],
    ["invalid_utf8", "文件不是有效的 UTF-8 文本"],
  ] as const)("shows an explicit %s state", (previewIssue, title) => {
    render(
      <VersionFilePreview
        copy={copy}
        downloadUrl="/download"
        file={previewIssue === "missing" ? null : markdownFile}
        imagePreviewUrl={null}
        loading={false}
        markdownView="rendered"
        onMarkdownViewChange={vi.fn()}
        onPathSelect={vi.fn()}
        onRetry={vi.fn()}
        previewIssue={previewIssue}
        textPreview={null}
      />,
    )

    expect(screen.getByText(title)).toBeInTheDocument()
  })
})
