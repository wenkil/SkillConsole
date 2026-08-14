import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

import {
  createTestReportAnalysis,
  getTestReportAnalysis,
  getTestReport,
  getTestReportByRun,
  listTestReportAnalysisLogs,
  listTestReportAnalyses,
  listTestReports,
  regenerateTestReport,
  subscribeToTestReportAnalysis,
} from "@/features/test-reports/api/test-reports-api"
import {
  defaultTestReportListFilters,
  getDefaultAnalysisCaseIds,
  isTestReportDocumentReady,
  type TestReportAnalysisList,
  type TestReportAnalysisLogEvent,
  type TestReportDetail,
  type TestReportListFilters,
} from "@/features/test-reports/model/test-report"

export function useTestReportsListController(workspaceId: string) {
  const [filters, setFilters] = useState<TestReportListFilters>(
    defaultTestReportListFilters,
  )
  const query = useQuery({
    queryKey: ["skill-workspaces", workspaceId, "test-reports", filters],
    queryFn: () => listTestReports(workspaceId, filters),
    placeholderData: (previous) => previous,
    refetchInterval: (current) =>
      current.state.data?.items.some(
        (report) =>
          report.status === "GENERATION_PENDING" ||
          report.analysisStatus === "PENDING" ||
          report.analysisStatus === "RUNNING",
      )
        ? 2_000
        : false,
  })
  const updateFilters = (patch: Partial<TestReportListFilters>) => {
    setFilters((current) => ({
      ...current,
      ...patch,
      page: patch.page ?? 1,
    }))
  }
  return {
    filters,
    reports: query.data?.items ?? [],
    pagination: query.data?.pagination ?? {
      page: filters.page,
      pageSize: filters.pageSize,
      total: 0,
      pageCount: 0,
    },
    summary: query.data?.summary ?? {
      total: 0,
      available: 0,
      partial: 0,
      generationFailed: 0,
      withNegativeTransitions: 0,
      executionCostUsd: 0,
      gradingCostUsd: 0,
    },
    loading: query.isPending,
    refreshing: query.isFetching,
    error: query.isError,
    actions: {
      updateFilters,
      resetFilters: () => setFilters(defaultTestReportListFilters),
      retry: () => void query.refetch(),
    },
  }
}

export function useTestReportDetailController(reportId: string) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ["test-reports", reportId],
    queryFn: () => getTestReport(reportId),
    refetchInterval: (current) =>
      current.state.data?.status === "GENERATION_PENDING" ||
      current.state.data?.analysisStatus === "PENDING" ||
      current.state.data?.analysisStatus === "RUNNING"
        ? 1_500
        : false,
  })
  const regenerate = useMutation({
    mutationFn: () => regenerateTestReport(reportId),
    onSuccess: (report) => {
      queryClient.setQueryData(["test-reports", reportId], report)
      void queryClient.invalidateQueries({
        queryKey: ["skill-workspaces", report.workspaceId, "test-reports"],
      })
    },
  })
  return {
    report: query.data ?? null,
    loading: query.isPending,
    error: query.isError,
    regenerating: regenerate.isPending,
    mutationError: regenerate.error instanceof Error ? regenerate.error.message : null,
    actions: {
      retry: () => void query.refetch(),
      regenerate: () => regenerate.mutateAsync(),
    },
  }
}

export function useTestReportByRun(runId: string) {
  return useQuery({
    queryKey: ["test-runs", runId, "report"],
    queryFn: () => getTestReportByRun(runId),
  })
}

export function useTestReportAnalyzerController(
  reportId: string,
  report: TestReportDetail | null,
) {
  const queryClient = useQueryClient()
  const selectableCases = report?.report?.cases ?? []
  const defaultCaseIds = getDefaultAnalysisCaseIds(selectableCases)
  const selectionKey = `${reportId}:${report?.currentRevisionId ?? "none"}:${defaultCaseIds.join(",")}`
  const [selectionOverride, setSelectionOverride] = useState<{
    readonly key: string
    readonly ids: readonly string[]
  } | null>(null)
  const selectedCaseIds =
    selectionOverride?.key === selectionKey
      ? selectionOverride.ids
      : defaultCaseIds

  const listQuery = useQuery({
    queryKey: ["test-reports", reportId, "analyses"],
    queryFn: () => listTestReportAnalyses(reportId),
    enabled: report !== null && isTestReportDocumentReady(report),
    refetchInterval: (current) =>
      current.state.data?.items.some(
        (analysis) =>
          analysis.status === "PENDING" || analysis.status === "RUNNING",
      )
        ? 1_500
        : false,
  })
  const analyses = [...(listQuery.data?.items ?? [])].sort(
    (left, right) => right.revisionNumber - left.revisionNumber,
  )
  const [requestedAnalysis, setRequestedAnalysis] = useState<{
    readonly reportId: string
    readonly analysisId: string
  } | null>(null)
  const requestedAnalysisId =
    requestedAnalysis?.reportId === reportId
      ? requestedAnalysis.analysisId
      : null
  const selectedAnalysisId =
    requestedAnalysisId &&
    analyses.some((analysis) => analysis.id === requestedAnalysisId)
      ? requestedAnalysisId
      : (analyses[0]?.id ?? null)
  const detailQuery = useQuery({
    queryKey: ["test-report-analyses", selectedAnalysisId],
    queryFn: () => getTestReportAnalysis(selectedAnalysisId!),
    enabled: selectedAnalysisId !== null,
    refetchInterval: (current) =>
      current.state.data?.status === "PENDING" ||
      current.state.data?.status === "RUNNING"
        ? 1_500
        : false,
  })
  const logsQuery = useInfiniteQuery({
    queryKey: ["test-report-analyses", selectedAnalysisId, "logs"],
    queryFn: ({ pageParam }) =>
      listTestReportAnalysisLogs(selectedAnalysisId!, {
        ...(pageParam === undefined
          ? {}
          : { beforeSequence: pageParam }),
        limit: 200,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? (lastPage.pagination.nextBeforeSequence ?? undefined)
        : undefined,
    enabled: selectedAnalysisId !== null,
  })
  const historyLogEvents = useMemo(
    () =>
      (logsQuery.data?.pages ?? [])
        .flatMap((page) => page.items)
        .sort((left, right) => left.sequence - right.sequence),
    [logsQuery.data?.pages],
  )
  const [streamState, setStreamState] = useState<{
    readonly analysisId: string | null
    readonly events: readonly TestReportAnalysisLogEvent[]
  }>({ analysisId: null, events: [] })
  const [logConnectionState, setLogConnectionState] = useState<{
    readonly analysisId: string | null
    readonly failed: boolean
  }>({ analysisId: null, failed: false })
  const createMutation = useMutation({
    mutationFn: (evalRevisionCaseIds: readonly string[]) =>
      createTestReportAnalysis(reportId, evalRevisionCaseIds),
    onSuccess: (analysis) => {
      setRequestedAnalysis({
        reportId: analysis.reportId,
        analysisId: analysis.id,
      })
      queryClient.setQueryData(
        ["test-report-analyses", analysis.id],
        analysis,
      )
      queryClient.setQueryData<TestReportAnalysisList>(
        ["test-reports", analysis.reportId, "analyses"],
        (current) => ({
          items: [
            analysis,
            ...(current?.items.filter((item) => item.id !== analysis.id) ?? []),
          ],
        }),
      )
      void queryClient.invalidateQueries({
        queryKey: ["test-reports", analysis.reportId, "analyses"],
      })
      void queryClient.invalidateQueries({
        queryKey: ["test-reports", analysis.reportId],
      })
    },
  })
  const selectedAnalysis =
    detailQuery.data?.id === selectedAnalysisId &&
    detailQuery.data.reportId === reportId
      ? detailQuery.data
      : null
  const streamAfterSequence = historyLogEvents.at(-1)?.sequence ?? 0
  useEffect(() => {
    if (
      !selectedAnalysisId ||
      selectedAnalysis?.status !== "RUNNING" ||
      !logsQuery.isSuccess
    ) {
      return
    }
    const unsubscribe = subscribeToTestReportAnalysis(
      selectedAnalysisId,
      streamAfterSequence,
      (event) => {
        setLogConnectionState({
          analysisId: selectedAnalysisId,
          failed: false,
        })
        setStreamState((current) => {
          const currentEvents =
            current.analysisId === selectedAnalysisId ? current.events : []
          if (currentEvents.some((item) => item.sequence === event.sequence)) {
            return current
          }
          return {
            analysisId: selectedAnalysisId,
            events: [...currentEvents, event].sort(
              (left, right) => left.sequence - right.sequence,
            ),
          }
        })
        if (
          [
            "turn.completed",
            "turn.canceled",
            "turn.interrupted",
            "turn.failed",
            "session.failed",
          ].includes(event.type)
        ) {
          void queryClient.invalidateQueries({
            queryKey: ["test-report-analyses", selectedAnalysisId],
            exact: true,
          })
          void queryClient.invalidateQueries({
            queryKey: ["test-reports", reportId, "analyses"],
            exact: true,
          })
          void queryClient.invalidateQueries({
            queryKey: ["test-report-analyses", selectedAnalysisId, "logs"],
          })
        }
      },
      () =>
        setLogConnectionState({
          analysisId: selectedAnalysisId,
          failed: true,
        }),
    )
    return unsubscribe
  }, [
    logsQuery.isSuccess,
    queryClient,
    reportId,
    selectedAnalysis?.status,
    selectedAnalysisId,
    streamAfterSequence,
  ])
  const logsBySequence = new Map<number, TestReportAnalysisLogEvent>()
  for (const event of historyLogEvents) {
    logsBySequence.set(event.sequence, event)
  }
  if (streamState.analysisId === selectedAnalysisId) {
    for (const event of streamState.events) {
      logsBySequence.set(event.sequence, event)
    }
  }
  const logEvents = [...logsBySequence.values()].sort(
    (left, right) => left.sequence - right.sequence,
  )
  const analysisActive =
    analyses.some(
      (analysis) =>
        analysis.status === "PENDING" || analysis.status === "RUNNING",
    ) ||
    selectedAnalysis?.status === "PENDING" ||
    selectedAnalysis?.status === "RUNNING"

  const updateSelectedCaseIds = (ids: readonly string[]) => {
    setSelectionOverride({ key: selectionKey, ids })
  }

  return {
    analyses,
    selectedAnalysis,
    selectedAnalysisId,
    selectableCases,
    selectedCaseIds,
    loading: listQuery.isPending,
    detailLoading: detailQuery.isPending && selectedAnalysisId !== null,
    error: listQuery.isError || detailQuery.isError,
    creating: createMutation.isPending,
    analysisActive,
    logEvents,
    logsLoading: logsQuery.isPending && selectedAnalysisId !== null,
    logsError: logsQuery.isError,
    logConnectionError:
      logConnectionState.analysisId === selectedAnalysisId &&
      logConnectionState.failed,
    hasEarlierLogs: logsQuery.hasNextPage,
    loadingEarlierLogs: logsQuery.isFetchingNextPage,
    mutationError:
      createMutation.error instanceof Error
        ? createMutation.error.message
        : null,
    actions: {
      retry: () => {
        void listQuery.refetch()
        if (selectedAnalysisId) void detailQuery.refetch()
        if (selectedAnalysisId) void logsQuery.refetch()
      },
      selectAnalysis: (analysisId: string) => {
        if (analyses.some((analysis) => analysis.id === analysisId)) {
          setRequestedAnalysis({ reportId, analysisId })
        }
      },
      toggleCase: (evalRevisionCaseId: string) => {
        updateSelectedCaseIds(
          selectedCaseIds.includes(evalRevisionCaseId)
            ? selectedCaseIds.filter((id) => id !== evalRevisionCaseId)
            : [...selectedCaseIds, evalRevisionCaseId],
        )
      },
      selectDefaultCases: () => updateSelectedCaseIds(defaultCaseIds),
      selectAllCases: () =>
        updateSelectedCaseIds(
          selectableCases.map((item) => item.evalRevisionCaseId),
        ),
      clearCases: () => updateSelectedCaseIds([]),
      create: (evalRevisionCaseIds: readonly string[] = selectedCaseIds) =>
        createMutation.mutateAsync(evalRevisionCaseIds),
      retryLogs: () => void logsQuery.refetch(),
      loadEarlierLogs: () => logsQuery.fetchNextPage(),
    },
  }
}
