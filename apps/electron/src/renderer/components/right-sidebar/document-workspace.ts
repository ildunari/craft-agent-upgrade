import type {
  DocumentKind,
  SessionDocumentRef,
  SessionDocumentRevision,
  SessionDocumentState,
} from '@craft-agent/core/types'

export interface DocumentBranchView {
  branchId: string
  label: string
  revisions: SessionDocumentRevision[]
  headRevision?: SessionDocumentRevision
  isActive: boolean
}

const REVISION_SORT = (left: SessionDocumentRevision, right: SessionDocumentRevision) => (
  right.revisionNumber - left.revisionNumber ||
  right.createdAt - left.createdAt ||
  right.id.localeCompare(left.id)
)

export function sortDocumentRevisions(revisions: SessionDocumentRevision[]): SessionDocumentRevision[] {
  return revisions.slice().sort(REVISION_SORT)
}

export function getDocumentById(
  documentState: SessionDocumentState | undefined,
  documentId?: string,
): SessionDocumentRef | undefined {
  if (!documentState || !documentId) return undefined
  return documentState.documents.find((document) => document.id === documentId)
}

export function getDocumentRevisions(
  documentState: SessionDocumentState | undefined,
  documentId?: string,
): SessionDocumentRevision[] {
  if (!documentState || !documentId) return []
  return sortDocumentRevisions(
    documentState.revisions.filter((revision) => revision.documentId === documentId),
  )
}

export function getLatestDocumentRevision(
  documentState: SessionDocumentState | undefined,
  documentId?: string,
): SessionDocumentRevision | undefined {
  return getDocumentRevisions(documentState, documentId)[0]
}

export function getDocumentBranchViews(
  documentState: SessionDocumentState | undefined,
  documentId?: string,
  activeBranchId?: string,
): DocumentBranchView[] {
  const revisions = getDocumentRevisions(documentState, documentId)
  const branches = new Map<string, SessionDocumentRevision[]>()

  for (const revision of revisions) {
    const branchRevisions = branches.get(revision.branchId) ?? []
    branchRevisions.push(revision)
    branches.set(revision.branchId, branchRevisions)
  }

  return Array.from(branches.entries())
    .map(([branchId, branchRevisions], index) => {
      const sortedRevisions = sortDocumentRevisions(branchRevisions)
      return {
        branchId,
        label: formatBranchLabel(branchId, index),
        revisions: sortedRevisions,
        headRevision: sortedRevisions[0],
        isActive: branchId === activeBranchId,
      }
    })
    .sort((left, right) => {
      if (left.isActive && !right.isActive) return -1
      if (!left.isActive && right.isActive) return 1
      return REVISION_SORT(
        left.headRevision ?? emptyRevision(left.branchId, documentId),
        right.headRevision ?? emptyRevision(right.branchId, documentId),
      )
    })
}

export function getRecentDocuments(
  documentState: SessionDocumentState | undefined,
): SessionDocumentRef[] {
  if (!documentState) return []

  const documentById = new Map(documentState.documents.map((document) => [document.id, document] as const))
  const orderedIds = [
    ...documentState.workspace.recentDocumentIds,
    ...documentState.documents.map((document) => document.id),
  ]

  const seen = new Set<string>()
  const ordered: SessionDocumentRef[] = []

  for (const documentId of orderedIds) {
    if (seen.has(documentId)) continue
    const document = documentById.get(documentId)
    if (!document) continue
    seen.add(documentId)
    ordered.push(document)
  }

  return ordered
}

export function getSmartCollapsedRevisionIds(
  revisions: SessionDocumentRevision[],
  options?: {
    activeRevisionId?: string
    latestRevisionId?: string
  },
): Set<string> {
  const sorted = sortDocumentRevisions(revisions)
  const collapsed = new Set<string>()
  const hasServerSupersessionState = sorted.some((revision) => revision.isSuperseded !== undefined)

  for (const revision of sorted) {
    const isActive = revision.id === options?.activeRevisionId
    const isLatest = revision.id === options?.latestRevisionId
    const isSuperseded = hasServerSupersessionState
      ? revision.isSuperseded === true
      : !isActive && !isLatest
    const shouldStayExpanded = isActive || isLatest || revision.hasAnnotations || !isSuperseded
    if (!shouldStayExpanded) {
      collapsed.add(revision.id)
    }
  }

  return collapsed
}

export function getSupersededRevisionTurnKeys(
  documentState: SessionDocumentState | undefined,
): Set<string> {
  if (!documentState) return new Set<string>()

  const turnKeys = new Set<string>()
  for (const revision of documentState.revisions) {
    if (!revision.isSuperseded || revision.hasAnnotations || !revision.pinnedToMessageId) continue
    turnKeys.add(`assistant:msg:${revision.pinnedToMessageId}`)
  }

  return turnKeys
}

export function formatDocumentKind(kind: DocumentKind): string {
  switch (kind) {
    case 'docx':
      return 'DOCX'
    case 'pdf':
      return 'PDF'
    case 'pptx':
      return 'PPTX'
    default:
      return kind.toUpperCase()
  }
}

function formatBranchLabel(branchId: string, index: number): string {
  if (branchId === 'main') return 'Main'
  if (branchId.startsWith('branch-')) return `Branch ${branchId.slice(7)}`
  if (branchId.includes('fork')) return `Fork ${index + 1}`
  return branchId
}

function emptyRevision(branchId: string, documentId?: string): SessionDocumentRevision {
  return {
    id: `${branchId}-empty`,
    documentId: documentId ?? 'unknown-document',
    branchId,
    revisionNumber: -1,
    createdAt: 0,
    createdBy: 'system',
    hasAnnotations: false,
  }
}
