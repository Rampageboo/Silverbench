import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { galleryImageUrl, type GalleryAssetSummary } from "./galleryApi";
import { contentRatingLabel, METADATA_FORMAT_LABELS, shouldObscure } from "./galleryDomain";
import { IconCheck, IconEyeOff, IconStar } from "../../ui/icons";

type Props = {
  items: GalleryAssetSummary[];
  focusedId: string | null;
  selected: Set<string>;
  revealAll: boolean;
  revealed: Set<string>;
  tileSize: number;
  loading: boolean;
  empty: ReactNode;
  onFocus: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onRangeSelect: (id: string) => void;
};

function Thumb({ asset, obscured }: { asset: GalleryAssetSummary; obscured: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className="gal-tile__broken">无法生成缩略图</span>;
  }
  return (
    <img
      src={galleryImageUrl(asset.id)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className={obscured ? "is-obscured" : undefined}
      onError={() => setFailed(true)}
    />
  );
}

export function GalleryGrid({
  items,
  focusedId,
  selected,
  revealAll,
  revealed,
  tileSize,
  loading,
  empty,
  onFocus,
  onToggleSelect,
  onRangeSelect
}: Props) {
  const focusedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusedId]);

  function onClick(event: MouseEvent, id: string) {
    if (event.shiftKey) onRangeSelect(id);
    else if (event.ctrlKey || event.metaKey) onToggleSelect(id);
    else onFocus(id);
  }

  if (!items.length) {
    return <div className={`gal-grid-empty${loading ? " is-loading" : ""}`}>{loading ? "加载中…" : empty}</div>;
  }

  return (
    <div
      className={`gal-grid${loading ? " is-loading" : ""}`}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))` }}
      role="listbox"
      aria-label="图片"
      aria-multiselectable="true"
    >
      {items.map((asset) => {
        const obscured = shouldObscure(asset.contentRating, revealAll) && !revealed.has(asset.id);
        const isSelected = selected.has(asset.id);
        const isFocused = asset.id === focusedId;
        return (
          <button
            key={asset.id}
            ref={isFocused ? focusedRef : null}
            type="button"
            role="option"
            aria-selected={isFocused}
            className={`gal-tile${isFocused ? " is-focused" : ""}${isSelected ? " is-selected" : ""}${asset.missing ? " is-missing" : ""}`}
            title={asset.filename}
            onClick={(event) => onClick(event, asset.id)}
          >
            <span className="gal-tile__media">
              <Thumb asset={asset} obscured={obscured} />
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
              aria-label={isSelected ? "取消选择" : "选择"}
              onClick={(event) => {
                event.stopPropagation();
                if (event.shiftKey) onRangeSelect(asset.id);
                else onToggleSelect(asset.id);
              }}
            >
              {isSelected ? <IconCheck size={12} /> : null}
            </span>
            <span className="gal-tile__badges">
              {asset.hasMetadata ? (
                <span className="gal-badge gal-badge--meta" title={`原始元数据：${METADATA_FORMAT_LABELS[asset.metadata?.format] ?? asset.metadata?.format}`}>
                  元
                </span>
              ) : null}
              {asset.missing ? <span className="gal-badge gal-badge--missing">离线</span> : null}
            </span>
            {asset.rating ? (
              <span className="gal-tile__rating" aria-label={`${asset.rating} 星`}>
                <IconStar size={10} />
                {asset.rating}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
