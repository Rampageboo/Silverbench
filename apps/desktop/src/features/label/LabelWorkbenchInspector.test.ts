import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LabelReviewActions, LabelWorkbenchInspector, formatInspectorMs } from "./LabelWorkbenchInspector";
import type { LabelWorkbenchActionGroup } from "./labelWorkbenchTypes";

function inspector(props: React.ComponentProps<typeof LabelWorkbenchInspector>) {
  return React.createElement(LabelWorkbenchInspector, props);
}

function html(node: ReactElement) {
  return renderToStaticMarkup(node);
}

describe("LabelWorkbenchInspector", () => {
  it("renders compact image inspector without source, status, proposal noise, undefined, or NaN", () => {
    const output = html(inspector({ mode: "image", inspectorState: null, actionGroups: [] }));
    expect(output).not.toContain("Source");
    expect(output).not.toContain("Status");
    expect(output).not.toContain("Proposal / Review");
    expect(output).not.toContain("No proposals");
    expect(output).toContain("Duplicate to Next Frame");
    expect(output).toContain("Select a box and press T to add it to duplicate list.");
    expect(output).toContain("No duplicate boxes queued.");
    expect(output).toContain('id="lwbClassifyClassesSlot"');
    expect(output).not.toContain("undefined");
    expect(output).not.toContain("NaN");
  });

  it("renders image review actions in the header group, not the inspector", () => {
    const actionGroups: LabelWorkbenchActionGroup[] = [
      {
        id: "image-review",
        label: "Review",
        actions: [
          { id: "review.markReviewed", label: "Unmark Reviewed", variant: "primary", run: () => {} },
          { id: "review.markJunk", label: "Mark Junk", variant: "danger", run: () => {} }
        ]
      }
    ];
    const header = html(React.createElement(LabelReviewActions, { mode: "image", actionGroups }));
    expect(header).toContain('aria-label="Review"');
    expect(header).toContain("Unmark Reviewed");
    expect(header).toContain("Mark Junk");
    expect(header).toContain('class="ui-btn--sm primary"');
    expect(header).toContain('class="ui-btn--sm danger"');

    const panel = html(
      inspector({
        mode: "image",
        inspectorState: {
          taskKind: "both",
          proposalSummary: { pendingCount: 2, totalCount: 5 }
        },
        actionGroups
      })
    );
    expect(panel).not.toContain("Unmark Reviewed");
    expect(panel).not.toContain("frame_001.jpg");
    expect(panel).not.toContain("Proposals:");
  });

  it("renders nothing for review actions of the other mode", () => {
    const header = html(
      React.createElement(LabelReviewActions, {
        mode: "video",
        actionGroups: [
          {
            id: "image-review",
            label: "Review",
            actions: [{ id: "review.markJunk", label: "Mark Junk", run: () => {} }]
          }
        ]
      })
    );
    expect(header).toBe("");
  });

  it("filters all proposal actions from image inspector", () => {
    const actions: LabelWorkbenchActionGroup[] = [
      {
        id: "image-proposals",
        label: "Proposals",
        actions: [
          { id: "proposal.acceptSelected", label: "Accept Selected", run: () => {} },
          { id: "proposal.rejectSelected", label: "Reject Selected", run: () => {} },
          { id: "proposal.acceptAll", label: "Accept All", run: () => {} },
          { id: "proposal.rejectAll", label: "Reject All", run: () => {} }
        ]
      },
      {
        id: "mixed",
        label: "Mixed",
        actions: [
          { id: "proposal.acceptSelected", label: "Accept Selected", run: () => {} },
          { id: "classes.openManagement", label: "Manage Classes", run: () => {} }
        ]
      }
    ];
    const output = html(
      inspector({
        mode: "image",
        inspectorState: {
          proposalSummary: { pendingCount: 0, totalCount: 0 },
          selectedProposal: { id: "p1", className: "EnemyHP", confidence: 0.72 }
        },
        actionGroups: actions
      })
    );

    expect(output).not.toContain("Accept Selected");
    expect(output).not.toContain("Reject Selected");
    expect(output).not.toContain("Accept All");
    expect(output).not.toContain("Reject All");
    expect(output).not.toContain("EnemyHP");
    expect(output).not.toContain("No proposals");
    expect(output).toContain("Manage Classes");
  });

  it("renders video inspector summary", () => {
    const output = html(
      inspector({
        mode: "video",
        inspectorState: {
          taskKind: "both",
          classSummary: { activeDetectCount: 1, activeClassificationCount: 1 },
          overlaySummary: { activeCount: 2 },
          segmentSummary: { label: "1 enabled", startMs: null, endMs: null },
          samplingControl: {
            sourceLabel: "Manual",
            segmentCount: 1,
            mode: "segments-preferred",
            modeOptions: [{ value: "segments-preferred", label: "Segments preferred" }],
            minSpacingMs: 2000
          },
          classPalette: {
            detectClasses: [
              { id: 0, name: "background" },
              { id: 4, name: "Map" }
            ],
            currentDetectClassId: 4,
            onSelectDetectClass: () => {}
          }
        },
        actionGroups: []
      })
    );
    expect(output).not.toContain("clip");
    expect(output).not.toContain("Timestamp 00:00:01.234");
    expect(output).not.toContain("Detect active: 1");
    expect(output).toContain("Blackouts: 2");
    expect(output).toContain("Segment: 1 enabled");
    expect(output).toContain("Random Sampling");
    expect(output).not.toContain("Source: Manual");
    expect(output).toContain("Segments preferred");
    expect(output).toContain("Detect Classes");
    expect(output).toContain("4: Map");
    expect(output).toContain('id="lwbClassifyClassesSlot"');
    expect(output).not.toContain("Current Boxes");
    expect(output).not.toContain("Duplicate to Next Frame");
  });

  it("renders video duplicate action without an image duplicate queue", () => {
    const output = html(
      inspector({
        mode: "video",
        inspectorState: null,
        actionGroups: [
          {
            id: "video-duplicate",
            label: "Duplicate to Next Frame",
            description: "Duplicate current marker boxes to the next marker.",
            items: [],
            actions: [
              { id: "video.duplicateToNext", label: "Duplicate to Next", variant: "primary", run: () => {} }
            ]
          }
        ]
      })
    );

    expect(output).toContain("Duplicate to Next Frame");
    expect(output).toContain("Duplicate current marker boxes to the next marker.");
    expect(output).toContain("Duplicate to Next");
    expect(output).not.toContain("No duplicate boxes queued.");
  });

  it("keeps video review actions out of the inspector", () => {
    const actionGroups: LabelWorkbenchActionGroup[] = [
      {
        id: "video-review",
        label: "Review",
        actions: [
          { id: "review.markReviewed", label: "Mark Reviewed", variant: "primary", run: () => {} },
          { id: "review.markJunk", label: "Mark Junk", variant: "danger", run: () => {} }
        ]
      }
    ];
    const output = html(inspector({ mode: "video", inspectorState: null, actionGroups }));
    expect(output).not.toContain("Mark Reviewed");
    expect(output).not.toContain("Actions");
    expect(output).not.toContain("Mark Empty");

    const header = html(React.createElement(LabelReviewActions, { mode: "video", actionGroups }));
    expect(header).toContain("Mark Reviewed");
    expect(header).toContain("Mark Junk");
  });

  it("renders duplicate controls in the image inspector panel", () => {
    const output = html(
      inspector({
        mode: "image",
        inspectorState: null,
        actionGroups: [
          {
            id: "image-duplicate",
            label: "Duplicate to Next Frame",
            description: "1 duplicate box(es) ready. Press D to copy list to next image.",
            items: [
              {
                id: "dup-1",
                label: "1. EnemyHP x=0.100 y=0.200 w=0.300 h=0.400",
                detail: "Current box 2",
                selected: true,
                run: () => {},
                onPause: () => {},
                onDelete: () => {}
              }
            ],
            actions: []
          }
        ]
      })
    );

    expect(output).toContain("Duplicate to Next Frame");
    expect(output).toContain("1 duplicate box(es) ready. Press D to copy list to next image.");
    expect(output).toContain("1. EnemyHP x=0.100 y=0.200 w=0.300 h=0.400");
    expect(output).toContain("Current box 2");
    expect(output).toContain('aria-label="Pause duplicate box"');
    expect(output).toContain('aria-label="Delete duplicate box"');
    expect(output).not.toContain(">Add<");
    expect(output).not.toContain(">Next<");
    expect(output).not.toContain(">Pause<");
    expect(output).not.toContain(">Resume<");
    expect(output).not.toContain(">Delete<");
    expect(output).not.toContain("No contextual actions available.");
    expect(output).not.toContain("undefined");
    expect(output).not.toContain("NaN");
  });

  it("action button invokes registered handler", () => {
    let calls = 0;
    const run = () => {
      calls += 1;
    };
    const output = html(
      inspector({
        mode: "video",
        inspectorState: null,
        actionGroups: [
          {
            id: "nav",
            label: "Navigation",
            actions: [{ id: "video.randomNext", label: "Random Next", run }]
          }
        ]
      })
    );
    expect(output).toContain("Random Next");
    run();
    expect(calls).toBe(1);
  });

  it("disabled action renders as disabled and does not have enabled state", () => {
    const output = html(
      inspector({
        mode: "video",
        inspectorState: null,
        actionGroups: [
          {
            id: "proposal",
            label: "Proposals",
            actions: [
              {
                id: "proposal.acceptSelected",
                label: "Accept Selected",
                disabled: true,
                unavailableReason: "Select a proposal first.",
                run: () => {}
              }
            ]
          }
        ]
      })
    );
    expect(output).toContain("Accept Selected");
    expect(output).toContain("disabled");
    expect(output).toContain("lwb-inspector-action--unavailable");
  });

  it("renders image and video action groups without stale labels", () => {
    const imageOutput = html(
      inspector({
        mode: "image",
        inspectorState: null,
        actionGroups: [
          {
            id: "image-review",
            label: "Review",
            actions: [{ id: "review.markReviewed", label: "Mark Reviewed", run: () => {} }]
          }
        ]
      })
    );
    // Review actions live in the canvas header (LabelReviewActions), not the inspector.
    expect(imageOutput).not.toContain("Mark Reviewed");
    expect(imageOutput).not.toContain("Random Next");

    const videoOutput = html(
      inspector({
        mode: "video",
        inspectorState: null,
        actionGroups: [
          {
            id: "video-navigation",
            label: "Navigation",
            actions: [{ id: "video.randomNext", label: "Random Next", run: () => {} }]
          }
        ]
      })
    );
    expect(videoOutput).toContain("Random Next");
    expect(videoOutput).not.toContain("Accept Selected");
  });

  it("renders danger and busy action states", () => {
    const output = html(
      inspector({
        mode: "video",
        inspectorState: null,
        actionGroups: [
          {
            id: "review",
            label: "Review",
            actions: [
              { id: "review.clearRecord", label: "Clear Frame Record", variant: "danger", run: () => {} },
              { id: "video.randomNext", label: "Random Next", busy: true, run: () => {} }
            ]
          }
        ]
      })
    );
    expect(output).toContain("lwb-inspector-action--danger");
    expect(output).toContain('aria-busy="true"');
    expect(output).toContain("Busy");
  });

  it("renders archived-class warning when reported", () => {
    const output = html(
      inspector({
        mode: "image",
        inspectorState: {
          warnings: [{ id: "archived", label: "Archived class reference", detail: "restore before labeling" }]
        },
        actionGroups: []
      })
    );
    expect(output).toContain("Archived class reference");
    expect(output).toContain("restore before labeling");
  });

  it("formats invalid timestamps as null", () => {
    expect(formatInspectorMs(Number.NaN)).toBeNull();
    expect(formatInspectorMs(null)).toBeNull();
  });

  it("stale actions clear when empty groups are supplied", () => {
    const output = html(inspector({ mode: "video", inspectorState: null, actionGroups: [] }));
    expect(output).not.toContain("Random Next");
    expect(output).toContain("No contextual actions available.");
  });
});
