# AniMocap Fusion Design QA

- source visual truth: `build/animocap-ui-target-v2.png`
- implementation screenshot: `build/ui-implemented-v4.png`
- 1:1 side-by-side comparison: `build/ui-design-comparison-v4.png`
- concept viewport: 1488 × 1057 px
- implementation viewport: native Windows outer window, 1487 × 1058 px
- implementation state: local test video, 367-frame smoothed 2.5D pose, reconstructed motion, automatic person range, local visual correction enabled
- capture method: a temporary in-process Win32 `PrintWindow` QA path; the path was removed before the final build

## Result

Passed. No actionable P0, P1, or P2 visual differences remain.

- Layout and hierarchy: the implementation preserves the concept's grouped command bar, five-step workflow, person-scope row, dominant video canvas, upper-right skeleton viewport, lower-right issue rail, diagnostic timeline, status footer, and single primary capture action. The native workspace uses a 64/36 split, within the concept's intended 70/30 visual balance while keeping issue text readable.
- Visual system: true graphite backgrounds, three surface elevations, cool gray borders, cyan primary/selection states, violet motion data, amber confidence and diagnostics, green valid joints, and red error-only accents remain consistent across every surface.
- Typography: Segoe UI handles titles, sections, controls, and body copy; Cascadia Mono handles time values. Control typography is explicit and no browser/default text sizing is involved.
- Media and diagnostic fidelity: the implementation uses the real decoded test video without tinting or reframing, native 2D observations, the real 2.5D skeleton, real low-confidence issues, confidence/ambiguity curves, foot-contact bars, and the actual playhead. The final skeleton scaling keeps the complete figure visible.
- States: active, selected, disabled, pressed, hover, toggle, and primary actions have distinct treatments. The loaded screenshot intentionally shows workflow step 5 active; the concept shows step 1 active.
- Native framing: Windows 11 dark title-bar, border, caption, and rounded-corner attributes match the application palette. A 1320 × 860 minimum window size prevents control collisions and unreadable diagnostic panels.

## Fidelity ledger

1. **Command bar:** all required labels are present and ordered by open/import, motion/save, export, environment/setup, then local visual correction. Compact code-native controls replace the concept's decorative toolbar icons.
2. **Workflow:** the five labels and chevron anatomy match; completed steps use subdued borders and only the active step receives the cyan fill.
3. **Workspace:** the video remains the dominant surface, with the skeleton and issue rail aligned to a single right column. No extra cards, navigation, or metrics were introduced.
4. **Palette and type:** background, surfaces, borders, text hierarchy, accent colors, and monospaced timing closely match the concept.
5. **Skeleton viewport:** the perspective grid, XYZ axes, violet bones, semantic confidence colors, and rotation hint are present. A first-pass head crop was fixed by recalibrating projection scale.
6. **Timeline:** confidence, ambiguity, contact track, selection handles, current marker, start/end timecodes, playback, range, and loop controls are all present and data-driven.
7. **Copy:** above-the-fold functional labels match the supplied inventory. The scope helper retains the product-accurate wording about excluding wings, weapons, pets, and game UI instead of the concept's illustrative sentence.

## Intentional deviations

- The concept's illustrative school scene is replaced by the authorized local test capture; this verifies real product rendering rather than a mock asset.
- The concept shows a thumbnail filmstrip and a second media transport row. The implementation keeps one functional transport surface and does not manufacture thumbnails from a single decoded frame.
- Toolbar symbols remain text-first because the native app has no established icon asset family; only the play/capture glyphs are code-drawn. This avoids inconsistent approximations and preserves legibility at the compact desktop density.

## Verification

- Final native build: passed.
- `animocap_core` CTest: 1/1 passed in 4.69 seconds.
- Existing CLI load paths successfully loaded the local video, pose sequence, and reconstructed motion used by the screenshot.
- Primary state-dependent controls were visibly verified in loaded/disabled states. Capture, correction, range, save, and export handlers were not changed by this visual pass.
- Browser verification was not applicable to this native Win32 UI. The Windows control plugin failed during initialization with a window-enumeration path error, so native `PrintWindow` capture was used instead.
