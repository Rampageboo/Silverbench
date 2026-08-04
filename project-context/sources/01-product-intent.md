# Product Intent

YoloWorkBench is a local-first desktop workbench for YOLO computer-vision
dataset work: image and video import, labeling (detection boxes plus
classification), auto-labeling with PT models, dataset prep/merge/export, and
training runs.

## Target user

A single practitioner working on their own machine against their own data.
The product optimizes for direct local control over large media directories,
not for collaboration, hosting, or multi-tenant use.

## Direction

Video-first labeling is the active direction: treat video as a primary source
rather than a pre-processing step that produces loose frames.

## Non-goals

- Not a hosted or multi-user service. The backend binds localhost only, and
  that is a product decision, not a deployment detail.
- Not a general annotation platform. Scope is YOLO detection and
  classification workflows.
- The legacy Qt shell (`run_legacy_qt.bat`) and the legacy web frontend are
  retained for reference only. They are not on the main path and are excluded
  from the codebase map; do not extend them.
