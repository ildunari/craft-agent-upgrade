
# Craft Agents OSS — Rich Document Annotation Plan Review & Hardening Report

**Project:** `lukilabs/craft-agents-oss`  
**Review date:** 2026-03-25  
**Reviewed artifact:** user-provided “Rich Document Annotation Follow-Up System — Implementation Plan”  
**Repo basis:** current `main` snapshot as inspected on 2026-03-25 (raw file review; no commit SHA captured)

## Executive summary

The plan is directionally sound, but it is **not implementation-ready**. It gets the broad product problem right, but it misstates several parts of the current codebase, targets at least one wrong file path, and badly understates how much of the current annotation stack is hard-wired to a **single DOM root + character offsets + window selection** model.

The biggest risk is not PDF.js, mammoth, or iframe selection. It is the existing annotation architecture in `TurnCard` and its helper modules. Until that is refactored into a viewer-agnostic “annotation surface” model, every phase in the plan will fight selection capture, selection restore, overlay geometry, duplicate detection, pending preview annotations, and follow-up extraction.

My verdict: **needs revision**, not a fundamentally different product direction. Keep the adapter idea, but insert a **Phase 0 refactor**, tighten the security model, and reorder the implementation phases.

---

## A. Plan accuracy

### What the plan gets right

- The current follow-up UX is built around text selections and the floating Island UI.
- Rich documents are not first-class annotation targets today.
- Office attachments are converted to Markdown during storage, and that conversion is lossy.
- HTML preview is intentionally sandboxed and same-origin-capable.
- PPTX is the least mature area.

### Where the plan is inaccurate or incomplete

| Plan statement | Actual code | Assessment |
|---|---|---|
| Annotation creation is essentially a `text-position` system today. | The current text-annotation creator stores **both** `text-position` and `text-quote` selectors in `createSelectionPreviewAnnotation()` and `createTextSelectionAnnotation()` (`packages/ui/src/components/annotations/annotation-core.ts:32-64`, `66-110`). | Inaccurate. Creation is dual-selector already. |
| `annotation-resolver.ts` lives under `packages/ui/src/components/annotations/`. | The resolver used by overlay geometry is `packages/ui/src/components/markdown/annotation-resolver.ts`, imported from `packages/ui/src/components/annotations/annotation-overlay-geometry.ts:1-12`. | Wrong file path. |
| The current system only works on markdown-rendered text. | Text selection follow-ups are markdown-root based, yes, but the schema and UI already support **block annotations** (`packages/core/src/types/message.ts:168-188`; `packages/ui/src/components/chat/TurnCard.tsx:2224-2268`). | Incomplete framing. |
| PDF text layer is not currently enabled. | Inline preview disables it (`packages/ui/src/components/markdown/MarkdownPdfBlock.tsx:205-210`), but fullscreen PDF already enables both text and annotation layers (`packages/ui/src/components/overlay/PDFPreviewOverlay.tsx:147-155`). | Wrong as written. |
| HTML preview is file-backed via `src`, not inlined. | The HTML preview loads file contents, injects `<base target="_top">`, and renders via `srcDoc`, both inline and fullscreen (`packages/ui/src/components/markdown/MarkdownHtmlBlock.tsx:133-159`, `214-224`; `packages/ui/src/components/overlay/HTMLPreviewOverlay.tsx:130-154`, `200-208`). | Wrong. |
| Office files have no in-app preview. | File-link preview classification has no Office preview (`packages/ui/src/lib/file-classification.ts:10-16`, `84-96`), but Office attachments are converted to Markdown and can still appear in the chat as text content. | Broadly true for native Office preview, but incomplete. |
| Switching to quote-based selectors is a major architectural change for resolution. | Resolution already prefers valid `text-position` and falls back to `text-quote`, including whitespace-normalized quote matching (`packages/ui/src/components/markdown/annotation-resolver.ts:59-172`). | Overstated. The bigger problem is capture/restore/render, not resolver existence. |
| Adding adapters mainly affects a few annotation files plus `ChatDisplay`. | It also affects `annotation-core.ts`, `selection-restore.ts`, `annotation-overlay-geometry.ts`, `use-annotation-interaction-controller.ts`, `TurnCard.tsx`, and `follow-up-helpers.ts`. | Underestimated scope. |

### Important existing architecture the plan missed

#### 1) The annotation stack is much more DOM-root-specific than the plan acknowledges

The following helpers all assume one concrete `HTMLElement` root containing real DOM text nodes:

- `collectTextSegments()`, `getCanonicalText()`, `resolveNodeOffset()`, `resolveRangeFromOffsets()`, `getClientRectsForOffsets()`  
  `packages/ui/src/components/annotations/annotation-core.ts:113-224`
- `restoreDomSelectionFromOffsets()` / `scheduleDomSelectionRestore()`  
  `packages/ui/src/components/annotations/selection-restore.ts:8-49`
- `computeAnnotationOverlayGeometry()`  
  `packages/ui/src/components/annotations/annotation-overlay-geometry.ts:23-100`

That is the real seam you have to break open first.

#### 2) `TurnCard` owns too much of annotation capture and rendering

`TurnCard` is not just “where annotations show up.” It owns:

- pending preview annotation injection (`1770-1785`)
- overlay recompute lifecycle (`1799-1841`)
- selection-change dismissal (`1858-1899`)
- annotation save/update logic (`1914-1997`)
- selection capture, offset computation, prefix/suffix extraction, and island anchoring (`2105-2204`)
- block annotation gesture handling (`2224-2268`)
- document-level mouseup fallback (`2280-2310`)

All of that is in `packages/ui/src/components/chat/TurnCard.tsx`.

That means the proposed adapter pattern is not a drop-in. It is a **refactor-first** project.

#### 3) The current system mutates the DOM for highlights, not just overlay-paints rectangles

`TurnCard` clears and re-wraps text nodes with highlight spans in `clearAnnotationMarks()` and `applyTextHighlightRange()` (`packages/ui/src/components/chat/TurnCard.tsx:1467-1618`).

That matters because:

- iframe documents will need their own equivalent rendering strategy,
- PDF text layers already have their own span structure,
- DOM mutation can interfere with selection restore and layout,
- a pure “selectionToRects” adapter is not enough if the app still expects inline DOM marks.

#### 4) Follow-up extraction is currently message-content-centric

`extractAnnotationSelectedText()` first uses `text-quote`, then falls back to slicing the **assistant message content** using `text-position` (`packages/ui/src/components/chat/follow-up-helpers.ts:12-29`).

`ChatDisplay` then formats a trivial blockquote-plus-arrow structure (`apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx:213-247`, `1234-1261`, `1403-1445`).

That means rich-document follow-ups cannot work just by changing the formatter. You must also change:

- what gets stored in annotation metadata,
- how pending follow-ups are assembled,
- how selected text and context are recovered for non-markdown sources.

### Files and flows the plan should explicitly include

The plan should add these to its impact list:

- `packages/ui/src/components/annotations/annotation-core.ts`
- `packages/ui/src/components/annotations/selection-restore.ts`
- `packages/ui/src/components/annotations/annotation-overlay-geometry.ts`
- `packages/ui/src/components/annotations/use-annotation-interaction-controller.ts`
- `packages/ui/src/components/chat/follow-up-helpers.ts`
- `apps/electron/src/main/window-manager.ts` (security posture matters)
- `apps/electron/resources/scripts/pptx_tool.py` (already has PPTX metadata and text extraction in `info` / `extract`; `248-345`)
- `apps/electron/resources/scripts/markitdown_cli.py` (already supports `.docx`, `.pptx`, `.pdf`, etc. for Markdown conversion; `87-125`)
- `apps/electron/resources/scripts/pdf_tool.py` (already contains conversion-oriented utilities, including PDF → DOCX and PDF → PPTX paths)

---

## B. Issues and breakpoints

### 1) Core architectural breakpoints

#### Duplicate detection will break immediately for rich surfaces

`hasExistingTextRangeAnnotation()` only checks exact `text-position` start/end pairs (`packages/ui/src/components/annotations/annotation-core.ts:18-30`).

If you start storing quote-first PDF/DOCX/HTML annotations, duplicate suppression stops working unless you add a surface-aware strategy such as:

- same `sourceFile`
- same page/slide or DOM block scope
- same normalized quote
- same quote prefix/suffix
- same rendered rect cluster

Without that, users will create duplicate annotations constantly.

#### Selection restore is hard-coded to DOM offsets

`restoreDomSelectionFromOffsets()` and `scheduleDomSelectionRestore()` assume a range can be reconstituted from one DOM root (`packages/ui/src/components/annotations/selection-restore.ts:8-49`).

That fails for:

- iframe-contained selections,
- PDF text layer selections after rerender,
- hidden/virtualized pages,
- surfaces where the selection should be restored visually but not as a browser selection.

The current “Cancel follow-up restores your selection” behavior is a hidden compatibility constraint that the plan does not account for.

#### Overlay invalidation is currently too weak

Overlay recompute only listens to `window.resize` in `TurnCard` (`packages/ui/src/components/chat/TurnCard.tsx:1806-1841`).

That is already marginal. For PDF/iframe/doc viewers it is not enough. You need, at minimum:

- container scroll observation,
- viewer zoom change hooks,
- iframe internal scroll hooks,
- page render completion hooks,
- `ResizeObserver`,
- tab/show-hidden restoration hooks.

If you do not add those, highlights and island anchors will drift.

#### Existing selection lifecycle does not see iframe-originated selections

`showSelectionMenuFromCurrentSelection()` uses `window.getSelection()` and checks `root.contains(range.commonAncestorContainer)` (`packages/ui/src/components/chat/TurnCard.tsx:2105-2113`).

That logic simply does not observe selections created inside an iframe. Same for the document-level `selectionchange` and `mouseup` listeners (`1858-1899`, `2280-2310`).

So the plan’s HTML/DOCX phases are missing a full event-bridge and lifecycle model.

### 2) PDF-specific breakpoints

#### The plan overcorrects toward `getTextContent()`

Using `page.getTextContent()` for durable text extraction and context is sensible. Using it as the main source of selection geometry and highlight mapping is harder than the plan suggests.

Problems:

- PDF.js splits text into arbitrary items.
- ligatures, bidi text, hyphenation, and synthetic spaces can make quote-to-item mapping messy.
- user selection happens on the text layer DOM spans, not on raw text items.
- matching repeated text on the same page is ambiguous.

A better approach for Phase 1 is:

1. use the existing fullscreen **DOM text layer** for user selection and immediate geometry,
2. use `getTextContent()` only for persistence, context extraction, and re-resolution fallback,
3. persist `text-quote` + page scope + optional `xywh` fallback.

#### The “pageNumber + quote” selector is not strong enough

On financial reports, contracts, and academic PDFs, repeated strings are common. `text-quote` + `prefix/suffix` + `pageNumber` is still ambiguous when:

- a header/footer repeats,
- tables duplicate labels,
- multiple columns reuse the same phrase,
- OCR output is noisy.

You need tighter scoping, such as:

- page number,
- normalized quote,
- local item index or item-run hash,
- optional rect/`xywh` fallback,
- optional nearest heading.

#### Cross-page selection must be designed, not just forbidden

The plan says cross-page PDF selections are “undefined” and should be scoped to one page. Fine. But UX needs an answer:

- do you cancel the selection?
- do you keep only the first page’s fragment?
- do you split into two annotations?
- do you show a toast explaining the limitation?

If you leave it implicit, users get random behavior.

#### Mixed scanned/digital PDFs are common

The plan treats “scanned PDF detection” as if the whole file is scanned or not. In practice, mixed PDFs happen:

- digital front matter + scanned appendix,
- OCR text on some pages only,
- embedded image pages inside otherwise digital documents.

Detection and messaging should be per page, not just per document.

#### Password-protected / malformed PDFs are missing from the plan

`react-pdf`/PDF.js error states are not just “failed to render.” You need defined behavior for:

- password-protected PDFs,
- corrupted xref tables,
- oversized PDFs,
- pages that render but whose text layer fails,
- files deleted after the chat message was created.

### 3) DOCX-specific breakpoints

#### Mammoth is semantically convenient, visually lossy

That is the biggest product tradeoff in the whole plan.

Mammoth is great when you want:

- headings as headings,
- paragraphs as paragraphs,
- stable-ish quote extraction,
- clean HTML.

It is bad when users expect “the thing on screen looks like Word.” It intentionally does **not** preserve many presentational/layout details. The repo README explicitly positions it as a clean semantic converter, not a fidelity renderer.[1]

If visual fidelity is important, Mammoth is probably the wrong default for the display layer.

#### Cache coherence is underspecified

The plan proposes timestamp-based invalidation if `docx_tool.py` modifies a document. That is too weak.

Problems:

- identical mtimes are possible,
- edits can happen outside Craft,
- the same `storedPath` may be replaced atomically,
- cached HTML can diverge from the current binary without a reliable content identity.

Use a content hash or source fingerprint, not just timestamps.

#### Large images can explode renderer memory

Mammoth commonly emits embedded images as data URIs. On a long `.docx`, that can create huge HTML strings, huge DOM trees, and large memory spikes in the renderer.

That is especially risky here because the BrowserWindow renderer is **not** OS-sandboxed (`apps/electron/src/main/window-manager.ts:165-170`).

#### Zipped OOXML parsing belongs outside the renderer if possible

DOCX is a ZIP container. Untrusted ZIP parsing plus HTML generation in the renderer is a bigger risk than the plan treats it as. Even if scripts are sanitized afterward, the parsing work has already happened.

If you keep DOCX conversion client-side, strongly consider:

- a worker/utility process,
- or server-side/sidecar conversion,
- or at minimum lazy, isolated execution with aggressive size limits.

### 4) HTML-specific breakpoints

#### Wrapping selected nodes with `<mark>` is riskier than the plan suggests

For HTML previews, the plan suggests injecting styles and wrapping text nodes in `<mark>` elements. That will:

- mutate author DOM,
- potentially break CSS selectors and layout,
- interfere with copy/paste or subsequent selections,
- be harder to clean up reliably inside cached hidden iframes.

A better path is the **CSS Custom Highlight API** for same-origin iframe documents where Chromium support exists.[2] That lets you highlight `Range`s without DOM surgery. Use DOM wrapping only as a fallback.

#### Hidden iframe caching is already a memory tradeoff

`MarkdownHtmlBlock` renders all cached items as hidden iframes to avoid flash (`packages/ui/src/components/markdown/MarkdownHtmlBlock.tsx:23-29`, `207-226`).

That is already a memory/performance tradeoff. Adding annotation state, custom styles, and event listeners to those cached iframes increases the pressure. Long HTML docs or many tabs can make this ugly fast.

#### There is no magical cross-iframe selection API you missed

There is no modern browser API that lets the parent page transparently use one `Range` or `Selection` across iframe boundaries. `Selection.getComposedRanges()` is about **shadow DOM**, not iframes.[3]

So the plan is right to think in terms of same-origin iframe bridging. It just needs to acknowledge that coordinate mapping and event bridging are still required.

### 5) Follow-up assembly and state-management breakpoints

#### Editing an existing rich-document annotation will currently recover the wrong quote

When editing an existing annotation, `saveFollowUp()` returns:

```ts
selectedText: extractAnnotationSelectedText(activeAnnotation, text)
```

from `packages/ui/src/components/chat/TurnCard.tsx:1963-1968`.

That `text` is the assistant message text, not the PDF/DOCX/HTML source. For rich-doc annotations, that will often be wrong unless you store the quote and context directly on the annotation in a surface-independent way.

#### Pending follow-up objects are too small

`PendingFollowUpAnnotation` only has:

- `messageId`
- `annotationId`
- `note`
- `selectedText`
- `createdAt`
- `color`
- `meta`

`apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx:213-221`

That is not enough for document follow-ups if you want:

- file name,
- source type,
- page/slide,
- section heading,
- surrounding text,
- stable quote scoping.

The plan notices the formatter problem, but not the upstream object model problem.

### 6) Electron-specific breakpoints

#### The renderer is not OS-sandboxed

The app uses:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: false`
- `webviewTag: false`

in `apps/electron/src/main/window-manager.ts:165-170`.

That is better than an unsafe Electron window, but worse than a fully sandboxed renderer. The plan talks about iframe sandboxing and DOMPurify, but not about the actual host process security posture.

This matters because DOCX/PDF/HTML parsing and rendering happen in the renderer. If that renderer is compromised, the blast radius is larger than the plan implies. Electron’s docs are clear that `contextIsolation` and `nodeIntegration: false` help, but process sandboxing is a separate control and defaults to `true` in modern Electron unless you turn it off.[4]

#### IPC payload growth can become a quiet problem

If you start attaching rich document context to annotations and shuttling it repeatedly through preload-exposed APIs, you can create large structured-clone payloads and extra renderer churn. The current app is not doing that at scale yet.

Keep annotation metadata compact and deterministic. Do not store giant HTML excerpts or page text blobs unless you absolutely have to.

---

## C. Security review

### Bottom line

**DOMPurify + sandboxed iframe is the right baseline, but it is not sufficient by itself.** The plan is correct to reject Shadow DOM as a security boundary. But the current repo’s Electron settings, Mammoth’s recent vulnerability history, and the app’s raw interpolation of follow-up text mean the security section needs to be much tighter.

### 1) DOMPurify + iframe sandbox: good baseline, incomplete hardening

What the plan gets right:

- sanitize untrusted HTML,
- keep it in an iframe,
- do not allow scripts,
- do not replace the iframe with Shadow DOM.

What is still missing:

#### a) Pin and verify safe library versions

DOMPurify has had recent bypasses/CVEs:

- **CVE-2025-26791** affects versions before `3.2.4`.[5]
- **CVE-2025-15599** affects `3.1.3`–`3.2.6`; fixed in `3.2.7` on the 3.x line.[6]

As of this review, DOMPurify’s current line is `3.3.3`.[7] Do not write a plan that says “use DOMPurify” without also saying:

- pin to a non-vulnerable version,
- watch advisories,
- test your exact config.

#### b) Use Trusted Types where possible

DOMPurify supports Trusted Types, and Chromium/Electron support is mature enough to use it as defense-in-depth.[8][9]

That does **not** replace sanitization or iframe isolation. It reduces unsafe sink usage.

#### c) Add an iframe-level CSP for `srcDoc`

Even with `allow-scripts` removed, untrusted HTML can still do plenty you may not want:

- external image/network fetches,
- form submissions,
- `meta refresh`,
- navigations on user activation.

Because the content is injected via `srcDoc`, you can prepend a `<meta http-equiv="Content-Security-Policy" ...>` to lock it down further. At minimum, decide your policy for:

- `default-src`
- `img-src`
- `style-src`
- `font-src`
- `connect-src`
- `form-action`
- `navigate-to`

Right now the HTML preview deliberately injects `<base target="_top">` and relies on `allow-top-navigation-by-user-activation` (`packages/ui/src/components/markdown/MarkdownHtmlBlock.tsx:71-86`, `214-224`; `packages/ui/src/components/overlay/HTMLPreviewOverlay.tsx:19-32`, `200-208`). That is okay if you want external navigation on click, but you should treat it as part of the threat model.

### 2) Mammoth-specific risk: sanitization is not enough

The plan correctly says Mammoth does not sanitize its output. That is true. But the bigger point is this:

**some Mammoth risk happens before sanitization.**

Mammoth had **CVE-2025-11849** / GHSA-rmjr-87wv-gf87, a directory traversal / external file access issue involving DOCX files with externally linked images, fixed in `1.11.0`.[10][11] Mammoth’s own NEWS file says `1.11.0` “Disable external file accesses by default” and gates them behind the `externalFileAccess` option.[12]

That means:

- DOMPurify cannot save you from a pre-sanitize file access bug.
- The plan should explicitly require `mammoth >= 1.11.0` (today: `1.12.0` is current).[13]
- The plan should explicitly require `externalFileAccess: false` and tests for linked-image edge cases.

### 3) Electron posture: the plan ignores the real host boundary

The plan asks the right question about `nodeIntegration` and `contextIsolation`, but it stops short of the full answer.

For this repo specifically:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: false`

`apps/electron/src/main/window-manager.ts:165-170`

So yes, the app avoids the worst-case “renderer can just `require('fs')`” problem. But it does **not** run the renderer in Electron’s OS-level sandbox, even though modern Electron enables sandboxing by default unless you turn it off.[4]

That does not mean the project is doomed. It means the plan’s security story is incomplete. If you are going to parse untrusted DOCX/HTML/PDF in the renderer, this setting matters.

### 4) Could annotation data itself be an injection vector?

**Yes, but today it is more obviously a markdown/prompt injection vector than a DOM XSS vector.**

Current behavior:

- `ChatDisplay.formatFollowUpSection()` interpolates `selectedText` and `note` directly into Markdown text (`apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx:229-247`).
- `normalizeExcerptForMessage()` truncates and normalizes, but it does not escape Markdown metacharacters (`223-226`).
- `selectedText` often comes straight from quote selectors or message slices (`packages/ui/src/components/chat/follow-up-helpers.ts:12-29`).

Risks:

- a selected quote or note can break the intended markdown structure,
- a malicious quote could alter prompt shape,
- if any future UI path renders annotation text as raw HTML or drops it into `srcDoc`, it becomes a direct XSS sink.

Recommendation:

- treat annotation quote/note as plain text,
- escape before inserting into Markdown,
- keep structured metadata separate from the rendered follow-up body.

### 5) Recommended security hardening additions

Add these to the plan explicitly:

1. **Pin versions**
   - DOMPurify `>= 3.2.7` (prefer current `3.3.3`)
   - Mammoth `>= 1.11.0` (prefer current `1.12.0`)

2. **Mammoth config**
   - explicitly disable external file access,
   - custom image handler,
   - reject or log external linked images.

3. **Renderer isolation**
   - seriously evaluate enabling Electron renderer sandboxing,
   - or move DOCX/PPTX conversion to a worker/utility process.

4. **Iframe CSP**
   - add a restrictive CSP to `srcDoc` payloads.

5. **Annotation text escaping**
   - escape Markdown,
   - preserve structured context separately.

6. **Sanitizer allowlist review**
   - forbid `form`, `iframe`, `object`, `embed`, `meta`, `link`, `style` unless there is a compelling reason to keep them,
   - define URI policy, not just tag policy.

---

## D. Library evaluation (current state as of March 2026)

### 1) `mammoth.js`

#### Current state

- Current npm line: **`1.12.0`** (published March 2026).[13]
- Security fix milestone: **`1.11.0`** disabled external file access by default and added the `externalFileAccess` option.[12]
- Maintenance status: active enough to count as maintained; recent versions and repo activity exist through 2025–2026.[12][13]

#### Reality check

Mammoth is still a **semantic converter**, not a fidelity renderer. Its own project description emphasizes “simple and clean HTML” and explicitly says it ignores many presentational details such as exact fonts, colors, and styling.[1]

That makes Mammoth:

- **good** for clean quote extraction and structural context,
- **bad** for “this should look like the Word document I uploaded.”

#### Alternatives

##### `docx-preview` / `docxjs`
Still active. npm/CDN-visible builds exist through late 2025, and the GitHub project is alive.[14][15]

This is the main open-source alternative if the real requirement is **visual fidelity**, not semantic cleanliness.

Tradeoff:

- `mammoth`: easier context extraction, worse fidelity
- `docx-preview`: better fidelity, messier HTML / annotation mapping

##### Server-side LibreOffice → PDF/HTML
Still a serious option if layout fidelity matters more than browser-only purity. It is operationally heavier, but it gives you a consistent rendering substrate and can push annotation onto the PDF path.

#### My call

If the product goal is “annotation on the thing the user visually recognizes as their document,” Mammoth is not an obviously correct default. If the goal is “good-enough rich preview plus structurally sane quote extraction,” it is fine.

### 2) `pdfjs-dist` / `react-pdf`

#### Current state

- `pdfjs-dist`: **`5.5.207`** as of March 2026.[16]
- `react-pdf`: **`10.4.1`** as of February 2026.[17]

#### Has text-layer misalignment been “fixed”?

No, not in the strong sense the plan seems to want.

- PDF.js releases have continued shipping text-selection improvements.[18]
- But text-selection misalignment is **not dead**. Open issue **#20017** (June 2025) reports incorrect text-selection span positioning and explicitly says the bug reproduces on the latest PDF.js version at the time.[19]
- The plan cites issue **#14969**, which is real but **closed**.[20] Using it as the canonical reason for today’s strategy is outdated.

#### Practical conclusion

Fullscreen-only PDF annotation is still the correct conservative rollout. The reason just needs to be stated more accurately:

- not “there is a single open bug we know about,”
- but “PDF.js text selection keeps improving, yet span/canvas drift still exists in real documents and at some scales.”

### 3) `DOMPurify`

#### Current state

- Current release line: **`3.3.3`**.[7]
- Trusted Types support exists.[8]

#### Recent security reality

Relevant recent CVEs:

- **CVE-2025-26791** — fixed in `3.2.4`.[5]
- **CVE-2025-15599** — fixed in `3.2.7` on the 3.x line.[6]

#### Alternatives

##### `sanitize-html`
Still active (`2.17.2` at review time).[21]

I would not switch to it here unless you have a very specific compatibility reason. In Electron/Chromium land, DOMPurify plus Trusted Types remains the better default.

#### My call

Use DOMPurify, but the plan must say **which minimum version is acceptable**, and it should add Trusted Types as defense-in-depth.

### 4) New PPTX options

The plan says there is no maintained JavaScript PPTX renderer. That is no longer accurate.

There are now multiple candidates worth evaluating:

- **`@aiden0z/pptx-renderer`** — npm shows `1.0.2`, recently published, with a browser-native HTML/SVG rendering pitch.[22][23]
- **`pptx-preview`** — npm shows `1.0.7`, recently updated, pure frontend preview library.[24]
- **`@docmentis/udoc-viewer`** — very new but ambitious; npm shows `0.6.x` in March 2026, positioning itself as a universal PDF/DOCX/PPTX/image viewer backed by WASM.[25][26]
- **`pptx-browser`** — npm/CDN-visible `4.1.5`, claiming render/edit/export capabilities.[27]

Caveats:

- these are new enough that maintenance depth, fidelity, and correctness are still open questions,
- some options are proprietary or licensing-sensitive (for example `@kandiforge/pptx-renderer` is proprietary, so it is a poor fit for this OSS project).[28]

#### My call

The PPTX landscape has improved enough that “research only” is still reasonable, but the plan’s stated reason is outdated. The updated reason should be:

> There are now real candidates, but they are too new and too unproven to commit to implementation without a bake-off.

### 5) New approaches to cross-iframe selection/highlighting

There is **no new cross-iframe selection primitive** that removes the need for same-origin bridging and coordinate translation.

What **has** changed:

- the **CSS Custom Highlight API** is now baseline/newly available across latest browsers since June 2025, and it lets you style arbitrary `Range`s without DOM mutation.[2]

That is genuinely relevant here. It is useful for:

- HTML preview highlights,
- DOCX-as-HTML highlights,
- avoiding `<mark>` wrappers.

It does **not** solve selection capture across iframe boundaries. It helps the rendering side, not the cross-document selection side.

---

## E. Alternative solutions by phase

### Phase 1 (PDF)

#### Better approach than “pure `getTextContent()`” for user selection?

Yes.

**Recommended hybrid approach:**

- use the existing fullscreen **PDF.js text layer DOM** for user selection and rects,
- use `getTextContent()` for:
  - surrounding text extraction,
  - quote normalization,
  - re-resolution fallback,
  - heading-ish heuristics if needed.

Why this is better:

- it reuses the browser/PDF.js selection behavior users already get,
- it avoids rebuilding selection geometry from raw items,
- it keeps the persistence layer decoupled from rendering drift.

#### What about PDF.js’s built-in annotation layer?

Not a substitute. The PDF annotation layer is for PDF-native annotations/forms/links, not your app’s follow-up workflow. It may be useful for coordinate grounding or interoperability in the future, but it does not solve Craft’s selection-follow-up UX by itself.

#### Alternative viewer approach

If you want less DIY later, evaluate the default PDF.js viewer embedded in an isolated iframe/web component, rather than only `react-pdf`. There are now wrapper projects around the full viewer stack. But that is a larger UI integration shift and not a quick Phase 1 win.

### Phase 2 (DOCX)

#### Is Mammoth the best choice?

Not automatically.

Choose based on product goal:

##### If the priority is semantic text + context extraction
Use **Mammoth**, but harden it heavily.

##### If the priority is visual fidelity
Evaluate **docx-preview/docxjs** first.[14][15]

##### If the priority is consistency across formats
Convert DOCX to **PDF** server-side or in a sidecar, and reuse the PDF annotation path.

#### What about server-side LibreOffice conversion?

This is still one of the best fidelity-preserving options. Downsides:

- operational complexity,
- more moving parts,
- conversion latency,
- potential platform pain.

But it removes a lot of browser-side layout guesswork.

#### What about just using `markitdown-js` output with better styling?

That is the quickest fallback, not the best long-term solution. It preserves the current agent-facing text path and gives annotation “for free,” but it does not solve the user’s “I want to point at the document I actually see” problem.

### Phase 3 (HTML)

#### Is there a way to avoid coordinate mapping complexity?

Not really. If you keep same-origin iframes, you still need to map iframe-relative rects to parent coordinates.

What you can simplify:

- keep the parent as controller,
- attach listeners inside `iframe.contentDocument`,
- store rects relative to the iframe document,
- translate them to parent space only for island placement / overlay drawing.

#### What about `postMessage` bridges?

Possible, but unnecessary if you deliberately keep same-origin iframes. Direct DOM access is simpler and lower overhead here. `postMessage` makes more sense if you later want to move to a stronger isolation boundary.

#### Better highlight strategy

Use **CSS Custom Highlight API** inside the iframe document where available, fallback to DOM wrapping only when necessary.[2]

### Phase 4 (PPTX)

#### Has the landscape changed?

Yes. The “no maintained JS rendering library exists” claim is outdated. There are now real candidates.[22][24][25][27]

#### What should the project do?

Do a short, ruthless bake-off:

- rendering fidelity,
- selection support,
- performance on big decks,
- license fit for OSS,
- bundle size,
- Electron stability.

Until one passes, keep PPTX out of implementation scope.

#### Near-term practical fallback

If PPTX support becomes urgent before a browser-native renderer proves itself, the most coherent near-term path is:

- keep `markitdown` / existing text extraction for agent-readable content,
- add PPTX → PDF conversion,
- reuse the PDF viewer/annotation stack.

---

## F. UX concerns

### 1) Fullscreen-only PDF annotation will confuse users unless you spell it out

The current plan is technically sensible, but product-wise it is confusing if:

- inline preview shows a document,
- selection appears possible,
- annotation only works after opening fullscreen.

You need an explicit affordance on the inline preview, e.g.:

- disabled annotate badge,
- tooltip: “Open fullscreen to annotate PDF text,”
- one-click “Open to annotate” CTA.

Without that, users will think the feature is broken.

### 2) Mammoth output may be visually unacceptable for real docs

For simple reports and notes, Mammoth is okay. For corporate docs, grant applications, contracts, and anything layout-heavy, it will often look “off.”

That matters because annotation is about trust in visual reference. If the preview looks unlike the original, the user will doubt the annotation target even if the quote is technically correct.

If you pick Mammoth, add honest UI language like:

> Preview simplifies some formatting. Open original for exact layout.

### 3) Long-document UX is underspecified

For 100+ page docs, you need decisions on:

- visible-page-only highlight resolution,
- annotation search/jump,
- page breadcrumb in follow-up chips,
- whether all pending highlights render at once,
- what happens when many annotations exist on the same page.

The current plan’s performance target (“<50ms for 20-page PDFs”) is okay as a benchmark, but the UX behavior for large documents needs more detail than “virtual scrolling.”

### 4) The Island needs edge-aware placement inside scrollable viewers

The current island anchor logic in `TurnCard` is tuned around text-row rects and pointer position (`packages/ui/src/components/chat/TurnCard.tsx:2133-2202`), but it does not solve all viewport/container collisions.

Rich docs add new failure modes:

- selection near the right edge of a narrow overlay,
- selection near the top while toolbars are pinned,
- iframe-contained selections whose translated coordinates sit partially outside the visible area,
- anchors inside horizontally scrollable docs.

You need explicit collision and clamping logic per container, not just per row.

### 5) Accessibility is weakly specified

The plan mentions accessibility audits, which is good, but note:

- PDF.js text layers have accessibility quirks of their own.
- CSS Custom Highlight API accessibility guidance is still catching up.[29]
- highlight chips and focus order need explicit keyboard design, not just “works with mouse selection.”

---

## G. Improvements and recommendations

### 1) Add a **Phase 0: annotation surface refactor**

This is the missing piece.

Before PDF/DOCX/HTML phases, extract the current DOM-bound logic into a surface model roughly like:

- `captureSelection()`
- `restoreSelection()`
- `selectionToRects()`
- `resolveAnnotation()`
- `getFollowUpContext()`
- `observeGeometryInvalidation()`

Move this responsibility out of `TurnCard` as much as possible.

Without this, every later phase becomes a series of hacks around `window.getSelection()` and one `contentLayerRef`.

### 2) Do **not** extend `AnnotationTarget` with ad-hoc top-level fields

The plan proposes adding `pageNumber`, `sourceType`, and `sourceFile` to `AnnotationTarget`. I would not do that.

Reasons:

- `AnnotationSelector` already supports multiple selector types, including `xywh.page` (`packages/core/src/types/message.ts:155-188`).
- `AnnotationV1.meta` already exists for auxiliary metadata (`204-227`).
- top-level type-specific fields will sprawl quickly.

Better options:

- keep durable targeting in selectors,
- store presentation/context metadata under `annotation.meta.document`,
- add a new selector only if you truly need it.

### 3) Reorder the phases

I would reorder to:

1. **Phase 0** — surface refactor
2. **Phase 1** — fullscreen PDF
3. **Phase 2** — HTML iframe annotation
4. **Phase 3** — DOCX rich display
5. **Phase 4** — PPTX research

Why HTML before DOCX?

- same-origin iframe infrastructure already exists,
- no new parser dependency is needed,
- it exercises the cross-document selection/overlay model earlier,
- it is a cleaner proving ground than immediately adding Mammoth.

### 4) Tighten the follow-up data model before touching viewers

Add a richer pending-follow-up structure first. Right now the app cannot reliably represent non-markdown document context in `PendingFollowUpAnnotation`.

Define and persist fields such as:

- `sourceType`
- `sourceFile`
- `pageOrSlide`
- `selectedText`
- `quotePrefix`
- `quoteSuffix`
- `surroundingText`
- `sectionHeading`
- `selectionScopeId` (page/block/item run hash)

That unblocks `ChatDisplay` cleanly and stops later phases from bolting metadata on as an afterthought.

### 5) Pick a DOCX strategy explicitly instead of pretending Mammoth is neutral

The plan needs one explicit product decision:

- **semantic preview first** → Mammoth
- **visual fidelity first** → docx-preview or PDF conversion

Right now it treats Mammoth as if it is just “the DOCX renderer.” It is not. It is one side of a fidelity-vs-structure tradeoff.

### Single biggest risk

**Architectural mismatch.**

If the team starts implementing adapters against the current `TurnCard`/annotation-core model without a Phase 0 refactor, the project will accumulate special cases immediately:

- iframe-only selection bridges,
- PDF-only restore rules,
- DOCX-only metadata paths,
- duplicated geometry logic,
- broken edit/restore/duplicate-detection behavior.

That is the risk most likely to derail the project.

### Quick wins the plan is missing

1. **Exploit what already exists in fullscreen PDF**
   - The text layer is already on there (`packages/ui/src/components/overlay/PDFPreviewOverlay.tsx:147-155`).

2. **Fix follow-up escaping now**
   - `ChatDisplay` currently inserts raw note/quote into Markdown (`apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx:229-247`).

3. **Add overlay invalidation now**
   - Even current markdown annotations would benefit from scroll/observer-based recompute.

4. **Use `meta.document` now**
   - You can start storing richer document metadata before the full viewer work lands.

5. **Use existing `xywh.page` where it makes sense**
   - The schema already has a page-aware region selector (`packages/core/src/types/message.ts:174-183`).

---

## Revised risk register

| Risk | Likelihood | Impact | Why it matters | Mitigation |
|---|---:|---:|---|---|
| Current annotation engine is too DOM-root-specific for adapters | High | Critical | This is the real project blocker, not any individual library | Add Phase 0 surface refactor before feature phases |
| Renderer compromise or instability from untrusted DOCX/PDF parsing | Medium | Critical | BrowserWindow has `sandbox: false`; renderer-side parsing is a larger risk | Move conversion/parsing to worker/utility process or enable stronger sandboxing |
| PDF highlight drift / mis-selection at some scales and documents | High | High | PDF.js text-layer issues still exist in current releases | Fullscreen-only rollout, hybrid DOM selection + `getTextContent()` persistence |
| Duplicate or wrong rich-document annotations due weak selectors | High | High | `page + quote` is not always unique | Add page/block/item-run scoping and optional `xywh` fallback |
| Rich follow-up context sent to the LLM is incomplete or wrong | High | High | Current follow-up pipeline assumes message text is the source | Expand annotation metadata + pending follow-up object model |
| Markdown/prompt injection through annotation quote/note | High | Medium | Current formatter interpolates raw strings | Escape Markdown, preserve structured metadata separately |
| Hidden iframe/doc caches consume too much memory | Medium | High | Large HTML/DOCX docs and many tabs can bloat renderer memory | Evict caches, cap iframe count, free inactive surfaces aggressively |
| Cache incoherence after document edits | Medium | Medium | Timestamp-only invalidation is weak | Hash-based or fingerprint-based cache keys |
| PPTX ecosystem candidate chosen too early | Medium | Medium | New libraries exist, but maturity is unclear | Bake-off before implementation commitment |
| External resource loading / navigation from preview HTML | Medium | High | Sandboxed HTML can still fetch/navigate in allowed ways | iframe CSP, URL policy, sanitize/strip remote resources where appropriate |

---

## Top 5 changes I would make

### 1) Insert a real Phase 0
Refactor annotation capture, restore, overlay, and follow-up context into a viewer-agnostic “annotation surface” layer before touching PDF/DOCX/HTML.

### 2) Change the PDF strategy from “`getTextContent()` everywhere” to a hybrid model
Use the existing fullscreen PDF text layer for interactive selection and rects; use `getTextContent()` for persistence and context. This is both less risky and faster to ship.

### 3) Reorder HTML ahead of DOCX
HTML iframe annotation is a better second proving ground than Mammoth-based DOCX because the iframe substrate already exists and exercises the cross-document selection problem directly.

### 4) Split DOCX decisions into “semantic preview” vs “fidelity preview”
Do not bury that tradeoff under implementation details. Decide whether you want Mammoth or a higher-fidelity renderer before writing the phase as if there is one obvious answer.

### 5) Harden the security plan materially
Pin safe versions, disable Mammoth external file access explicitly, add iframe CSP, escape follow-up Markdown, and treat `sandbox: false` in Electron as a real architectural input.

---

## Final verdict

**Needs revision.**

The overall direction is good: keep the existing Craft annotation UX, avoid a fake “unified viewer,” keep iframe sandboxes, and roll out incrementally. But the plan is not accurate enough about the current codebase, and it underestimates the refactor required to make annotations surface-agnostic.

I would not greenlight implementation from this document as written. I would greenlight a revised version that:

- adds a Phase 0 annotation-surface refactor,
- corrects the repo-specific inaccuracies,
- tightens the security model,
- reorders the phases,
- and makes an explicit DOCX strategy decision.

---

## References

1. Mammoth project description / philosophy: https://github.com/mwilliamson/mammoth.js  
2. MDN — CSS Custom Highlight API baseline and usage: https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API  
3. Selection composed ranges are for shadow DOM, not iframes: https://developer.mozilla.org/en-US/docs/Web/API/Selection/getComposedRanges  
4. Electron WebPreferences / sandbox default / context isolation docs: https://electronjs.org/docs/latest/api/structures/web-preferences  
5. NVD — DOMPurify CVE-2025-26791: https://nvd.nist.gov/vuln/detail/CVE-2025-26791  
6. NVD — DOMPurify CVE-2025-15599: https://nvd.nist.gov/vuln/detail/CVE-2025-15599  
7. DOMPurify current release line / repo: https://github.com/cure53/DOMPurify  
8. DOMPurify Trusted Types support note: https://github.com/cure53/DOMPurify  
9. MDN — Trusted Types API: https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API  
10. NVD — Mammoth CVE-2025-11849: https://nvd.nist.gov/vuln/detail/CVE-2025-11849  
11. GitHub Advisory — Mammoth GHSA-rmjr-87wv-gf87: https://github.com/advisories/GHSA-rmjr-87wv-gf87  
12. Mammoth NEWS (`1.11.0`, `1.12.0`): https://github.com/mwilliamson/mammoth.js/blob/master/NEWS  
13. npm package result for Mammoth (`1.12.0` current at review time): https://www.npmjs.com/package/mammoth  
14. npm package result for `docx-preview`: https://www.npmjs.com/package/docx-preview  
15. `docxjs` / `docx-preview` repository: https://github.com/VolodymyrBaydalka/docxjs  
16. npm package result for `pdfjs-dist` (`5.5.207` current at review time): https://www.npmjs.com/package/pdfjs-dist  
17. npm package result for `react-pdf` (`10.4.1` current at review time): https://www.npmjs.com/package/react-pdf  
18. PDF.js releases / recent text-selection improvements: https://github.com/mozilla/pdf.js/releases  
19. PDF.js issue #20017 (open): https://github.com/mozilla/pdf.js/issues/20017  
20. PDF.js issue #14969 (closed): https://github.com/mozilla/pdf.js/issues/14969  
21. npm package result for `sanitize-html`: https://www.npmjs.com/package/sanitize-html  
22. npm package result for `@aiden0z/pptx-renderer`: https://www.npmjs.com/package/@aiden0z/pptx-renderer  
23. `@aiden0z/pptx-renderer` repository: https://github.com/aiden0z/pptx-renderer  
24. npm package result for `pptx-preview`: https://www.npmjs.com/package/pptx-preview  
25. npm package result for `@docmentis/udoc-viewer`: https://www.npmjs.com/package/@docmentis/udoc-viewer  
26. docMentis viewer site / guide: https://www.docmentis.com/viewer/guide  
27. CDN/package listing for `pptx-browser`: https://www.jsdelivr.com/package/npm/pptx-browser  
28. `@kandiforge/pptx-renderer` package metadata / proprietary notice: https://www.npmjs.com/package/@kandiforge/pptx-renderer  
29. MDN content issue on Custom Highlight accessibility guidance: https://github.com/mdn/content/issues/43408

