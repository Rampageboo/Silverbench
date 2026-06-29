import { callJson } from "../../api";
import {
  validateWorkspaceVersionsManifest,
  type WorkspaceVersionId,
  type WorkspaceVersionsManifest
} from "./workspaceSnapshotVersions";

export async function readSnapshotVersions(workspaceRoot: string): Promise<WorkspaceVersionsManifest> {
  const manifest = await callJson<unknown>("readSnapshotVersions", [workspaceRoot]);
  return validateWorkspaceVersionsManifest(manifest);
}

export async function initializeSnapshotVersioning(
  workspaceRoot: string
): Promise<WorkspaceVersionsManifest> {
  const manifest = await callJson<unknown>("initializeSnapshotVersioning", [workspaceRoot]);
  return validateWorkspaceVersionsManifest(manifest);
}

export async function createSnapshotVersion(
  workspaceRoot: string,
  fromVersionId: WorkspaceVersionId
): Promise<WorkspaceVersionsManifest> {
  const manifest = await callJson<unknown>("createSnapshotVersion", [workspaceRoot, fromVersionId]);
  return validateWorkspaceVersionsManifest(manifest);
}

export async function setActiveSnapshotVersion(
  workspaceRoot: string,
  versionId: WorkspaceVersionId
): Promise<WorkspaceVersionsManifest> {
  const manifest = await callJson<unknown>("setActiveSnapshotVersion", [workspaceRoot, versionId]);
  return validateWorkspaceVersionsManifest(manifest);
}

export async function resolveActiveSnapshotWorkspacePath(workspaceRoot: string): Promise<string> {
  return callJson<string>("resolveActiveSnapshotWorkspacePath", [workspaceRoot]);
}
