import { describe, expect, it } from 'bun:test'
import type { SessionDocumentRevision, SessionDocumentState } from '@craft-agent/core/types'
import {
  getDocumentBranchViews,
  getLatestDocumentRevision,
  getRecentDocuments,
  getSmartCollapsedRevisionIds,
  getSupersededRevisionTurnKeys,
} from '../document-workspace'

const revisions: SessionDocumentRevision[] = [
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
  },
  {
    id: 'rev-3',
    documentId: 'doc-1',
    parentRevisionId: 'rev-1',
    branchId: 'fork-1',
    revisionNumber: 2,
    createdAt: 150,
    createdBy: 'assistant',
    hasAnnotations: true,
  },
]

const documentState: SessionDocumentState = {
  documents: [
    { id: 'doc-1', displayName: 'Plan.docx', kind: 'docx', origin: 'generated' },
    { id: 'doc-2', displayName: 'Appendix.pdf', kind: 'pdf', origin: 'attachment' },
  ],
  revisions,
  workspace: {
    activeDocumentId: 'doc-1',
    activeRevisionId: 'rev-2',
    activeBranchId: 'main',
    sidePanelOpen: true,
    recentDocumentIds: ['doc-2', 'doc-1'],
  },
}

describe('document workspace utilities', () => {
  it('orders recent documents using the persisted recent-document list', () => {
    expect(getRecentDocuments(documentState).map((document) => document.id)).toEqual(['doc-2', 'doc-1'])
  })

  it('returns the latest revision for a document', () => {
    expect(getLatestDocumentRevision(documentState, 'doc-1')?.id).toBe('rev-2')
  })

  it('groups revisions into active-first branch views', () => {
    const branches = getDocumentBranchViews(documentState, 'doc-1', 'main')
    expect(branches.map((branch) => branch.branchId)).toEqual(['main', 'fork-1'])
    expect(branches[0]?.headRevision?.id).toBe('rev-2')
    expect(branches[1]?.headRevision?.id).toBe('rev-3')
  })

  it('smart-collapses superseded unannotated revisions only', () => {
    const collapsed = getSmartCollapsedRevisionIds(revisions, {
      activeRevisionId: 'rev-2',
      latestRevisionId: 'rev-2',
    })

    expect(collapsed.has('rev-1')).toBe(true)
    expect(collapsed.has('rev-2')).toBe(false)
    expect(collapsed.has('rev-3')).toBe(false)
  })

  it('maps superseded revision links back to assistant turn keys', () => {
    expect(Array.from(getSupersededRevisionTurnKeys(documentState))).toEqual(['assistant:msg:msg-1'])
  })
})
