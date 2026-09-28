import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const validName = (value) =>
  typeof value === "string" && value.trim().length > 0;

function suitePath(root, relative) {
  const path = resolve(root, relative);
  if (
    !validName(relative) ||
    (path !== root && !path.startsWith(`${root}${sep}`))
  )
    throw new Error(`Suite manifest escapes catalog root: ${relative}`);
  return path;
}

function validPackage(value) {
  return (
    value &&
    validName(value.name) &&
    validName(value.version) &&
    validName(value.integrity)
  );
}

function validateSuite(suite, extension) {
  if (suite?.format !== "hall.armory-suite/v1")
    throw new Error("Unsupported suite manifest format");
  if (suite.extension !== extension || !validPackage(suite.package))
    throw new Error("Suite package metadata is invalid");
  if (
    !validName(suite.native?.command) ||
    !Array.isArray(suite.tools) ||
    !suite.tools.every(validName)
  )
    throw new Error(
      `Suite ${extension} lacks native command or tool allowlist`,
    );
  if (new Set(suite.tools).size !== suite.tools.length)
    throw new Error(`Suite ${extension} duplicates a tool name`);
}

export function validateCatalog(root) {
  const catalogRoot = resolve(root);
  const catalog = readJson(resolve(catalogRoot, "manifest.json"));
  if (catalog?.format !== "hall.armory/v1" || !Array.isArray(catalog.lockers))
    throw new Error("Unsupported Armory catalog format");
  const ids = new Set();
  for (const locker of catalog.lockers) {
    if (!validName(locker?.name) || !Array.isArray(locker.suites))
      throw new Error("Invalid locker");
    for (const entry of locker.suites) {
      if (!validName(entry?.extension) || !validName(entry.manifest))
        throw new Error("Invalid suite index entry");
      const id = `${locker.name}/${entry.extension}`;
      if (ids.has(id)) throw new Error(`Duplicate suite: ${id}`);
      ids.add(id);
      validateSuite(
        readJson(suitePath(catalogRoot, entry.manifest)),
        entry.extension,
      );
    }
  }
  return ids;
}

export function suitePackagesAreCoLocated(root) {
  const catalogRoot = resolve(root);
  const catalog = readJson(resolve(catalogRoot, "manifest.json"));
  return catalog.lockers.every((locker) =>
    locker.suites.every((entry) => {
      const suiteRoot = dirname(suitePath(catalogRoot, entry.manifest));
      const packagePath = resolve(suiteRoot, "package.json");
      return (
        existsSync(packagePath) &&
        existsSync(resolve(suiteRoot, "src", "index.ts"))
      );
    }),
  );
}
