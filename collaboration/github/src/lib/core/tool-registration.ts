// Shared registration seam for GitHub suite operations.
//
// Every domain module (core, discussions, issues, labels, projects, pulls)
// used to carry its own copy of the `output`/`tool` closures that wrapped
// `pi.registerTool`. That duplication is exactly what the Armory design
// docs warn against: a static "install this suite" path and a future
// dynamic Armory-loader path must register the *same* operation schemas
// through the *same* code, not two hand-maintained copies that can drift.
//
// `operation()` builds a plain-data descriptor (name, description,
// parameters, execute) with no dependency on `pi` at all -- this is the
// reusable half, safe to collect into a suite manifest and reused by any
// future loader. `registerOperations()` is the one place that turns a list
// of descriptors into live `pi.registerTool()` calls -- this is the seam.

export type OperationDescriptor = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (input: any) => Promise<unknown> | unknown;
};

export function operation(
  name: string,
  description: string,
  parameters: unknown,
  execute: (input: any) => Promise<unknown> | unknown,
): OperationDescriptor {
  return { name, description, parameters, execute };
}

function toolOutput(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    details: value,
  };
}

export function registerOperations(pi, descriptors: OperationDescriptor[]) {
  for (const descriptor of descriptors) {
    pi.registerTool({
      name: descriptor.name,
      label: descriptor.name.replaceAll("_", " "),
      description: descriptor.description,
      parameters: descriptor.parameters,
      async execute(_id, input) {
        return toolOutput(await descriptor.execute(input));
      },
    });
  }
}
