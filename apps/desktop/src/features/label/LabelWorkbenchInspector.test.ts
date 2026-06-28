import React, { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LabelWorkbenchInspector, formatInspectorMs } from "./LabelWorkbenchInspector";
import type { LabelWorkbenchActionGroup } from "./labelWorkbenchTypes";

type TestElementProps = {
  children?: ReactNode;
  onClick?: () => void;
};

function inspector(props: React.ComponentProps<typeof LabelWorkbenchInspector>) {
  return React.createElement(LabelWorkbenchInspector, props);
}

function html(node: ReactElement) {
  return renderToStaticMarkup(node);
}

function countText(output: string, text: string) {
  return output.split(text).length - 1;
}

function childrenOf(props: TestElementProps) {
  return React.Children.toArray(props.children);
}

function expand(node: ReactNode): ReactNode {
  if (!React.isValidElement<TestElementProps>(node)) return node;
  if (typeof node.type === "function") {
    return expand((node.type as (props: unknown) => ReactNode)(node.props));
  }
  return React.cloneElement(
    node,
    node.props,
    ...childrenOf(node.props).map((child) => expand(child))
  );
}

function findButtonByText(node: ReactNode, text: string): ReactElement<TestElementProps> | null {
  const expanded = expand(node);
  if (!React.isValidElement<TestElementProps>(expanded)) return null;
  if (expanded.type === "button" && childrenOf(expanded.props).join("") === text) {
    return expanded;
  }
  for (const child of childrenOf(expanded.props)) {
    const found = findButtonByText(child, text);
    if (found) return found;
  }
  return null;
}

describe("LabelWorkbenchInspector", () => {
  it("renders empty state without undefined or NaN", () => {
    const output = html(inspector({ mode: "image", sourceSummary: null, inspectorState: null, actionGroups: [] }));
    expect(output).toContain("No image selected");
    expect(output).toContain("No contextual actions available.");
    expect(output).not.toContain("undefined");
    expect(output).not.toContain("NaN");
  });

  it("renders image inspector summary", () => {
    const output = html(inspector({
      mode: "image",
      sourceSummary: {
        kind: "image",
        filename: "frame_001.jpg",
        currentIndex: 1,
        totalImages: 4,
        reviewStatus: "approved",
      },
      inspectorState: {
        taskKind: "detect",
        classSummary: { observedClassCount: 3 },
        proposalSummary: { pendingCount: 2, totalCount: 5 },
      },
      actionGroups: [],
    }));
    expect(output).toContain("frame_001.jpg");
    expect(output).toContain("2 / 4");
    expect(output).toContain("Reviewed");
    expect(output).toContain("Observed: 3");
    expect(output).toContain("Proposals: 2 pending / 5 total");
  });

  it("renders proposal review details and invokes proposal action handlers", () => {
    let accepted = 0;
    const node = inspector({
      mode: "image",
      sourceSummary: {
        kind: "image",
        filename: "frame_002.jpg",
        currentIndex: 0,
        totalImages: 2,
        reviewStatus: "unreviewed",
      },
      inspectorState: {
        taskKind: "detect",
        reviewStatus: "unreviewed",
        proposalSummary: { pendingCount: 1, totalCount: 1 },
        selectedProposal: {
          id: "p1",
          classId: 2,
          className: "2: car",
          confidence: 0.87,
        },
      },
      actionGroups: [{
        id: "image-proposals",
        label: "Proposals",
        actions: [{ id: "proposal.acceptSelected", label: "Accept Selected", run: () => { accepted += 1; } }],
      }],
    });
    const output = html(node);
    expect(output).toContain("Proposal / Review");
    expect(output).toContain("Selected: 2: car");
    expect(output).toContain("Confidence: 87%");
    const button = findButtonByText(node, "Accept Selected");
    button?.props.onClick?.();
    expect(accepted).toBe(1);
  });

  it("hides proposal action buttons and shows one empty state when proposal count is zero", () => {
    const output = html(inspector({
      mode: "image",
      sourceSummary: {
        kind: "image",
        filename: "empty.jpg",
        currentIndex: 0,
        totalImages: 1,
        reviewStatus: "unreviewed",
      },
      inspectorState: {
        taskKind: "detect",
        proposalSummary: { pendingCount: 0, totalCount: 0 },
      },
      actionGroups: [{
        id: "image-proposals",
        label: "Proposals",
        actions: [
          { id: "proposal.acceptSelected", label: "Accept Selected", disabled: true, unavailableReason: "No proposals on the current image." },
          { id: "proposal.rejectSelected", label: "Reject Selected", disabled: true, unavailableReason: "No proposals on the current image." },
          { id: "proposal.acceptAll", label: "Accept All", disabled: true, unavailableReason: "No proposals on the current image." },
          { id: "proposal.rejectAll", label: "Reject All", disabled: true, unavailableReason: "No proposals on the current image." },
        ],
      }],
    }));

    expect(output).toContain("No proposals on this image.");
    expect(countText(output, "No proposals on this image.")).toBe(1);
    expect(output).not.toContain("Accept Selected");
    expect(output).not.toContain("Reject Selected");
    expect(output).not.toContain("Accept All");
    expect(output).not.toContain("Reject All");
    expect(output).not.toContain("No proposals on the current image.");
  });

  it("shows batch proposal actions and one selection hint when proposals exist without a selected proposal", () => {
    const output = html(inspector({
      mode: "image",
      sourceSummary: {
        kind: "image",
        filename: "proposals.jpg",
        currentIndex: 0,
        totalImages: 1,
        reviewStatus: "unreviewed",
      },
      inspectorState: {
        taskKind: "detect",
        proposalSummary: { pendingCount: 2, totalCount: 2 },
      },
      actionGroups: [{
        id: "image-proposals",
        label: "Proposals",
        actions: [
          { id: "proposal.acceptSelected", label: "Accept Selected", disabled: true, unavailableReason: "Select a proposal first." },
          { id: "proposal.rejectSelected", label: "Reject Selected", disabled: true, unavailableReason: "Select a proposal first." },
          { id: "proposal.acceptAll", label: "Accept All", run: () => {} },
          { id: "proposal.rejectAll", label: "Reject All", run: () => {} },
        ],
      }],
    }));

    expect(output).toContain("Proposals: 2 pending / 2 total");
    expect(output).toContain("Select a proposal to accept or reject it.");
    expect(countText(output, "Select a proposal to accept or reject it.")).toBe(1);
    expect(output).toContain("Accept All");
    expect(output).toContain("Reject All");
    expect(output).not.toContain("Accept Selected");
    expect(output).not.toContain("Reject Selected");
  });

  it("shows selected proposal actions and summary when a proposal is selected", () => {
    const output = html(inspector({
      mode: "image",
      sourceSummary: {
        kind: "image",
        filename: "selected.jpg",
        currentIndex: 0,
        totalImages: 1,
        reviewStatus: "unreviewed",
      },
      inspectorState: {
        taskKind: "detect",
        proposalSummary: { pendingCount: 2, totalCount: 2 },
        selectedProposal: {
          id: "p1",
          className: "EnemyHP",
          confidence: 0.72,
          archived: true,
        },
      },
      actionGroups: [{
        id: "image-proposals",
        label: "Proposals",
        actions: [
          { id: "proposal.acceptSelected", label: "Accept Selected", run: () => {} },
          { id: "proposal.rejectSelected", label: "Reject Selected", run: () => {} },
          { id: "proposal.acceptAll", label: "Accept All", run: () => {} },
          { id: "proposal.rejectAll", label: "Reject All", run: () => {} },
        ],
      }],
    }));

    expect(output).toContain("Selected: EnemyHP");
    expect(output).toContain("Confidence: 72%");
    expect(output).toContain("Selected proposal class is archived.");
    expect(output).toContain("Accept Selected");
    expect(output).toContain("Reject Selected");
    expect(output).toContain("Accept All");
    expect(output).toContain("Reject All");
  });

  it("does not duplicate no-proposal messages or render invalid proposal text", () => {
    const output = html(inspector({
      mode: "image",
      sourceSummary: null,
      inspectorState: {
        proposalSummary: { pendingCount: 0, totalCount: 0 },
      },
      actionGroups: [{
        id: "image-proposals",
        label: "Proposals",
        actions: [
          { id: "proposal.acceptSelected", label: "Accept Selected", disabled: true, unavailableReason: "No proposals on the current image." },
          { id: "proposal.rejectSelected", label: "Reject Selected", disabled: true, unavailableReason: "No proposals on the current image." },
        ],
      }],
    }));

    expect(countText(output, "No proposals")).toBe(1);
    expect(output).not.toContain("undefined");
    expect(output).not.toContain("NaN");
  });

  it("renders class palette and excludes archived classes from active display", () => {
    const output = html(inspector({
      mode: "image",
      sourceSummary: null,
      inspectorState: {
        taskKind: "detect",
        classSummary: { activeDetectCount: 2, totalDetectCount: 3 },
        classPalette: {
          detectClasses: [
            { id: 0, name: "cat" },
            { id: 1, name: "archived dog", archived: true },
            { id: 2, name: "car" },
          ],
          currentDetectClassId: 2,
          readOnlyReason: "Class selection remains owned by the child page.",
        },
      },
      actionGroups: [],
    }));
    expect(output).toContain("Active Detect");
    expect(output).toContain("0: cat");
    expect(output).toContain("2: car");
    expect(output).not.toContain("archived dog");
    expect(output).toContain("Class selection remains owned by the child page.");
  });

  it("renders video inspector summary", () => {
    const output = html(inspector({
      mode: "video",
      sourceSummary: {
        kind: "video-timestamp",
        videoName: "clip",
        timestampMs: 1234,
        reviewed: false,
        hasDetectTask: true,
        hasClfTask: true,
      },
      inspectorState: {
        taskKind: "both",
        classSummary: { activeDetectCount: 1, activeClassificationCount: 1 },
        classPalette: {
          detectClasses: [{ id: 0, name: "person" }],
          classificationClasses: [{ key: "ok", name: "OK" }],
          currentDetectClassId: 0,
          currentClassificationKey: "ok",
        },
        overlaySummary: { activeCount: 2 },
        segmentSummary: { label: "1 enabled", startMs: null, endMs: null },
      },
      actionGroups: [],
    }));
    expect(output).toContain("clip");
    expect(output).toContain("Timestamp 00:00:01.234");
    expect(output).toContain("Detect");
    expect(output).toContain("Classify");
    expect(output).toContain("Active Detect");
    expect(output).toContain("Active Classify");
    expect(output).toContain("Blackouts: 2");
    expect(output).toContain("Segment: 1 enabled");
  });

  it("renders disabled unavailable actions", () => {
    const actions: LabelWorkbenchActionGroup[] = [{
      id: "proposal",
      label: "Proposals",
      actions: [{
        id: "proposal.acceptSelected",
        label: "Accept Selected",
        disabled: true,
        unavailableReason: "Owned by child page",
      }],
    }];
    const output = html(inspector({ mode: "image", sourceSummary: null, inspectorState: null, actionGroups: actions }));
    expect(output).toContain("Accept Selected");
    expect(output).toContain("disabled");
    expect(output).toContain("Owned by child page");
  });

  it("action button invokes registered handler", () => {
    let calls = 0;
    const node = inspector({
      mode: "video",
      sourceSummary: null,
      inspectorState: null,
      actionGroups: [{
        id: "nav",
        label: "Navigation",
        actions: [{ id: "video.randomNext", label: "Random Next", run: () => { calls += 1; } }],
      }],
    });
    const button = findButtonByText(node, "Random Next");
    expect(button).not.toBeNull();
    button?.props.onClick?.();
    expect(calls).toBe(1);
  });

  it("disabled action does not invoke registered handler", () => {
    let calls = 0;
    const node = inspector({
      mode: "image",
      sourceSummary: null,
      inspectorState: null,
      actionGroups: [{
        id: "proposal",
        label: "Proposals",
        actions: [{
          id: "proposal.acceptSelected",
          label: "Accept Selected",
          disabled: true,
          unavailableReason: "Select a proposal first.",
          run: () => { calls += 1; },
        }],
      }],
    });
    const button = findButtonByText(node, "Accept Selected");
    expect(button).not.toBeNull();
    button?.props.onClick?.();
    expect(calls).toBe(0);
  });

  it("renders image and video action groups without stale labels", () => {
    const imageOutput = html(inspector({
      mode: "image",
      sourceSummary: null,
      inspectorState: null,
      actionGroups: [{
        id: "image-review",
        label: "Review",
        actions: [{ id: "review.markReviewed", label: "Mark Reviewed", run: () => {} }],
      }],
    }));
    expect(imageOutput).toContain("Mark Reviewed");
    expect(imageOutput).not.toContain("Random Next");

    const videoOutput = html(inspector({
      mode: "video",
      sourceSummary: null,
      inspectorState: null,
      actionGroups: [{
        id: "video-navigation",
        label: "Navigation",
        actions: [{ id: "video.randomNext", label: "Random Next", run: () => {} }],
      }],
    }));
    expect(videoOutput).toContain("Random Next");
    expect(videoOutput).not.toContain("Accept Selected");
  });

  it("renders danger and busy action states", () => {
    const output = html(inspector({
      mode: "video",
      sourceSummary: null,
      inspectorState: null,
      actionGroups: [{
        id: "review",
        label: "Review",
        actions: [
          { id: "review.clearRecord", label: "Clear Frame Record", variant: "danger", run: () => {} },
          { id: "video.randomNext", label: "Random Next", busy: true, run: () => {} },
        ],
      }],
    }));
    expect(output).toContain("lwb-inspector-action--danger");
    expect(output).toContain("aria-busy=\"true\"");
    expect(output).toContain("Busy");
  });

  it("renders archived-class warning when reported", () => {
    const output = html(inspector({
      mode: "image",
      sourceSummary: null,
      inspectorState: {
        warnings: [{ id: "archived", label: "Archived class reference", detail: "restore before labeling" }],
      },
      actionGroups: [],
    }));
    expect(output).toContain("Archived class reference");
    expect(output).toContain("restore before labeling");
  });

  it("formats invalid timestamps as null", () => {
    expect(formatInspectorMs(Number.NaN)).toBeNull();
    expect(formatInspectorMs(null)).toBeNull();
  });

  it("stale actions clear when empty groups are supplied", () => {
    const output = html(inspector({ mode: "video", sourceSummary: null, inspectorState: null, actionGroups: [] }));
    expect(output).not.toContain("Random Next");
    expect(output).toContain("No contextual actions available.");
  });
});
