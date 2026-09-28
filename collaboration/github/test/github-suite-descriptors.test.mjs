import { strict as assert } from "node:assert";
import { test } from "node:test";
import installGithubExtension from "../src/index.ts";
import { githubOperationDescriptors } from "../src/lib/suite.ts";

function fakePi() {
  const registered = [];
  return {
    registered,
    registerTool: (definition) => registered.push(definition),
  };
}

function schemaShape(definitions) {
  return definitions
    .map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

test("static installation (index.ts) registers exactly the reusable descriptor set, once each", () => {
  const pi = fakePi();
  installGithubExtension(pi);

  const staticallyRegistered = schemaShape(pi.registered);
  const reusableDescriptors = schemaShape(githubOperationDescriptors());

  // Same length and same {name, description, parameters} shape proves the
  // static path is not carrying a second, hand-maintained schema copy: it
  // registers through the identical descriptor list a loader would use.
  assert.equal(staticallyRegistered.length, reusableDescriptors.length);
  assert.deepEqual(staticallyRegistered, reusableDescriptors);

  const names = staticallyRegistered.map((d) => d.name);
  const uniqueNameCount = new Set(names).size;
  assert.equal(
    uniqueNameCount,
    names.length,
    "no duplicate tool names across GitHub domains",
  );
  assert.ok(
    names.length > 30,
    "expected the full multi-domain GitHub tool set to be registered",
  );
});

test("installation is idempotent for the same Pi instance", () => {
  const pi = fakePi();
  installGithubExtension(pi);
  installGithubExtension(pi);
  assert.equal(pi.registered.length, githubOperationDescriptors().length);
});

test("reusable descriptors expose a callable execute independent of pi.registerTool", () => {
  for (const descriptor of githubOperationDescriptors()) {
    assert.equal(
      typeof descriptor.execute,
      "function",
      `${descriptor.name} must expose a plain execute function`,
    );
  }
});

test("pull-review blocking-findings safety is reachable through the registered descriptor", async () => {
  const descriptor = githubOperationDescriptors().find(
    (d) => d.name === "github_pull_request_review_submit",
  );
  assert.ok(
    descriptor,
    "github_pull_request_review_submit descriptor must exist",
  );

  await assert.rejects(
    () =>
      descriptor.execute({
        reviewId: "R_1",
        event: "approve",
        body: "Looks good.",
        hasBlockingFindings: true,
      }),
    /blocking findings/,
  );
});
