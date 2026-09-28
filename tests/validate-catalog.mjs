import { catalogHasOnlyMetadata, validateCatalog } from "../lib/validate.mjs";

const root = new URL("../", import.meta.url).pathname;
validateCatalog(root);
if (!catalogHasOnlyMetadata(root))
  throw new Error("Armory catalog must not contain package handlers");
console.log("Armory catalog is valid");
