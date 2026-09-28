import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  operation,
  registerOperations,
} from "../src/lib/core/tool-registration.ts";

function fakePi() {
  const registered = [];
  return {
    registered,
    registerTool: (definition) => registered.push(definition),
  };
}

test("operation() builds a plain-data descriptor with no pi dependency", () => {
  const descriptor = operation(
    "github_thing_do",
    "Do the thing.",
    { type: "object" },
    (x) => x.value,
  );
  assert.deepEqual(descriptor, {
    name: "github_thing_do",
    description: "Do the thing.",
    parameters: { type: "object" },
    execute: descriptor.execute,
  });
  assert.equal(typeof descriptor.execute, "function");
});

test("registerOperations() is the single seam that turns descriptors into pi.registerTool() calls", () => {
  const pi = fakePi();
  const descriptors = [
    operation("github_widget_list", "List widgets.", { type: "object" }, () => [
      "a",
      "b",
    ]),
    operation(
      "github_widget_create",
      "Create a widget.",
      { type: "object" },
      (x) => ({ name: x.name }),
    ),
  ];

  registerOperations(pi, descriptors);

  assert.equal(pi.registered.length, 2);
  const [list, create] = pi.registered;
  assert.equal(list.name, "github_widget_list");
  assert.equal(list.label, "github widget list");
  assert.equal(list.description, "List widgets.");
  assert.deepEqual(list.parameters, { type: "object" });
  assert.equal(create.label, "github widget create");
});

test("registerOperations() wraps each descriptor's result in the shared tool-output envelope", async () => {
  const pi = fakePi();
  registerOperations(pi, [
    operation(
      "github_widget_get",
      "Get a widget.",
      { type: "object" },
      (x) => ({ id: x.id }),
    ),
  ]);

  const [{ execute }] = pi.registered;
  const result = await execute("call-id", { id: 7 });

  assert.deepEqual(result, {
    content: [{ type: "text", text: JSON.stringify({ id: 7 }) }],
    details: { id: 7 },
  });
});
