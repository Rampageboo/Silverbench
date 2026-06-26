export type GalleryNavigationKey = {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  targetTagName?: string;
  targetEditable?: boolean;
};

/**
 * Return the item that should be revealed by keyboard navigation.
 * Pointer selection and other programmatic current-index changes deliberately do not call this.
 */
export function galleryRevealTargetForKey(
  event: GalleryNavigationKey,
  currentIndex: number,
  itemCount: number
): number | null {
  const tag = String(event.targetTagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea" || event.targetEditable) return null;
  if (event.ctrlKey || event.altKey || event.metaKey) return null;

  const key = String(event.key || "").toLowerCase();
  const delta = key === "a" ? -1 : key === "d" ? 1 : 0;
  if (!delta) return null;
  const nextIndex = currentIndex + delta;
  return nextIndex >= 0 && nextIndex < itemCount ? nextIndex : null;
}
