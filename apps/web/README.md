# Web application

`apps/web` is the React, Vite, shadcn/ui, and Tailwind CSS desktop application for the SkillConsole workbench.

## Technology

- React 19 and React Router
- Vite 8
- Tailwind CSS 4
- shadcn/ui using the `new-york` style, Radix primitives, CSS variables, and Lucide icons
- i18next and react-i18next
- Zustand with versioned localStorage persistence for non-sensitive preferences
- TanStack Query and TanStack Table
- React Hook Form and Zod
- Vitest and Testing Library

## Responsibilities

- Present projects, Skills, tests, environments, Runs, traces, assertions, and artifacts.
- Call the Fastify API through versioned contracts.
- Subscribe to Run events through Server-Sent Events.
- Keep server state in TanStack Query and short-lived interaction state in React.

## Directory structure

```text
src/
├── app/                 # Bootstrap, providers, router, and desktop shell
├── routes/              # Route-level screen composition
├── features/            # Product capability boundaries and headless controllers
├── shared/              # API, shadcn/ui, layout, hooks, config, lib, and types
├── locales/             # Translation resources grouped by locale and namespace
├── styles/              # Tailwind and semantic design tokens
├── test/                # Shared test setup
└── main.tsx
```

Dependency direction is `app → routes → features → shared`.

Do not access PostgreSQL, the local file system, Endpoint Secrets, or Claude Agent SDK from this application.

## Internationalization and client state

- `src/shared/i18n` owns i18next initialization, supported locales, and resource registration.
- `src/locales/<locale>` contains contributor-editable JSON translation files.
- `src/shared/stores/preferences` owns browser preferences.
- Zustand is the source of truth for the selected locale and persists only validated, non-sensitive preference fields.
- TanStack Query remains the owner of API-backed server state.
- React Hook Form remains the owner of form state.

API keys, Endpoint credentials, Skill contents, traces, and artifacts must never be written to localStorage.

## Docker development

Use the repository-level Compose command rather than installing dependencies in this directory:

```bash
docker compose --profile development up --build
```

Open `http://localhost:5173`. Vite proxies `/api/*` to the Fastify container.

## Component architecture

The first implemented Feature is `workbench-home`. It uses controlled view components and a headless controller so downstream projects can replace layouts and UI without changing validation or interaction rules.

See [Frontend component architecture](../../docs/architecture/frontend-component-architecture.md) for the dependency rules, component catalog, theme tokens, and extension examples.
