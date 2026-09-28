import {
  suitePackagesAreCoLocated,
  validateCatalog,
} from "../lib/validate.mjs";

const root = new URL("../", import.meta.url).pathname;
validateCatalog(root);
if (!suitePackagesAreCoLocated(root))
  throw new Error("Every cataloged suite must have co-located package source");
console.log("Armory catalog is valid");
