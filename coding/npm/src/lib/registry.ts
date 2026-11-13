import { createHash, timingSafeEqual } from "node:crypto";
import { LIMITS, REGISTRY_HOST } from "./limits.ts";

export type FetchLike = (url: string, init?: any) => Promise<any>;

// A tarball URL the lockfile names: https, exactly the npm registry host, no credentials, default port.
export function checkRegistryUrl(value: unknown): string {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error("resolved is not a URL");
  }
  if (url.protocol !== "https:" || url.hostname !== REGISTRY_HOST || url.username || url.password || url.port)
    throw new Error(`resolved must be https://${REGISTRY_HOST}/...`);
  if (!url.pathname.endsWith(".tgz")) throw new Error("resolved is not a tarball URL");
  return url.href;
}

// One sha512 SRI string, nothing else (no sha1, no alternatives): the digest it carries.
export function integrityDigest(value: unknown): Buffer {
  const match = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(String(value));
  if (!match) throw new Error("integrity must be a single sha512 SRI");
  return Buffer.from(match[1], "base64");
}

export function verifyDigest(bytes: Uint8Array, expected: Buffer) {
  const actual = createHash("sha512").update(bytes).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("integrity mismatch");
}

// Reads a response body as it streams in, refusing anything over `max` bytes (declared or counted chunk by chunk).
// The injected `fetch` is the host's own: a stream that hands over one enormous chunk is outside this bound.
export async function readBounded(response: any, max: number): Promise<Uint8Array> {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new Error(`response is larger than ${max} bytes`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body?.getReader?.();
  // Only a streamed body can be bounded while it arrives; one that has to be read whole is refused.
  if (!reader) throw new Error("the registry answer has no readable stream");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`response is larger than ${max} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// A request to the registry: never follows a redirect, bounded in time and size.
export async function registryRequest(
  fetchImpl: FetchLike,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  max: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const timeout = AbortSignal.timeout(LIMITS.fetchMs);
  const response = await fetchImpl(url, {
    ...init,
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response?.ok) throw new Error(`registry request failed (HTTP ${response?.status})`);
  // An injected fetch may follow redirects despite `redirect: "error"`: the answer must come from where it was asked.
  if (response.redirected) throw new Error("the registry answer was redirected");
  if (response.url && new URL(response.url).href !== new URL(url).href)
    throw new Error("the registry answer came from a different URL");
  return readBounded(response, max);
}
