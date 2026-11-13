// Plain operation descriptors keep schemas separate from Pi's registration API.
export type OperationDescriptor = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (input: any, context?: { signal?: AbortSignal }) => Promise<unknown> | unknown;
};

const toolOutput = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }], details: value });

export function registerOperations(pi, descriptors: OperationDescriptor[]) {
  for (const descriptor of descriptors) {
    pi.registerTool({
      name: descriptor.name,
      label: descriptor.name.replaceAll("_", " "),
      description: descriptor.description,
      parameters: descriptor.parameters,
      async execute(_id, input, signal) {
        return toolOutput(await descriptor.execute(input, { signal }));
      },
    });
  }
}
