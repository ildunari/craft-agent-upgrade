import * as React from 'react'
import { GitBranch, Sparkles } from 'lucide-react'
import type { DocumentBranchView } from './document-workspace'
import { cn } from '@/lib/utils'

interface BranchNavigatorProps {
  branches: DocumentBranchView[]
  onSelectBranch: (branchId: string) => void
}

export function BranchNavigator({ branches, onSelectBranch }: BranchNavigatorProps) {
  if (branches.length <= 1) return null

  return (
    <section className="flex flex-col gap-2 px-4 pb-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5" />
        <span>Branches</span>
      </div>
      <div className="flex flex-col gap-2">
        {branches.map((branch) => (
          <button
            key={branch.branchId}
            type="button"
            onClick={() => onSelectBranch(branch.branchId)}
            className={cn(
              'flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
              branch.isActive
                ? 'border-foreground/15 bg-background shadow-minimal'
                : 'border-border/50 bg-foreground/[0.02] hover:bg-foreground/[0.04]',
            )}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{branch.label}</div>
              <div className="truncate text-xs text-muted-foreground">
                {branch.headRevision
                  ? `Revision ${branch.headRevision.revisionNumber}`
                  : 'No revisions'}
              </div>
            </div>
            {branch.isActive && <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        ))}
      </div>
    </section>
  )
}
