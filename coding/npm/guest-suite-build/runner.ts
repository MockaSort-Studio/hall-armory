import { readFileSync, writeFileSync } from "node:fs";
import { npmOperationDescriptors } from "../src/lib/suite.ts";

const [mode, inputPath, outputPath] = process.argv.slice(2);
const write = (value: unknown) => writeFileSync(outputPath, JSON.stringify(value));

try {
  // The guest image supplies Node; fail clearly if it ever falls behind the bundle target.
  if (Number(process.versions.node.split(".")[0]) < 22)
    throw new Error(`Armory guest runner needs Node 22 or newer; the guest has ${process.versions.node}`);
  const request = JSON.parse(readFileSync(inputPath, "utf8"));
  const selected = new Set(request.operations ?? []);
  const descriptors = npmOperationDescriptors().filter((descriptor) => selected.has(descriptor.name));
  const byName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));

  if (mode === "describe") {
    write({
      operations: descriptors.map(({ name, description, parameters }) => ({ name, description, parameters })),
    });
  } else if (mode === "invoke") {
    if (!byName.has(request.operation)) throw new Error(`Guest operation is not approved: ${request.operation}`);
    // These operations fetch from the npm registry and write a dependency tree into a workspace the host holds:
    // they run host-side. A guest has no registry access, so this runner describes the operations and nothing more.
    throw new Error(`${request.operation} runs on the host, not in a guest`);
  } else {
    throw new Error(`Unsupported guest suite mode: ${mode}`);
  }
} catch (error) {
  write({ error: { message: error instanceof Error ? error.message : String(error) } });
  process.exitCode = 1;
}
