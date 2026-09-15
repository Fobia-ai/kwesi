import { useEffect, useState } from "react";
import { kwesiArtistProfiles } from "../../lib/artistProfiles";

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface AvatarImageProps {
  avatarPath: string | null;
  name: string;
  size?: number;
  className?: string;
}

/**
 * Reads avatar bytes over IPC and builds a blob URL, the same pattern
 * playerStore.tsx uses for audio — falls back to a plain initials circle
 * while loading, on read failure, or when no avatar is set at all, so a
 * profile is always visually identifiable even without an image.
 */
export function AvatarImage({ avatarPath, name, size = 32, className = "" }: AvatarImageProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    if (!avatarPath) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    kwesiArtistProfiles.readAvatar(avatarPath).then((result) => {
      if (cancelled || !result.ok || !result.bytes) return;
      const blob = new Blob([result.bytes as BlobPart], { type: result.mimeType ?? "image/png" });
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [avatarPath]);

  if (url) {
    return (
      <img
        src={url}
        alt=""
        style={{ width: size, height: size }}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.36) }}
      className={`flex shrink-0 items-center justify-center rounded-full bg-accent/15 font-medium text-accent ${className}`}
    >
      {initialsFor(name)}
    </div>
  );
}
