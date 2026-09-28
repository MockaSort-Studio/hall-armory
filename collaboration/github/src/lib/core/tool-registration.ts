// Plain operation descriptors keep domain schemas separate from Pi's
// registration API. This is the single registration seam for the suite.

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
