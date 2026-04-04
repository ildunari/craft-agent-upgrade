export type DocumentKind = 'markdown' | 'docx' | 'pdf' | 'html' | 'pptx' | 'other'

export interface SessionDocumentRef {
  id: string
  sourcePath?: string
  displayName: string
  kind: DocumentKind
  origin: 'attachment' | 'generated' | 'referenced'
}

export interface SessionDocumentRevision {
  id: string
  documentId: string
  parentRevisionId?: string
  branchId: string
  revisionNumber: number
  renderPath?: string
  contentPath?: string
  previewAssetPath?: string
  createdAt: number
  createdBy: 'user' | 'assistant' | 'system'
  pinnedToMessageId?: string
  hasAnnotations: boolean
  summary?: string
  isSuperseded?: boolean
  supersededAt?: number
}

export interface SessionDocumentBranch {
  id: string
  documentId: string
  parentBranchId?: string
  forkedFromRevisionId?: string
  createdAt: number
  label?: string
}

export interface SessionDocumentWorkspaceState {
  activeDocumentId?: string
  activeRevisionId?: string
  activeBranchId?: string
  sidePanelOpen: boolean
  recentDocumentIds: string[]
}

export interface SessionDocumentState {
  documents: SessionDocumentRef[]
  branches: SessionDocumentBranch[]
  revisions: SessionDocumentRevision[]
  workspace: SessionDocumentWorkspaceState
}
