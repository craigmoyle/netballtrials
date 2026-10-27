---
name: Chisholm Netball Trials
description: "The Sideline Clipboard: a calm, practical workspace for running netball trials."
colors:
  chisholm-blue: "#618ec8"
  light-blue: "#a9bfe1"
  deep-plum: "#511631"
  dark-plum: "#3c1025"
  ink: "#211b20"
  paper: "#ffffff"
  canvas: "#f0f5fc"
  line: "#78869a"
  placeholder-ink: "#4f4b55"
  focus-amber: "#a65c00"
  invalid-border: "#9c1c26"
  camera-background: "#161216"
  success-ink: "#103f2b"
  success-surface: "#dff2e8"
  warning-ink: "#4d3500"
  warning-surface: "#fff0bf"
  error-ink: "#721a20"
  error-surface: "#fde9e9"
  warning-panel: "#fff3d0"
  warning-border: "#a65c00"
typography:
  display:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(2.25rem, 7vw, 4.5rem)"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  headline:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(1.75rem, 4vw, 2.5rem)"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(1.25rem, 3vw, 1.6rem)"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1rem"
    fontWeight: 650
    lineHeight: 1.5
  public-trial-title:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(1.25rem, 2vw, 1.5rem)"
    fontWeight: 700
    lineHeight: 1.2
  scan-result:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(1.5rem, 5vw, 2.5rem)"
    fontWeight: 800
    lineHeight: 1.2
  game-section:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.2rem"
    fontWeight: 700
    lineHeight: 1.2
  game-table:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.92rem"
    fontWeight: 400
    lineHeight: 1.5
  game-table-mobile:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.84rem"
    fontWeight: 400
    lineHeight: 1.5
  consequence-note:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  tight: "0.2rem"
  standard: "0.25rem"
  button: "0.3rem"
components:
  button-primary:
    backgroundColor: "{colors.deep-plum}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "0.55rem 1rem"
  button-primary-hover:
    backgroundColor: "{colors.dark-plum}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.deep-plum}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "0.55rem 1rem"
  form-control:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.standard}"
    padding: "0.55rem 0.7rem"
    width: "min(100%, 36rem)"
  app-bar:
    backgroundColor: "{colors.chisholm-blue}"
    textColor: "{colors.ink}"
    padding: "0.75rem clamp(1rem, 4vw, 3rem)"
  public-banner:
    backgroundColor: "{colors.chisholm-blue}"
    textColor: "{colors.ink}"
    padding: "clamp(2rem, 7vw, 4rem) 0"
  table-head:
    backgroundColor: "{colors.light-blue}"
    textColor: "{colors.ink}"
  error-summary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.standard}"
    padding: "1rem 1.25rem"
  message-confirmation:
    backgroundColor: "{colors.light-blue}"
    textColor: "{colors.ink}"
    rounded: "{rounded.standard}"
    padding: "1rem 1.25rem"
---

# Design System: Chisholm Netball Trials

## Overview

**Creative North Star: "The Sideline Clipboard"**

The interface is a calm, practical clipboard for match day: committee members can scan registrations, court assignments and player numbers quickly, while families get clear next steps on a phone. The Chisholm wordmark and blue-and-plum palette provide recognition; the rest of the interface stays straightforward so trial information leads.

Public pages are welcoming and reassuring. Admin pages favor clear status, compact workflows and explainable data. Printed selectors carry the same hierarchy onto paper, with strong grids, writable fields and team-color names that remain useful in grayscale.

**Key Characteristics:**
- Operational, task-first layouts with familiar controls.
- Blue surfaces identify the club shell; plum identifies actions and links.
- Data tables and print sheets prioritize legibility over decoration.
- A single system sans-serif voice across screens and forms.

## Colors

The palette uses Chisholm Blue for the shell, Deep Plum for actions, and Light Blue to distinguish data surfaces. Ink and paper do most of the reading work; state colors are reserved for feedback.

### Primary
- **Deep Plum** — the primary action and link color; use the darker plum for hover and pressed emphasis.

### Secondary
- **Chisholm Blue** — the application header and public home banner.

### Tertiary
- **Light Blue** — table headers and low-emphasis information surfaces.

### Neutral
- **Ink** — body text and headings.
- **Paper** — form fields, error summaries and other white surfaces.
- **Canvas** — the page background.
- **Line** — dividers and control borders.

**Focus and status:** Focus uses Focus Amber; invalid controls use Invalid Border. Placeholder Ink keeps hint text readable, and Camera Background sits behind the scanner feed. Success, warning and error messages use separate green, ochre and red text/surface pairs; they communicate state, not decoration. The browser theme-color metadata is a legacy exception; the CSS palette and Deep Plum token are the visual source of truth.

### Named Rules
**The Written Color Rule.** A team-color swatch always appears with its written name. Grayscale printing must not remove the distinction between teams.

**The One Accent Rule.** Deep Plum carries the main action; Chisholm Blue belongs to the shell and broad club surfaces. Keep both purposeful.

## Typography

**Display Font:** System UI with the native sans-serif fallbacks defined in the token layer.

**Body Font:** The same system UI stack and native fallbacks.

**Label/Mono Font:** No separate label or monospaced family; labels use the same sans-serif voice.

**Character:** Familiar and neutral, with firm weights for labels and headings. Typography supports quick scanning rather than adding a separate editorial voice.

### Hierarchy
- **Display** — the oversized public-home headline.
- **Headline** — page titles such as Events and Full Game List.
- **Title** — section headings and panels.
- **Body** — event details, helper copy and dense player data.
- **Label** — form labels, navigation and primary controls.
- **Public trial title** — headings for individual trial listings.
- **Scan result** — prominent scanner feedback.
- **Game section** — event and court headings in the Full Game List.
- **Game table** — compact game data, with a smaller mobile position-table scale.
- **Consequence note** — compact explanatory copy beside consequential Admin actions.

Use the display scale only on the public home page. Admin screens keep a tighter hierarchy. Prose is kept to a readable measure where practical; data tables may run wider and scroll within their own region.

### Named Rules
**The Single Voice Rule.** Do not introduce a display font or an unrelated type family; the interface uses one system sans-serif stack.

## Layout

The app shell centers content within a responsive container with a one-rem minimum side gutter and a 76-rem maximum width. Standard pages cap their content at 62rem; the public page container is 52rem, forms cap at 44rem, and public reading copy stays near 70ch. The public trial list presents details in two columns, then stacks them on narrow screens.

Admin pages keep global navigation at the top. The Full Game List uses a desktop sidebar and collapses it at or below the 56-rem breakpoint. At or below 38rem, the header and data tables adapt for phones; wide reports scroll inside their own table region instead of widening the page. Printed schedules are A4 landscape, one court per page.

## Elevation & Depth

The system is flat: there is no box-shadow vocabulary. Hierarchy comes from blue and white surfaces, restrained plum accents, borders and spacing. Focus rings and status panels communicate state rather than floating the interface above the page.

### Named Rules
**The Flat Surface Rule.** Use borders and tonal surfaces for structure; do not add shadows to controls or panels.

## Shapes

Most surfaces are square-edged. Inputs and information panels use a small radius; buttons are only slightly softer, while tables and print grids stay square. Borders are thin in the app and darker in paper layouts so handwriting fields remain clear.

## Components

### Buttons
Primary buttons use a solid plum fill and white text. Secondary buttons use a white surface, plum text and plum outline. Hover darkens the plum; disabled actions visibly recede. All controls retain a high-contrast keyboard focus ring.

### Inputs and fields
Labels sit above native inputs and selects. Fields use a white surface, ink text and a line border; invalid fields add a red border and a concise message. Keep fields full-width within their form, then let the form itself set the measure.

### Navigation
The app bar is Chisholm Blue with dark links, a plum lower rule and the club wordmark on a white panel. Navigation text links remain underlined; the wordmark and button-style calls to action are exceptions. The mobile header wraps rather than shrinking its controls.

The four Full Game List views—Full Game List, Position View, Player Statistics and Player Reference—are navigation items, not a native select. Keep them visible and directly selectable on desktop and mobile, with a clear active state and keyboard operation. Do not hide these core views behind a dropdown. Player Statistics include Games, ranked-position and Other assignments, Unique opponents, and Repeat meetings; state the meaning of opponent metrics and show the total repeated-pair count for the schedule.

Expose Communications as a direct Admin destination and from the event workflow. Keep the workflow groups and their links visible when the tools menu is open on mobile; do not nest core destinations behind another disclosure.

### Lists and tables
Public trial entries are separated by rules, not cards. Tables use a Light Blue header and plain ink text. The game list, statistics and reference views use captions and row/column headers; mobile tables scroll within their own region. Participant lists show the assigned Number next to the player's name wherever it exists; before check-in, show a clear unassigned state rather than implying a Number has been issued.

### Member associations
Manage the association name and its primary contact name and email together. Keep contact details clearly labelled and restricted to the Admin workspace; they are not part of parent registration or volunteer check-in views.

### Communications workspace
Use one Communications workspace for event participants and member-association contacts. Make the audience choice explicit, then show searchable, filterable recipients in a readable list with a selection control. Participant rows include Number when assigned, player name, association and relevant registration/check-in context. Filters and individual include/exclude controls must let an Admin reach the intended audience without exposing one family's contacts to another.

Keep reusable templates, send scheduling and delivery history inside the Communications workspace. Before sending or scheduling, show the selected audience and recipient count. Scheduled sends use Australia/Melbourne time and expose their next-send time, status, edit/cancel action and delivery outcome. Failed or ambiguous delivery recovery stays with its message history; retrying an ambiguous result requires confirmation because it may duplicate email.

### Feedback panels
Validation summaries use a plain white panel with a plum outline; invalid controls and scan errors use red treatments. Warnings use ochre text on pale yellow, while successful updates use green. These treatments are restrained and always include words, not color alone.

### Printed selectors
Selectors and the blank game sheet are landscape paper forms. Team A and Team B sit side by side with swatches and written color names; player rows show Number, choices, Rating and Notes/Feedback. Keep the grid and writing areas black and white printable.

## Do's and Don'ts

### Do:
- **Do** preserve the supplied club wordmark and its white backing.
- **Do** use Number for a player's assigned identifier; reserve “bib color” for team uniforms.
- **Do** pair each team-color swatch with its written name.
- **Do** retain visible keyboard focus and text labels for statuses.
- **Do** keep the public form calm and the Admin tables dense but readable.

### Don't:
- **Don't** use color as the only team identifier.
- **Don't** add decorative photography, remote fonts or unprovided brand assets.
- **Don't** add drop shadows, gradients or rounded-card scaffolding to the otherwise flat interface.
- **Don't** treat the legacy browser theme-color metadata as the canonical plum for interface components.
