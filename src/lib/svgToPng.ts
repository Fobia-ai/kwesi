// Rasterizes a self-contained SVG markup string (explicit width/height or
// viewBox, no reliance on an external stylesheet or "currentColor" resolved
// from a live ancestor) into PNG bytes via an offscreen canvas. Returns null
// rather than throwing when the runtime can't do it (jsdom's canvas/Image
// are stubs, some sandboxed contexts block canvas) -- callers treat that the
// same as "no image available", matching this feature's "(if possible)"
// framing throughout.
export function svgMarkupToPng(
  svgMarkup: string,
  options: { background?: string; scale?: number; width?: number; height?: number } = {},
): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    try {
      const scale = options.scale ?? 2;
      const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const width = options.width ?? img.naturalWidth ?? img.width;
          const height = options.height ?? img.naturalHeight ?? img.height;
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            URL.revokeObjectURL(url);
            resolve(null);
            return;
          }
          if (options.background) {
            ctx.fillStyle = options.background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          canvas.toBlob(async (pngBlob) => {
            if (!pngBlob) {
              resolve(null);
              return;
            }
            resolve(new Uint8Array(await pngBlob.arrayBuffer()));
          }, "image/png");
        } catch {
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}
