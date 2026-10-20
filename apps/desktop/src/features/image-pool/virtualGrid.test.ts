import { describe, expect, it } from "vitest";
import {
  anchorScrollTop,
  computeGridWindow,
  computeVirtualGridLayout,
  revealScrollTop,
  sameGridWindow,
  scrollVirtualGridToIndex,
  type GridWindowInput
} from "./virtualGrid";

const base: GridWindowInput = {
  width: 1000,
  height: 600,
  scrollTop: 0,
  itemCount: 1000,
  minColumnWidth: 120,
  gap: 8,
  paddingX: 24,
  paddingTop: 12,
  overscanRows: 2
};

describe("computeGridWindow geometry", () => {
  it("fits as many columns of at least minColumnWidth as the inner width allows", () => {
    const grid = computeGridWindow(base);
    // inner 976: 7 × 120 + 6 × 8 = 888 fits, 8 × 120 + 7 × 8 = 1016 does not.
    expect(grid.columns).toBe(7);
    expect(grid.columnWidth * grid.columns + 8 * (grid.columns - 1)).toBeCloseTo(976);
    expect(grid.columnWidth).toBeGreaterThanOrEqual(120);
  });

  it("derives cell height from aspect ratio and extra, stride adds the gap", () => {
    const grid = computeGridWindow({ ...base, aspectRatio: 1.5, rowExtra: 20 });
    expect(grid.cellHeight).toBe(Math.ceil(grid.columnWidth * 1.5 + 20));
    expect(grid.rowStride).toBe(grid.cellHeight + 8);
  });

  it("total height has no trailing gap and no rows for no items", () => {
    const grid = computeGridWindow(base);
    expect(grid.totalRows).toBe(Math.ceil(1000 / 7));
    expect(grid.totalHeight).toBe(grid.totalRows * grid.rowStride - 8);
    const empty = computeGridWindow({ ...base, itemCount: 0 });
    expect(empty).toMatchObject({ totalRows: 0, totalHeight: 0, startIndex: 0, endIndex: 0 });
  });

  it("keeps one column on very narrow containers and ignores bad numbers", () => {
    const grid = computeGridWindow({ ...base, width: 50, height: Number.NaN, scrollTop: -40 });
    expect(grid.columns).toBe(1);
    expect(grid.startRow).toBe(0);
  });
});

describe("computeGridWindow window", () => {
  it("renders the visible rows plus overscan, clamped at the top", () => {
    const grid = computeGridWindow(base);
    expect(grid.firstVisibleRow).toBe(0);
    expect(grid.startRow).toBe(0);
    expect(grid.endRow).toBe(grid.lastVisibleRow + 1 + 2);
  });

  it("counts a partially visible bottom row as visible", () => {
    const grid = computeGridWindow({ ...base, overscanRows: 0 });
    const visiblePx = 600;
    const fullRows = Math.floor(visiblePx / grid.rowStride);
    // 600px is not a whole number of rows, so a partial row is showing.
    expect(visiblePx % grid.rowStride).not.toBe(0);
    expect(grid.lastVisibleRow).toBe(fullRows);
  });

  it("measures from the first row, not the container's padding edge", () => {
    const atPadding = computeGridWindow({ ...base, scrollTop: 12, overscanRows: 0 });
    expect(atPadding.firstVisibleRow).toBe(0);
    const intoRowTwo = computeGridWindow({ ...base, overscanRows: 0, scrollTop: 12 + atPadding.rowStride * 2 + 1 });
    expect(intoRowTwo.firstVisibleRow).toBe(2);
  });

  it("clamps at the bottom of a 50k-item library", () => {
    const start = computeGridWindow({ ...base, itemCount: 50000 });
    const end = computeGridWindow({ ...base, itemCount: 50000, scrollTop: start.totalHeight });
    expect(end.endIndex).toBe(50000);
    expect(end.endRow).toBe(end.totalRows);
    expect(end.endIndex - end.startIndex).toBeLessThan(200);
  });

  it("covers every item intersecting the viewport at any offset", () => {
    for (let scrollTop = 0; scrollTop < 5000; scrollTop += 37) {
      const grid = computeGridWindow({ ...base, overscanRows: 0, scrollTop });
      const top = scrollTop - 12;
      for (let row = 0; row < grid.totalRows; row += 1) {
        const rowTop = row * grid.rowStride;
        const rowBottom = rowTop + grid.cellHeight;
        const intersects = rowBottom > top && rowTop < top + 600;
        if (intersects) {
          expect(row).toBeGreaterThanOrEqual(grid.startRow);
          expect(row).toBeLessThan(grid.endRow);
        }
      }
    }
  });

  it("is unchanged when scrolling within a row, so no re-render is needed", () => {
    const a = computeGridWindow({ ...base, scrollTop: 300 });
    const b = computeGridWindow({ ...base, scrollTop: 301 });
    expect(sameGridWindow(a, b)).toBe(true);
    const c = computeGridWindow({ ...base, scrollTop: 300 + a.rowStride });
    expect(sameGridWindow(a, c)).toBe(false);
  });
});

describe("revealScrollTop", () => {
  const grid = computeGridWindow(base);
  const viewport = { height: 600, scrollTop: 0 };

  it("does nothing for visible items", () => {
    expect(revealScrollTop(grid, 3, viewport, { paddingTop: 12 })).toBeNull();
  });

  it("nearest scrolls just enough to show a row below", () => {
    const index = grid.columns * 20;
    const target = revealScrollTop(grid, index, viewport, { paddingTop: 12 })!;
    const rowBottom = 12 + 20 * grid.rowStride + grid.cellHeight;
    expect(target + 600).toBeGreaterThanOrEqual(rowBottom);
    expect(target + 600 - rowBottom).toBeLessThanOrEqual(12);
  });

  it("nearest scrolls up to a row above", () => {
    const target = revealScrollTop(grid, 0, { height: 600, scrollTop: 3000 }, { paddingTop: 12 });
    expect(target).toBe(0);
  });

  it("center puts the row in the middle", () => {
    const index = grid.columns * 30;
    const target = revealScrollTop(grid, index, viewport, { mode: "center", paddingTop: 12 })!;
    const rowCenter = 12 + 30 * grid.rowStride + grid.cellHeight / 2;
    expect(Math.abs(target + 300 - rowCenter)).toBeLessThanOrEqual(1);
  });

  it("ignores invalid indexes and empty grids", () => {
    expect(revealScrollTop(grid, -1, viewport)).toBeNull();
    expect(revealScrollTop(computeGridWindow({ ...base, itemCount: 0 }), 0, viewport)).toBeNull();
  });
});

describe("anchorScrollTop", () => {
  it("puts the anchor's row at the top after the column count changes", () => {
    const wide = computeGridWindow({ ...base, scrollTop: 4000 });
    const anchor = wide.firstVisibleRow * wide.columns;
    const narrow = computeGridWindow({ ...base, width: 600 });
    const top = anchorScrollTop(narrow, anchor, 12);
    const after = computeGridWindow({ ...base, width: 600, scrollTop: top });
    const firstVisibleIndex = after.firstVisibleRow * after.columns;
    expect(firstVisibleIndex).toBeLessThanOrEqual(anchor);
    expect(anchor).toBeLessThan(firstVisibleIndex + after.columns);
  });

  it("is zero for the first item", () => {
    expect(anchorScrollTop(computeGridWindow(base), 0, 12)).toBe(0);
  });
});

describe("compatibility layout", () => {
  function el(clientWidth: number, clientHeight: number, scrollTop: number) {
    return { clientWidth, clientHeight, scrollTop, offsetWidth: clientWidth, offsetHeight: clientHeight } as HTMLElement;
  }

  function oldFormula(width: number, itemCount: number, columnUnit: number, gap: number, rowExtra: number, aspectRatio: number) {
    const inner = Math.max(1, width - 24);
    const columns = Math.max(1, Math.floor(inner / columnUnit));
    const columnWidth = (inner - Math.max(0, columns - 1) * gap) / columns;
    return { columns, columnWidth, rowHeight: Math.ceil(columnWidth * aspectRatio + rowExtra), totalRows: Math.ceil(Math.max(itemCount, 1) / columns) };
  }

  it("keeps the old column count, column width and row height at every width", () => {
    for (let width = 200; width <= 2400; width += 13) {
      for (const [unit, gap, extra, aspect] of [
        [148, 10, 52, 1],
        [138, 10, 36, 10 / 16],
        [148, 10, 58, 1]
      ]) {
        const layout = computeVirtualGridLayout(el(width, 700, 0), 500, unit, gap, extra, aspect);
        const old = oldFormula(width, 500, unit, gap, extra, aspect);
        expect(layout).toMatchObject(old);
      }
    }
  });

  it("always renders every visible item", () => {
    for (let scrollTop = 0; scrollTop < 20000; scrollTop += 113) {
      const layout = computeVirtualGridLayout(el(1100, 700, scrollTop), 2000);
      const firstVisible = Math.floor(scrollTop / layout.rowHeight) * layout.columns;
      const lastVisible = Math.min(2000, Math.ceil((scrollTop + 700) / layout.rowHeight) * layout.columns) - 1;
      expect(layout.startIndex).toBeLessThanOrEqual(firstVisible);
      expect(layout.endIndex).toBeGreaterThan(lastVisible);
    }
  });

  it("keeps a single row for an empty grid as before", () => {
    expect(computeVirtualGridLayout(el(800, 600, 0), 0).totalRows).toBe(1);
  });

  it("comfort scrolling matches the old rule", () => {
    const element = el(1100, 700, 0);
    const result = scrollVirtualGridToIndex(element, 400, 2000);
    const layout = computeVirtualGridLayout(el(1100, 700, 0), 2000);
    const row = Math.floor(400 / layout.columns);
    expect(result.scrolled).toBe(true);
    expect(element.scrollTop).toBe(Math.max(0, Math.round(row * layout.rowHeight - 700 * 0.35)));
    // Already inside the comfort band: no movement.
    expect(scrollVirtualGridToIndex(element, 400, 2000).scrolled).toBe(false);
  });
});
