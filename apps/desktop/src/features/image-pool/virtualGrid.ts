import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/*
 * Virtual grid: renders only the rows near the viewport of a scroll container.
 *
 * - Geometry is computed here and applied as exact pixel sizes, so the scroll
 *   height and each row's offset cannot drift from what CSS lays out (drift
 *   accumulates over tens of thousands of rows otherwise).
 * - The window changes only when the rendered row range or geometry changes;
 *   callers keep the previous object otherwise (`sameGridWindow`), so
 *   scrolling inside a row does not re-render any tile.
 * - `computeGridWindow` is pure; the hook does the measuring.
 */

export type GridWindowInput = {
  /** Container client width/height (scrollbar excluded), CSS px. */
  width: number;
  height: number;
  scrollTop: number;
  itemCount: number;
  /** Smallest acceptable column width; columns stretch to fill the row. */
  minColumnWidth: number;
  /** Gap between columns and between rows. */
  gap: number;
  /** Cell height = columnWidth × aspectRatio + rowExtra. */
  aspectRatio?: number;
  rowExtra?: number;
  /** Horizontal padding inside the scroll container (left + right). */
  paddingX?: number;
  /** Padding above the first row inside the scroll container. */
  paddingTop?: number;
  /** Extra rows rendered above and below the viewport. Default 2. */
  overscanRows?: number;
  /** Force a column count instead of deriving it from minColumnWidth. */
  columns?: number;
};

export type GridWindow = {
  columns: number;
  columnWidth: number;
  cellHeight: number;
  /** Distance between the tops of consecutive rows (cell + gap). */
  rowStride: number;
  totalRows: number;
  /** Height of all rows, without container padding. */
  totalHeight: number;
  /** Rendered rows [startRow, endRow) and items [startIndex, endIndex). */
  startRow: number;
  endRow: number;
  startIndex: number;
  endIndex: number;
  /** Rows actually intersecting the viewport (no overscan). */
  firstVisibleRow: number;
  lastVisibleRow: number;
};

function num(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

export function computeGridWindow(input: GridWindowInput): GridWindow {
  const gap = Math.max(0, num(input.gap, 0));
  const innerWidth = Math.max(1, num(input.width, 0) - Math.max(0, num(input.paddingX, 0)));
  const minColumnWidth = Math.max(1, num(input.minColumnWidth, 1));
  const itemCount = Math.max(0, Math.floor(num(input.itemCount, 0)));
  const overscan = Math.max(0, Math.floor(num(input.overscanRows, 2)));

  const columns = Math.max(1, Math.floor(num(input.columns, (innerWidth + gap) / (minColumnWidth + gap))));
  const columnWidth = Math.max(1, (innerWidth - (columns - 1) * gap) / columns);
  const cellHeight = Math.max(1, Math.ceil(columnWidth * num(input.aspectRatio, 1) + num(input.rowExtra, 0)));
  const rowStride = cellHeight + gap;
  const totalRows = Math.ceil(itemCount / columns);
  const totalHeight = totalRows ? totalRows * rowStride - gap : 0;

  let firstVisibleRow = 0;
  let lastVisibleRow = 0;
  let startRow = 0;
  let endRow = 0;
  if (totalRows) {
    // Offsets are measured from the first row, not from the padding edge.
    const top = Math.max(0, num(input.scrollTop, 0) - Math.max(0, num(input.paddingTop, 0)));
    const bottom = top + Math.max(0, num(input.height, 0));
    firstVisibleRow = Math.min(totalRows - 1, Math.floor(top / rowStride));
    // A row is visible if any pixel of it is; `bottom` itself is exclusive.
    lastVisibleRow = Math.min(totalRows - 1, Math.max(firstVisibleRow, Math.ceil(bottom / rowStride) - 1));
    startRow = Math.max(0, firstVisibleRow - overscan);
    endRow = Math.min(totalRows, lastVisibleRow + 1 + overscan);
  }

  return {
    columns,
    columnWidth,
    cellHeight,
    rowStride,
    totalRows,
    totalHeight,
    startRow,
    endRow,
    startIndex: Math.min(itemCount, startRow * columns),
    endIndex: Math.min(itemCount, endRow * columns),
    firstVisibleRow,
    lastVisibleRow
  };
}

/** True when `b` renders the same DOM as `a`, so the old object can be kept. */
export function sameGridWindow(a: GridWindow, b: GridWindow) {
  return (
    a.columns === b.columns &&
    a.columnWidth === b.columnWidth &&
    a.cellHeight === b.cellHeight &&
    a.rowStride === b.rowStride &&
    a.totalRows === b.totalRows &&
    a.startRow === b.startRow &&
    a.endRow === b.endRow &&
    a.startIndex === b.startIndex &&
    a.endIndex === b.endIndex &&
    a.firstVisibleRow === b.firstVisibleRow &&
    a.lastVisibleRow === b.lastVisibleRow
  );
}

/** Scroll offset that puts the row containing `index` at the top of the viewport. */
export function anchorScrollTop(grid: Pick<GridWindow, "columns" | "rowStride">, index: number, paddingTop = 0) {
  if (index <= 0) return 0;
  return paddingTop + Math.floor(index / grid.columns) * grid.rowStride;
}

export type RevealOptions = {
  /**
   * nearest: move as little as possible. center: center the row.
   * comfort: move only when the row leaves a middle band.
   */
  mode?: "nearest" | "center" | "comfort";
  paddingTop?: number;
  comfortTopRatio?: number;
  comfortBottomRatio?: number;
  /** comfort mode: where the row lands when it must move (0–1 from top). */
  scrollBiasRatio?: number;
};

/** Scroll offset that brings item `index` into view, or null if it already is. */
export function revealScrollTop(
  grid: Pick<GridWindow, "columns" | "cellHeight" | "rowStride" | "totalRows">,
  index: number,
  viewport: { height: number; scrollTop: number },
  options: RevealOptions = {}
): number | null {
  if (index < 0 || !grid.totalRows) return null;
  const { mode = "nearest", paddingTop = 0, comfortTopRatio = 0.18, comfortBottomRatio = 0.72, scrollBiasRatio = 0.35 } = options;
  const row = Math.min(grid.totalRows - 1, Math.floor(index / grid.columns));
  const rowTop = paddingTop + row * grid.rowStride;
  const rowBottom = rowTop + grid.cellHeight;
  const viewTop = viewport.scrollTop;
  const viewBottom = viewTop + viewport.height;

  let target: number | null = null;
  if (mode === "center") {
    target = rowTop - (viewport.height - grid.cellHeight) / 2;
  } else if (mode === "comfort") {
    const bandTop = viewTop + viewport.height * comfortTopRatio;
    const bandBottom = viewTop + viewport.height * comfortBottomRatio;
    if (rowTop < bandTop || rowBottom > bandBottom) target = rowTop - viewport.height * scrollBiasRatio;
  } else if (rowTop < viewTop) {
    target = rowTop - paddingTop;
  } else if (rowBottom > viewBottom) {
    target = rowBottom - viewport.height + paddingTop;
  }
  if (target === null) return null;
  const rounded = Math.max(0, Math.round(target));
  return Math.abs(rounded - viewTop) < 2 ? null : rounded;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export type VirtualGridOptions = Omit<GridWindowInput, "width" | "height" | "scrollTop">;

export type VirtualGridHandle = {
  grid: GridWindow;
  /** Attach to the scroll container; it may mount later than the component. */
  containerRef: (element: HTMLElement | null) => void;
  /** Scroll so `index` is visible. Returns true if the container moved. */
  scrollToIndex: (index: number, options?: RevealOptions) => boolean;
  /** Jump to the top (e.g. after the list contents change). */
  scrollToTop: () => void;
};

/**
 * Measures the scroll container (ResizeObserver plus a passive scroll
 * listener, coalesced to one measurement per animation frame). State changes
 * only when the rendered rows or geometry change.
 */
export function useVirtualGrid(options: VirtualGridOptions): VirtualGridHandle {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const frameRef = useRef(0);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [grid, setGrid] = useState<GridWindow>(() => computeGridWindow({ ...options, width: 0, height: 0, scrollTop: 0 }));

  const read = useCallback(() => {
    if (!element) return null;
    return computeGridWindow({
      ...optionsRef.current,
      width: element.clientWidth,
      height: element.clientHeight,
      scrollTop: element.scrollTop
    });
  }, [element]);

  const gridRef = useRef(grid);
  /** Scroll offset to apply once the re-laid-out content is in the DOM. */
  const pendingScrollRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const el = element;
    let next = read();
    if (!next || !el) return;
    const prev = gridRef.current;
    // Column count changed (resize, tile size): keep the first visible item at
    // the top instead of letting the same offset land somewhere else. The new
    // content may be taller than the old one, so the offset is applied after
    // React has rendered it (see the layout effect below), never clamped now.
    if (prev.totalRows && next.columns !== prev.columns && el.scrollTop > 0) {
      const target = anchorScrollTop(next, prev.firstVisibleRow * prev.columns, optionsRef.current.paddingTop ?? 0);
      if (Math.abs(target - el.scrollTop) >= 1) {
        pendingScrollRef.current = target;
        next = computeGridWindow({ ...optionsRef.current, width: el.clientWidth, height: el.clientHeight, scrollTop: target });
      }
    }
    if (sameGridWindow(prev, next)) return;
    gridRef.current = next;
    setGrid(next);
  }, [element, read]);

  useLayoutEffect(() => {
    const target = pendingScrollRef.current;
    if (target === null || !element) return;
    pendingScrollRef.current = null;
    element.scrollTop = target;
  }, [element, grid]);

  const schedule = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      measure();
    });
  }, [measure]);

  const { itemCount, minColumnWidth, gap, aspectRatio, rowExtra, paddingX, paddingTop, overscanRows, columns } = options;
  useLayoutEffect(() => {
    measure();
  }, [measure, itemCount, minColumnWidth, gap, aspectRatio, rowExtra, paddingX, paddingTop, overscanRows, columns]);

  useEffect(() => {
    if (!element) return;
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    element.addEventListener("scroll", schedule, { passive: true });
    return () => {
      resize.disconnect();
      element.removeEventListener("scroll", schedule);
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [element, schedule]);

  const scrollToIndex = useCallback(
    (index: number, reveal: RevealOptions = {}) => {
      const current = read();
      if (!element || !current) return false;
      const target = revealScrollTop(
        current,
        index,
        { height: element.clientHeight, scrollTop: element.scrollTop },
        { paddingTop: optionsRef.current.paddingTop, ...reveal }
      );
      if (target === null) return false;
      element.scrollTop = target;
      measure();
      return true;
    },
    [element, measure, read]
  );

  const scrollToTop = useCallback(() => {
    if (!element) return;
    element.scrollTop = 0;
    measure();
  }, [element, measure]);

  return { grid, containerRef: setElement, scrollToIndex, scrollToTop };
}

// ── Compatibility API (image pool, dataset review, box label, inbox) ─────────

export type VirtualGridLayout = {
  columns: number;
  rowHeight: number;
  totalRows: number;
  startRow: number;
  startIndex: number;
  endIndex: number;
  columnWidth: number;
};

/** The older grids' CSS pads the scroll container 12px on each side. */
const LEGACY_PADDING_X = 24;

/**
 * The older grids use `floor(width / columnUnit)` columns and a row height
 * that already includes the vertical spacing; both are preserved exactly so
 * their layout does not shift. The window itself comes from the shared core.
 */
function legacyWindow(
  scrollEl: HTMLElement | null,
  itemCount: number,
  columnUnit: number,
  gap: number,
  rowExtra: number,
  aspectRatio: number
) {
  const width = scrollEl?.clientWidth || scrollEl?.offsetWidth || 640;
  const height = scrollEl?.clientHeight || scrollEl?.offsetHeight || 480;
  const innerWidth = Math.max(1, width - LEGACY_PADDING_X);
  const columns = Math.max(1, Math.floor(innerWidth / columnUnit));
  const columnWidth = (innerWidth - Math.max(0, columns - 1) * gap) / columns;
  const rowHeight = Math.ceil(columnWidth * aspectRatio + rowExtra);
  const core = computeGridWindow({
    width: innerWidth,
    height,
    scrollTop: scrollEl?.scrollTop || 0,
    itemCount,
    minColumnWidth: 1,
    columns,
    gap: 0,
    aspectRatio: 0,
    rowExtra: rowHeight,
    overscanRows: 3
  });
  const layout: VirtualGridLayout = {
    columns,
    rowHeight,
    totalRows: Math.max(1, core.totalRows),
    startRow: core.startRow,
    startIndex: core.startIndex,
    endIndex: core.endIndex,
    columnWidth
  };
  return { core, layout };
}

export function computeVirtualGridLayout(
  scrollEl: HTMLElement | null,
  itemCount: number,
  columnUnit = 148,
  gap = 10,
  rowExtra = 52,
  aspectRatio = 1
): VirtualGridLayout {
  return legacyWindow(scrollEl, itemCount, columnUnit, gap, rowExtra, aspectRatio).layout;
}

/** Keep the previous layout object when nothing visible changed. */
export function sameVirtualGridLayout(a: VirtualGridLayout, b: VirtualGridLayout) {
  return (
    a.columns === b.columns &&
    a.rowHeight === b.rowHeight &&
    a.totalRows === b.totalRows &&
    a.startRow === b.startRow &&
    a.startIndex === b.startIndex &&
    a.endIndex === b.endIndex &&
    a.columnWidth === b.columnWidth
  );
}

export type VirtualGridScrollOptions = {
  columnUnit?: number;
  gap?: number;
  rowExtra?: number;
  aspectRatio?: number;
  /** Keep the active row in this band of the viewport (0–1). */
  comfortTopRatio?: number;
  comfortBottomRatio?: number;
  /** When scrolling, bias the row to this fraction from the top. */
  scrollBiasRatio?: number;
};

export function scrollVirtualGridToIndex(
  el: HTMLElement,
  index: number,
  itemCount: number,
  options: VirtualGridScrollOptions = {}
): { scrolled: boolean; layout: VirtualGridLayout } {
  const {
    columnUnit = 148,
    gap = 10,
    rowExtra = 52,
    aspectRatio = 1,
    comfortTopRatio = 0.18,
    comfortBottomRatio = 0.72,
    scrollBiasRatio = 0.35
  } = options;
  const { core, layout } = legacyWindow(el, itemCount, columnUnit, gap, rowExtra, aspectRatio);
  if (index < 0 || !itemCount) return { scrolled: false, layout };
  const target = revealScrollTop(core, index, { height: el.clientHeight, scrollTop: el.scrollTop }, {
    mode: "comfort",
    comfortTopRatio,
    comfortBottomRatio,
    scrollBiasRatio
  });
  if (target === null) return { scrolled: false, layout };
  el.scrollTop = target;
  return { scrolled: true, layout: computeVirtualGridLayout(el, itemCount, columnUnit, gap, rowExtra, aspectRatio) };
}
