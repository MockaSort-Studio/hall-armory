import type { Include } from "./lockfile.ts";

// The name -> versions map an audit sends, from every locked package. Unlike an install it needs no source or
// integrity: a lockfile entry is audited whatever its origin.
export function planLockfileForAudit(raw: string, include: Include): Map<string, Set<string>> {
  let lock: any;
  try {
    lock = JSON.parse(raw);
  } catch {
    throw new Error("the lockfile is not valid JSON");
  }
  if (![2, 3].includes(lock?.lockfileVersion) || !lock.packages || typeof lock.packages !== "object")
    throw new Error("only package-lock.json lockfileVersion 2 or 3 is supported");
  const versions = new Map<string, Set<string>>();
  for (const [key, entry] of Object.entries<any>(lock.packages)) {
    if (key === "" || entry?.link || typeof entry?.version !== "string") continue;
    if (include === "production" && entry.dev) continue;
    const name = typeof entry.name === "string" ? entry.name : key.split("node_modules/").pop()!;
    if (!name) continue;
    if (!versions.has(name)) versions.set(name, new Set());
    versions.get(name)!.add(entry.version);
  }
  return versions;
}
