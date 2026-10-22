# AniMocap_Fusion Decisions

## Assign animation curves to Blender

- **Decision:** AniMocap captures, corrects, and selects final full-pose frames; Blender creates the new Action and owns F-Curves, interpolation, and smoothing.
- **Reason:** The native timeline's correction influence curve is not a full bone XYZ animation editor.
- **Consequences:** Export selected sparse Canonical poses using a separate selection state; do not overwrite an existing Action or export only correction deltas.
- **Source:** `平滑抖动并叠加关键帧` (`01a01af1`), implemented in `实现选中帧导入 Blender` (`01a02585`).

## Keep balanced multiview fusion as the default

- **Decision:** Preserve the balanced multiview result by default; expose the old raw reference-view image-plane overwrite only as an explicit compatibility option.
- **Reason:** The old overwrite could retain reference-anchor tail behavior; the recorded three-view comparison improved tail metrics under the balanced default.
- **Consequences:** Existing output can be reproduced with the explicit compatibility switch. Tail-metric improvement does not prove labelled pose accuracy.
- **Source:** `Decide reference-anchor pin fix` (`01a025ce`) and the scoped multiview diagnostics (`019ff607-65fd`, `019ff607-c351`).

## Preserve per-frame base capture while sampling auxiliary experts

- **Decision:** The expert interval setting reduces auxiliary expert calls; base capture and output animation retain every frame.
- **Reason:** Less frequent full inference can save work, but sampling alone can increase drift and is not a trust guarantee.
- **Consequences:** Low confidence, rapid motion, tracking trouble, or expert disagreement can trigger denser expert checks. The two-frame default remained a trial setting pending real-video GPU comparison.
- **Source:** `[PERF] Adaptive Expert Inference` (`01a09d5f`).

## Keep ROI super-resolution claims within tested evidence

- **Decision:** Feed a 2× Maxine VSR person ROI to the pose models and map coordinates back to the source frame.
- **Reason:** A small subject can benefit from a larger model input, but upscaling can also introduce false detail.
- **Consequences:** GPU bridge and targeted coordinate tests establish the path; real-person video stability remains unaccepted until compared on actual clips.
- **Source:** `确认AI放大功能` (`01a0480f`).
