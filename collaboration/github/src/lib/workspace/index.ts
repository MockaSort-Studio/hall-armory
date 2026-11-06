import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { gh } from "../core/gh.ts";

const exec = promisify(execFile);
const WORKSPACE = "/workspace";
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

function repository(repo: string) {
  const [owner, name, ...rest] = repo.split("/");
  if (!owner || !name || rest.length)
    throw new Error(`Invalid repository: ${repo}`);
  return { owner, name };
}

function revision(value: string) {
  if (!value || value.length > 255 || /[\0\r\n]/.test(value))
    throw new Error("Invalid repository revision");
  return value;
}

async function emptyWorkspace(run = exec) {
  const { stdout } = await run("/bin/sh", [
    "-lc",
    `find ${WORKSPACE} -mindepth 1 -maxdepth 1 ! -name node_modules -print -quit`,
  ]);
  if (stdout.trim()) throw new Error("Guest workspace is not empty");
}

// A guest runner has a private /workspace mount. This operation deliberately
// does not accept a destination path, so a model cannot repurpose the suite as
// an arbitrary guest filesystem writer.
export async function snapshotRepository(
  repo: string,
  revisionName: string,
  dependencies = {},
) {
  const { owner, name } = repository(repo);
  const revisionValue = revision(revisionName);
  const run = dependencies.exec ?? exec;
  await emptyWorkspace(run);
  const archive = `/tmp/hall-github-snapshot-${randomUUID()}.tar.gz`;
  try {
    await gh([
      "api",
      `repos/${owner}/${name}/tarball/${encodeURIComponent(revisionValue)}`,
      "--output",
      archive,
    ]);
    try {
      await run("/bin/sh", [
        "-lc",
        `test $(wc -c < ${archive}) -le ${MAX_ARCHIVE_BYTES}`,
      ]);
    } catch {
      throw new Error("Repository archive exceeds the guest snapshot limit");
    }
    await run("/bin/tar", [
      "-xzf",
      archive,
      "--strip-components=1",
      "--no-same-owner",
      "--no-same-permissions",
      "-C",
      WORKSPACE,
    ]);
    return { repo, revision: revisionValue, workspace: WORKSPACE };
  } finally {
    await run("/bin/rm", ["-f", archive]).catch(() => undefined);
  }
}
