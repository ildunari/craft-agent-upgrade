import { describe, expect, it } from 'bun:test'
import {
  handleDocumentActivated,
  handleDocumentRevisionCreated,
  handleDocumentWorkspaceChanged,
} from '../session'
import type { SessionDocumentState } from '@craft-agent/core/types'
import type {
  DocumentActivatedEvent,
  DocumentRevisionCreatedEvent,
  DocumentWorkspaceChangedEvent,
  SessionState,
} from '../../types'

const documentState: SessionDocumentState = {
  documents: [
    { id: 'doc-1', displayName: 'Plan.docx', kind: 'docx', origin: 'generated' as const },
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
})
