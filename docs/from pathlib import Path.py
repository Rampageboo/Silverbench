from pathlib import Path

DATASET_DIR = Path(r"Z:\Yolo\ZZZ\detect_dataset")
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def check_split(split: str):
    img_dir = DATASET_DIR / "images" / split
    label_dir = DATASET_DIR / "labels" / split

    if not img_dir.exists():
        print(f"[SKIP] 不存在: {img_dir}")
        return

    images = [p for p in img_dir.rglob("*") if p.suffix.lower() in IMAGE_EXTS]
    missing_labels = []

    for img in images:
        rel = img.relative_to(img_dir)
        label = label_dir / rel.with_suffix(".txt")
        if not label.exists():
            missing_labels.append(img)

    print(f"\n[{split}]")
    print(f"图片数量: {len(images)}")
    print(f"缺少标签: {len(missing_labels)}")

    for p in missing_labels[:20]:
        print("  missing:", p)


if __name__ == "__main__":
    check_split("train")
    check_split("val")
    check_split("test")