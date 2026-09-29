import {
  suiteClosuresAreCoLocated,
  suitePackagesAreCoLocated,
  validateCatalog,
} from "../lib/validate.mjs";

const root = new URL("../", import.meta.url).pathname;
validateCatalog(root);
if (!suiteClosuresAreCoLocated(root))
  throw new Error("Every cataloged suite must have a co-located locked Nix closure definition");
if (!suitePackagesAreCoLocated(root))
  throw new Error("Every cataloged suite must have co-located package source");
console.log("Armory catalog is valid");
