import { renderAbc } from "abcjs";
import type { ParsedMidi } from "./midiParser";
import { buildPianoRollExportSvg } from "./pianoRollExportSvg";
import { svgMarkupToPng } from "./svgToPng";

export function renderPianoRollPng(midi: ParsedMidi, viewHeight = 320): Promise<Uint8Array | null> {
  const svg = buildPianoRollExportSvg(midi, viewHeight);
  return svgMarkupToPng(svg, { background: "#ffffff" });
}

/**
 * Renders ABC text to a PNG via a real, temporary abcjs render -- attached
 * off-screen (not display:none) because abcjs lays out engraving using real
 * DOM measurement (getBBox etc.), which returns zeros for a fully detached
 * node in most browsers. Uses an explicit dark foreground on white rather
 * than this app's live "currentColor" theming (see AbcNotationRenderer),
 * since an exported image has to read correctly in any viewer regardless of
 * this app's current theme.
 */
export async function renderAbcPng(abc: string): Promise<Uint8Array | null> {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.style.background = "#ffffff";
  document.body.appendChild(container);
  try {
    renderAbc(container, abc, { foregroundColor: "#1a1a1a" });
    const svg = container.querySelector("svg");
    if (!svg) return null;
    const bbox = svg.getBBox();
    const width = Math.ceil(bbox.x + bbox.width + 16);
    const height = Math.ceil(bbox.y + bbox.height + 16);
    if (width <= 0 || height <= 0) return null;
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return await svgMarkupToPng(svg.outerHTML, { background: "#ffffff", width, height });
  } catch {
    return null;
  } finally {
    document.body.removeChild(container);
  }
}
