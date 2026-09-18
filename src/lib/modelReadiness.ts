import { kwesiDb } from "./db";
import { kwesiEnvironment } from "./environment";

export interface ModelReadiness {
  checkpointReady: boolean;
  venvReady: boolean;
  ready: boolean;
}

// A model is only actually usable once it has a real installed checkpoint
// AND a real Python environment -- neither check alone is enough (see
// ModelSetupDialog, and the gates in Workspaces.tsx/WorkspaceDetail.tsx
// that call this before letting a workspace get created or a generation
// start).
export async function checkModelReadiness(modelId: string): Promise<ModelReadiness> {
  const [variants, env] = await Promise.all([
    kwesiDb.listModelVariants(modelId),
    kwesiEnvironment.checkStatus(modelId),
  ]);
  const checkpointReady = variants.some((v) => v.install_status === "installed");
  return { checkpointReady, venvReady: env.venvExists, ready: checkpointReady && env.venvExists };
}
