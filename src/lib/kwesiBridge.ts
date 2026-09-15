declare global {
  interface Window {
    kwesi?: {
      openExternal: (url: string) => Promise<boolean>;
      getEnv: () => Promise<Record<string, string | number>>;
    };
  }
}

/**
 * Opens an external link. Goes through the Electron preload bridge (which
 * only allows allowlisted URLs) when running inside the app; falls back to
 * a plain new-tab open when running in a plain browser during UI dev.
 */
export async function openExternal(url: string): Promise<void> {
  if (window.kwesi) {
    await window.kwesi.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export {};
