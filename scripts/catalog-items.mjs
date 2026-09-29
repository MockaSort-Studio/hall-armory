import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const catalog = read(resolve(root, "manifest.json"));
const items = catalog.lockers.flatMap((locker) =>
  locker.suites.map((entry) => {
    const manifest = entry.manifest;
    const suite = read(resolve(root, manifest));
    return { id: suite.package.name, path: `${dirname(manifest)}/` };
  }),
);
console.log(JSON.stringify(items));
