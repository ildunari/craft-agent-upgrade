import * as React from 'react'
import { ChevronDown, ChevronRight, Clock3, MessageSquareQuote, Pin } from 'lucide-react'
import type { SessionDocumentRevision } from '@craft-agent/core/types'
import { cn } from '@/lib/utils'

interface RevisionTimelineProps {
  revisions: SessionDocumentRevision[]
  activeRevisionId?: string
  latestRevisionId?: string
  collapsedRevisionIds: Set<string>
  onToggleRevision: (revisionId: string) => void
  onOpenRevision: (revisionId: string) => void
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export function RevisionTimeline({
  revisions,
  activeRevisionId,
  latestRevisionId,
  collapsedRevisionIds,
  onToggleRevision,
  onOpenRevision,
}: RevisionTimelineProps) {
  if (revisions.length === 0) {
    return (
      <section className="px-4 pb-3">
        <div className="rounded-xl border border-dashed border-border/60 px-3 py-4 text-xs text-muted-foreground">
          No revisions yet.
        </div>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-2 px-4 pb-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Clock3 className="h-3.5 w-3.5" />
        <span>Revisions</span>
      </div>
      <div className="flex flex-col gap-2">
        {revisions.map((revision) => {
          const collapsed = collapsedRevisionIds.has(revision.id)
          const isActive = revision.id === activeRevisionId
          const isLatest = revision.id === latestRevisionId

          return (
            <div
              key={revision.id}
              className={cn(
                'rounded-xl border px-3 py-2',
                isActive
                  ? 'border-foreground/15 bg-background shadow-minimal'
                  : 'border-border/50 bg-foreground/[0.02]',
              )}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => onToggleRevision(revision.id)}
                  className="mt-0.5 rounded-[6px] p-0.5 text-muted-foreground hover:bg-foreground/[0.05]"
                  aria-label={collapsed ? 'Expand revision details' : 'Collapse revision details'}
                >
                  {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenRevision(revision.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Revision {revision.revisionNumber}</span>
                    {isLatest && (
                      <span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Latest
                      </span>
                    )}
                    {isActive && (
                      <span className="rounded-full bg-foreground text-background px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                        Active
                      </span>
                    )}
                    {revision.isSuperseded && !isLatest && (
                      <span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Superseded
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{formatTimestamp(revision.createdAt)}</div>
                </button>
              </div>

              {!collapsed && (
                <div className="ml-6 mt-2 flex flex-col gap-2">
                  {revision.summary && (
                    <p className="text-xs leading-relaxed text-foreground/80">{revision.summary}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded-full bg-foreground/[0.04] px-2 py-0.5">
                      {revision.createdBy}
                    </span>
                    <span className="rounded-full bg-foreground/[0.04] px-2 py-0.5">
                      {revision.branchId}
                    </span>
                    {revision.hasAnnotations && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.04] px-2 py-0.5">
                        <MessageSquareQuote className="h-3 w-3" />
                        Annotated
                      </span>
                    )}
                    {revision.pinnedToMessageId && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.04] px-2 py-0.5">
                        <Pin className="h-3 w-3" />
                        Pinned
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
