import * as React from 'react'
import { BookOpenText, FileText, FolderOpen, PanelRightClose } from 'lucide-react'
import { useSession as useSessionData } from '@/context/AppShellContext'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { SessionFilesSection } from './SessionFilesSection'
import {
  formatDocumentKind,
  getDocumentBranchViews,
  getDocumentById,
  getDocumentRevisions,
  getLatestDocumentRevision,
  getRecentDocuments,
  getSmartCollapsedRevisionIds,
} from './document-workspace'
import { RevisionTimeline } from './RevisionTimeline'
import { BranchNavigator } from './BranchNavigator'
import { cn } from '@/lib/utils'

interface DocumentWorkspacePanelProps {
  sessionId?: string | null
  sessionFolderPath?: string
  onRequestClose: () => void
}

export function DocumentWorkspacePanel({
  sessionId,
  sessionFolderPath,
  onRequestClose,
}: DocumentWorkspacePanelProps) {
  const session = useSessionData(sessionId ?? '')
  const documentState = session?.documentState
  const recentDocuments = React.useMemo(() => getRecentDocuments(documentState), [documentState])
  const activeDocumentId = documentState?.workspace.activeDocumentId ?? recentDocuments[0]?.id
  const activeDocument = React.useMemo(
    () => getDocumentById(documentState, activeDocumentId),
    [documentState, activeDocumentId],
  )
  const revisions = React.useMemo(
    () => getDocumentRevisions(documentState, activeDocument?.id),
    [documentState, activeDocument?.id],
  )
  const latestRevision = React.useMemo(
    () => getLatestDocumentRevision(documentState, activeDocument?.id),
    [documentState, activeDocument?.id],
  )
  const branches = React.useMemo(
    () => getDocumentBranchViews(documentState, activeDocument?.id, documentState?.workspace.activeBranchId),
    [documentState, activeDocument?.id],
  )
  const [collapsedRevisionIds, setCollapsedRevisionIds] = React.useState<Set<string>>(new Set())

  React.useEffect(() => {
    setCollapsedRevisionIds(getSmartCollapsedRevisionIds(revisions, {
      activeRevisionId: documentState?.workspace.activeRevisionId,
      latestRevisionId: latestRevision?.id,
    }))
  }, [revisions, documentState?.workspace.activeRevisionId, latestRevision?.id])

  const updateDocumentWorkspace = React.useCallback(async (nextSidePanelOpen: boolean) => {
    if (!sessionId || !documentState) return
    await window.electronAPI.sessionCommand(sessionId, {
      type: 'setDocumentWorkspace',
      documentState: {
        ...documentState,
        workspace: {
          ...documentState.workspace,
          sidePanelOpen: nextSidePanelOpen,
        },
      },
    })
  }, [sessionId, documentState])

  const handleClose = React.useCallback(async () => {
    await updateDocumentWorkspace(false)
    onRequestClose()
  }, [onRequestClose, updateDocumentWorkspace])

  const handleActivateDocument = React.useCallback(async (
    documentId: string,
    options?: { revisionId?: string; branchId?: string },
  ) => {
    if (!sessionId) return
    await window.electronAPI.sessionCommand(sessionId, {
      type: 'activateDocument',
      documentId,
      revisionId: options?.revisionId,
      branchId: options?.branchId,
      sidePanelOpen: true,
    })
  }, [sessionId])

  const handleDeactivateDocument = React.useCallback(async () => {
    if (!sessionId) return
    if (!documentState) return
    await window.electronAPI.sessionCommand(sessionId, {
      type: 'setDocumentWorkspace',
      documentState: {
        ...documentState,
        workspace: {
          ...documentState.workspace,
          activeDocumentId: undefined,
          activeRevisionId: undefined,
          activeBranchId: undefined,
          sidePanelOpen: true,
        },
      },
    })
  }, [sessionId, documentState])

  const toggleRevision = React.useCallback((revisionId: string) => {
    setCollapsedRevisionIds((prev) => {
      const next = new Set(prev)
      if (next.has(revisionId)) next.delete(revisionId)
      else next.add(revisionId)
      return next
    })
  }, [])

  if (!sessionId) return null

  return (
    <div className="flex h-full min-h-0 w-[360px] shrink-0 flex-col border-l border-border/60 bg-foreground-2 shadow-middle">
      <PanelHeader
        title="Document workspace"
        actions={activeDocument && (
          <PanelHeaderCenterButton
            icon={<FolderOpen className="h-4 w-4" />}
            onClick={() => activeDocument.id && handleActivateDocument(activeDocument.id)}
            tooltip="Focus active document"
          />
        )}
        rightSidebarButton={
          <PanelHeaderCenterButton
            icon={<PanelRightClose className="h-4 w-4" />}
            onClick={handleClose}
            tooltip="Close document workspace"
          />
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
        {activeDocument ? (
          <section className="px-4 pb-3">
            <div className="rounded-2xl border border-foreground/10 bg-background px-4 py-3 shadow-minimal">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-foreground/[0.04] p-2 text-muted-foreground">
                  <BookOpenText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{activeDocument.displayName}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded-full bg-foreground/[0.04] px-2 py-0.5">
                      {formatDocumentKind(activeDocument.kind)}
                    </span>
                    <span className="rounded-full bg-foreground/[0.04] px-2 py-0.5">
                      {activeDocument.origin}
                    </span>
                    {latestRevision && (
                      <span className="rounded-full bg-foreground/[0.04] px-2 py-0.5">
                        Latest rev {latestRevision.revisionNumber}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {latestRevision && latestRevision.id !== documentState?.workspace.activeRevisionId && (
                  <button
                    type="button"
                    onClick={() => handleActivateDocument(activeDocument.id, { revisionId: latestRevision.id })}
                    className="rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
                  >
                    Open latest
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDeactivateDocument}
                  className="rounded-lg bg-foreground/[0.05] px-2.5 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.08]"
                >
                  Clear active document
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="px-4 pb-3">
            <div className="rounded-2xl border border-dashed border-border/60 px-4 py-5 text-sm text-muted-foreground">
              Open a session document to keep a live workspace here.
            </div>
          </section>
        )}

        {branches.length > 1 && (
          <BranchNavigator
            branches={branches}
            onSelectBranch={(branchId) => {
              if (activeDocument?.id) {
                void handleActivateDocument(activeDocument.id, { branchId })
              }
            }}
          />
        )}

        <RevisionTimeline
          revisions={revisions}
          activeRevisionId={documentState?.workspace.activeRevisionId}
          latestRevisionId={latestRevision?.id}
          collapsedRevisionIds={collapsedRevisionIds}
          onToggleRevision={toggleRevision}
          onOpenRevision={(revisionId) => {
            if (activeDocument?.id) {
              void handleActivateDocument(activeDocument.id, { revisionId })
            }
          }}
        />

        <section className="flex flex-col gap-2 px-4 pb-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            <span>Recent documents</span>
          </div>
          <div className="flex flex-col gap-2">
            {recentDocuments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 px-3 py-4 text-xs text-muted-foreground">
                No tracked session documents yet.
              </div>
            ) : (
              recentDocuments.map((document) => {
                const isActive = document.id === activeDocument?.id
                return (
                  <button
                    key={document.id}
                    type="button"
                    onClick={() => void handleActivateDocument(document.id)}
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
                      isActive
                        ? 'border-foreground/15 bg-background shadow-minimal'
                        : 'border-border/50 bg-foreground/[0.02] hover:bg-foreground/[0.04]',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{document.displayName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {formatDocumentKind(document.kind)}
                      </div>
                    </div>
                    {isActive && (
                      <span className="rounded-full bg-foreground text-background px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                        Active
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </section>

        <div className="min-h-0 flex-1 overflow-hidden border-t border-border/50">
          <SessionFilesSection
            sessionId={sessionId}
            sessionFolderPath={sessionFolderPath}
            className="h-full min-h-0"
          />
        </div>
      </div>
    </div>
  )
}
