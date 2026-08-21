---
name: SkillConsole Field Laboratory
description: A clear, restrained evidence workbench for Skill versioning and testing.
colors:
  primary-cobalt: "#245fd4"
  primary-cobalt-deep: "#1e50b8"
  active-teal: "#138f96"
  active-teal-deep: "#0d7075"
  canvas-cold-white: "#fbfcfc"
  surface-white: "#ffffff"
  surface-soft: "#f5f8fa"
  ink-blue-black: "#16233a"
  text-muted: "#64738c"
  line-default: "#dee6ec"
  line-strong: "#cbd7e0"
  passed-green: "#2f8a62"
  warning-amber: "#a96f18"
  danger-red: "#be3b3b"
  draft-indigo: "#596fcb"
  trace-navy: "#142034"
typography:
  display:
    fontFamily: "Noto Serif SC, Songti SC, STSong, ui-serif, serif"
    fontSize: "clamp(1.9rem, 2.7vw, 2.75rem)"
    fontWeight: 600
    lineHeight: 1.18
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Geist Variable, Microsoft YaHei UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Variable, Microsoft YaHei UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.25
  data:
    fontFamily: "Geist Mono Variable, Cascadia Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  control: "10px"
  compact: "8px"
  surface: "18px"
  dialog: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary-cobalt}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink-blue-black}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "36px"
  input-default:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink-blue-black}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "40px"
  card-default:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink-blue-black}"
    rounded: "{rounded.surface}"
    padding: "20px"
---

# Design System: SkillConsole Field Laboratory

## Overview

**Creative North Star: "田野实验室"**

SkillConsole 是一张长期运行的实验工作台，而不是营销页或装饰性的“未来科技”界面。界面以冷白画布、可信的蓝色操作信号、青绿色运行状态和克制的测量细节建立实验室感；唯一允许作为显性装饰的测量符号是尺子品牌图形。

视觉层级优先回答“我在哪里、当前是什么状态、下一步做什么”，随后才暴露运行证据、日志、Token 和成本。数据密度可以高，但默认视图必须安静、可扫描，完整技术证据进入详情或二级视图。

**Key Characteristics:**

- 冷静、清晰、可信，像有秩序的实验记录台。
- 圆润但不软萌，以 10px 控件和 18–20px 容器形成自然边界。
- 蓝色表示操作，青绿色表示运行与技术上下文，语义色只表达真实状态。
- 不使用粒子、网络连线、装饰性扫描线或背景动效争夺主视觉。

## Colors

主色是一组低噪声钴蓝与实验青，铺在冷白和蓝黑中性色之上；红、黄只服务于错误和风险语义。

### Primary

- **可信钴蓝**：用于主按钮、选中导航、焦点和可点击链接，是全局操作信号。
- **钴蓝浅面**：由主色的浅色容器承载选中态，避免大面积高饱和填充。

### Secondary

- **实验青**：用于运行中、技术边界、本地数据边界和非错误的系统活动。
- **草稿靛蓝**：只用于草稿和候选版本语义，不与主操作色争夺层级。

### Neutral

- **冷白画布**：页面底色，降低旧版米黄色造成的陈旧和纸张感。
- **纯白表面**：卡片、弹窗、输入框和抬升容器。
- **柔灰表面**：表头、页脚、次级面板和非交互背景。
- **蓝黑墨色**：正文与标题，不使用纯黑。
- **雾灰文字**：辅助说明、时间与元数据。
- **雾蓝分隔线**：构建层次，不把每个区域框成硬矩形。

**The Semantic Color Rule.** 红色只表示失败、危险或破坏性操作；琥珀色只表示警告和待处理，不能作为品牌装饰色。

**The One Action Voice Rule.** 同一视图只让一个主要操作使用实心钴蓝，其余操作使用描边或幽灵样式。

## Typography

**Display Font:** Noto Serif SC，并回退到系统宋体。
**Body Font:** Geist Variable，并回退到 Microsoft YaHei UI 与系统无衬线。
**Label/Mono Font:** Geist Mono Variable，并回退到 Cascadia Mono。

**Character:** 展示型衬线字体只给页面级标题带来研究记录的温度；正文保持现代、紧凑和高可读。等宽字体仅用于 ID、哈希、版本号、时间与日志等真正的数据字段。

### Hierarchy

- **Display**：页面主标题，半粗字重和紧凑字距，单页只出现一次。
- **Title**：模块、面板和弹窗标题，使用正文无衬线的中高字重。
- **Body**：说明和操作文案，单行阅读宽度尽量控制在 75ch 内。
- **Label**：字段名和导航分组，默认不做全大写或宽字距的“技术感装饰”。
- **Data**：运行 ID、哈希、数值和日志，允许使用等宽字体与表格数字。

**The Honest Mono Rule.** 只有机器生成或需要逐字符比较的内容使用等宽字体；产品标题、按钮与普通标签禁止用等宽字体伪装技术感。

## Layout

应用采用桌面优先的固定工作台壳层，最小宽度为 1024px。全局顶栏高 64px；工作区左侧导航展开宽度 248px、收起宽度 56px。页面标题、状态摘要与主操作位于首屏上方，模块内容在剩余高度中独立滚动。

页面水平间距以 24–32px 为主，卡片内部以 16–24px 为主。概览使用状态条加真实模块入口；列表默认只呈现状态、对象、进度、核心结果、时间和操作，证据细节进入详情。数据集模块在功能完成前不进入导航，直接访问会回到概览。

## Elevation & Depth

系统以色调分层和细边框为主，阴影只用于真正抬升的卡片、弹窗和浮层。普通表格行与全宽工作区保持平面，不使用硬偏移阴影。

### Shadow Vocabulary

- **Surface**：低对比环境阴影，用于独立卡片和控制面板。
- **Surface Soft**：更轻的环境阴影，用于概览模块容器。
- **Dialog**：较深且扩散的阴影，只用于模态弹窗与侧滑工作面板。

**The Flat Evidence Rule.** 日志、表格和证据视图在默认状态保持平面；只有浮层和明确的容器边界获得抬升。

## Shapes

控件采用自然、克制的圆角：紧凑标签 8px，按钮与输入 10px，卡片 18px，居中弹窗 20px。连接到屏幕边缘的侧滑面板只圆露出的左侧角。状态标签可以使用胶囊形，但普通按钮不做完全胶囊化。

边框保持 1px 雾蓝灰；不使用深黑描边、不使用内嵌彩色竖条表示选中，也不使用硬矩形框包住每一段内容。

## Components

### Buttons

- **Shape:** 自然圆角控件（10px），默认高度 36px。
- **Primary:** 钴蓝底和白字，只用于当前视图的主操作。
- **Hover / Focus:** 悬停仅轻微加深；键盘焦点使用可见钴蓝焦点环，不移动组件位置。
- **Secondary / Ghost:** 白色描边或透明底，用于取消、返回、筛选和低优先级动作。
- **Destructive:** 仅确认删除或不可逆操作时使用危险红。

### Chips

- **Style:** 8px 圆角或状态胶囊，使用低饱和浅色面和同色文字。
- **State:** 绿色通过、青色运行、琥珀警告、红色失败、靛蓝草稿；不以颜色代替文字标签。

### Cards / Containers

- **Corner Style:** 18px 圆角，内容区必要时裁切。
- **Background:** 白色为主，柔灰只作为次级分区。
- **Shadow Strategy:** 默认细边框；独立抬升卡片使用低对比环境阴影。
- **Internal Padding:** 16–24px。

### Inputs / Fields

- **Style:** 白色底、雾蓝边框、10px 圆角和 40px 默认高度。
- **Focus:** 钴蓝边框加低透明焦点环。
- **Error / Disabled:** 错误使用红色边框与浅红背景；禁用态降低透明度但保留标签可读性。

### Navigation

左侧导航以图标、清晰标签和浅钴蓝选中面构成。悬停只改变表面色；选中态不使用黑框或彩色内嵌竖条。尚未实现的模块不出现，折叠后仍保留可访问名称和工具提示。

### Evidence Trace

日志和原始证据使用深蓝黑底、浅色等宽文字、柔和边界与 16–18px 圆角。该组件只用于确实需要逐行核对的技术证据，不能作为页面背景语言。

## Do's and Don'ts

### Do:

- **Do** 让页面先表达状态、核心结果与下一步操作，再提供证据深钻。
- **Do** 复用全局令牌和共享按钮、输入、弹窗、状态条组件。
- **Do** 同时使用图标、文字和颜色表达状态，保证语义不依赖颜色。
- **Do** 保留尺子作为唯一显性测量识别，并保持低干扰。

### Don't:

- **Don't** 把红色或琥珀色用于品牌按钮、普通边框或装饰背景。
- **Don't** 恢复米黄纸张底、深黑硬边框、硬偏移阴影和全直角卡片。
- **Don't** 添加粒子网络、连接点、扫描线、漂浮光斑或其他背景动效。
- **Don't** 在未实现模块上展示 TODO 卡片、虚假数据或不可用主操作。
- **Don't** 默认展开 Token、成本、哈希和完整日志；它们属于详情与证据视图。
