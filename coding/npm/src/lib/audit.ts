import { LIMITS, REGISTRY_HOST } from "./limits.ts";
import { planLockfileForAudit } from "./audit-plan.ts";
import { registryRequest, type FetchLike } from "./registry.ts";
import { joinPath, safeRelative } from "./paths.ts";
import { promisesOf, readText, type NpmWorkspace } from "./workspace.ts";
import type { Include } from "./lockfile.ts";

const ENDPOINT = `https://${REGISTRY_HOST}/-/npm/v1/security/advisories/bulk`;
const clip = (value: unknown) => String(value ?? "").slice(0, LIMITS.auditText);

// Asks the registry about the exact name@version pairs in the lockfile. A registry that cannot be reached, or
// answers with anything but advisories, is an error: it is never reported as "no vulnerabilities".
export async function auditLockfile(
  input: { lockfile?: string; include?: Include },
  { workspace, fetch, signal }: { workspace: NpmWorkspace; fetch: FetchLike; signal?: AbortSignal },
) {
  const fs = promisesOf(workspace);
  const lockfile = safeRelative(input.lockfile ?? "package-lock.json", "lockfile");
  const versions = planLockfileForAudit(
    await readText(fs, joinPath(workspace.dir, lockfile), LIMITS.lockfileBytes),
    input.include === "production" ? "production" : "all",
  );
  const names = [...versions.keys()].sort();
  const found: any[] = [];
  const counts: Record<string, number> = {};
  let total = 0;
  for (let start = 0; start < names.length; start += LIMITS.auditBatch) {
    const body = Object.fromEntries(
      names.slice(start, start + LIMITS.auditBatch).map((name) => [name, [...versions.get(name)!].sort()]),
    );
    const bytes = await registryRequest(
      fetch,
      ENDPOINT,
      { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) },
      LIMITS.auditResponseBytes,
      signal,
    );
    let advisories: any;
    try {
      advisories = JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      throw new Error("the registry's audit response is not JSON");
    }
    if (!advisories || typeof advisories !== "object" || Array.isArray(advisories))
      throw new Error("the registry's audit response has an unexpected shape");
    for (const [name, list] of Object.entries<any>(advisories)) {
      if (!Array.isArray(list)) throw new Error("the registry's audit response has an unexpected shape");
      for (const advisory of list) {
        const severity = ["info", "low", "moderate", "high", "critical"].includes(advisory?.severity) ? advisory.severity : "unknown";
        counts[severity] = (counts[severity] ?? 0) + 1;
        total += 1;
        if (found.length < LIMITS.auditItems)
          found.push({
            name: clip(name),
            severity,
            title: clip(advisory?.title),
            url: clip(advisory?.url),
            range: clip(advisory?.vulnerable_versions),
            versions: [...(versions.get(name) ?? [])].sort().slice(0, 20),
          });
      }
    }
  }
  return { packages: names.length, advisories: total, counts, vulnerabilities: found, truncated: total > found.length };
}
