import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  assertNotSelfReview,
  changedPullRequestLine,
  inlineReviewInput,
  reviewSubmissionInput,
} from "../src/lib/pulls/reviews.ts";

test("inline review comments require an actionable diff location", () => {
  assert.deepEqual(
    inlineReviewInput({
      path: "src/a.ts",
      line: 12,
      body: "Handle the null case.",
    }),
    {
      path: "src/a.ts",
      line: 12,
      side: "RIGHT",
      body: "Handle the null case.",
    },
  );
  for (const input of [
    { path: "", line: 1, body: "x" },
    { path: "a", line: 0, body: "x" },
    { path: "a", line: 1, body: " " },
  ])
    assert.throws(() => inlineReviewInput(input), /Inline review comment/);
});

test("inline review locations must belong to the PR diff", () => {
  const files = [
    {
      filename: "src/a.ts",
      patch: "@@ -8,2 +8,3 @@\n old\n-old\n+new\n+extra",
    },
  ];
  assert.ok(changedPullRequestLine(files, "src/a.ts", 9, "RIGHT"));
  assert.ok(changedPullRequestLine(files, "src/a.ts", 9, "LEFT"));
  assert.ok(!changedPullRequestLine(files, "src/a.ts", 8, "RIGHT"));
  assert.ok(!changedPullRequestLine(files, "other.ts", 9, "RIGHT"));
});

test("self-review is mechanically rejected", () => {
  assert.throws(
    () => assertNotSelfReview("snowball", "snowball"),
    /own pull request/,
  );
  assert.doesNotThrow(() => assertNotSelfReview("snowball", "mergio"));
});

test("approval cannot be submitted with declared blocking findings", () => {
  assert.throws(
    () =>
      reviewSubmissionInput({
        event: "approve",
        body: "Looks good.",
        hasBlockingFindings: true,
      }),
    /blocking findings/,
  );
  assert.deepEqual(
    reviewSubmissionInput({
      event: "request-changes",
      hasBlockingFindings: true,
    }),
    {
      event: "REQUEST_CHANGES",
      body: "",
    },
  );
});
