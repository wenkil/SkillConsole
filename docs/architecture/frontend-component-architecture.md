# SkillConsole 前端组件架构

> 文档状态：v0.1 首页实现基线
>
> 适用目录：`apps/web`
>
> 更新日期：2026-07-23

## 1. 目标

SkillConsole 的前端需要同时满足两类扩展需求：

1. 项目维护者可以继续实现测试、Run、Trace 和 Environment 等产品能力；
2. 开源使用者可以替换视觉样式、布局或组件库组合，而不需要修改业务状态、校验和 API 调用逻辑。

因此，前端不采用“页面组件同时管理请求、状态和 JSX”的实现方式。当前基线使用：

```text
shadcn/ui 可编辑原语
        ↓
共享布局组件
        ↓
Feature 受控展示组件
        ↑
Headless Controller / Use Case
        ↑
Route 页面组合与 UI 副作用
```

## 2. 方案比较

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 页面内直接管理状态和 JSX | 文件少，上手快 | UI 与逻辑耦合，换布局时容易改坏行为 | 不采用 |
| Headless Controller + 受控组件 | UI 可整体替换，逻辑可独立测试，适合开源二次开发 | 文件数量略多，需要明确 Props 契约 | 当前采用 |
| 独立发布 Design System Package | 多应用复用能力最强 | v0.1 只有一个 Web 应用，过早增加发布与版本成本 | 暂不采用 |

当前方案不是为了抽象而抽象。只有以下内容进入独立层：

- 会影响业务行为的状态和校验；
- 会被多个视觉实现消费的 View Model；
- shadcn/ui 原语；
- 跨 Feature 的应用壳和布局；
- 路由级组合和 UI 副作用。

## 3. 依赖方向

```text
app
  ↓
routes
  ↓
features/<feature>/components
  ↑
features/<feature>/hooks
  ↑
features/<feature>/model
  ↓
shared
```

必须遵守：

- `routes` 可以组合 Feature、Layout 和 Provider；
- `components` 只通过 Props 接收数据和事件；
- `hooks` 不导入具体页面组件；
- `model` 不依赖 React、浏览器 API、shadcn/ui 或 Toast；
- `shared/components/ui` 保持接近 shadcn/ui 上游 API；
- `shared/components/layout` 不包含某个业务模块的状态；
- Feature 不允许导入 `app` 或 `routes`。

## 4. 当前目录

```text
apps/web/src/
├── app/
│   ├── App.tsx
│   └── providers/
│       ├── AppProviders.tsx
│       └── I18nSynchronizer.tsx
├── locales/
│   ├── en/
│   │   ├── common.json
│   │   └── workbench-home.json
│   └── zh-CN/
│       ├── common.json
│       └── workbench-home.json
├── routes/
│   └── workbench-home-route.tsx
├── features/
│   └── workbench-home/
│       ├── components/
│       │   ├── create-workbench-dialog.tsx
│       │   ├── project-sidebar.tsx
│       │   ├── runtime-settings-dialog.tsx
│       │   ├── workbench-detail-placeholder.tsx
│       │   ├── workbench-home-view.tsx
│       │   └── workbench-setup-guide.tsx
│       ├── hooks/
│       │   └── use-workbench-home-controller.ts
│       ├── model/
│       │   ├── workbench-home-copy.ts
│       │   └── workbench.ts
├── shared/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── app-header.tsx
│   │   │   ├── application-frame.tsx
│   │   │   ├── brand-lockup.tsx
│   │   │   └── technical-ruler.tsx
│   │   └── ui/
│   │       ├── button.tsx
│   │       ├── dialog.tsx
│   │       ├── input.tsx
│   │       ├── label.tsx
│   │       ├── sonner.tsx
│   │       ├── toggle-group.tsx
│   │       └── toggle.tsx
│   ├── i18n/
│   │   ├── i18n.ts
│   │   ├── i18next.d.ts
│   │   ├── locale.ts
│   │   └── resources.ts
│   ├── stores/
│   │   └── preferences/
│   │       ├── preferences-schema.ts
│   │       └── preferences-store.ts
│   └── types/
│       └── locale.ts
└── styles/
    └── globals.css
```

## 5. 组件层级

### 5.1 shadcn/ui 原语

位置：`src/shared/components/ui`

这些文件由官方 shadcn CLI 生成，并直接进入项目源码。它们不是黑盒 npm 组件，因此开源使用者可以检查和修改。

当前首页使用：

| 原语 | 用途 |
| --- | --- |
| `Button` | 创建、设置、保存和返回操作 |
| `Dialog` | 创建工作台和默认运行环境 |
| `Input` | 名称、Endpoint URL、API Key 和 Model ID |
| `Label` | 表单可访问性标签 |
| `ToggleGroup` | 语言和 Skill 来源类型 |
| `Sonner` | 路由组合层的成功反馈 |

官方参考：

- [shadcn/ui Components](https://ui.shadcn.com/docs/components)
- [Button](https://ui.shadcn.com/docs/components/button)
- [Dialog](https://ui.shadcn.com/docs/components/dialog)

修改原则：

- 不在原语内加入 SkillConsole 业务判断；
- 产品视觉优先通过语义 Token 和组合组件实现；
- 确实需要全局交互修正时才修改原语；
- 更新官方组件时先比较本地差异，不能直接覆盖产品定制。

### 5.2 共享布局组件

位置：`src/shared/components/layout`

布局组件只定义应用结构：

- `AppHeader`：Logo、语言和设置入口；
- `ApplicationFrame`：左侧项目区与主内容区；
- `BrandLockup`：品牌标识；
- `TechnicalRuler`：工程档案风格的横向和纵向刻度。

布局组件不读取项目列表、不创建工作台，也不访问 API。

### 5.3 Feature 展示组件

位置：`src/features/<feature>/components`

展示组件必须是受控组件：

```tsx
<CreateWorkbenchDialog
  draft={controller.createDialog.draft}
  errors={controller.createDialog.errors}
  onNameChange={controller.actions.updateWorkbenchName}
  onSourceSelect={controller.actions.selectSource}
  onSubmit={handleCreateProject}
/>
```

展示组件可以处理浏览器事件到 Props 事件的适配，例如从 `FileList` 提取文件夹名，但不能决定：

- 是否允许创建；
- 项目如何生成 ID；
- 创建后写入哪个 Repository；
- 请求哪个 API；
- 成功后导航到哪里。

### 5.4 Headless Controller

位置：`src/features/<feature>/hooks`

Controller 负责：

- 交互状态；
- 调用纯校验和 Use Case；
- 输出页面需要的 View Model；
- 暴露语义化 Actions。

Controller 不返回 JSX，也不导入 shadcn/ui。

当 Fastify API 可用后，项目列表应由 TanStack Query 提供。Controller 的公开形状保持稳定，展示组件不需要知道数据来自内存还是 HTTP。

### 5.5 Model 与纯逻辑

位置：`src/features/<feature>/model`

Model 保存：

- 类型；
- 纯校验；
- 纯转换；
- 国际化 View Model 结构。

这里禁止读取 `window`、渲染 Toast 或导入 React 组件。

### 5.6 Route 组合层

位置：`src/routes`

Route 负责：

- 连接 Controller 与展示组件；
- 组合全局 Header、Sidebar 和页面内容；
- 处理 Toast、页面导航等 UI 副作用；
- 后续连接 Router 参数。

Route 不实现业务校验，也不直接解析文件。

### 5.7 国际化与客户端 Store

国际化使用 `i18next` 和 `react-i18next`，客户端全局偏好使用 Zustand。两者职责固定为：

```text
Zustand Preferences Store
        ↓ locale
I18nSynchronizer
        ↓
i18next Runtime
        ↓
Feature Controller 生成翻译后的 View Model
        ↓
受控展示组件
```

约束：

- Zustand 是用户语言偏好的唯一持久化来源；
- `skillconsole:preferences` 只保存通过 Zod 校验的非敏感字段；
- i18next Resource 使用 `locales/<locale>/<namespace>.json`；
- 展示组件继续消费翻译后的 Props，不直接读写 localStorage；
- TanStack Query 管理服务端状态，React Hook Form 管理表单状态；
- API Key、Secret、Skill 内容、Trace 和 Artifact 禁止进入 localStorage；
- 持久化结构必须带版本号，并在结构变化时增加迁移逻辑。

## 6. 如何替换 UI 而不修改逻辑

假设维护者需要把创建弹窗改成右侧 Sheet：

1. 保留 `useWorkbenchHomeController`；
2. 新建 `CreateWorkbenchSheet`；
3. 继续消费相同的 `draft`、`errors` 和 Actions；
4. 在 `workbench-home-route.tsx` 替换组件；
5. 不修改 `workbench.ts` 和 Controller。

同理，可以替换：

- 项目列表为卡片或表格；
- 四步说明为 Timeline；
- 顶部语言切换为 Dropdown Menu；
- 设置 Dialog 为独立页面。

只要 Props 契约不变，业务行为不会跟随 UI 重写。

## 7. 全局样式

全局 Token 位于 `src/styles/globals.css`。

当前 Ink Signal 主题使用：

| Token | 值 | 用途 |
| --- | --- | --- |
| `--background` | `#F6F2E8` | 暖纸张背景 |
| `--paper-raised` | `#FBF8EF` | Header、Sidebar、Dialog |
| `--foreground` | `#101820` | 主文字和工程线框 |
| `--primary` | `#EF4B35` | 主要操作和编号 |
| `--rule` | `#A49C8D` | 分隔线和刻度 |
| `--technical` | `#16847F` | 验证、环境和安全图标 |

样式规则：

- PC 最小宽度为 `1280px`；
- Header 高度和 Sidebar 宽度使用全局变量；
- 方角、细边框和轻量阴影优先；
- 不使用渐变和玻璃拟态；
- 业务组件只能使用语义 Token，不硬编码厂商颜色；
- 路径、编号和工程标签使用 Geist Mono。

## 8. API 接入边界

当前首页使用内存状态，只用于完成前端组件架构。

接入 Fastify 后建议增加：

```text
features/workbench-home/
├── api/
│   ├── workbench-home.queries.ts
│   └── workbench-home.mutations.ts
└── application/
    └── workbench-repository.ts
```

展示组件仍只消费 Props。API Response 需要先映射为 Feature Model，不能把后端 DTO 直接散落在 JSX 中。

浏览器前端不得直接：

- 读取 PostgreSQL；
- 调用 Claude Agent SDK；
- 保存明文 Secret；
- 扫描用户文件系统；
- 决定本地工作台保存目录。

## 9. 当前范围

本轮完成：

- 首页应用壳；
- 空项目列表；
- 四步创建说明；
- 创建工作台 Dialog；
- 默认运行环境 Dialog；
- 基于 i18next/react-i18next 的中英文命名空间；
- 基于 Zustand persist 的语言偏好保存；
- 内存项目创建与详情占位导航；
- Ink Signal 全局 Token；
- shadcn/ui 基础原语。

本轮不包含：

- 正式项目详情页；
- 正式业务 Fastify API；
- 本地目录扫描；
- Skill 校验；
- Endpoint 能力检测；
- 项目持久化；
- Run 和 Trace。
