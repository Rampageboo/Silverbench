export type VirtualGridLayout = {
  columns: number;
  rowHeight: number;
  totalRows: number;
  startRow: number;
  startIndex: number;
  endIndex: number;
  columnWidth: number;
};

export function computeVirtualGridLayout(
  scrollEl: HTMLElement | null,
  itemCount: number,
  columnUnit = 148,
  gap = 10,
  rowExtra = 52,
  aspectRatio = 1
): VirtualGridLayout {
  const width = Math.max(1, (scrollEl?.clientWidth || scrollEl?.offsetWidth || 640) - 24);
  const columns = Math.max(1, Math.floor(width / columnUnit));
  const columnWidth = (width - Math.max(0, columns - 1) * gap) / columns;
  const rowHeight = Math.ceil(columnWidth * aspectRatio + rowExtra);
  const totalRows = Math.ceil(Math.max(itemCount, 1) / columns);
  const scrollTop = scrollEl?.scrollTop || 0;
  const viewportRows = Math.ceil(
    (scrollEl?.clientHeight || scrollEl?.offsetHeight || 480) / Math.max(rowHeight, 1)
  );
  const startRow = Math.max(0, Math.floor(scrollTop / Math.max(rowHeight, 1)) - 2);
  const endRow = Math.min(totalRows, startRow + viewportRows + 5);
  return {
    columns,
    rowHeight,
    totalRows,
    startRow,
    startIndex: startRow * columns,
    endIndex: Math.min(itemCount, endRow * columns),
    columnWidth
  };
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
  const layout = computeVirtualGridLayout(el, itemCount, columnUnit, gap, rowExtra, aspectRatio);
  if (index < 0 || !itemCount) return { scrolled: false, layout };

  const columns = Math.max(1, layout.columns);
  const rowHeight = Math.max(1, layout.rowHeight);
  const row = Math.floor(index / columns);
  const rowTop = row * rowHeight;
  const rowBottom = rowTop + rowHeight;
  const viewTop = el.scrollTop;
  const comfortTop = viewTop + el.clientHeight * comfortTopRatio;
  const comfortBottom = viewTop + el.clientHeight * comfortBottomRatio;

  if (rowTop >= comfortTop && rowBottom <= comfortBottom) {
    return { scrolled: false, layout };
  }

  const targetTop = Math.max(0, Math.round(row * rowHeight - el.clientHeight * scrollBiasRatio));
  if (Math.abs(el.scrollTop - targetTop) < 2) {
    return { scrolled: false, layout };
  }

  el.scrollTop = targetTop;
  return {
    scrolled: true,
    layout: computeVirtualGridLayout(el, itemCount, columnUnit, gap, rowExtra, aspectRatio)
  };
}
