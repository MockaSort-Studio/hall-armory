import { packageSourceIsIsolated, validateCatalog } from "../lib/validate.mjs";

const root = new URL("../", import.meta.url).pathname;
validateCatalog(root);
if (!packageSourceIsIsolated(root))
  throw new Error("Package source must stay below extensions");
console.log("Armory catalog is valid");
