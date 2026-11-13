import { LIMITS } from "./limits.ts";
import { joinPath, safeRelative } from "./paths.ts";
import { planLockfile, type Include, type PlannedPackage } from "./lockfile.ts";
import { registryRequest, verifyDigest, type FetchLike } from "./registry.ts";
import { extractTarball, type Extracted } from "./tar.ts";
import { ensureDirectory, exists, promisesOf, readText, type NpmWorkspace } from "./workspace.ts";

const CONCURRENCY = 4;

// Every package is downloaded, checked against the lockfile's integrity hash BEFORE its archive is read, and
// unpacked in memory first. Nothing is written until the whole tree has passed; if writing fails the files and
// directories already created are removed. No script is run and nothing is executed.
export async function installVerified(
  input: { lockfile?: string; dir?: string; include?: Include },
  { workspace, fetch, signal }: { workspace: NpmWorkspace; fetch: FetchLike; signal?: AbortSignal },
) {
  const fs = promisesOf(workspace);
  const dir = safeRelative(input.dir ?? ".", "dir");
  const lockfile = safeRelative(input.lockfile ?? (dir ? `${dir}/package-lock.json` : "package-lock.json"), "lockfile");
  const include: Include = input.include === "production" ? "production" : "all";
  const root = joinPath(workspace.dir, dir);
  if (await exists(fs, joinPath(root, "node_modules")))
    throw new Error("node_modules already exists there; this operation never overwrites an existing tree");
  const plan = planLockfile(await readText(fs, joinPath(workspace.dir, lockfile), LIMITS.lockfileBytes), include);
  const skipped = [...plan.skipped];
  const unpacked = new Map<PlannedPackage, Extracted>();
  let bytes = 0;
  let entries = 0;
  let next = 0;
  let failure: unknown;

  const fetchOne = async (item: PlannedPackage) => {
    try {
      const archive = await registryRequest(fetch, item.resolved, { headers: { accept: "application/octet-stream" } }, LIMITS.tarballBytes, signal);
      verifyDigest(archive, item.digest);
      const extracted = extractTarball(archive);
      bytes += extracted.bytes;
      entries += extracted.files.length + extracted.directories.length + 1;
      if (bytes > LIMITS.totalUnpackedBytes || entries > LIMITS.totalEntries)
        throw new Error("the install exceeds its total size or entry cap");
      unpacked.set(item, extracted);
    } catch (error: any) {
      if (!item.optional || /total size or entry cap|aborted/i.test(error.message) || signal?.aborted)
        throw new Error(`${item.key}: ${error.message}`);
      skipped.push({ path: item.key, reason: error.message });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, plan.packages.length) }, async () => {
      while (!failure && next < plan.packages.length) {
        try {
          await fetchOne(plan.packages[next++]);
        } catch (error) {
          failure ??= error;
        }
      }
    }),
  );
  if (failure) throw failure;

  const createdDirectories: string[] = [];
  const createdFiles: string[] = [];
  try {
    for (const [item, extracted] of unpacked) {
      const base = joinPath(root, item.key);
      await ensureDirectory(fs, base, createdDirectories);
      for (const directory of extracted.directories) await ensureDirectory(fs, joinPath(base, directory), createdDirectories);
      for (const file of extracted.files) {
        const path = joinPath(base, file.path);
        await ensureDirectory(fs, path.slice(0, path.lastIndexOf("/")), createdDirectories);
        await fs.writeFile(path, file.data, { mode: file.mode });
        createdFiles.push(path);
      }
    }
  } catch (error) {
    for (const path of createdFiles.reverse()) await fs.unlink(path).catch(() => undefined);
    for (const path of createdDirectories.reverse()) await fs.rmdir(path).catch(() => undefined);
    throw error;
  }
  return {
    installed: unpacked.size,
    files: createdFiles.length,
    bytes,
    skipped: skipped.slice(0, 200),
    skippedTotal: skipped.length,
    note: "No scripts were run and no .bin links were created; run a binary with `node node_modules/<package>/<path>`.",
  };
}
