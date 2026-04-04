import { describe, expect, it } from 'bun:test'
import type { SessionDocumentState } from '@craft-agent/core/types'
import { SessionManager, createManagedSession } from './SessionManager.ts'

const workspace = {
  id: 'ws-test',
  name: 'Workspace',
  rootPath: '/tmp/document-workspace-tests',
  createdAt: 1,
}

function makeDocumentState(): SessionDocumentState {
  return {
    documents: [
      {
        id: 'doc-1',
        displayName: 'Spec.md',
        kind: 'markdown',
        origin: 'generated',
      },
    ],
    revisions: [
      {
        id: 'rev-1',
        documentId: 'doc-1',
        branchId: 'main',
        revisionNumber: 1,
        createdAt: 100,
        createdBy: 'assistant',
        hasAnnotations: false,
        pinnedToMessageId: 'msg-1',
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
}

function makeManager(documentState: SessionDocumentState) {
  const manager = new SessionManager() as any
  const events: any[] = []
  const managed = createManagedSession({
    id: 'session-1',
    documentState,
  } as any, workspace as any)

  manager.sessions.set('session-1', managed)
  manager.persistSession = () => {}
  manager.sendEvent = (event: unknown) => {
    events.push(event)
  }

  return { manager: manager as SessionManager, managed, events }
}

describe('SessionManager document workspace', () => {
  it('marks older revisions superseded when a newer revision is stored', () => {
    const initialState = makeDocumentState()
    const nextState: SessionDocumentState = {
      ...initialState,
      revisions: [
        ...initialState.revisions,
        {
          id: 'rev-2',
          documentId: 'doc-1',
          parentRevisionId: 'rev-1',
          branchId: 'main',
          revisionNumber: 2,
          createdAt: 200,
          createdBy: 'assistant',
          hasAnnotations: false,
          pinnedToMessageId: 'msg-2',
        },
      ],
      workspace: {
        ...initialState.workspace,
        activeRevisionId: 'rev-2',
      },
    }

    const { manager, managed, events } = makeManager(initialState)
    manager.setDocumentWorkspace('session-1', nextState)

    expect(managed.documentState?.revisions.find((revision) => revision.id === 'rev-1')).toMatchObject({
      isSuperseded: true,
      supersededAt: 200,
    })
    expect(events.some((event) => event.type === 'document_revision_created' && event.revisionId === 'rev-2')).toBe(true)
    expect(events.some((event) => event.type === 'document_revision_collapsed' && event.revisionId === 'rev-1')).toBe(true)
    expect(events.some((event) => event.type === 'document_revision_changed' && event.revisionId === 'rev-2')).toBe(true)
  })

  it('switches the active revision without changing the last-used surface', () => {
    const documentState: SessionDocumentState = {
      ...makeDocumentState(),
      workspace: {
        activeDocumentId: 'doc-1',
        activeRevisionId: 'rev-2',
        activeBranchId: 'main',
        sidePanelOpen: false,
        recentDocumentIds: ['doc-1'],
      },
      revisions: [
        {
          id: 'rev-1',
          documentId: 'doc-1',
          branchId: 'main',
          revisionNumber: 1,
          createdAt: 100,
          createdBy: 'assistant',
          hasAnnotations: false,
          pinnedToMessageId: 'msg-1',
          isSuperseded: true,
          supersededAt: 200,
        },
        {
          id: 'rev-2',
          documentId: 'doc-1',
          parentRevisionId: 'rev-1',
          branchId: 'main',
          revisionNumber: 2,
          createdAt: 200,
          createdBy: 'assistant',
          hasAnnotations: false,
          pinnedToMessageId: 'msg-2',
        },
      ],
    }

    const { manager, managed, events } = makeManager(documentState)
    manager.setActiveDocumentRevision('session-1', 'doc-1', 'rev-1')

    expect(managed.documentState?.workspace).toMatchObject({
      activeDocumentId: 'doc-1',
      activeRevisionId: 'rev-1',
      activeBranchId: 'main',
      sidePanelOpen: false,
    })
    expect(events.some((event) => event.type === 'document_revision_changed' && event.revisionId === 'rev-1')).toBe(true)
  })
})
