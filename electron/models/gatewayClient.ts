// Primary download path for real users: mints a short-lived, presigned R2
// download URL from Fobia's own backend for one specific model file, so
// model bytes are actually served from Fobia's own bucket (licensed,
// traceable, not subject to Hugging Face's anonymous-request rate limits)
// instead of hitting Hugging Face directly. hfClient.ts's direct download
// stays as the fallback this app already had -- used whenever the gateway
// isn't available (no KWESI_ACCESS_TOKEN set, e.g. local dev, or the
// gateway itself errors) -- so a missing/broken token degrades to the
// previous working behavior instead of breaking installs outright.

const GATEWAY_BASE_URL = "https://gateway.fobia.ai/v1/kwesi/model";

interface GatewayResolveResponse {
  path?: string;
  url?: string;
  expiresAt?: string;
}

/**
 * Resolves one file to a presigned download URL through Fobia's backend.
 * Returns null (never throws) on anything short of getting a real URL back
 * -- no token configured, network failure, non-OK response, malformed body
 * -- so callers can silently fall back to a direct Hugging Face download
 * rather than failing the whole install over a gateway hiccup.
 */
export async function tryResolveGatewayFileUrl(
  modelId: string,
  variantName: string,
  filename: string,
  signal: AbortSignal,
): Promise<string | null> {
  const token = process.env.KWESI_ACCESS_TOKEN;
  if (!token) return null;

  try {
    const encodedPath = filename
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const url =
      `${GATEWAY_BASE_URL}/${encodeURIComponent(modelId)}/${encodeURIComponent(variantName)}/${encodedPath}` +
      `?token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as GatewayResolveResponse;
    return data.url ?? null;
  } catch {
    return null;
  }
}
