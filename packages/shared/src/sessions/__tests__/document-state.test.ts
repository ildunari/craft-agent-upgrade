import { describe, expect, it } from 'bun:test';
import { SESSION_PERSISTENT_FIELDS } from '../types.ts';
import { pickSessionFields } from '../utils.ts';

describe('session persistence: documentState', () => {
  it('includes documentState in SESSION_PERSISTENT_FIELDS', () => {
    expect(SESSION_PERSISTENT_FIELDS).toContain('documentState');
  });

  it('pickSessionFields preserves documentState when present', () => {
    const source = {
      id: 's1',
      workspaceRootPath: '/tmp/ws',
      createdAt: 1,
      lastUsedAt: 2,
      documentState: {
        documents: [
          {
            id: 'doc-1',
            displayName: 'Spec',
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
            createdAt: 3,
            createdBy: 'assistant',
            hasAnnotations: false,
            isSuperseded: true,
            supersededAt: 4,
          },
        ],
        workspace: {
          activeDocumentId: 'doc-1',
          activeRevisionId: 'rev-1',
          activeBranchId: 'main',
          sidePanelOpen: true,
          recentDocumentIds: ['doc-1'],
        },
      },
      ignoredRuntimeField: 'nope',
    } as const;

    const picked = pickSessionFields(source);
    expect(picked.documentState).toEqual(source.documentState);
    expect((picked as Record<string, unknown>).ignoredRuntimeField).toBeUndefined();
  });
});
