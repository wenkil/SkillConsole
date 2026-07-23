export type SkillSourceKind = "folder" | "zip"

export interface WorkbenchProject {
  id: string
  name: string
  sourceKind: SkillSourceKind
  sourceName: string
  createdAt: string
}

export interface CreateWorkbenchDraft {
  name: string
  sourceKind: SkillSourceKind
  sourceName: string | null
}

export interface CreateWorkbenchErrors {
  name?: "nameRequired" | undefined
  source?: "sourceRequired" | undefined
}

export interface RuntimeDefaults {
  endpointUrl: string
  apiKey: string
  modelId: string
}

interface CreateWorkbenchOptions {
  id: string
  createdAt: string
}

export function createEmptyWorkbenchDraft(): CreateWorkbenchDraft {
  return {
    name: "",
    sourceKind: "folder",
    sourceName: null,
  }
}

export function createEmptyRuntimeDefaults(): RuntimeDefaults {
  return {
    endpointUrl: "",
    apiKey: "",
    modelId: "",
  }
}

export function validateWorkbenchDraft(
  draft: CreateWorkbenchDraft,
): CreateWorkbenchErrors {
  const errors: CreateWorkbenchErrors = {}

  if (!draft.name.trim()) {
    errors.name = "nameRequired"
  }

  if (!draft.sourceName) {
    errors.source = "sourceRequired"
  }

  return errors
}

export function createWorkbenchProject(
  draft: CreateWorkbenchDraft,
  options: CreateWorkbenchOptions,
): WorkbenchProject {
  if (!draft.sourceName) {
    throw new Error("A Skill source is required to create a workbench project.")
  }

  return {
    id: options.id,
    name: draft.name.trim(),
    sourceKind: draft.sourceKind,
    sourceName: draft.sourceName,
    createdAt: options.createdAt,
  }
}
