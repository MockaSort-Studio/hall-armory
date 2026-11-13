import { LIMITS } from "./limits.ts";
import { checkRegistryUrl, integrityDigest } from "./registry.ts";

export type Include = "all" | "production";
export type PlannedPackage = {
  key: string;
  name: string;
  version: string;
  resolved: string;
  digest: Buffer;
  optional: boolean;
};
export type Plan = {
  packages: PlannedPackage[];
  skipped: { path: string; reason: string }[];
  versions: Map<string, Set<string>>;
};

const SEGMENT = "(?:@[A-Za-z0-9_~][A-Za-z0-9._~-]*/)?[A-Za-z0-9_~][A-Za-z0-9._~-]*";
const KEY = new RegExp(`^node_modules/${SEGMENT}(?:/node_modules/${SEGMENT})*$`);

// Reads package-lock.json (lockfileVersion 2 or 3) into the packages to install. Anything this suite cannot
// install exactly as locked is refused, not approximated: links, workspaces, git or file sources, entries
// without an integrity hash. Optional packages that cannot be planned are skipped and reported.
export function planLockfile(raw: string, include: Include): Plan {
  let lock: any;
  try {
    lock = JSON.parse(raw);
  } catch {
    throw new Error("the lockfile is not valid JSON");
  }
  if (![2, 3].includes(lock?.lockfileVersion) || !lock.packages || typeof lock.packages !== "object")
    throw new Error("only package-lock.json lockfileVersion 2 or 3 is supported");
  const plan: Plan = { packages: [], skipped: [], versions: new Map() };
  for (const [key, entry] of Object.entries<any>(lock.packages)) {
    if (key === "") continue;
    if (!KEY.test(key) || key.length > LIMITS.pathBytes || entry?.link)
      throw new Error(`unsupported lockfile entry (links and workspaces are not installable): ${key.slice(0, 120)}`);
    if (plan.packages.length + plan.skipped.length >= LIMITS.packages)
      throw new Error(`the lockfile has more than ${LIMITS.packages} packages`);
    if (entry?.inBundle) {
      plan.skipped.push({ path: key, reason: "bundled in its parent package" });
      continue;
    }
    if (include === "production" && entry?.dev) {
      plan.skipped.push({ path: key, reason: "development dependency" });
      continue;
    }
    const optional = Boolean(entry?.optional);
    const name = typeof entry?.name === "string" ? entry.name : key.split("node_modules/").pop()!;
    try {
      if (typeof entry?.version !== "string" || !entry.version) throw new Error("no version");
      const planned = { key, name, version: entry.version, optional };
      plan.packages.push({
        ...planned,
        resolved: checkRegistryUrl(entry.resolved),
        digest: integrityDigest(entry.integrity),
      });
      if (!plan.versions.has(name)) plan.versions.set(name, new Set());
      plan.versions.get(name)!.add(entry.version);
    } catch (error: any) {
      if (!optional) throw new Error(`${key}: ${error.message}`);
      plan.skipped.push({ path: key, reason: error.message });
    }
  }
  return plan;
}
