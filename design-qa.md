# AniMocap Fusion Design QA

- source visual truth path: `build/animocap-ui-target-v1.png`
- implementation screenshot path: `build/ui-implemented-v3.png`
- combined comparison: `build/ui-design-comparison-v3.png` (1:1) and `build/ui-design-comparison-v3-small.png` (overview)
- viewport: native Windows outer window, 1487 × 1058 px
- source pixels: 1487 × 1058; implementation pixels: 1487 × 1058
- density normalization: none; exact pixel dimensions were matched before comparison
- state: user test video loaded with 367-frame smoothed 2.5D pose and reconstructed motion; automatic person range active; local VLM correction enabled

**Findings**

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: target and native implementation use the same compact Windows desktop hierarchy. The implementation uses Segoe UI/ClearType; weights and wrapping remain readable at the matched viewport.
- Spacing and layout rhythm: the implementation preserves the target's dominant video area, upper-right skeleton monitor, lower-right issue list, top workflow, and bottom diagnostic timeline. Persistent controls remain visible without overflow.
- Colors and visual tokens: near-black surfaces, cyan primary actions/status, violet tracking curves, amber uncertainty, and subdued borders map consistently to the target.
- Image quality and asset fidelity: the implementation renders the original decoded video at high quality with no extra vertical flip. The full character, head, hands, and feet are visible. Joint overlays and the 2.5D skeleton are native diagnostic rendering rather than substituted imagery.
- Copy and content: labels describe the actual local pipeline, automatic/manual person range, actionable joint issues, and capture action. No prompt or mockup-only product language leaks into the interface.

P3 follow-up polish: the target shows thumbnail filmstrips and more transport controls. The native implementation currently provides play plus direct click/drag scrubbing and a compact video track; this is functionally complete but visually less rich.

**Full-view comparison evidence**

The 1:1 combined comparison confirms the same major region proportions and workflow hierarchy. The implementation intentionally uses the supplied Honkai: Star Rail capture rather than the generated reference character.

**Focused region comparison evidence**

The standalone 1487 × 1058 implementation capture was inspected at original resolution for the header, person-range toolbar, video/2D overlay, 2.5D skeleton, issue rows, timeline, and primary action. No additional crop was needed because all labels and controls were legible at original resolution.

**Comparison history**

1. Initial capture: blocked by an unquoted video path in the QA launch command, header/control overlap, pipeline/toggle overlap, and a desktop notification overlay. Fixed the native header layout, constrained the pipeline label, quoted the test paths, and replaced the bright system trackbar with the native self-drawn scrubber.
2. Second capture: video, full-body framing, pose overlay, issue list, and diagnostics loaded correctly. Comparison remained blocked because the maximized viewport did not match the target and a desktop notification obscured the 3D panel.
3. Final capture: used PrintWindow and an exact 1487 × 1058 window. No external overlay, overflow, or actionable P0/P1/P2 mismatch remained.

**Primary interactions tested**

- test video opens without inversion or quality loss
- automatic full-body range keeps head, hands, and feet
- 2D observations and 2.5D preview load together
- issue list populates from low-confidence joints
- custom timeline renders confidence and ambiguity state and supports direct scrubbing
- local VLM unavailability falls back without aborting the capture pipeline

final result: passed