# Design Token and Site Consistency — Design

**Date:** 2026-10-19
**Status:** Draft for review

## Goal

Resolve the valid color and font-size detector findings and the remaining small public-site consistency issues without changing the Chisholm visual identity or adding new visual effects.

## Current design authority

- `DESIGN.md` defines the Chisholm blue/plum palette, ink/paper/canvas neutrals, system sans-serif voice, and flat surfaces.
- `.impeccable/design.json` is the detector-facing sidecar for that system.
- The latest detector reported 17 color and 6 font-size advisories in `apps/web/src/styles.css`. The amber focus outline `#a65c00` is already documented in `DESIGN.md` but is absent from the sidecar, so that finding is a false positive.

## Decisions

### Reconcile valid detector findings with the existing system

- Review each of the 23 findings by usage before editing. Replace repeated literal values with existing CSS variables wherever they are the same color or size.
- Add named semantic tokens only for existing, intentional state and compact-data values that the interface already uses (for example, placeholder, focus, success, warning, error, and dense-data typography). Keep their current rendered values; do not introduce a new palette or typography scale without evidence.
- Record those tokens in both `DESIGN.md` and `.impeccable/design.json` so the source design brief and detector sidecar agree.
- Register `#a65c00` as the documented focus-amber token in the sidecar. Preserve its current appearance and contrast; do not remove or recolor focus rings to silence the detector.
- Replace literal white surfaces with the existing Paper token where they have the same meaning. Keep intentional black/white print treatments documented as print-specific exceptions if they cannot use the same token without changing print output.
- Keep the single system font, flat surfaces, existing brand colors, and current computed font sizes. No remote fonts, shadows, gradients, or decorative accents.

### Clarify public-site link labels

- Rename the banner link “Chisholm Netball home” to “Chisholm Netball website” so it is not confused with the trials-app home/wordmark link.
- Make the selection-policy link disclose that it opens a new tab, in visible or accessible text. Retain safe `target`/`rel` behavior.

## Acceptance criteria

- The detector reports no unaccounted color or font-size warnings for the target stylesheet. Any remaining documented exception must be intentional, visible in the design source, and reviewed rather than silenced with a broad ignore.
- The focus-amber finding is resolved by documenting the existing `#a65c00` token, with the rendered focus ring unchanged.
- Semantic color and typography tokens match the actual values already used; no visual drift is introduced by token refactoring.
- The public-home external link is clearly labeled as the club website, and the policy link discloses its new-tab behavior.
- The written-color rule remains intact: every team-color swatch has a written name and sufficient boundary contrast.

## Non-goals

- Rebranding the application, changing the blue/plum palette, adding fonts or visual effects, or changing the public registration/payment flow.
- Blindly replacing every CSS literal with a token without checking its role and computed appearance.
- Changing CSS values merely to improve the critique score.
