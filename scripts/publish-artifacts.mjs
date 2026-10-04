// Emits artifacts.json (the resolved, immutable catalog) on stdout.
//   publish-artifacts.mjs --repo OWNER/REPO --revision SHA [--previous FILE] [--local] [--allow-build] [--systems a,b]
// Exit 3 when --previous already describes identical suites (nothing to release).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { buildArtifacts, GUEST_SYSTEMS, suitesUnchanged, validateArtifacts } from "../lib/artifacts.mjs";

const root = new URL("../", import.meta.url).pathname;
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => args[args.indexOf(`--${name}`) + 1];
const required = (name) => value(name) ?? (console.error(`--${name} is required`), process.exit(2));

const exec = (command, argv) => execFileSync(command, argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const document = validateArtifacts(
  buildArtifacts({
    root,
    repo: required("repo"),
    revision: required("revision"),
    cache: JSON.parse(readFileSync(new URL("../cache.json", import.meta.url), "utf8")),
    systems: flag("systems") ? value("systems").split(",") : GUEST_SYSTEMS,
    local: flag("local"),
    allowBuild: flag("allow-build"),
    exec,
  }),
);

if (flag("previous")) {
  let previous;
  try {
    previous = JSON.parse(readFileSync(value("previous"), "utf8"));
  } catch {}
  if (previous && suitesUnchanged(previous, document)) {
    console.error("Suites are unchanged since the previous release; nothing to publish.");
    process.exit(3);
  }
}
process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
