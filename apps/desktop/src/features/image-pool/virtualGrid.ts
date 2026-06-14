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
