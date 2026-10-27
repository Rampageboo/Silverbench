import { memo, useState, type MouseEvent, type ReactNode } from "react";
import type { GridWindow } from "../image-pool/virtualGrid";
import { galleryImageUrl, type GalleryAssetSummary } from "./galleryApi";
import { contentRatingLabel, METADATA_FORMAT_LABELS, shouldObscure } from "./galleryDomain";
import { IconCheck, IconEyeOff, IconStar } from "../../ui/icons";

export const GRID_GAP = 8;
export const GRID_PADDING = 12;

type Props = {
  containerRef: (element: HTMLElement | null) => void;
  grid: GridWindow;
  /** null while the first chunk of the query is loading. */
  total: number | null;
  getItem: (index: number) => GalleryAssetSummary | undefined;
  focusedId: string | null;
  selected: Set<string>;
  revealAll: boolean;
  revealed: Set<string>;
  loading: boolean;
  empty: ReactNode;
  onFocus: (id: string, index: number) => void;
  onToggleSelect: (id: string, index: number) => void;
  onRangeSelect: (index: number) => void;
};

function Thumb({ id, obscured }: { id: string; obscured: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="gal-tile__broken">No thumbnail</span>;
  return (
    <img
      src={galleryImageUrl(id)}
      alt=""
      decoding="async"
      draggable={false}
      className={obscured ? "is-obscured" : undefined}
      onError={() => setFailed(true)}
    />
  );
}

type TileProps = {
  asset: GalleryAssetSummary;
  index: number;
  focused: boolean;
  isSelected: boolean;
  obscured: boolean;
  onFocus: (id: string, index: number) => void;
  onToggleSelect: (id: string, index: number) => void;
  onRangeSelect: (index: number) => void;
};

// Memoized so a window shift only renders the tiles that enter it.
const Tile = memo(function Tile({
  asset,
  index,
  focused,
  isSelected,
  obscured,
  onFocus,
  onToggleSelect,
  onRangeSelect
}: TileProps) {
  function onClick(event: MouseEvent) {
    if (event.shiftKey) onRangeSelect(index);
    else if (event.ctrlKey || event.metaKey) onToggleSelect(asset.id, index);
    else onFocus(asset.id, index);
  }
  return (
    <button
      type="button"
      role="option"
      aria-selected={focused}
      aria-posinset={index + 1}
      className={`gal-tile${focused ? " is-focused" : ""}${isSelected ? " is-selected" : ""}${asset.missing ? " is-missing" : ""}`}
      title={asset.filename}
      onClick={onClick}
    >
      <span className="gal-tile__media">
        <Thumb id={asset.id} obscured={obscured} />
        {obscured ? (
          <span className="gal-tile__veil">
            <IconEyeOff size={16} />
            <span>{contentRatingLabel(asset.contentRating)}</span>
          </span>
        ) : null}
      </span>
      <span
        className={`gal-tile__check${isSelected ? " is-on" : ""}`}
        role="checkbox"
        aria-checked={isSelected}
        aria-label={isSelected ? "Deselect" : "Select"}
        onClick={(event) => {
          event.stopPropagation();
          if (event.shiftKey) onRangeSelect(index);
          else onToggleSelect(asset.id, index);
        }}
      >
        {isSelected ? <IconCheck size={12} /> : null}
      </span>
      <span className="gal-tile__badges">
        {asset.hasMetadata ? (
          <span
            className="gal-badge gal-badge--meta"
            title={`Original metadata: ${METADATA_FORMAT_LABELS[asset.metadata?.format] ?? asset.metadata?.format}`}
          >
            Meta
          </span>
        ) : null}
        {asset.missing ? <span className="gal-badge gal-badge--missing">Offline</span> : null}
      </span>
      {asset.rating ? (
        <span className="gal-tile__rating" aria-label={`${asset.rating} stars`}>
          <IconStar size={10} />
          {asset.rating}
        </span>
      ) : null}
    </button>
  );
});

/**
 * Only the rows the virtual grid window covers are in the DOM. Row geometry
 * comes from the window (exact px), so offsets never drift over long lists.
 * The scroll container is always mounted: the grid hook measures it.
 */
export function GalleryGrid({
  containerRef,
  grid,
  total,
  getItem,
  focusedId,
  selected,
  revealAll,
  revealed,
  loading,
  empty,
  onFocus,
  onToggleSelect,
  onRangeSelect
}: Props) {
  const slots: ReactNode[] = [];
  for (let index = grid.startIndex; index < grid.endIndex; index += 1) {
    const asset = getItem(index);
    if (!asset) {
      slots.push(
        <span key={`slot-${index}`} className="gal-tile gal-tile--placeholder" aria-hidden="true" />
      );
      continue;
    }
    slots.push(
      <Tile
        key={asset.id}
        asset={asset}
        index={index}
        focused={asset.id === focusedId}
        isSelected={selected.has(asset.id)}
        obscured={shouldObscure(asset.contentRating, revealAll) && !revealed.has(asset.id)}
        onFocus={onFocus}
        onToggleSelect={onToggleSelect}
        onRangeSelect={onRangeSelect}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={`gal-scroll${loading ? " is-loading" : ""}`}
      style={{ padding: `${GRID_PADDING}px` }}
      role="listbox"
      aria-label="Images"
      aria-multiselectable="true"
      aria-setsize={total ?? undefined}
    >
      {total === null ? (
        <div className="gal-grid-empty gal-muted">Loading…</div>
      ) : total === 0 ? (
        <div className="gal-grid-empty">{empty}</div>
      ) : (
        <div className="gal-grid-spacer" style={{ height: grid.totalHeight }}>
          <div
            className="gal-grid"
            style={{
              transform: `translateY(${grid.startRow * grid.rowStride}px)`,
              gridTemplateColumns: `repeat(${grid.columns}, ${grid.columnWidth}px)`,
              gridAutoRows: `${grid.cellHeight}px`,
              gap: `${GRID_GAP}px`
            }}
          >
            {slots}
          </div>
        </div>
      )}
    </div>
  );
}
