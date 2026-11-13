import * as nodeFs from "node:fs";

// Where the lockfile is read and the tree is written. A host injects it; the shape is the GitHub suite's:
// promise-style `fs` (under `.promises`, as node:fs has) and the working-tree root. Only methods every such
// filesystem has are used.
export type NpmWorkspace = { fs: any; dir: string };

export const defaultWorkspace = (): NpmWorkspace => ({ fs: nodeFs, dir: "/workspace" });

export const promisesOf = (workspace: NpmWorkspace) => workspace.fs.promises ?? workspace.fs;

export const exists = async (fs: any, path: string) => {
  try {
    await fs.lstat(path);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
};

const text = (value: unknown) => (typeof value === "string" ? value : Buffer.from(value as Uint8Array).toString("utf8"));

export async function readText(fs: any, path: string, max: number): Promise<string> {
  const content = text(await fs.readFile(path));
  if (Buffer.byteLength(content) > max) throw new Error(`${path} is larger than ${max} bytes`);
  return content;
}

// mkdir -p over the minimal fs surface; returns the directories it created, deepest last.
export async function ensureDirectory(fs: any, path: string, created: string[]) {
  let current = "";
  for (const part of path.split("/").filter(Boolean)) {
    current = `${current}/${part}`;
    if (await exists(fs, current)) continue;
    await fs.mkdir(current);
    created.push(current);
  }
}
