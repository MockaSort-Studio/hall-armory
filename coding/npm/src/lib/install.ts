import { LIMITS } from "./limits.ts";
import { joinPath, safeRelative } from "./paths.ts";
import { planLockfile, type Include, type PlannedPackage } from "./lockfile.ts";
import { registryRequest, verifyDigest, type FetchLike } from "./registry.ts";
import { collisionTracker, extractTarball, type Extracted } from "./tar.ts";
import { ensureDirectory, exists, promisesOf, readText, type NpmWorkspace } from "./workspace.ts";

const DOWNLOADS = 4;

// Every package is downloaded, checked against the lockfile's integrity hash BEFORE its archive is read, and
// unpacked in memory first; nothing is written until the whole tree has passed. Memory is bounded: at most
// DOWNLOADS compressed archives (32 MiB each) are in flight, archives are unpacked one at a time within the
// remaining share of the install's unpacked budget, and what is kept is that budget (256 MiB) at most.
export async function installVerified(
  input: { lockfile?: string; dir?: string; include?: Include },
  { workspace, fetch, signal }: { workspace: NpmWorkspace; fetch: FetchLike; signal?: AbortSignal },
) {
  const fs = promisesOf(workspace);
  const dir = safeRelative(input.dir ?? ".", "dir");
  const lockfile = safeRelative(input.lockfile ?? (dir ? `${dir}/package-lock.json` : "package-lock.json"), "lockfile");
  const include: Include = input.include === "production" ? "production" : "all";
  const root = joinPath(workspace.dir, dir);
  const modules = joinPath(root, "node_modules");
  if (await exists(fs, modules)) throw new Error("node_modules already exists there; this operation never overwrites an existing tree");
  const plan = planLockfile(await readText(fs, joinPath(workspace.dir, lockfile), LIMITS.lockfileBytes), include);
  const skipped = [...plan.skipped];
  const unpacked = new Map<PlannedPackage, Extracted>();
  let kept = 0;
  let entries = 0;
  let next = 0;
  let failure: unknown;
  let unpacking: Promise<unknown> = Promise.resolve();
  const totalCap = () => new Error("the install exceeds its total size or entry cap");

  const unpack = (archive: Uint8Array): Promise<Extracted> => {
    const run = unpacking.then(() => {
      const remaining = LIMITS.totalUnpackedBytes - kept;
      if (remaining <= 0) throw totalCap();
      let extracted: Extracted;
      try {
        extracted = extractTarball(archive, remaining);
      } catch (error: any) {
        throw error?.code === "SIZE_CAP" && remaining < LIMITS.packageUnpackedBytes ? totalCap() : error;
      }
      kept += extracted.unpacked;
      entries += extracted.files.length + extracted.directories.length + 1;
      if (entries > LIMITS.totalEntries) throw totalCap();
      return extracted;
    });
    unpacking = run.catch(() => undefined);
    return run;
  };

  const fetchOne = async (item: PlannedPackage) => {
    try {
      const archive = await registryRequest(fetch, item.resolved, { headers: { accept: "application/octet-stream" } }, LIMITS.tarballBytes, signal);
      verifyDigest(archive, item.digest);
      unpacked.set(item, await unpack(archive));
    } catch (error: any) {
      if (!item.optional || /total size or entry cap/.test(error.message) || signal?.aborted)
        throw new Error(`${item.key}: ${error.message}`);
      skipped.push({ path: item.key, reason: error.message });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(DOWNLOADS, plan.packages.length) }, async () => {
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

  // One destination map for the whole install: no archive may write where another package's file belongs.
  const claim = collisionTracker();
  for (const [item, extracted] of unpacked) {
    claim(item.key, "directory");
    for (const directory of extracted.directories) claim(`${item.key}/${directory}`, "directory");
    for (const file of extracted.files) claim(`${item.key}/${file.path}`, "file");
  }

  const createdDirectories: string[] = [];
  const createdFiles: string[] = [];
  try {
    await ensureDirectory(fs, root, createdDirectories);
    // The mkdir itself is the check: it fails if node_modules appeared since the early look.
    try {
      await fs.mkdir(modules);
    } catch (error: any) {
      throw error?.code === "EEXIST" ? new Error("node_modules appeared while installing; nothing was written") : error;
    }
    createdDirectories.push(modules);
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
    bytes: kept,
    skipped: skipped.slice(0, 200),
    skippedTotal: skipped.length,
    note: "No scripts were run and no .bin links were created; run a binary with `node node_modules/<package>/<path>`.",
  };
}
