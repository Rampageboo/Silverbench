# Workspace Snapshot Versioning

YoloWorkBench uses simple snapshot-based workspace versions for the current product need.

This intentionally avoids a normalized source/version/export architecture. The app already understands one complete workspace folder with `image_pool`, `detect_labels`, `detect_dataset`, `clf_dataset`, `runs`, `workspace`, `metadata.csv`, and related files. Snapshot versioning keeps that model intact and adds a thin container around it.

## Why Snapshot Versioning

The goal is safe experimentation with minimal product risk:

- every version is a complete workspace copy;
- existing Box Label, Video Label, Export, YOLO, metadata, and undo/redo behavior continue to operate inside a normal workspace folder;
- switching versions only changes the effective workspace path;
- no annotation schema migration is needed;
- recovery is easy because each version is self-contained.

The tradeoff is disk usage. Creating `V2` from `V1` copies the full current workspace folder, including datasets, labels, runs, and metadata.

## Workspace Root And Active Version Folder

The workspace root is the project container. It contains `workspace_versions.json` plus full version folders.

The active version folder is the folder the rest of the app uses as the actual workspace path.

Example:

```text
ZZZ/
  workspace_versions.json
  V1/
    .yolo_label_viewer/
    clf_dataset/
    detect_dataset/
    detect_labels/
    image_pool/
    image_pool_backup/
    runs/
    workspace/
    metadata.csv
    WORKSPACE_README.txt
  V2/
    .yolo_label_viewer/
    clf_dataset/
    detect_dataset/
    detect_labels/
    image_pool/
    image_pool_backup/
    runs/
    workspace/
    metadata.csv
    WORKSPACE_README.txt
```

If the user opens `D:/Yolo/ZZZ` and `workspace_versions.json` says `activeVersion` is `V2`, app tools operate on `D:/Yolo/ZZZ/V2`.

## Manifest Format

`workspace_versions.json` lives at the workspace root:

```json
{
  "version": 1,
  "type": "yolo-workbench-snapshot-versions",
  "activeVersion": "V1",
  "createdAt": "2026-06-29T00:00:00.000Z",
  "updatedAt": "2026-06-29T00:00:00.000Z",
  "versions": [
    {
      "id": "V1",
      "path": "V1",
      "createdAt": "2026-06-29T00:00:00.000Z",
      "source": "initialized-from-root"
    }
  ]
}
```

Rules:

- version IDs are `V1`, `V2`, `V3`;
- IDs like `v001` are not used;
- `activeVersion` must point to an existing version entry;
- each entry path is relative to the workspace root unless absolute;
- the manifest does not describe media sources, annotation migrations, or export layers.

## Initializing V1

Initializing versioning for a non-versioned workspace:

1. creates `workspace_versions.json`;
2. creates `V1/`;
3. copies current workspace contents into `V1/`;
4. leaves original root files in place;
5. skips existing `V1`, `V2`, `V3` folders;
6. skips `workspace_versions.json`.

The copy preserves existing internal folder names and files exactly where possible.

## Creating V2 Or V3

Creating a new version copies the active/source version folder into the next version folder.

Example:

- active version is `V1`;
- user clicks `Create V2 from V1`;
- app copies `ZZZ/V1` to `ZZZ/V2`;
- manifest records the new entry with `source: "copied-from:V1"`;
- source version is not mutated.

Creating another version after `V2` creates `V3`.

## Switching Versions

Switching versions updates only `workspace_versions.json.activeVersion`.

After switching:

- `workspaceRootPath` remains the container, e.g. `D:/Yolo/ZZZ`;
- `activeVersionId` changes, e.g. `V2`;
- `activeVersionPath` changes, e.g. `D:/Yolo/ZZZ/V2`;
- existing tools receive the active version path as their effective `workspaceRoot`.

## Preserved Behavior

Inside `V1`, `V2`, or `V3`, the workspace stays normal:

- Box Label reads and writes `image_pool`, `detect_labels`, and class files as before;
- Video Label reads its existing workspace files as before;
- Export writes into the active version folder;
- YOLO format stays unchanged;
- `runs` stays inside the active version;
- `metadata.csv` stays inside the active version;
- undo/redo and canvas behavior are not changed by version switching.

## Deferred Architecture

The normalized Workspace vNext architecture is deferred and not currently desired.

Do not introduce shared `sources/`, `versions/v001/`, source registries, JSONL annotation records, or separated source/version/export layers for this feature. Snapshot versions are deliberately simple full-folder copies.
