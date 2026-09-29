import { readFileSync, writeFileSync } from "node:fs";
import { githubOperationDescriptors } from "./src/lib/suite.ts";

const [mode, inputPath, outputPath] = process.argv.slice(2);
const request = JSON.parse(readFileSync(inputPath, "utf8"));
const selected = new Set(request.operations ?? []);
const descriptors = githubOperationDescriptors().filter((descriptor) => selected.has(descriptor.name));
const byName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));

function write(value: unknown) {
  writeFileSync(outputPath, JSON.stringify(value));
}

if (mode === "describe") {
  write({
    operations: descriptors.map(({ name, description, parameters }) => ({ name, description, parameters })),
  });
} else if (mode === "invoke") {
  const descriptor = byName.get(request.operation);
  if (!descriptor) throw new Error(`Guest operation is not approved: ${request.operation}`);
  write({ result: await descriptor.execute(request.input) });
} else {
  throw new Error(`Unsupported guest suite mode: ${mode}`);
}
