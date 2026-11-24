---
target: apps/web/src/admin/SettingsPage.tsx
total_score: 33
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:/Users/craig/Git/netballtrials/apps/web/src/admin/SettingsPage.tsx"
target_fingerprint: "sha256:ea6213f4e38e0635b2eece422590736fdf01a96ed7e1ae425b702a5db6ace9b9"
target_path: /Users/craig/Git/netballtrials/apps/web/src/admin/SettingsPage.tsx
timestamp: 2026-11-05T03-02-17Z
slug: apps-web-src-admin-settingspage-tsx
---
⚠️ DEGRADED: single-context (isolated reviewer could not start; configured Node executable was missing)

## Critique: Settings and Admin access
**Target:** `apps/web/src/admin/SettingsPage.tsx` and its embedded Admin roster · **Mode:** Operate

### Design health: 33/40 — Good

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 4 | Roster count, load state, and save/invite feedback are visible. |
| 2 | Match with the real world | 4 | Admin invitation and self-service sign-in are explained in familiar terms. |
| 3 | User control and freedom | 3 | An Admin can remove others but not themselves; removal is confirmed, with no undo. |
| 4 | Consistency and standards | 4 | Settings sections use consistent headings, forms, and controls. |
| 5 | Error prevention | 4 | The TEST limit and self-removal guard prevent common lockout mistakes. |
| 6 | Recognition rather than recall | 4 | Current Admins and available actions are listed directly. |
| 7 | Flexibility and efficiency | 3 | Admins can request their own links; the five-person TEST cap is a constraint. |
| 8 | Aesthetic and minimalist design | 2 | Two helper paragraphs exceed the intended reading measure or wrap awkwardly. |
| 9 | Error recovery | 3 | The page provides actionable recovery, though some service errors remain generic. |
| 10 | Help and documentation | 2 | Help exists, but the Settings page’s secondary form instructions could be more concise. |

### Design specificity
**LLM assessment:** The restrained blue-and-plum shell and task-first Admin roster fit the “Sideline Clipboard” system. Admin access is now easy to find at the top of Settings. The page feels coherent, though the long Settings form makes clear, measured copy especially important.

**Deterministic scan:** CLI detector returned `[]`. The browser overlay found two text-measure issues in `SettingsPage.tsx`: **LINE LENGTH TOO LONG** on the fake-provider notice and **STRAGGLER** on the automatic-email introduction. I injected the overlay in a fresh Playwright page and inspected the desktop and 390px mobile renders. The overlay was not exposed in a user-visible `[Human]` browser tab by this harness.

### Cognitive load and journey
Low overall; sections are grouped and the Admin task is first. The page is lengthy, but the primary task is not buried. The mobile render had no horizontal overflow.

### What’s working
- The Admin roster, five-person TEST count, and self-removal protection make access management clear.
- The invitation is a one-time account creation; Admins can request their own sign-in links afterward.
- The design stays consistent with the existing admin workspace rather than introducing a new pattern.

### Priority issues
1. **[P2] Fake-provider notice has an overly long reading line.**
   This makes the test-only warning harder to scan. **Fix:** cap its measure while preserving the existing message. Suggested command: `/impeccable layout`.

2. **[P2] Automatic-email introduction ends with an orphaned “details.”**
   That lone word makes the paragraph look unfinished, especially on desktop. **Fix:** shorten the copy and constrain it to a readable measure. Suggested command: `/impeccable clarify`.

### Persona red flags
- **Alex, power Admin:** The roster is quick to scan; there is no bulk action, but the TEST roster is capped at five.
- **Sam, accessibility-dependent:** Headings, labels, and named removal buttons are present; the two copy-measure issues affect readability.
- **Casey, mobile:** Admin access appears near the top and the page fits a 390px viewport, though Settings remains a long scroll.

### Minor observations
- Removal is deliberately irreversible from this page; the confirmation explains that sessions and sign-in links will be revoked.
- The read-only Infisical status avoids implying that credentials can still be edited here.

Questions skipped: the critique found two priority issues, and you asked me to fix all of them.
