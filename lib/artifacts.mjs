import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";

export const ARTIFACTS_FORMAT = "hall.armory-artifacts/v1";
export const GUEST_SYSTEMS = ["x86_64-linux", "aarch64-linux"];
const STORE_PATH = /^\/nix\/store\/[a-z0-9]{32}-[^/]+$/;
const NAR_HASH = /^sha256-[A-Za-z0-9+/]{43}=$/;
const REVISION = /^[0-9a-f]{40}$/;

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function suiteEntries(root) {
  const catalog = readJson(join(root, "manifest.json"));
  const entries = catalog.lockers.flatMap((locker) =>
    locker.suites.map((entry) => ({ id: `${locker.name}/${entry.extension}`, manifestPath: entry.manifest })),
  );
  return { catalog, entries };
}

// Builds (or, with allowBuild=false, only substitutes) every suite output for each
// guest system and records the exact closure. `--max-jobs 0` makes a missing cache
// entry an error, so a document can only describe artifacts a client can fetch.
export function buildArtifacts({ root, repo, revision, cache, systems = GUEST_SYSTEMS, local = false, allowBuild = false, exec }) {
  const { catalog, entries } = suiteEntries(root);
  const suites = {};
  for (const { id, manifestPath } of entries) {
    const manifest = readJson(join(root, manifestPath));
    const dir = posix.normalize(posix.join(dirname(manifestPath), manifest.native.closure));
    const output = manifest.native.output;
    const bySystem = {};
    for (const system of systems) {
      const flake = local ? `path:${join(root, dir)}` : `github:${repo}/${revision}?dir=${dir}`;
      const build = ["build", "--no-link", "--print-out-paths", ...(allowBuild ? [] : ["--max-jobs", "0"]), `${flake}#packages.${system}.${output}`];
      const storePath = exec("nix", build).trim().split("\n")[0];
      const info = JSON.parse(exec("nix", ["path-info", "-r", "--json", "--json-format", "1", storePath]));
      const closure = Object.entries(info)
        .map(([path, value]) => ({ path, narHash: value.narHash, narSize: value.narSize }))
        .sort((a, b) => a.path.localeCompare(b.path));
      bySystem[system] = { storePath, narHash: info[storePath].narHash, closure };
    }
    suites[id] = { manifestPath, manifest, output, systems: bySystem };
  }
  return { format: ARTIFACTS_FORMAT, revision, cache, catalog, suites };
}

export function validateArtifacts(doc) {
  const fail = (message) => {
    throw new Error(`Invalid artifact catalog: ${message}`);
  };
  if (doc?.format !== ARTIFACTS_FORMAT) fail("unsupported format");
  if (!REVISION.test(doc.revision)) fail("revision must be a full git commit");
  if (!/^https:\/\//.test(doc.cache?.substituter ?? "") || typeof doc.cache?.publicKey !== "string") fail("cache identity missing");
  if (doc.catalog?.format !== "hall.armory/v1") fail("embedded catalog is not hall.armory/v1");
  const ids = Object.keys(doc.suites ?? {});
  if (!ids.length) fail("no suites");
  for (const id of ids) {
    const suite = doc.suites[id];
    if (suite.manifest?.format !== "hall.armory-suite/v1") fail(`${id}: embedded manifest is not hall.armory-suite/v1`);
    for (const [system, artifact] of Object.entries(suite.systems ?? {})) {
      if (!GUEST_SYSTEMS.includes(system)) fail(`${id}: unknown system ${system}`);
      if (!STORE_PATH.test(artifact.storePath) || !NAR_HASH.test(artifact.narHash)) fail(`${id}/${system}: bad store path or hash`);
      const paths = artifact.closure?.map((item) => item.path) ?? [];
      if (!paths.includes(artifact.storePath)) fail(`${id}/${system}: closure omits its root`);
      if (!artifact.closure.every((item) => STORE_PATH.test(item.path) && NAR_HASH.test(item.narHash))) fail(`${id}/${system}: bad closure entry`);
    }
    if (!Object.keys(suite.systems ?? {}).length) fail(`${id}: no systems`);
  }
  return doc;
}

// Revisions that change neither a manifest nor an artifact need no new release.
export const suitesUnchanged = (previous, next) => JSON.stringify(previous?.suites) === JSON.stringify(next.suites);
