# Droid Mission: Implement Rich Document Annotation System for Craft Agents

## Mission Overview

Implement the Rich Document Annotation System as specified in the attached spec (`craft-agents-rich-document-annotation-spec-v2.md`). This extends the annotation follow-up popup ("Island") to work with PDF, Word (.docx), and HTML documents — not just markdown text. It also adds persistent highlights and "Copy as quote" features.

## Repository

- **Location:** `~/LocalDev/craft-agents-oss/`
- **Fork of:** `lukilabs/craft-agents-oss`
- **Tech stack:** Bun runtime, Electron + React, shadcn/ui + Tailwind CSS v4, TypeScript, esbuild + Vite

## Implementation Order (STRICT — do not reorder)

### Phase 0: Annotation Surface Refactor (MUST DO FIRST)

**Goal:** Extract annotation logic from `TurnCard` into surface-agnostic adapters. Zero user-visible changes.

**Key constraint:** The existing markdown annotation flow MUST remain behaviorally identical after this refactor. All existing tests must pass. This is a pure refactor — no new features.

**Steps:**

1. Read and understand these files thoroughly before writing any code:
   - `packages/ui/src/components/chat/TurnCard.tsx` (especially lines 1467-1618, 1770-1841, 1858-1899, 1914-1997, 2105-2310)
   - `packages/ui/src/components/annotations/annotation-core.ts`
   - `packages/ui/src/components/annotations/selection-restore.ts`
   - `packages/ui/src/components/annotations/annotation-overlay-geometry.ts`
   - `packages/ui/src/components/annotations/interaction-state-machine.ts`
   - `packages/ui/src/components/annotations/use-annotation-interaction-controller.ts`
   - `packages/ui/src/components/markdown/annotation-resolver.ts` (NOTE: in /markdown/, not /annotations/)
   - `packages/ui/src/components/chat/follow-up-helpers.ts`
   - `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` (lines 213-247, 1234-1261, 1403-1445)
   - `packages/core/src/types/message.ts` (AnnotationV1 types, lines 155-227)

2. Create the core interfaces in `packages/ui/src/components/annotations/types.ts`:
   - `AnnotationSurface` interface (see spec Section 3)
   - `SurfaceSelection`, `SelectionScope`, `FollowUpContext`, `ResolvedAnnotation` types
   - `AnnotationDocumentMeta` Zod schema

3. Create `MarkdownAnnotationSurface.ts` — wrap existing DOM-root logic:
   - `captureSelection()` wraps `collectTextSegments()`, `resolveNodeOffset()`, window.getSelection()
   - `restoreSelection()` wraps `restoreDomSelectionFromOffsets()`
   - `getSelectionRects()` wraps `getClientRectsForOffsets()`
   - `resolveAnnotation()` wraps annotation-resolver.ts logic
   - `getFollowUpContext()` extracts surrounding text from the markdown DOM
   - `setRenderedAnnotations()` wraps `clearAnnotationMarks()`/`applyTextHighlightRange()`
   - `observeGeometryInvalidation()` wraps resize listener + adds scroll and ResizeObserver

4. Create `surface-registry.ts` — factory that maps surface kind to surface instance

5. Create `duplicate-detection.ts` — surface-aware duplicate checking (see spec Section 3)

6. Create `follow-up-formatter-registry.ts` — extensible formatters per surface type

7. Refactor `TurnCard.tsx`:
   - Remove ~600 lines of DOM-specific annotation logic
   - Delegate to surface via registry
   - Keep: state machine, Island orchestration, annotation CRUD, draft lifecycle, send integration

8. Update `use-annotation-interaction-controller.ts` to accept surface as parameter

9. Update `follow-up-helpers.ts` to use formatter registry

10. Update `ChatDisplay.tsx` to use formatter registry and extended `PendingFollowUpAnnotation`

**Verification:**
```bash
bun test packages/ui/src/components/annotations/
bun test packages/ui/src/components/chat/
```
Manual: create annotation → edit → cancel (verify selection restore) → send follow-up → verify format

### Phase 0.5: Persistent Highlights + Copy as Quote

**Goal:** Add Highlight button and Copy as Quote to the Island popup. Ships after Phase 0, before Phase 1.

**Steps:**

1. Add "Highlight" button to `AnnotationIslandMenu.tsx` compact view (two-button layout: Highlight | Follow up)
2. On Highlight click: create `AnnotationV1` with `intent: 'highlight'`, empty body, default warm yellow color via `style.color`
3. Add "Copy as quote" action to Island overflow menu
4. On Copy click: build formatted quote string from `selectedText` + `FollowUpContext`, copy to clipboard, show toast
5. Verify highlights persist across session reload
6. Verify existing follow-up flow unchanged

### Phase 1: PDF Text Selection

**Goal:** Enable annotation in fullscreen PDF overlay only.

**Steps:**

1. Read `packages/ui/src/components/overlay/PDFPreviewOverlay.tsx` — note the text layer is ALREADY enabled (lines 147-155)

2. Create `PdfAnnotationSurface.ts`:
   - `captureSelection()`: read selection from PDF text layer DOM, then call `page.getTextContent()` for stable text
   - `restoreSelection()`: find quote in getTextContent() items, highlight via overlay rects
   - `getSelectionRects()`: use text layer span rects for immediate geometry
   - `resolveAnnotation()`: use getTextContent() to find quote on page, map to viewport via page.getViewport()
   - `getFollowUpContext()`: extract ±500 chars from getTextContent(), detect headings via font-size heuristics
   - `setRenderedAnnotations()`: overlay rectangles (NOT DOM mutation, NOT CSS Custom Highlight)
   - `observeGeometryInvalidation()`: watch overlay scroll, zoom changes

3. Create `pdf-text-utils.ts`: getTextContent() wrappers, heading detection, context extraction

4. Wire into `PDFPreviewOverlay.tsx`: integrate surface, add Island, add selection listeners

5. Handle edge cases:
   - Scanned pages: detect empty getTextContent(), show "Text selection unavailable" per page
   - Cross-page selection: cancel with toast
   - Repeated text: use itemRunHash + optional xywh selector

6. Register PDF surface and formatter

7. Add "Open fullscreen to annotate" tooltip on inline `MarkdownPdfBlock`

### Phase 2: HTML Preview Annotation

**Goal:** Enable annotation within iframe-based HTML previews.

**Steps:**

1. Read `packages/ui/src/components/markdown/MarkdownHtmlBlock.tsx` and `HTMLPreviewOverlay.tsx`

2. Create `iframe-selection-bridge.ts`: selection capture via `iframe.contentDocument.getSelection()`, coordinate mapping, event bridging

3. Create `HtmlAnnotationSurface.ts`:
   - Uses iframe-selection-bridge for all selection operations
   - Highlights via CSS Custom Highlight API on `iframe.contentWindow.CSS.highlights`
   - Fallback: overlay rectangles if Custom Highlight unavailable
   - Context extraction by traversing iframe DOM

4. Wire into `MarkdownHtmlBlock.tsx` and `HTMLPreviewOverlay.tsx`

5. Register HTML surface and formatter

### Phase 3: DOCX Rich Display

**Goal:** Render DOCX as visual HTML with annotation support.

**Steps:**

1. Install dependencies: `bun add docx-preview dompurify`

2. Create `MarkdownDocxBlock.tsx`:
   - Parse `docx-preview` code fence JSON spec
   - Load .docx via IPC READ_BINARY
   - Render via docx-preview's `renderAsync()` into temporary container
   - Sanitize output with DOMPurify (whitelist config from spec Section 7)
   - Inject iframe-level CSP meta tag
   - Render sanitized HTML in sandboxed iframe (same pattern as HTML preview)

3. Create `DocxPreviewOverlay.tsx` — fullscreen DOCX viewer

4. Create `DocxAnnotationSurface.ts` — extends HtmlAnnotationSurface with DOCX-specific context extraction

5. Add `docx-preview` code fence handler to `Markdown.tsx`

6. Add DOCX to `FilePreviewType` in `file-classification.ts`

7. Update `STORE_ATTACHMENT` handler in `files.ts` to generate docx-preview HTML alongside markitdown markdown

8. Register DOCX surface and formatter

9. Handle legacy `.doc`: falls back to current behavior (markitdown + system app)

## Key Technical Details

### Security Requirements (NON-NEGOTIABLE)

- DOMPurify >= 3.2.7 with ALLOWED_TAGS whitelist (see spec Section 12)
- Iframe sandbox on ALL document HTML: `sandbox="allow-same-origin"`
- CSP meta tag in all srcDoc payloads
- Escape markdown metacharacters in formatFollowUpSection()
- Never render unsanitized HTML in the renderer

### CSS Custom Highlight API Usage

```typescript
// For iframe-contained content (HTML, DOCX surfaces):
const highlights = iframe.contentWindow.CSS.highlights;
const range = iframe.contentDocument.createRange();
// ... set range to annotation target
const highlight = new iframe.contentWindow.Highlight(range);
highlights.set(`annotation-${annotationId}`, highlight);

// In iframe's injected style:
// ::highlight(annotation-xxx) { background-color: rgba(255, 213, 79, 0.4); }
```

### Annotation Scoping

Annotations scoped by `sessionId + messageId + attachmentId`. Same document in multiple messages = separate annotation spaces. Never share annotations across messages accidentally.

### Content Fingerprint (Cache)

```typescript
// Compute at attachment ingest — NOT on every render
function computeFingerprint(buffer: ArrayBuffer, filename: string): string {
  const header = new Uint8Array(buffer.slice(0, 4096));
  const hash = crypto.subtle.digest('SHA-256', header);
  return `${filename}:${buffer.byteLength}:${arrayToHex(hash).slice(0, 16)}`;
}
```

## Testing

After each phase, run:
```bash
# Unit tests
bun test packages/ui/src/components/annotations/
bun test packages/ui/src/components/chat/

# Build verification
bun run build

# Type check
bun run typecheck
```

Manual testing checklist per phase:
- [ ] Create annotation on target surface
- [ ] Edit annotation
- [ ] Cancel annotation (verify selection restore)
- [ ] Delete annotation
- [ ] Send follow-up (verify LLM receives correct context with document metadata)
- [ ] Persistent highlight (create, verify it persists across overlay close/reopen)
- [ ] Copy as quote (verify clipboard content includes attribution)
- [ ] Existing markdown annotations still work identically

## What NOT To Do

- Do NOT enable PDF text layer in the inline 500px preview (only fullscreen)
- Do NOT use Shadow DOM anywhere — always use iframe sandbox
- Do NOT use mammoth.js — use docx-preview
- Do NOT add OCR/Tesseract for scanned PDFs
- Do NOT implement PPTX rendering (Phase 4 is research only)
- Do NOT modify the Electron sandbox setting (`sandbox: false`)
- Do NOT add user-configurable quick actions or color pickers
- Do NOT run both docx-preview and mammoth on the same file
