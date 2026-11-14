# Solution Lab design contract

## 0. Research log
- The current browser workspace adapts [Astryx Side Nav](https://astryx.atmeta.com/templates?preview=side-nav) with Meta's Stone theme. The menu, drawer and action controls use the published Astryx components. The existing GaJwa print layout remains the PDF default.
- Reading: a Korean teacher's private document workbench, using restrained document-first minimalism.
- References: the frontend router, minimalist-ui and layout-mechanics references; Notion's white canvas, readable typographic hierarchy and thin division lines. This is original application UI, not a branded clone. The task's approved blue/brown and Korean fonts override reference brand colors.
- Concept lane: built-in Image Gen produced `design/workspace-concept.png` and `design/review-concept.png`. Both were opened and visually inspected. The workspace concept is the primary shell reference; the review concept defines the result document and review rail.
- Independent concept review checked scroll ownership, text contrast, input roles, empty states and mobile reflow. Its recommendations are incorporated below.
- Lazyweb lane: skipped because the required private-app workflow and existing local document references provide the needed grammar; no remote product screenshots are copied.
- Literal concept deviations: generated example text, synthetic recent work, gradient-like button texture and decorative numbered circles are not shipped. The app starts empty, uses flat color controls, plain numbered steps, and real API/catalog/job data.

## 1. Purpose and people
- Primary user: one Korean math teacher uploading exams or their own handwriting, reading outputs carefully and recording corrections.
- Main tasks: create a job, generate a solution, compare the source with the explanation and graph, edit the result, export a PDF, and revisit saved work. Current method references are the observed baseline records.
- Low-confidence handwriting and model output stay visibly unreviewed. Reading source metadata is never described as learning the contents.
- Cognitive constraints: plain Korean actions, a single primary action per region, preserved original variable names and step order, no decorative information.

## 2. Tokens
- Browser chrome uses the Stone surface, body, border, accent, and text tokens. The following fallback colors and metrics also support the worksheet presentation.
- Canvas `#FFFFFF`; sidebar and secondary surfaces `#F7F8F9`; panel tint `#F1F4F6`.
- Text `#202629`; secondary `#5E6870`; muted `#707A83`.
- Border `#E1E6EA`; strong border `#C7D0D7`; grid `#E9EDF0`.
- Primary blue `#3C5D72`; primary hover `#304D60`; blue tint `#EDF2F5`.
- Explanatory brown `#AD7645`; brown text `#80522C`; brown tint `#FAF4EE`.
- Error `#9A3838`; error tint `#FBF0F0`; positive `#35634C`; positive tint `#EEF5F0`.
- White text `#FFFFFF`; graph axis `#79848B`; graph blue/brown use approved primary colors; graph gray `#A0A8AD`.
- Radius: Stone component defaults for Astryx controls, 6px for worksheet controls and containers, and 4px for compact tags.
- Space: 4, 8, 12, 16, 20, 24, 32, 40, 48px.
- Border: 1px on worksheet elements. AppShell and the mobile drawer use Astryx elevation.

## 3. Typography
- UI: Pretendard when locally available, then Segoe UI/Malgun Gothic/system sans.
- Document prose: Noto Serif KR, Batang and serif fallback. KaTeX renders math with trust disabled.
- Brand 24px/700; page title 26px/700; view heading 28px/700; section 19px/700; body 16px/1.7; UI 14px/1.5; label 14px/600; metadata 12px/1.5.
- Narrow screens use a 23px view heading, never shrink body below 14px. Long filenames wrap or ellipsize intentionally.

## 4. Layout and scroll ownership
- Shell: Astryx elevated AppShell, 260px initial SideNav, and a bounded main content column. The grouped menu and recent work scroll inside the sidebar. On narrow screens the menu opens in the Astryx mobile drawer.
- Main: fixed 76px topbar. The scroll owner is `.main-scroll`. The result view uses one full-width content column. The editing view opens a separate panel.
- Below 1100px: ordinary rails sit below the main content. During editing, independent preview and edit panes start at 1250px and stack below that width. Below 440px form fields stack.
- Content cases: empty, pending, error, long Korean filename, unbroken math string, multiple questions and 375px reflow must retain all controls without page horizontal overflow.

## 5. Components
- App shell: Astryx AppShell, SideNav and MobileNavToggle frame the topbar and main scroll region. Navigation and recent work use SideNavItem with visible selection. A primary Button starts a new job.
- Buttons: Stone primary and secondary actions in the work views and shell, with plain text utilities. Core work actions are at least 40px high.
- Forms: real labels above each field; input/textarea/select share border, radius and focus ring. Upload areas accept PDF and supported images, list selected files and allow removal.
- Tabs: Astryx TabList for work modes, document views and editing. Narrow strips scroll when needed.
- Document: original problem, answer, main idea, solution steps, formulas, and graphs. When the handwriting needs a specific correction, show the issue beside the solution with access to the original.
- Answer: black body-size text in a right-aligned row after the solution. Use whitespace and a thin neutral rule for separation.
- Editor: content and design controls appear on demand with a save action. The work record retains earlier revisions.
- Catalog: searchable plain rows, explicit metadata-only/reviewed labeling; source links and separate approved-case list.
- Graph: new figures use a locally rendered PNG from a validated `figure_recipe_v1` recipe in the result view and PDF. Saved legacy graphs use finite samples computed on the server.
- Notices: semantic success/error/status text, not color alone.
- Knowledge list-detail: actual baseline records in a narrow selectable list, with original core and supplement needs in separately titled sections. Every step shows its observed predecessor and branch, and unknown order is never presented as a verified linear sequence. Validation holdouts are absent from the reusable list.
- New job form: choose suggested emphasis or write directions next to the job’s optional request. Criteria render as a separate read-only document.
- The editing workspace places a live solution or rendered PDF beside content and design controls on wide screens. Narrow screens show the preview above the editor. PDF settings show whether the preview matches the current draft.
- Design references pair a reusable source file and notes with supported layout and curve settings. Reuse is explicit. File reading for design suggestions starts only from the user’s analysis action.
- Legacy JSXGraph uses server-computed segmented points. Browser labels are SVG text with parsing disabled. Pan, zoom, and reset controls are keyboard reachable.
- Legacy graphs use a height of 360px on wide screens and 280px on narrow screens. Recipe figures and original image previews preserve their intrinsic proportions.

## 6. Interaction and motion
- Hover and focus use color/outline changes in 120ms. Buttons have a subtle active translateY(1px). No ambient animation or decorative motion.
- Running jobs show a real status with text and a small spinner. Polling stops on completion/failure and on unmount.
- Respect `prefers-reduced-motion`: remove spinner rotation and transition animation while keeping status text.
- Editing is explicit; save state and server errors stay visible. Unsaved edits are not silently replaced by polling.

## 7. Accessibility
- Semantic navigation, heading hierarchy, labels and buttons. Focus ring 2px primary with 3px offset. Icon-only controls require accessible names.
- Alerts use `role=alert`; asynchronous status uses `aria-live=polite`. Graph has an accessible title/description and text explanation.
- Keyboard users can select modes, choose files, submit, open history, edit, and save without pointer-only controls.
- Touch targets are at least 40px, rising to 44px in compact navigation.

## 8. Evidence and debt
- Reference images: `design/workspace-concept.png`, `design/review-concept.png`.
- Root coordinates real-browser verification at desktop/tablet/mobile and screenshot comparison after integration.
- Product limitations must be reported by actual server state. The interface must never claim that an unreviewed model result is mathematically proved or that source metadata was analyzed.
- No knowingly accepted critical or major UI debt.
