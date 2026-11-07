// Bundles each suite's Pi extension (package.json "pi.extensions"[0]) into one self-contained ESM file and
// prints, on stdout, { "<suite id>": { file, sha256, size } }. A suite host imports the file directly: it needs
// no node_modules next to it. Only the Pi packages stay external (the host provides them).
//   bundle-extensions.mjs --out DIR
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { build } from "esbuild";

const root = new URL("../", import.meta.url).pathname;
const args = process.argv.slice(2);
const out = resolve(args[args.indexOf("--out") + 1] ?? "");
if (!args.includes("--out")) (console.error("--out is required"), process.exit(2));
mkdirSync(out, { recursive: true });

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const catalog = readJson(join(root, "manifest.json"));
const result = {};
for (const locker of catalog.lockers)
  for (const entry of locker.suites) {
    const id = `${locker.name}/${entry.extension}`;
    const suiteDir = join(root, dirname(entry.manifest));
    const entryPoint = join(suiteDir, readJson(join(suiteDir, "package.json")).pi.extensions[0]);
    const file = `${id.replaceAll("/", "-")}.mjs`;
    await build({
      entryPoints: [entryPoint],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      outfile: join(out, file),
      external: ["@earendil-works/*"],
      legalComments: "none",
      logLevel: "warning",
      // Bundled CommonJS dependencies (isomorphic-git) call require() on Node builtins; an ESM bundle has
      // no require of its own.
      banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    });
    const bytes = readFileSync(join(out, file));
    result[id] = { file, sha256: createHash("sha256").update(bytes).digest("hex"), size: statSync(join(out, file)).size };
  }
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
