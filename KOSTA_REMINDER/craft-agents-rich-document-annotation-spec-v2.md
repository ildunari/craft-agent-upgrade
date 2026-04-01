# Rich Document Annotation System — Complete Implementation Spec v2

**Project:** Craft Agents OSS (`lukilabs/craft-agents-oss`)
**Fork:** `ildunari/craft-agents-oss`
**Date:** 2026-03-25
**Status:** Implementation-ready

---

## Executive Summary

This spec extends the annotation follow-up system ("Island" popup) in Craft Agents to work with PDF, Word, and HTML documents — not just markdown text. It also adds persistent highlights and "Copy as quote" as adjacent features that ship alongside the core annotation work.

The implementation requires a **Phase 0 refactor** to extract the annotation engine from `TurnCard` into a surface-agnostic adapter layer before any document-specific work begins. The spec incorporates findings from three independent research passes across the full codebase, two adversarial reviews, library evaluations with current (March 2026) version data, and security analysis.

This document is **fully self-contained**. A developer starting a new session can implement from this spec without additional research.

---

## Table of Contents

1. [Current System Architecture](#1-current-system-architecture)
2. [Problem Statement](#2-problem-statement)
3. [Architecture: Annotation Surface Adapter](#3-architecture-annotation-surface-adapter)
4. [Phase 0: Annotation Surface Refactor](#4-phase-0-annotation-surface-refactor)
5. [Phase 1: PDF Text Selection](#5-phase-1-pdf-text-selection)
6. [Phase 2: HTML Preview Annotation](#6-phase-2-html-preview-annotation)
7. [Phase 3: DOCX Rich Display with Annotation](#7-phase-3-docx-rich-display-with-annotation)
8. [Phase 4: PPTX Annotation (Research Only)](#8-phase-4-pptx-annotation-research-only)
9. [Feature: Persistent Highlights](#9-feature-persistent-highlights)
10. [Feature: Copy as Quote](#10-feature-copy-as-quote)
11. [Feature: Quick AI Actions (Fast-Follow)](#11-feature-quick-ai-actions-fast-follow)
12. [Security Hardening](#12-security-hardening)
13. [Data Model Changes](#13-data-model-changes)
14. [Issue Catalog](#14-issue-catalog)
15. [Risk Register](#15-risk-register)
16. [Testing Strategy](#16-testing-strategy)
17. [Files Changed — Complete Manifest](#17-files-changed-complete-manifest)
18. [Library Versions and Dependencies](#18-library-versions-and-dependencies)
19. [Open Questions](#19-open-questions)
20. [References](#20-references)

---

## 1. Current System Architecture

### 1.1 Annotation Follow-Up System

The annotation system lets users select text in assistant responses, attach follow-up questions via a floating popup ("Island"), and send them to the LLM with context. It currently only works on markdown-rendered text.

#### Core Data Types

**`packages/core/src/types/message.ts`:**

```typescript
interface AnnotationV1 {
  id: string;
  schemaVersion: 1;
  createdAt: number;
  body: AnnotationBody[];          // Contains follow-up note text
  target: AnnotationTarget;        // text-position + text-quote selectors
  intent?: AnnotationIntent;       // 'highlight' | 'comment' | 'question' (ALREADY EXISTS)
  status?: AnnotationStatus;
  style?: { color?: string; opacity?: number; };  // color support EXISTS
  meta?: Record<string, unknown>;  // pendingFollowUp/sentFollowUp flags
}

// Selector types (ALREADY dual-selector):
// - text-position: { start, end }
// - text-quote: { exact, prefix, suffix }
// - xywh: { unit, x, y, w, h, page?, rotation? }  // page-aware region EXISTS in schema
```

**Key finding:** The schema already supports `highlight` intent, `highlight` body type, color styles, and page-aware `xywh` selectors. These are defined but NOT actively used in the follow-up flow.

**Key finding:** Annotation creation already stores BOTH `text-position` AND `text-quote` selectors (`annotation-core.ts:32-110`). The plan to "switch to text-quote" is already half-done.

#### Selection Capture Flow

```
User selects text in TurnCard
  → window.getSelection() captured
  → DOM Range resolved against contentLayerRef root
  → collectTextSegments() walks DOM text nodes
  → resolveNodeOffset() computes character offsets
  → TextAnnotationSelection created: { start, end, selectedText, prefix, suffix }
  → Island popup anchored at selection rects
  → User types follow-up question
  → AnnotationV1 created with text-position + text-quote selectors
  → On send: formatFollowUpSection() assembles markdown, appended to user message
```

#### The TurnCard Problem

`TurnCard` (`packages/ui/src/components/chat/TurnCard.tsx`, ~2300 lines) owns FAR too much annotation logic:

| Responsibility | Lines | Should Stay in TurnCard? |
|---|---|---|
| Pending preview annotation injection | 1770-1785 | No — surface concern |
| Overlay recompute lifecycle | 1799-1841 | No — surface concern |
| Selection-change dismissal | 1858-1899 | Partially — Island orchestration stays |
| Annotation save/update/delete | 1914-1997 | Yes — product CRUD |
| Selection capture, offset computation | 2105-2204 | No — surface concern |
| Block annotation gesture handling | 2224-2268 | No — surface concern |
| Document-level mouseup fallback | 2280-2310 | No — surface concern |
| Highlight DOM mutation (clearAnnotationMarks, applyTextHighlightRange) | 1467-1618 | No — surface concern |

**Critical:** The annotation helpers that assume a single DOM root:

| Helper | File | Assumption |
|---|---|---|
| `collectTextSegments()` | `annotation-core.ts:113-224` | Single HTMLElement root with real DOM text nodes |
| `getCanonicalText()` | `annotation-core.ts` | Flattened text from one root |
| `resolveNodeOffset()` | `annotation-core.ts` | Offsets computed against one root |
| `resolveRangeFromOffsets()` | `annotation-core.ts` | Range reconstituted from one root |
| `getClientRectsForOffsets()` | `annotation-core.ts` | Client rects from one root |
| `restoreDomSelectionFromOffsets()` | `selection-restore.ts:8-49` | DOM selection in one root |
| `scheduleDomSelectionRestore()` | `selection-restore.ts` | Same |
| `computeAnnotationOverlayGeometry()` | `annotation-overlay-geometry.ts:23-100` | Single root for geometry |
| `hasExistingTextRangeAnnotation()` | `annotation-core.ts:18-30` | Checks exact start/end pairs ONLY |

**Critical:** `annotation-resolver.ts` is in `packages/ui/src/components/markdown/`, NOT in `annotations/`. It's imported by `annotation-overlay-geometry.ts:1-12`.

#### Follow-Up Assembly

`extractAnnotationSelectedText()` (`follow-up-helpers.ts:12-29`) prefers `text-quote.exact`, falls back to slicing assistant message content by `text-position`. `formatFollowUpSection()` (`ChatDisplay.tsx:229-247`) interpolates raw quote text and notes into markdown with NO escaping.

`PendingFollowUpAnnotation` (`ChatDisplay.tsx:213-221`) only has: `messageId`, `annotationId`, `note`, `selectedText`, `createdAt`, `color`, `meta`. NOT enough for document context.

### 1.2 Document Rendering

#### File Type Classification

`packages/shared/src/utils/files.ts` classifies into: `'image' | 'text' | 'pdf' | 'office' | 'unknown'`

**Office extensions:** `.docx`, `.xlsx`, `.pptx`, `.doc`, `.xls`, `.ppt`

#### Attachment Pipeline

1. Frontend reads file as `FileAttachment` (`FreeFormInput.tsx`)
2. `STORE_ATTACHMENT` handler (`packages/server-core/src/handlers/rpc/files.ts`) saves to session attachments dir
3. Office files converted to markdown via `markitdown-js` (v0.0.14). If conversion fails, attachment rejected.
4. Agent receives path to `.md` file via Read tool. Original binary preserved.

#### Rich Block Rendering

`Markdown.tsx` dispatches by code fence language:

| Code fence | Component | Method |
|---|---|---|
| `pdf-preview` | `MarkdownPdfBlock.tsx` | react-pdf (pdfjs-dist), canvas rendering |
| `html-preview` | `MarkdownHtmlBlock.tsx` | Sandboxed iframe, `srcDoc` injection |
| `image-preview` | `MarkdownImageBlock.tsx` | `<img>` with data URL |
| `datatable` | `MarkdownDatatableBlock.tsx` | Interactive sortable table |
| `spreadsheet` | `MarkdownSpreadsheetBlock.tsx` | Excel-style grid |
| `mermaid` | `MarkdownMermaidBlock.tsx` | Mermaid.js SVG |
| `diff` | `MarkdownDiffBlock.tsx` | Color-coded diff |
| `latex` | `MarkdownLatexBlock.tsx` | KaTeX |
| `json` | `MarkdownJsonBlock.tsx` | Formatted JSON |

#### PDF Rendering Details

- **Inline:** `MarkdownPdfBlock.tsx:205-210` — text layer DISABLED, 500px width, 400px max-height with fade
- **Fullscreen:** `PDFPreviewOverlay.tsx:147-155` — text layer ENABLED, annotation layer ENABLED, full page navigation
- All pages rendered at once: `Array.from({ length: numPages }, ...)`
- PDF loaded as `Uint8Array` via IPC `READ_BINARY` handler

#### HTML Rendering Details

- Content loaded via IPC, `<base target="_top">` injected
- Rendered via `srcDoc` (NOT file-backed `src` as previously stated)
- `sandbox="allow-same-origin allow-top-navigation-by-user-activation"` — NO scripts
- Multiple items use CSS visibility toggling (hidden iframe caching) to prevent flash
- `MarkdownHtmlBlock.tsx:23-29, 133-159, 207-226`

#### File Link Preview

`file-classification.ts:10-16, 84-96` maps to `FilePreviewType = 'image' | 'code' | 'markdown' | 'json' | 'text' | 'pdf'`. Office files have NO in-app preview — open in system default app.

#### CLI Tools

Bundled Python scripts in `apps/electron/resources/bin/`, run via `uv`:
- `markitdown_cli.py` — universal doc-to-markdown (with DOCX fallback via python-docx)
- `pdf_tool.py` — extract, merge, split, rotate, convert (includes PDF→DOCX, PDF→PPTX)
- `docx_tool.py` — create/edit Word docs (python-docx >= 1.2)
- `xlsx_tool.py` — read/write Excel
- `pptx_tool.py` — inspect PowerPoint (python-pptx >= 1.0, has `info`/`extract` commands)
- `doc_diff.py` — cross-format document comparison
- `img_tool.py` — resize, convert, metadata

### 1.3 Electron Security Posture

`apps/electron/src/main/window-manager.ts:165-170`:

```
contextIsolation: true
nodeIntegration: false
sandbox: false          ← DELIBERATELY opted out (likely preload/runtime dependency)
webviewTag: false
```

The renderer is NOT OS-sandboxed. This is a deliberate choice, not an accident. Enabling `sandbox: true` would likely break the preload stack and is OUT OF SCOPE for this project.

### 1.4 Existing Design Language

- Tailwind CSS v4 + shadcn/ui components
- Island popup: `compact` mode (single "Follow up" button) and `confirm-follow-up` mode (textarea + submit)
- Room for ONE more primary action or an overflow trigger without redesign
- Craft.do parent product: lightweight text styling, highlights as first-class, comments as block-level collaboration

---

## 2. Problem Statement

The annotation follow-up system cannot reach into:
1. **PDF canvas renders** — opaque to DOM selection
2. **Sandboxed HTML iframes** — `window.getSelection()` doesn't cross iframe boundaries
3. **Office documents** — no visual rendering; shown as lossy flat markdown

Additionally, the annotation engine is hardwired to a single DOM root + character offset model, making it impossible to add new surfaces without major refactoring.

---

## 3. Architecture: Annotation Surface Adapter

### Why Adapter Pattern, Not Unified Viewer

Each document type has fundamentally different rendering: PDFs use canvas + text layer, DOCX uses HTML, HTML uses iframes, spreadsheets use grids. A unified viewer would be a leaky abstraction. Instead, each viewer implements a shared `AnnotationSurface` interface.

### The Interface

```typescript
interface AnnotationSurface {
  /** Surface type identifier */
  readonly kind: 'markdown' | 'html' | 'pdf' | 'docx' | 'pptx';

  /** Capture current user selection, or null if none */
  captureSelection(): SurfaceSelection | null;

  /** Restore a previously captured selection (for cancel-restore UX) */
  restoreSelection(sel: SurfaceSelection): void;

  /** Get DOM rects for a selection (for Island anchoring + overlay painting) */
  getSelectionRects(sel: SurfaceSelection): DOMRect[];

  /** Resolve a stored annotation back to a visual position */
  resolveAnnotation(annotation: AnnotationV1): ResolvedAnnotation | null;

  /** Get follow-up context for LLM — NO LLM call, deterministic extraction */
  getFollowUpContext(sel: SurfaceSelection): FollowUpContext;

  /** Paint/update rendered annotations (highlights, chips) */
  setRenderedAnnotations(annotations: AnnotationV1[]): void;

  /** Watch for geometry invalidation (scroll, zoom, resize, rerender) */
  observeGeometryInvalidation(cb: () => void): () => void;
}

interface SurfaceSelection {
  /** The raw selected text */
  selectedText: string;
  /** Quote context for persistence */
  prefix: string;
  suffix: string;
  /** Surface-specific scope */
  scope: SelectionScope;
}

type SelectionScope =
  | { kind: 'markdown'; start: number; end: number }
  | { kind: 'pdf'; pageNumber: number; itemRunHash?: string }
  | { kind: 'docx'; pageNumber?: number; sectionPath?: string[] }
  | { kind: 'html'; cssSelector?: string }  // cssSelector is informational metadata only, NOT used for re-resolution (too fragile). Re-resolution uses text-quote.
  | { kind: 'pptx'; slideNumber: number };

interface FollowUpContext {
  fileName?: string;
  pageOrSlide?: number;
  sectionHeading?: string;
  surroundingText: string;  // ±500 chars around selection
  documentType: string;
}

interface ResolvedAnnotation {
  rects: DOMRect[];
  isValid: boolean;
  /** If resolution failed, reason */
  failureReason?: 'quote-not-found' | 'page-missing' | 'surface-unavailable';
}
```

### Document Context Metadata

Stored in `annotation.meta.document` using a Zod-validated discriminated union:

```typescript
import { z } from 'zod';

const AnnotationDocumentMetaSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('markdown'), title: z.string().optional(), sectionPath: z.array(z.string()).optional() }),
  z.object({ kind: z.literal('pdf'), title: z.string().optional(), page: z.number(), pageLabel: z.string().optional() }),
  z.object({ kind: z.literal('docx'), title: z.string().optional(), page: z.number().optional(), sectionPath: z.array(z.string()).optional() }),
  z.object({ kind: z.literal('pptx'), title: z.string().optional(), slide: z.number(), slideTitle: z.string().optional() }),
  z.object({ kind: z.literal('html'), title: z.string().optional(), sectionPath: z.array(z.string()).optional() }),
]);

const AnnotationMetaSchema = z.object({
  document: AnnotationDocumentMetaSchema.optional(),
  contentFingerprint: z.string().optional(),
  attachmentId: z.string().optional(),
});
```

### Follow-Up Formatter Registry

Instead of a growing switch statement in `ChatDisplay`, use a small formatter registry:

```typescript
interface FollowUpFormatter {
  formatQuote(text: string, context: FollowUpContext): string;
  formatAttribution(context: FollowUpContext): string;
}

// ChatDisplay calls:
const formatter = getFormatter(annotation.meta?.document?.kind ?? 'markdown');
const formattedSection = formatter.formatQuote(selectedText, context)
  + '\n' + formatter.formatAttribution(context)
  + '\n' + userNote;
```

Each surface type registers its formatter. Markdown formatter preserves current behavior. PDF formatter adds page numbers. DOCX formatter adds section paths.

### Highlight Rendering Strategy

Three-tier fallback, chosen per surface:

1. **CSS Custom Highlight API** (preferred for markdown, HTML, DOCX DOM surfaces) — style `Range` objects without DOM mutation. Register highlights on `CSS.highlights` (or `iframe.contentWindow.CSS.highlights` for iframes). Supported in Electron 39+ (Chromium 142). See [MDN docs](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API).

2. **Overlay rectangles** (preferred for PDFs) — position absolute divs over the content. Already partially implemented in `annotation-overlay-geometry.ts`. Best for canvas-based renderers where DOM mutation is impossible.

3. **DOM wrapping (`<mark>`)** (last resort fallback) — only for simple DOM content where neither of the above works. Avoid for PDF text layers and complex HTML.

### Duplicate Detection

Current `hasExistingTextRangeAnnotation()` only checks exact `text-position` start/end pairs. This breaks for quote-based annotations. Replace with surface-aware strategy:

```typescript
function isDuplicateAnnotation(
  existing: AnnotationV1[],
  newSelection: SurfaceSelection,
  surfaceKind: string,
  sourceFile?: string
): boolean {
  return existing.some(ann => {
    const docMeta = ann.meta?.document as AnnotationDocumentMeta | undefined;
    if (docMeta?.kind !== surfaceKind) return false;
    // attachmentId lives on the outer meta, not meta.document
    if (sourceFile && ann.meta?.attachmentId !== sourceFile) return false;
    // Same page/slide scope — narrow by kind first for type safety
    if (docMeta.kind === 'pdf' && newSelection.scope.kind === 'pdf') {
      if (docMeta.page !== newSelection.scope.pageNumber) return false;
    } else if (docMeta.kind === 'pptx' && newSelection.scope.kind === 'pptx') {
      if (docMeta.slide !== newSelection.scope.slideNumber) return false;
    }
    // Normalized quote match
    const existingQuote = ann.target.selectors
      .find(s => s.type === 'text-quote')?.exact;
    return existingQuote && normalize(existingQuote) === normalize(newSelection.selectedText);
  });
}
```

### Annotation Scoping

Annotations are scoped by `sessionId + messageId + attachmentId`. Same document attached to multiple messages = separate annotation spaces. No accidental cross-message bleeding.

---

## 4. Phase 0: Annotation Surface Refactor

**Duration:** 3-4 weeks
**Goal:** Extract annotation logic from TurnCard into surface-agnostic adapters. Zero user-visible changes.

### What Gets Extracted

Create the `AnnotationSurface` interface and a `MarkdownAnnotationSurface` that wraps the existing DOM-root logic verbatim:

| Current Location | New Location | What Changes |
|---|---|---|
| `collectTextSegments()`, `resolveNodeOffset()`, etc. in `annotation-core.ts` | `MarkdownAnnotationSurface.captureSelection()` | Location change only |
| `restoreDomSelectionFromOffsets()` in `selection-restore.ts` | `MarkdownAnnotationSurface.restoreSelection()` | Location change only |
| `computeAnnotationOverlayGeometry()` in `annotation-overlay-geometry.ts` | `MarkdownAnnotationSurface.getSelectionRects()` / `resolveAnnotation()` | Location change only |
| `clearAnnotationMarks()` / `applyTextHighlightRange()` in `TurnCard.tsx:1467-1618` | `MarkdownAnnotationSurface.setRenderedAnnotations()` | Location change only |
| Selection capture in `TurnCard.tsx:2105-2204` | `MarkdownAnnotationSurface.captureSelection()` | Location change only |
| Overlay recompute in `TurnCard.tsx:1799-1841` | `MarkdownAnnotationSurface.observeGeometryInvalidation()` | Add scroll + ResizeObserver |

### What Stays in TurnCard

- Choosing/bootstrapping the right surface for rendered message content
- State machine (Island visibility, compact/confirm-follow-up transitions)
- Draft lifecycle (pending preview annotations, optimistic state)
- Annotation CRUD mutations (create/update/delete)
- Follow-up payload assembly and send integration
- Scoping annotations to current message/session

### New Files

| File | Purpose |
|---|---|
| `packages/ui/src/components/annotations/types.ts` | `AnnotationSurface`, `SurfaceSelection`, `FollowUpContext`, `ResolvedAnnotation` interfaces |
| `packages/ui/src/components/annotations/MarkdownAnnotationSurface.ts` | Wraps existing DOM-root logic |
| `packages/ui/src/components/annotations/surface-registry.ts` | Maps surface kind → surface factory |
| `packages/ui/src/components/annotations/duplicate-detection.ts` | Surface-aware duplicate checking |
| `packages/ui/src/components/annotations/follow-up-formatter-registry.ts` | Extensible formatters per surface |

### Files Modified

| File | Change |
|---|---|
| `TurnCard.tsx` | Remove ~600 lines of DOM-specific logic, delegate to surface |
| `annotation-core.ts` | Helpers become internal to MarkdownAnnotationSurface |
| `selection-restore.ts` | Becomes internal to MarkdownAnnotationSurface |
| `annotation-overlay-geometry.ts` | Becomes internal to MarkdownAnnotationSurface |
| `use-annotation-interaction-controller.ts` | Accept surface as parameter |
| `follow-up-helpers.ts` | Use formatter registry instead of direct text slicing |
| `ChatDisplay.tsx` | Use formatter registry for follow-up assembly |

### Scope Estimate

~8-10 existing files touched, ~4-6 new files, ~12-14 total artifacts. 3-4 engineer-weeks with regression coverage.

### Go/No-Go Criteria

- [ ] All existing annotation tests pass unchanged
- [ ] Markdown annotation flow behaviorally identical (create, edit, delete, follow-up send)
- [ ] Cancel-restore selection works identically
- [ ] Highlight rendering matches current behavior pixel-for-pixel
- [ ] No new dependencies added
- [ ] Performance: no measurable regression in annotation creation latency

### Verification

```bash
# Run existing annotation test suite
bun test packages/ui/src/components/annotations/
# Run TurnCard tests
bun test packages/ui/src/components/chat/TurnCard
# Manual: create annotation, edit it, cancel (verify restore), send follow-up, verify LLM receives correct text
```

---

## 5. Phase 1: PDF Text Selection

**Duration:** 4-6 weeks
**Scope:** Fullscreen PDF overlay ONLY (not inline 500px preview)
**Depends on:** Phase 0

### Why Fullscreen Only

The inline preview renders at 500px width where pdfjs text layer has severe misalignment with the canvas render. The fullscreen overlay renders at natural page width with significantly better alignment. The fullscreen overlay ALREADY enables text and annotation layers (`PDFPreviewOverlay.tsx:147-155`). Starting with fullscreen limits blast radius.

**UX for inline preview:** Add a subtle indicator on the inline preview: "Open fullscreen to annotate" (tooltip on hover). This prevents user confusion about why annotation works in one mode but not the other.

### Implementation: Hybrid Selection Strategy

Use the DOM text layer for interactive selection. Use `page.getTextContent()` for persistence and context:

1. **User selection happens on the existing fullscreen text layer DOM spans.** The browser handles selection natively. This is already working since the text layer is enabled in fullscreen.

2. **On selection capture:** `PdfAnnotationSurface.captureSelection()` reads `window.getSelection()` within the PDF overlay, extracts `selectedText`, and then calls `page.getTextContent()` to:
   - Compute prefix/suffix from structured text items
   - Determine page number from the selected page container
   - Extract surrounding text for `FollowUpContext`
   - Detect headings via font-size heuristics (items > 1.3x median size)

3. **For persistence:** Store `text-quote` as primary selector with `scope: { kind: 'pdf', pageNumber }`. Add optional `xywh` fallback using the existing `xywh.page` selector type.

4. **For re-resolution:** `PdfAnnotationSurface.resolveAnnotation()` uses `getTextContent()` to find the quote on the specified page, then maps to viewport coordinates via `page.getViewport()`. Fall back to text layer DOM span matching if `getTextContent()` matching fails.

5. **For highlights:** Use overlay rectangles (tier 2), not DOM mutation or CSS Custom Highlight. The PDF text layer span structure is too fragile for either.

### Selector Strengthening

`text-quote` + `prefix/suffix` + `pageNumber` can be ambiguous (repeated headers/footers, table labels). Add:

```typescript
// Enhanced PDF selector
{
  type: 'text-quote',
  exact: 'the selected text',
  prefix: '50 chars before...',
  suffix: '50 chars after...',
}
// Plus in scope:
{
  kind: 'pdf',
  pageNumber: 3,
  itemRunHash: 'a1b2c3',  // hash of surrounding text items for disambiguation
}
// Plus optional fallback:
{
  type: 'xywh',
  x: 0.12, y: 0.34, w: 0.56, h: 0.02,
  unit: 'percent',
  page: 3
}
```

### Edge Cases

| Case | Behavior |
|---|---|
| Scanned PDF (no text layer) | Detect empty `getTextContent()` result PER PAGE. Show subtle badge: "Text selection unavailable for this page" |
| Mixed scanned/digital PDF | Per-page detection, not per-document |
| Cross-page selection | Cancel selection. Show toast: "Select text within a single page" |
| Password-protected PDF | react-pdf handles this with a password prompt. Annotation disabled until unlocked |
| Corrupted/malformed PDF | react-pdf error state. Annotation not available. Show error message |
| Large PDF (100+ pages) | Lazy `getTextContent()` — per-page, with adjacent page prefetch. Never across whole document. Annotation computation only for visible pages. |
| Repeated text on same page | `itemRunHash` + optional `xywh` disambiguate |
| RTL text | Document as known limitation. Test with Arabic/Hebrew corpus |

### `getTextContent()` Performance

`page.getTextContent()` is a **per-page API** on `PDFPageProxy`. On a 216-page PDF, naive full-document extraction is a documented performance problem. Architecture: lazy per-page extraction + page cache + prefetch adjacent pages. Never call across the whole document on the hot path.

### New Files

| File | Purpose |
|---|---|
| `packages/ui/src/components/annotations/PdfAnnotationSurface.ts` | Implements `AnnotationSurface` for PDF |
| `packages/ui/src/components/annotations/pdf-text-utils.ts` | `getTextContent()` wrappers, heading detection, context extraction |

### Files Modified

| File | Change |
|---|---|
| `PDFPreviewOverlay.tsx` | Wire `PdfAnnotationSurface`, add selection listeners, integrate Island |
| `surface-registry.ts` | Register PDF surface |
| `follow-up-formatter-registry.ts` | Add PDF formatter (includes page number in attribution) |

### Go/No-Go Criteria

- [ ] Text selection accuracy > 95% for digitally-created PDFs at default zoom
- [ ] Annotations persist across overlay close/reopen
- [ ] No visual regression in PDF rendering
- [ ] Performance: annotation overlay < 50ms for 20-page PDFs
- [ ] Scanned page detection works (no silent failures)
- [ ] Cross-page selection gracefully blocked with user feedback
- [ ] Repeated-text disambiguation works on financial reports

### Fallback

If text layer accuracy is unacceptable: "copy text and annotate" workflow. User copies text, pastes into annotation field. System records page number from scroll position.

---

## 6. Phase 2: HTML Preview Annotation

**Duration:** 2-3 weeks
**Scope:** Same-origin iframe annotation
**Depends on:** Phase 0

### Why HTML Before DOCX

- The iframe substrate already exists — no new parser needed
- Exercises the cross-document selection model before adding mammoth/docx-preview complexity
- Proves the same-origin iframe bridging pattern that DOCX will also use (since DOCX HTML renders in an iframe too)

### Scope: Both Inline and Fullscreen

Unlike PDF (where text layer misalignment restricts annotation to fullscreen), HTML preview iframes use real DOM text at all sizes. Annotation support is enabled in BOTH the inline `MarkdownHtmlBlock` and the fullscreen `HTMLPreviewOverlay`. The `HtmlAnnotationSurface` attaches to whichever iframe is currently active. `HTMLPreviewOverlay.tsx` changes: wire the surface, add Island integration, and attach selection listeners to the fullscreen iframe — the same pattern as inline but in the overlay container.

### Implementation

1. **Keep iframe sandbox.** No Shadow DOM. Current `sandbox="allow-same-origin allow-top-navigation-by-user-activation"` stays.

2. **Selection via `iframe.contentDocument.getSelection()`.** The `allow-same-origin` permission grants DOM access from the parent frame. Listen for `mouseup` on `iframe.contentDocument` and bridge to the parent annotation controller.

3. **Coordinate mapping (NOTE: must account for CSS transforms on iframe element — use `getComputedStyle()` to detect `transform: scale()` and adjust accordingly):**
   ```typescript
   const iframeRect = iframe.getBoundingClientRect();
   const selectionRects = rangeRects.map(rect => ({
     top: rect.top + iframeRect.top - iframe.contentDocument.documentElement.scrollTop,
     left: rect.left + iframeRect.left - iframe.contentDocument.documentElement.scrollLeft,
     width: rect.width,
     height: rect.height,
   }));
   ```

4. **Highlights:** Use **CSS Custom Highlight API** inside the iframe: register highlights on `iframe.contentWindow.CSS.highlights`. Fallback to overlay rectangles if Custom Highlight fails.

5. **Context extraction:** Traverse iframe DOM for surrounding text and nearest headings (`h1`-`h6`).

6. **Selection event bridging:** Listen for `mouseup` and `selectionchange` on `iframe.contentDocument`. Map events to parent coordinate space for Island anchoring.

### Edge Cases

| Case | Behavior |
|---|---|
| Selection across iframe boundary | Cancel — not possible in browser APIs |
| Iframe hidden/cached (tab switching) | Restore highlights via `setRenderedAnnotations()` when iframe becomes visible |
| Iframe scroll changes | `observeGeometryInvalidation()` watches iframe internal scroll |
| Long HTML document | Same virtual scrolling concerns as PDF |

### New Files

| File | Purpose |
|---|---|
| `packages/ui/src/components/annotations/HtmlAnnotationSurface.ts` | Implements `AnnotationSurface` for HTML iframes |
| `packages/ui/src/components/annotations/iframe-selection-bridge.ts` | Cross-iframe selection capture and coordinate mapping |

### Files Modified

| File | Change |
|---|---|
| `MarkdownHtmlBlock.tsx` | Add selection event bridging, integrate surface |
| `HTMLPreviewOverlay.tsx` | Wire `HtmlAnnotationSurface`, integrate Island |
| `surface-registry.ts` | Register HTML surface |
| `follow-up-formatter-registry.ts` | Add HTML formatter |

### Go/No-Go Criteria

- [ ] Selection works within sandboxed iframe without `allow-scripts`
- [ ] CSS Custom Highlight API works via `iframe.contentWindow.CSS.highlights`
- [ ] Highlights persist across iframe hide/show cycles
- [ ] Coordinate mapping accurate across scroll positions
- [ ] No security properties weakened

### Fallback

If cross-iframe selection is unreliable: "Copy selection" button copies iframe-selected text to annotation field, with file name as context.

---

## 7. Phase 3: DOCX Rich Display with Annotation

**Duration:** 4-5 weeks
**Scope:** Render DOCX as visual HTML, with annotation
**Depends on:** Phase 0 (for surface adapter), Phase 2 (for iframe annotation surface)

**Parallelization note:** This phase splits into two sub-phases:
- **Phase 3a (DOCX rendering pipeline):** `MarkdownDocxBlock`, `DocxPreviewOverlay`, docx-preview integration, DOMPurify sanitization, cache management. Depends only on Phase 0. Can start as soon as Phase 0 completes, in parallel with Phase 2.
- **Phase 3b (DOCX annotation):** `DocxAnnotationSurface`, wiring to Island, follow-up formatter. Depends on Phase 2 (reuses `HtmlAnnotationSurface` and `iframe-selection-bridge`).

### Library Decision: `docx-preview` over mammoth.js

**Decision: Use `docx-preview` (docxjs) as the primary DOCX viewer.**

Rationale:

| Criterion | `docx-preview` | mammoth.js |
|---|---|---|
| Visual fidelity | High — aims to reproduce Word layout | Low — intentionally semantic/clean |
| Headers/footers/page breaks | Supported | Not supported |
| Tables | Good fidelity | Basic |
| Images | Embedded, good fidelity | Data URIs, basic |
| Bundle size | ~72KB min / ~163KB unmin | ~200KB min |
| Stars/activity | ~1.9k stars, active March 2026 | ~6.2k stars, active March 2026 |
| License | Apache-2.0 | BSD-2-Clause |
| Current version | 0.3.7 | 1.12.0 |
| Renders into | Normal HTMLElement container (NOT iframe/canvas) | Normal HTML string |
| Text selectability | DOM-selectable (it's real HTML) | DOM-selectable |
| Annotation compatibility | Harder (page-layout DOM wrappers) but workable | Easier (clean semantic HTML) |

**Why not mammoth?** The product goal is "show me something that looks like my Word document." Mammoth intentionally does NOT preserve layout. Users who see a flat, unstyled version of their document will doubt the annotation target even if the quote is technically correct.

**Why not both?** Running two parsers creates selector drift: lists/numbering normalize differently, headers/footers exist in one DOM but not the other, text boxes/comments appear in different places. Too much reconciliation for v1.

**Why not DOCX → PDF conversion?** Loses semantic structure. Inherits PDF text-layer weirdness. The agent still has `docx_tool.py` for paragraph/table operations, but the user loses document-quality text selection.

**Fallback if docx-preview quality is insufficient:** Keep current behavior (open in system app) + add "Select text for follow-up" on the markitdown-js markdown output.

### Implementation

1. **Add `docx-preview` as renderer dependency.** Lazy-load only when DOCX preview is needed.

2. **Render in sandboxed iframe.** Even though `docx-preview` renders into a normal DOM container, put the output in an iframe for security isolation. This reuses the Phase 2 iframe annotation infrastructure.

3. **Sanitize output with DOMPurify** before injecting into iframe `srcDoc`:
   ```typescript
   import DOMPurify from 'dompurify';
   // After docx-preview renders into a temporary container:
   const rawHtml = container.innerHTML;
   const cleanHtml = DOMPurify.sanitize(rawHtml, {
     ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'strong', 'em',
                     'u', 's', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tr', 'th',
                     'td', 'img', 'a', 'blockquote', 'pre', 'code', 'sup', 'sub', 'span',
                     'div', 'section', 'header', 'footer', 'figure', 'figcaption'],
     ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'colspan', 'rowspan', 'style'],
     FORBID_TAGS: ['form', 'iframe', 'object', 'embed', 'meta', 'link', 'script', 'style'],
     ALLOW_DATA_ATTR: false,
     ALLOW_UNKNOWN_PROTOCOLS: false,
   });
   // IMPORTANT: The `style` attribute is allowed for layout fidelity but must be
   // further sanitized to prevent CSS-based attacks. Add a DOMPurify hook to strip
   // dangerous CSS properties (position:absolute/fixed, z-index, background-image with url()):
   DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
     if (data.attrName === 'style') {
       data.attrValue = data.attrValue
         .replace(/position\s*:\s*(absolute|fixed)/gi, '')
         .replace(/z-index\s*:/gi, '')
         .replace(/background(-image)?\s*:.*url\s*\(/gi, 'background:none;/*sanitized*/');
     }
   });
   ```

4. **Add iframe-level CSP** via `<meta>` in `srcDoc`:
   ```html
   <meta http-equiv="Content-Security-Policy"
     content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none';">
   ```

5. **Create `DocxAnnotationSurface`** — reuses `HtmlAnnotationSurface` from Phase 2 since the DOCX HTML is rendered in an iframe. May need docx-specific context extraction (section headings from the document structure).

6. **Cache strategy:** Content fingerprint at attachment ingest (hash of first 4KB + file size + filename). NOT full-file hash. Invalidate when `docx_tool.py` modifies the document (track via modification events from file watcher or IPC).

7. **Create `MarkdownDocxBlock` component** and `docx-preview` code fence handler:
   ```
   ```docx-preview
   { "src": "/path/to/file.docx", "title": "Quarterly Report" }
   ```
   ```

8. **Keep markitdown-js path for agent.** Agent still receives markdown via Read tool. `docx-preview` HTML is display-only.

### Large Images / Memory

`docx-preview` may embed images as data URIs in the output. For long documents with many images, this creates huge HTML strings. Mitigations:
- Set a size limit on rendered HTML (e.g., 10MB)
- For documents exceeding limit, show first N pages + "Open full document" button
- Consider running `docx-preview` in an Electron `utilityProcess` to keep parsing out of the renderer

### Legacy `.doc` Format

`docx-preview` only handles `.docx` (Open XML). Legacy `.doc` (binary format) continues using current behavior: markitdown-js markdown display + system app open.

### New Files

| File | Purpose |
|---|---|
| `packages/ui/src/components/markdown/MarkdownDocxBlock.tsx` | DOCX preview component |
| `packages/ui/src/components/overlay/DocxPreviewOverlay.tsx` | Fullscreen DOCX viewer |
| `packages/ui/src/components/annotations/DocxAnnotationSurface.ts` | Extends HtmlAnnotationSurface with DOCX-specific context |

### Files Modified

| File | Change |
|---|---|
| `Markdown.tsx` | Add `docx-preview` code fence handler |
| `file-classification.ts` | Add DOCX to `FilePreviewType` for in-app preview |
| `files.ts` (server-core) | Generate docx-preview HTML alongside markitdown markdown; cache management |
| `surface-registry.ts` | Register DOCX surface |
| `follow-up-formatter-registry.ts` | Add DOCX formatter (section path in attribution) |
| `package.json` (ui) | Add `docx-preview`, `dompurify` |

### Go/No-Go Criteria

- [ ] docx-preview renders correctly for 90%+ of test corpus
- [ ] DOMPurify does not strip legitimate formatting
- [ ] Annotation selection works within iframe boundary
- [ ] No XSS via crafted `.docx` (test with evil-docs corpus)
- [ ] Bundle size increase < 250KB gzipped
- [ ] Cache coherence works when agent modifies document
- [ ] Legacy `.doc` gracefully falls back to current behavior

---

## 8. Phase 4: PPTX Annotation (Research Only)

**Duration:** Research phase only. No implementation commitment.

### Landscape Update (March 2026)

The "no maintained JS library" claim is outdated. Current candidates:

| Library | Stars | Version | License | Rendering | Text Selectable? | Status |
|---|---|---|---|---|---|---|
| `@aiden0z/pptx-renderer` | ~8 | 1.0.2 | Apache-2.0 | HTML/SVG DOM | Likely yes | **Best candidate** — clean, young, active |
| `pptx-preview` | ~109 | 1.0.7 | ISC (BUT conflicting claims) | DOM | Unknown | **Disqualified** — license ambiguity |
| `pptx-browser` | ? | 4.1.5 | MIT | Canvas | Likely no | **Research only** — opaque, no public repo health |
| `@docmentis/udoc-viewer` | ~13 | 0.6.13 | MIT + proprietary WASM | WASM | Unknown | **Bake-off wildcard** — heavy (11.8MB WASM), split license |

### Recommended Path

1. **Bake-off `@aiden0z/pptx-renderer`** — run 10 test decks through it (see test cases below)
2. **If it passes:** Implement Phase 4 using the same iframe + `AnnotationSurface` pattern
3. **If it fails:** PPTX → PDF conversion via LibreOffice headless, reuse PDF annotation path
4. **`@docmentis/udoc-viewer`** as wildcard — test it, but don't build architecture around it

### Bake-off Test Cases

1. Simple themed corporate deck
2. Table-heavy earnings slide
3. Chart + embedded image slide
4. SmartArt / org chart
5. Notes/comments extraction parity
6. Master/theme/background fidelity
7. Dense academic slide with references
8. 100+ slide performance
9. Text selection/copy fidelity
10. Extracted text parity vs `pptx_tool.py` output

---

## 9. Feature: Persistent Highlights

**Ships with:** Phase 0.5 — a separate mini-phase immediately after Phase 0 completes, before Phase 1 begins.
**Engineering effort:** Low once surface adapter exists
**Rationale for separate phase:** Phase 0's go/no-go criteria require "highlight rendering matches current behavior pixel-for-pixel." Adding new highlight/copy buttons changes the Island UI, which should be verified separately.

### Design

Users select text → Island shows two primary actions: **"Highlight"** and **"Follow up"**

- Highlight creates an `AnnotationV1` with `intent: 'highlight'` and empty `body`
- Uses existing `style.color` field for highlight color
- Persists across sessions (annotations already persist)
- Default: single preset color. Future: tiny preset palette (3-4 colors max)

### Schema Fit

The existing schema already has everything needed:
- `intent: 'highlight'` — already defined in `AnnotationIntent`
- `body` with `highlight` type — already defined in `AnnotationBody`
- `style.color` — already on `AnnotationV1`

### Island UI Change

The compact view gains one more button. Two-button layout:

```
┌─────────────────────────┐
│  ◉ Highlight  │ Follow up │
└─────────────────────────┘
```

This fits within the Island's current width. No overflow menu needed for two buttons.

### Implementation

- Modify `AnnotationIslandMenu.tsx` to show "Highlight" button in compact view
- On click: create annotation with `intent: 'highlight'`, skip the textarea view entirely
- Surface's `setRenderedAnnotations()` renders highlights using CSS Custom Highlight API (or overlay rects for PDF)
- Color defaults to a warm yellow. Configurable via `style.color` in future iteration.

---

## 10. Feature: Copy as Quote

**Ships with:** Phase 0.5 (same mini-phase as Persistent Highlights)
**Engineering effort:** Very low once `FollowUpContext` exists

### Design

Users select text → Island overflow menu (or third compact button if room) → **"Copy as quote"**

Copies to clipboard with attribution:

```
"Revenue increased 15% year-over-year driven primarily by enterprise expansion"

— quarterly_report.docx, Section "Financial Highlights", Page 3
```

Format: plain text + markdown. Uses the same `FollowUpContext` computed by the surface adapter.

### Implementation

- Add "Copy as quote" action to Island menu (compact overflow or third button)
- On click: build formatted quote string from `selectedText` + `FollowUpContext`
- Copy to clipboard via `navigator.clipboard.writeText()`
- Show brief toast confirmation: "Copied as quote"
- No annotation created (this is a clipboard action, not a persistence action)

---

## 11. Feature: Quick AI Actions (Fast-Follow)

**Ships with:** Fast-follow AFTER initial release
**Engineering effort:** Low-medium

### Design

Add "Explain" and "Summarize" as quick actions behind an overflow menu in the Island:

```
┌────────────────────────────────┐
│  ◉ Highlight  │  Follow up  │ ⋯ │
│                               ├───┤
│                               │ Explain     │
│                               │ Summarize   │
│                               │ Copy quote  │
└────────────────────────────────┘
```

These are shortcuts that auto-fill the follow-up textarea with canned prompts:
- "Explain" → "Explain this in simple terms: [selected text]"
- "Summarize" → "Summarize the key points: [selected text]"

Same annotation flow — just pre-populated notes. NOT user-configurable in v1.

---

## 12. Security Hardening

### Mandatory Requirements

| Requirement | Details |
|---|---|
| DOMPurify version | Pin `>= 3.2.7`, prefer current `3.3.3`. Monitor Snyk/CVE feeds. |
| DOMPurify config | Whitelist-based (ALLOWED_TAGS/ALLOWED_ATTR). Forbid `form`, `iframe`, `object`, `embed`, `meta`, `link`, `script`, `style`. |
| Trusted Types | Enable where possible as defense-in-depth. Chromium 142 supports it. |
| Iframe CSP | Add `<meta http-equiv="Content-Security-Policy">` to all `srcDoc` payloads. `default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none';` |
| Annotation text escaping | Escape markdown metacharacters in `formatFollowUpSection()`. Label as "untrusted quoted document text." Hard-cap quote length (2000 chars). Hard-cap `surroundingText` (1000 chars). Cap total assembled follow-up payload (4000 chars). |
| `sandbox: false` | OUT OF SCOPE for this project. Document as known risk. Do NOT attempt to enable without wider Electron compat pass. |
| DOCX parsing isolation | Consider Electron `utilityProcess` for docx-preview conversion. Renderer sends file path, utility returns sanitized HTML. Avoids untrusted ZIP parsing in renderer. |

### Prompt Injection Mitigation

Current `formatFollowUpSection()` interpolates raw selected text into markdown. A malicious document could contain text like `# SYSTEM: Ignore prior instructions.` that ends up in the prompt.

Mitigations:
1. Escape markdown in inserted quote text
2. Hard-cap quote length (e.g., 2000 chars)
3. Label explicitly: `[Quoted from document — untrusted user-selected text]`
4. Long-term: pass follow-up context as structured metadata, not ad-hoc markdown

---

## 13. Data Model Changes

### Extended `PendingFollowUpAnnotation`

```typescript
interface PendingFollowUpAnnotation {
  // Existing fields
  messageId: string;
  annotationId: string;
  note: string;
  selectedText: string;
  createdAt: number;
  color?: string;
  meta?: Record<string, unknown>;

  // New fields
  sourceType: 'markdown' | 'pdf' | 'docx' | 'html' | 'pptx';
  sourceFile?: string;
  pageOrSlide?: number;
  sectionHeading?: string;
  surroundingText?: string;
  quotePrefix?: string;
  quoteSuffix?: string;
  attachmentId?: string;
}
```

### `AnnotationV1.meta` Schema

Use Zod-validated `meta.document` (see Section 3). Keep `meta` as `Record<string, unknown>` at the type level for backward compatibility, but validate document metadata with Zod at creation time.

### Migration Strategy for Existing Annotations

Existing annotations created before this change will lack `sourceType`, `meta.document`, and extended `PendingFollowUpAnnotation` fields. Migration approach:

- **Lazy migration (on read):** When loading annotations, if `meta.document` is missing, default to `{ kind: 'markdown' }`. All Zod schemas use `.optional()` or `.default()` for new fields.
- **`sourceType` defaults to `'markdown'`** for any `PendingFollowUpAnnotation` missing this field.
- **No eager migration script needed.** Old annotations continue to work through the existing `text-position` + `text-quote` resolver, which is now wrapped by `MarkdownAnnotationSurface`.
- **No schema-breaking changes.** The `AnnotationV1` type is extended, not modified. All new fields are optional.

### Existing `xywh.page` Selector

Already defined in types: `{ type: 'xywh', unit, x, y, w, h, page?, rotation? }`. Currently NOT used in the active resolver path. Phase 1 activates it as a fallback selector for PDF annotations.

---

## 14. Issue Catalog

### BLOCKERS (resolved in this spec)

| ID | Issue | Resolution |
|---|---|---|
| B1 | Shadow DOM doesn't prevent script execution | Never proposed — spec uses iframe sandboxes throughout |
| B2 | Annotation offsets break on PDF text layer rerender | Hybrid: DOM text layer for selection, `getTextContent()` for persistence, `text-quote` primary |
| B3 | No sanitization on document-to-HTML output | DOMPurify mandatory, iframe sandbox as defense-in-depth |
| B4 | Annotation engine hardwired to single DOM root | Phase 0 refactor extracts into surface-agnostic adapters |

### HIGH (addressed)

| ID | Issue | Resolution |
|---|---|---|
| H1 | TurnCard owns too much annotation logic | Phase 0 extracts ~600 lines to surface adapters |
| H2 | pptx2html abandoned | Updated landscape assessment, `@aiden0z/pptx-renderer` as candidate |
| H3 | pdfjs text layer misaligns at small sizes | Fullscreen-only Phase 1 |
| H4 | Scanned PDFs no text layer | Per-page detection, user-visible indicator |
| H5 | Cross-page selection undefined | Gracefully blocked with toast |
| H6 | Existing annotations break on rendering change | Feature-flagged rollout, never change existing messages |
| H7 | visualContext implies LLM call | Deterministic extraction only |
| H8 | Dual-format cache coherence | Content fingerprint (first 4KB + size), not full hash |
| H9 | Duplicate detection breaks for quote-based | Surface-aware duplicate detection |
| H10 | Selection restore hardcoded to DOM offsets | Each surface owns its own restore logic |
| H11 | PendingFollowUpAnnotation too small | Extended with source type, page, section, etc. |
| H12 | Follow-up assembly assumes message text source | Formatter registry per surface |
| H13 | Overlay only invalidates on window resize | Add scroll, zoom, ResizeObserver per surface |
| H14 | Edit annotation recovers wrong quote for rich docs | Store quote in annotation meta, not derived from message |

### MEDIUM (mitigated)

| ID | Issue | Resolution |
|---|---|---|
| M1 | Spreadsheets not addressed | Out of scope — different selection semantics |
| M2 | Large documents performance | Lazy per-page computation, virtual scrolling |
| M3 | Mobile/touch selection | Out of scope — Electron desktop app |
| M4 | PDF copy-paste garbled | Use `getTextContent()` for clean text, not DOM spans |
| M5 | DOMPurify CVE history | Pin version >= 3.2.7, monitor, iframe as defense-in-depth |
| M6 | Hidden iframe caching memory pressure | Evict caches, cap iframe count |
| M7 | IPC payload growth | Keep annotation metadata compact |
| M8 | Mixed scanned/digital PDFs | Per-page detection, not per-document |

### LOW (documented)

| ID | Issue | Resolution |
|---|---|---|
| L1 | Legacy `.doc` not supported by docx-preview | Falls back to markitdown-js + system app |
| L2 | RTL text in PDF text layer | Known limitation, test corpus |
| L3 | Email files not covered | Out of scope |
| L4 | Print/export of chat with previews | Known limitation |
| L5 | Password-protected PDFs | react-pdf handles with prompt, annotation disabled until unlocked |

---

## 15. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Phase 0 refactor introduces subtle annotation regressions | High | High | Comprehensive regression test suite before starting Phase 1. Full manual QA pass. |
| PDF text layer drift at some zoom levels | High | High | Fullscreen-only, hybrid DOM + getTextContent(), overlay rects not DOM mutation |
| docx-preview output quality insufficient for user expectations | Medium | High | Test with 50+ real documents. Fallback: system app open + markitdown annotation |
| DOMPurify bypass vulnerability | Medium | Critical | Pin version, monitor CVEs, iframe sandbox as defense-in-depth, CSP |
| XSS through crafted .docx via docx-preview | Medium | Critical | DOMPurify whitelist + iframe sandbox + CSP |
| Large document renderer memory pressure | Medium | Medium | Size limits, lazy loading, utilityProcess for parsing |
| Existing annotations become unresolvable | High | Medium | Feature flags, never change rendering for existing messages |
| Cross-iframe coordinate mapping drift on scroll | Medium | Medium | observeGeometryInvalidation with iframe scroll listeners |
| Prompt injection via annotation text | High | Medium | Escape markdown, cap length, label as untrusted |
| Bundle size bloat | Medium | Low | Lazy-load docx-preview and DOMPurify |

---

## 16. Testing Strategy

### Phase 0 Regression Suite

- All existing annotation unit tests pass
- E2E: create markdown annotation → edit → cancel (verify restore) → delete
- E2E: create follow-up → send → verify LLM receives correct text
- E2E: multiple annotations on same message → verify numbering, chips, follow-up assembly
- Visual: highlight rendering matches current pixel-for-pixel
- Performance: annotation creation latency baseline (measure before, verify no regression after)

### Phase 1 PDF Tests

**Unit:** PdfAnnotationSurface with mock `getTextContent()` — single column, multi-column, tables, mixed languages
**Integration:** 10+ test PDFs: digital, scanned, rotated, forms, encrypted, large (100+), RTL, multi-column
**Visual:** Text layer alignment screenshots at default and 2x zoom
**Performance:** Overlay computation time for 5/20/50/100 page PDFs (< 50ms for 20 pages)
**Accessibility:** Screen reader with text layer

### Phase 2 HTML Tests

**Unit:** Cross-iframe selection mapping, coordinate transformation
**Security:** Sandbox preserved, no script execution
**Integration:** Annotation persistence across hide/show
**CSS Custom Highlight:** Verify works via `iframe.contentWindow.CSS.highlights`

### Phase 3 DOCX Tests

**Security:** Evil-docs corpus through docx-preview + DOMPurify. Zero script execution in iframe.
**Fidelity:** 50+ real .docx files, screenshot comparison, document formatting gaps
**Integration:** Annotation cycle through iframe boundary
**Cache:** Modify via CLI tool, verify HTML regenerates

### All Phases

**Regression:** Markdown annotation unchanged
**Migration:** Existing annotations resolve after upgrade
**E2E:** Full flow: open doc → select → highlight/follow-up → submit → agent receives context

---

## 17. Files Changed — Complete Manifest

### New Files (all phases)

| File | Phase | Purpose |
|---|---|---|
| `packages/ui/src/components/annotations/types.ts` | 0 | Core interfaces |
| `packages/ui/src/components/annotations/MarkdownAnnotationSurface.ts` | 0 | Markdown surface adapter |
| `packages/ui/src/components/annotations/surface-registry.ts` | 0 | Surface factory registry |
| `packages/ui/src/components/annotations/duplicate-detection.ts` | 0 | Surface-aware dedupe |
| `packages/ui/src/components/annotations/follow-up-formatter-registry.ts` | 0 | Extensible formatters |
| `packages/ui/src/components/annotations/PdfAnnotationSurface.ts` | 1 | PDF surface adapter |
| `packages/ui/src/components/annotations/pdf-text-utils.ts` | 1 | getTextContent wrappers |
| `packages/ui/src/components/annotations/HtmlAnnotationSurface.ts` | 2 | HTML iframe surface |
| `packages/ui/src/components/annotations/iframe-selection-bridge.ts` | 2 | Cross-iframe selection |
| `packages/ui/src/components/markdown/MarkdownDocxBlock.tsx` | 3 | DOCX preview component |
| `packages/ui/src/components/overlay/DocxPreviewOverlay.tsx` | 3 | Fullscreen DOCX viewer |
| `packages/ui/src/components/annotations/DocxAnnotationSurface.ts` | 3 | DOCX surface (extends HTML) |

### Modified Files (all phases)

| File | Phase | Change |
|---|---|---|
| `packages/ui/src/components/chat/TurnCard.tsx` | 0 | Remove ~600 lines, delegate to surface |
| `packages/ui/src/components/annotations/annotation-core.ts` | 0 | Internalize into MarkdownAnnotationSurface |
| `packages/ui/src/components/annotations/selection-restore.ts` | 0 | Internalize into MarkdownAnnotationSurface |
| `packages/ui/src/components/annotations/annotation-overlay-geometry.ts` | 0 | Internalize into surfaces |
| `packages/ui/src/components/annotations/use-annotation-interaction-controller.ts` | 0 | Accept surface param |
| `packages/ui/src/components/annotations/AnnotationIslandMenu.tsx` | 0.5 | Add Highlight button, Copy as Quote (separate mini-phase after Phase 0) |
| `packages/ui/src/components/chat/follow-up-helpers.ts` | 0 | Use formatter registry |
| `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` | 0 | Use formatter registry, extend PendingFollowUpAnnotation |
| `packages/ui/src/components/markdown/annotation-resolver.ts` | 0 | Surface-aware resolution |
| `packages/ui/src/components/overlay/PDFPreviewOverlay.tsx` | 1 | Wire PdfAnnotationSurface, Island |
| `packages/ui/src/components/markdown/MarkdownHtmlBlock.tsx` | 2 | Selection bridging, surface |
| `packages/ui/src/components/overlay/HTMLPreviewOverlay.tsx` | 2 | Wire HtmlAnnotationSurface, Island |
| `packages/ui/src/components/markdown/Markdown.tsx` | 3 | Add docx-preview handler |
| `packages/ui/src/lib/file-classification.ts` | 3 | Add DOCX preview type |
| `packages/server-core/src/handlers/rpc/files.ts` | 3 | docx-preview HTML gen + cache |
| `packages/core/src/types/message.ts` | 0 | Meta schema (Zod validation) |

---

## 18. Library Versions and Dependencies

### New Dependencies

| Library | Version | Phase | Bundle Size | Purpose |
|---|---|---|---|---|
| `docx-preview` | >= 0.3.7 | 3 | ~72KB min | DOCX → visual HTML |
| `dompurify` | >= 3.2.7 (prefer 3.3.3) | 3 | ~20KB min | HTML sanitization |

### Existing Dependencies (no changes)

| Library | Version | Notes |
|---|---|---|
| `react-pdf` | 10.4.1 | PDF rendering — already installed |
| `pdfjs-dist` | 5.5.207 | PDF engine — already installed |
| `markitdown-js` | 0.0.14 | Office → markdown — keep for agent text path |

### Electron Version

The project targets **Electron ^39.2.7** (Chromium 142). This version supports CSS Custom Highlight API, Trusted Types, and all other browser APIs referenced in this spec.

### NOT Adding

| Library | Reason |
|---|---|
| mammoth.js | Visual fidelity too low for display purposes |
| pptx2html | Abandoned (8+ years) |
| pptx-preview | License ambiguity |
| Tesseract.js | OCR too heavy (~5MB), scanned PDFs shown as unavailable instead |

---

## 19. Open Questions

1. **Spreadsheet annotation:** Should a future phase cover `.xlsx`? Cell-level selection differs fundamentally from text selection. May need separate design.

2. **Inline PDF annotation:** Should Phase 1 eventually extend to the 500px inline preview? Depends on future pdfjs text layer improvements.

3. **Annotation threading:** `threadRef` exists on `AnnotationV1` but is unused. Should rich doc annotations support threaded follow-up chains?

4. **Multi-document follow-ups:** If the agent's response has multiple docs, can the user select from two different documents in one follow-up?

5. **docx-preview in utilityProcess:** Should DOCX parsing happen in an Electron utilityProcess? Trade-off: safer but adds IPC complexity. Recommend starting in renderer, moving to utilityProcess if memory/security issues arise.

6. **PPTX bake-off timeline:** When should the `@aiden0z/pptx-renderer` bake-off happen? After Phase 1 ships, or in parallel?

7. **Annotation color palette:** For persistent highlights, should colors be preset (3-4 colors) or user-configurable? Recommendation: preset for v1.

---

## 20. References

### Codebase Files

- `packages/ui/src/components/chat/TurnCard.tsx` — main annotation orchestration
- `packages/ui/src/components/annotations/annotation-core.ts` — selection helpers
- `packages/ui/src/components/annotations/selection-restore.ts` — DOM selection restore
- `packages/ui/src/components/annotations/annotation-overlay-geometry.ts` — overlay rects
- `packages/ui/src/components/annotations/interaction-state-machine.ts` — Island state machine
- `packages/ui/src/components/annotations/AnnotationIslandMenu.tsx` — Island UI
- `packages/ui/src/components/annotations/AnnotationOverlayLayer.tsx` — highlight rendering
- `packages/ui/src/components/markdown/annotation-resolver.ts` — quote/offset resolution
- `packages/ui/src/components/chat/follow-up-helpers.ts` — follow-up text extraction
- `packages/core/src/types/message.ts` — AnnotationV1 types
- `packages/ui/src/components/markdown/MarkdownPdfBlock.tsx` — inline PDF
- `packages/ui/src/components/overlay/PDFPreviewOverlay.tsx` — fullscreen PDF
- `packages/ui/src/components/markdown/MarkdownHtmlBlock.tsx` — HTML preview
- `packages/ui/src/components/overlay/HTMLPreviewOverlay.tsx` — fullscreen HTML
- `packages/server-core/src/handlers/rpc/files.ts` — attachment handler
- `packages/shared/src/utils/files.ts` — file classification
- `packages/ui/src/lib/file-classification.ts` — preview type mapping
- `apps/electron/src/main/window-manager.ts` — Electron security config
- `apps/electron/resources/bin/` — CLI tools

### External Libraries

- docx-preview: https://github.com/VolodymyrBaydalka/docxjs (Apache-2.0, v0.3.7)
- DOMPurify: https://github.com/cure53/DOMPurify (v3.3.3)
- pdfjs-dist: https://www.npmjs.com/package/pdfjs-dist (v5.5.207)
- react-pdf: https://www.npmjs.com/package/react-pdf (v10.4.1)
- @aiden0z/pptx-renderer: https://github.com/aiden0z/pptx-renderer (Apache-2.0, v1.0.2)
- CSS Custom Highlight API: https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API

### Security References

- DOMPurify CVE-2025-26791: https://nvd.nist.gov/vuln/detail/CVE-2025-26791
- DOMPurify CVE-2025-15599: https://nvd.nist.gov/vuln/detail/CVE-2025-15599
- Electron sandbox docs: https://electronjs.org/docs/latest/api/structures/web-preferences
- Electron utilityProcess: https://electronjs.org/docs/latest/api/utility-process
- Trusted Types API: https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API

### PDF.js Issues

- Text selection misalignment #14969 (closed): https://github.com/mozilla/pdf.js/issues/14969
- Span positioning bug #20017 (open, June 2025): https://github.com/mozilla/pdf.js/issues/20017
- PDF.js text layer docs: https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html
