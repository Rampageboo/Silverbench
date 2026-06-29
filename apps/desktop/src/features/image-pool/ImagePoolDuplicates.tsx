import { useMemo, useState } from "react";
import * as api from "../../api";
import type { DuplicateScan } from "./types";

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function chooseKeeper(filenames: string[], inMetadata: string[] = []) {
  const metaSet = new Set(inMetadata);
  const inMeta = filenames.filter((name) => metaSet.has(name));
  if (inMeta.length === 1) return inMeta[0];
  if (inMeta.length) return [...inMeta].sort(naturalCompare)[0];
  return [...filenames].sort((a, b) => a.length - b.length || naturalCompare(a, b))[0];
}

function formatBytes(bytes: number) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

type ImagePoolDuplicatesProps = {
  workspaceRoot: string;
  scan: DuplicateScan | null;
  pending: boolean;
  onFind: () => void;
  onClear: () => void;
  onDeleteFile: (filename: string) => void;
};

export function ImagePoolDuplicates({
  workspaceRoot,
  scan,
  pending,
  onFind,
  onClear,
  onDeleteFile
}: ImagePoolDuplicatesProps) {
  const [expanded, setExpanded] = useState(false);
  const dupCount = scan?.duplicateFiles || 0;
  const statusText = useMemo(() => {
    if (pending) return "扫描中...";
    if (!scan) return "未扫描";
    const groups = scan.groupCount || 0;
    return groups ? `${groups} 组，${dupCount} 张多余` : `${scan.totalImages || 0} 张无重复`;
  }, [pending, scan, dupCount]);

  return (
    <div className={`image-pool-dup-overlay${expanded ? "" : " collapsed"}`}>
      <button
        type="button"
        className={`image-pool-dup-fab${dupCount > 0 ? " has-dup" : ""}`}
        title={expanded ? "收起重复图片" : dupCount > 0 ? `${dupCount} 张重复（点击展开）` : "重复图片"}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <svg className="image-pool-dup-fab-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <rect x="3" y="5" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <rect x="9" y="7" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        {dupCount > 0 ? (
          <span className="image-pool-dup-badge">{dupCount > 99 ? "99+" : dupCount}</span>
        ) : null}
      </button>
      <div className="image-pool-dup-panel" role="dialog" aria-label="Duplicate images">
        <div className="image-pool-dup-panel-head">
          <span className="image-pool-dup-title">Duplicates</span>
          <span className="status">{statusText}</span>
          <button type="button" className="image-pool-dup-close" title="Collapse" onClick={() => setExpanded(false)}>
            ×
          </button>
        </div>
        <div className="image-pool-dup-panel-body duplicate-photo-panel">
          <div className="row">
            <button type="button" className="primary" disabled={pending} onClick={onFind}>
              Find Duplicates
            </button>
            <button type="button" className="danger" disabled={pending} onClick={onClear}>
              Clear Duplicates
            </button>
          </div>
          <div className="hint">Scans media only. Deleting duplicates removes hard links and updates metadata.csv.</div>
          <div className="duplicate-photo-results">
            {!scan?.groups?.length ? (
              <div className="empty">
                {pending ? "正在扫描 media..." : "Click Find Duplicates to scan identical files."}
              </div>
            ) : (
              scan.groups.map((group, groupIndex) => {
                const filenames = group.filenames || [];
                const keeper = chooseKeeper(filenames, group.inMetadata || []);
                return (
                  <div key={`group-${groupIndex}`} className="duplicate-photo-group">
                    <div className="duplicate-photo-group-head">
                      <span>组 {groupIndex + 1}</span>
                      <span>
                        {group.count} 张 | {formatBytes(group.size || 0)}
                      </span>
                    </div>
                    <div className="duplicate-photo-grid">
                      {filenames.map((filename) => {
                        const isKeeper = filename === keeper;
                        return (
                          <div
                            key={filename}
                            className={`duplicate-photo-item${isKeeper ? " duplicate-photo-keeper" : ""}`}
                          >
                            <img src={api.imagePoolThumbUrl(workspaceRoot, filename)} alt={filename} />
                            <span title={filename}>{filename}</span>
                            <div className="duplicate-photo-item-actions">
                              {isKeeper ? (
                                <span className="status">保留</span>
                              ) : (
                                <button type="button" className="danger" onClick={() => onDeleteFile(filename)}>
                                  删除
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
