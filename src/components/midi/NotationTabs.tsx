import { PianoRollIcon } from "../ui/icons";
import { PianoRollDisplay } from "./PianoRollViewer";
import { AbcNotationRenderer } from "./AbcNotationRenderer";
import { NotationTabSurface } from "./NotationTabSurface";
import { useNotationData } from "../../lib/useNotationData";
import { renderPianoRollPng, renderAbcPng } from "../../lib/renderNotationImages";
import { copyTextToClipboard, copyPngToClipboard } from "../../lib/clipboard";
import { midiToText } from "../../lib/midiTextDump";

export type NotationTab = "midi" | "abc" | "midiTxt" | "abcTxt";

interface NotationTabsProps {
  activeTab: NotationTab;
  midiFilePath?: string;
  abcFilePath?: string;
  title: string;
  viewHeight: number;
  // Omit both to render without an expand button (see NotationTabSurface).
  expanded?: boolean;
  onToggleExpand?: () => void;
  // Sizing, forwarded to NotationTabSurface as-is: `height` for a fixed
  // pixel box (the notation sheet), or `className` (e.g. "min-h-0 flex-1")
  // to fill a flex-col ancestor's remaining space instead (the hero).
  height?: number;
  className?: string;
  contentClassName?: string;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
      <PianoRollIcon width={20} height={20} className="text-ink-muted" />
      <p className="text-xs text-ink-muted">{text}</p>
    </div>
  );
}

const TEXT_PRE_CLASSES = "whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-ink/90";

/**
 * Renders one of the four notation tabs (Midi, ABC, Midi.Txt, ABC.Txt) that
 * appear alongside Overview/Lyrics whenever a track has a real .mid or .abc
 * file -- shared between the hero player and the notation bottom sheet.
 * useNotationData loads/derives both representations once regardless of
 * which single tab is active, so flipping between them is instant.
 */
export function NotationTabs({
  activeTab,
  midiFilePath,
  abcFilePath,
  title,
  viewHeight,
  expanded,
  onToggleExpand,
  height,
  className,
  contentClassName,
}: NotationTabsProps) {
  const { state, data } = useNotationData(midiFilePath, abcFilePath, title);

  if (state === "checking" || state === "loading") {
    return (
      <div className={`relative ${className ?? ""}`} style={height !== undefined ? { height } : undefined}>
        <p className={`text-xs text-ink-muted ${contentClassName ?? "p-4"}`}>
          {state === "checking" ? "Checking notation…" : "Loading notation…"}
        </p>
      </div>
    );
  }
  if (state === "empty" || state === "error" || !data) {
    return (
      <div className={`relative ${className ?? ""}`} style={height !== undefined ? { height } : undefined}>
        <div className={contentClassName ?? "p-4"}>
          <EmptyState text={state === "empty" ? "No notation yet for this generation." : "Couldn't load notation."} />
        </div>
      </div>
    );
  }

  const { midi, abcText } = data;
  const midiText = midi ? midiToText(midi, title) : null;
  const shared = { expanded, onToggleExpand, height, className, contentClassName };

  if (activeTab === "midi") {
    return (
      <NotationTabSurface
        {...shared}
        copy={
          midi
            ? {
                mode: "image",
                label: "Copy as image",
                onCopy: async () => {
                  const png = await renderPianoRollPng(midi, viewHeight);
                  return png ? copyPngToClipboard(png) : false;
                },
              }
            : undefined
        }
      >
        {midi ? <PianoRollDisplay midi={midi} viewHeight={viewHeight} /> : <EmptyState text="No MIDI available for this track." />}
      </NotationTabSurface>
    );
  }

  if (activeTab === "abc") {
    return (
      <NotationTabSurface
        {...shared}
        copy={
          abcText
            ? {
                mode: "image",
                label: "Copy as image",
                onCopy: async () => {
                  const png = await renderAbcPng(abcText);
                  return png ? copyPngToClipboard(png) : false;
                },
              }
            : undefined
        }
      >
        {abcText ? <AbcNotationRenderer abc={abcText} /> : <EmptyState text="No ABC notation available for this track." />}
      </NotationTabSurface>
    );
  }

  if (activeTab === "midiTxt") {
    return (
      <NotationTabSurface
        {...shared}
        copy={midiText ? { mode: "text", label: "Copy text", onCopy: () => copyTextToClipboard(midiText) } : undefined}
      >
        {midiText ? <pre className={TEXT_PRE_CLASSES}>{midiText}</pre> : <EmptyState text="No MIDI available for this track." />}
      </NotationTabSurface>
    );
  }

  return (
    <NotationTabSurface
      {...shared}
      copy={abcText ? { mode: "text", label: "Copy text", onCopy: () => copyTextToClipboard(abcText) } : undefined}
    >
      {abcText ? <pre className={TEXT_PRE_CLASSES}>{abcText}</pre> : <EmptyState text="No ABC notation available for this track." />}
    </NotationTabSurface>
  );
}
