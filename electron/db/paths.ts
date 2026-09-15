import path from "node:path";
import fs from "node:fs";

let workspacesRoot = "";
let modelsRoot = "";
let venvsRoot = "";

export function initPaths(kwesiWorkspacesDir: string) {
  workspacesRoot = kwesiWorkspacesDir;
}

export function initModelsPaths(kwesiModelsDir: string) {
  modelsRoot = kwesiModelsDir;
}

export function initVenvsPaths(kwesiVenvsDir: string) {
  venvsRoot = kwesiVenvsDir;
}

export function modelsRootDir(): string {
  return modelsRoot;
}

export function workspacesRootDir(): string {
  return workspacesRoot;
}

export function venvsRootDir(): string {
  return venvsRoot;
}

export function venvDir(modelId: string): string {
  return path.join(venvsRoot, modelId);
}

export function modelVariantDir(modelId: string, variantName: string): string {
  return path.join(modelsRoot, modelId, variantName);
}

export function workspaceDir(workspaceId: string): string {
  return path.join(workspacesRoot, workspaceId);
}

export function projectDir(workspaceId: string, projectId: string): string {
  return path.join(workspaceDir(workspaceId), projectId);
}

export function generationDir(workspaceId: string, projectId: string, generationId: string): string {
  return path.join(projectDir(workspaceId, projectId), generationId);
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function removeDirIfExists(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}
