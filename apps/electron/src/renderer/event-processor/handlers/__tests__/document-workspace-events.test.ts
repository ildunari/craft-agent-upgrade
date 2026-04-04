import { describe, expect, it } from 'bun:test'
import {
  handleDocumentActivated,
  handleDocumentBranchCreated,
  handleDocumentBranchSwitched,
  handleDocumentRevisionChanged,
  handleDocumentRevisionCollapsed,
  handleDocumentRevisionCreated,
  handleDocumentWorkspaceChanged,
} from '../session'
import type { SessionDocumentState } from '@craft-agent/core/types'
import type {
  DocumentActivatedEvent,
  DocumentBranchCreatedEvent,
  DocumentBranchSwitchedEvent,
  DocumentRevisionChangedEvent,
  DocumentRevisionCollapsedEvent,
  DocumentRevisionCreatedEvent,
  DocumentWorkspaceChangedEvent,
  SessionState,
} from '../../types'

const documentState: SessionDocumentState = {
  documents: [
    { id: 'doc-1', displayName: 'Plan.docx', kind: 'docx', origin: 'generated' as const },
  ],
  branches: [
    { id: 'main', documentId: 'doc-1', createdAt: 100 },
  ],
  revisions: [
    {
      id: 'rev-1',
      documentId: 'doc-1',
      branchId: 'main',
      revisionNumber: 1,
      createdAt: 100,
      createdBy: 'assistant' as const,
      hasAnnotations: false,
    },
  ],
  workspace: {
    activeDocumentId: 'doc-1',
    activeRevisionId: 'rev-1',
    activeBranchId: 'main',
    sidePanelOpen: true,
    recentDocumentIds: ['doc-1'],
  },
}

function makeState(): SessionState {
  return {
    session: {
      id: 'session-1',
      messages: [],
      lastMessageAt: Date.now(),
    } as any,
    streaming: null,
  }
}

describe('document workspace session handlers', () => {
  it('updates session document state on workspace_changed', () => {
    const event: DocumentWorkspaceChangedEvent = {
      type: 'document_workspace_changed',
      sessionId: 'session-1',
      documentState,
    }

    const next = handleDocumentWorkspaceChanged(makeState(), event)
    expect(next.state.session.documentState).toEqual(documentState)
  })

  it('updates session document state on document_activated', () => {
    const event: DocumentActivatedEvent = {
      type: 'document_activated',
      sessionId: 'session-1',
      documentState,
    }

    const next = handleDocumentActivated(makeState(), event)
    expect(next.state.session.documentState?.workspace.activeRevisionId).toBe('rev-1')
  })

  it('updates session document state on document_revision_created', () => {
    const event: DocumentRevisionCreatedEvent = {
      type: 'document_revision_created',
      sessionId: 'session-1',
      documentState,
      revisionId: 'rev-1',
    }

    const next = handleDocumentRevisionCreated(makeState(), event)
    expect(next.state.session.documentState?.revisions).toHaveLength(1)
  })

  it('updates session document state on document_revision_changed', () => {
    const event: DocumentRevisionChangedEvent = {
      type: 'document_revision_changed',
      sessionId: 'session-1',
      documentState,
      documentId: 'doc-1',
      revisionId: 'rev-1',
    }

    const next = handleDocumentRevisionChanged(makeState(), event)
    expect(next.state.session.documentState?.workspace.activeRevisionId).toBe('rev-1')
  })

  it('updates session document state on document_revision_collapsed', () => {
    const collapsedState: SessionDocumentState = {
      ...documentState,
      revisions: documentState.revisions.map((revision) => ({
        ...revision,
        isSuperseded: true,
        supersededAt: 101,
      })),
    }

    const event: DocumentRevisionCollapsedEvent = {
      type: 'document_revision_collapsed',
      sessionId: 'session-1',
      documentState: collapsedState,
      documentId: 'doc-1',
      revisionId: 'rev-1',
    }

    const next = handleDocumentRevisionCollapsed(makeState(), event)
    expect(next.state.session.documentState?.revisions[0]?.isSuperseded).toBe(true)
  })

  it('updates session document state on document_branch_created', () => {
    const branchState: SessionDocumentState = {
      ...documentState,
      branches: [
        ...documentState.branches,
        { id: 'branch-2', documentId: 'doc-1', parentBranchId: 'main', forkedFromRevisionId: 'rev-1', createdAt: 200 },
      ],
    }

    const event: DocumentBranchCreatedEvent = {
      type: 'document_branch_created',
      sessionId: 'session-1',
      documentState: branchState,
      documentId: 'doc-1',
      branchId: 'branch-2',
    }

    const next = handleDocumentBranchCreated(makeState(), event)
    expect(next.state.session.documentState?.branches).toHaveLength(2)
  })

  it('updates session document state on document_branch_switched', () => {
    const event: DocumentBranchSwitchedEvent = {
      type: 'document_branch_switched',
      sessionId: 'session-1',
      documentState,
      documentId: 'doc-1',
      branchId: 'main',
      revisionId: 'rev-1',
    }

    const next = handleDocumentBranchSwitched(makeState(), event)
    expect(next.state.session.documentState?.workspace.activeBranchId).toBe('main')
  })
})
