# ECOS WCAG 2.2 Accessibility Notes — V117 P13-03

**Date:** 2026-05-29
**Scope:** apps/web pages
**Standard:** WCAG 2.2, COGA 1.0
**EU AI Act Reference:** Art.13(4) — accessible human oversight interface requirements

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical (A)  | 2 | Open → P14-02 |
| High (AA)     | 6 | Open → P14-02 |
| Medium (AA)   | 4 | Noted |
| Low (AAA)     | 3 | Noted |

---

## Critical — WCAG 2.1 Level A

### A-01: Missing `alt` text on dynamic status icons
**Pages:** `/validator`, `/dashboard`
**Criterion:** 1.1.1 Non-text Content
**Finding:** Confidence-level icons (green/red circles) render without `alt` or `aria-label`.
Screen readers announce them as unlabelled images.
**Fix:**
```jsx
// Before
<span className="dot green" />
// After
<span className="dot green" role="img" aria-label="High confidence — auto-approved" />
```

### A-02: Form inputs missing programmatic labels
**Pages:** `/validator` (task submission form), `/onboarding`
**Criterion:** 1.3.1 Info and Relationships
**Finding:** Several `<input>` and `<textarea>` elements lack `<label>` associations.
`id`/`htmlFor` binding is absent; placeholder text is the only label — invisible to screen readers.
**Fix:** Add `<label htmlFor="task_instruction">Task instruction</label>` with matching `id`.

---

## High — WCAG 2.1 Level AA

### AA-01: Color-only status communication
**Pages:** `/chain`, `/leaderboard`, `/validator-dashboard`
**Criterion:** 1.4.1 Use of Color
**Finding:** Approval/rejection status communicated via green/red background only.
No text label or icon shape distinguishes the states for color-blind users.
**Fix:** Add text labels ("Approved", "Rejected") or distinguishable icons alongside color coding.

### AA-02: Insufficient color contrast — ghost text
**Pages:** All pages using `color: #9ca3af` (gray-400) on white
**Criterion:** 1.4.3 Contrast (Minimum) — required 4.5:1, measured 2.8:1
**Fix:** Darken secondary text to `#6b7280` (4.6:1) or `#4b5563` (6.1:1).

### AA-03: Keyboard focus not visible
**Pages:** `/chat`, `/validator`
**Criterion:** 2.4.7 Focus Visible
**Finding:** Default browser focus ring removed by `outline: none` without a custom replacement.
Tab navigation is invisible for keyboard-only users.
**Fix:** Replace `outline: none` with `outline: 2px solid #2563eb; outline-offset: 2px`.

### AA-04: Live region missing for real-time updates
**Pages:** `/validator` (approval queue SSE updates), `/chain` (new audit entries)
**Criterion:** 4.1.3 Status Messages
**Finding:** New items appear in the approval queue without announcing to screen readers.
**Fix:** Add `role="status"` or `aria-live="polite"` wrapper around the queue container.

### AA-05: Missing `lang` attribute on HTML element
**Pages:** All (apps/web/src/app/layout.jsx)
**Criterion:** 3.1.1 Language of Page
**Finding:** `<html>` element has no `lang` attribute. Screen readers cannot determine language.
**Fix:** `<html lang="en">` in layout.jsx.

### AA-06: Timeout on task approval not announced
**Pages:** `/validator`
**Criterion:** 2.2.1 Timing Adjustable (COGA SC 3.2)
**Finding:** Task approval has an SLA countdown timer. Expiry is not announced to screen readers.
**Fix:** Use `aria-live="assertive"` on the countdown when < 60 seconds remain.

---

## Medium — WCAG 2.1 Level AA

### AA-M-01: Landmark regions incomplete
**Pages:** All
**Criterion:** 4.1.2 Name, Role, Value
**Finding:** Pages lack `<main>`, `<nav>`, `<header>` landmarks. Screen reader users cannot jump
between page sections.
**Fix:** Wrap primary content in `<main>`, nav links in `<nav>`, page header in `<header>`.

### AA-M-02: Modal dialogs lack focus management
**Pages:** `/admin`, `/mission/:id`
**Criterion:** 2.4.3 Focus Order
**Finding:** Dialogs open without moving focus to the modal container. Tab order escapes the dialog.
**Fix:** Use `dialog` element or add `tabIndex={-1}` + `.focus()` on open.

### AA-M-03: Tables missing headers
**Pages:** `/leaderboard`, `/chain`
**Criterion:** 1.3.1 Info and Relationships
**Finding:** Data tables use `<div>` grid layout instead of `<table>` with `<th scope>` headers.
**Fix:** Migrate to semantic `<table>` with proper `scope="col"` / `scope="row"` headers.

### AA-M-04: Error messages not associated with inputs
**Pages:** `/onboarding`, `/validator` login form
**Criterion:** 3.3.1 Error Identification
**Finding:** Error text appears near inputs but is not linked via `aria-describedby`.
**Fix:** `<input aria-describedby="err_field_id"> <p id="err_field_id" role="alert">Error text</p>`

---

## Low — WCAG 2.1 Level AAA

### AAA-01: No skip navigation link
**All pages** — add `<a href="#main-content" className="sr-only focus:not-sr-only">Skip to content</a>`

### AAA-02: PDF/export links not labeled as file type
**Admin export** — append "(opens PDF)" to download links.

### AAA-03: Session timeout warning
**Validator session** — warn users 5 minutes before JWT expiry via accessible notification.

---

## P14-02 Remediation Priority

| Priority | Item | Effort |
|----------|------|--------|
| P1 | A-01: Add `alt` text to status icons | 2h |
| P1 | A-02: Label all form inputs | 3h |
| P2 | AA-05: Add `lang` to HTML element | 0.5h |
| P2 | AA-03: Restore focus ring | 1h |
| P3 | AA-01: Add text labels to status colors | 4h |
| P3 | AA-02: Fix contrast on ghost text | 2h |
| P4 | AA-04: Add live region for queue updates | 2h |
| P4 | AA-06: Announce countdown timer | 1h |

---

*ECOS WCAG_ACCESSIBILITY_NOTES.md · V117 P13-03 · 2026-05-29*
