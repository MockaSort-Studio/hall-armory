import { strict as assert } from "node:assert";
import { test } from "node:test";
import { reviewThreadComments } from "../src/lib/pulls/index.ts";

const data = {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: [
            {
              isResolved: true,
              comments: {
                nodes: [
                  {
                    path: "old.mjs",
                    originalLine: 2,
                    body: "resolved",
                    url: "old",
                    author: { login: "m" },
                  },
                ],
              },
            },
            {
              isResolved: false,
              comments: {
                nodes: [
                  {
                    path: "live.mjs",
                    line: 8,
                    body: "open",
                    url: "live",
                    author: { login: "m" },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  },
};

test("review-thread reader excludes resolved inline comments by default", () => {
  assert.deepEqual(reviewThreadComments(data), [
    {
      resolved: false,
      path: "live.mjs",
      line: 8,
      body: "open",
      url: "live",
      author: "m",
    },
  ]);
  assert.equal(reviewThreadComments(data, true).length, 2);
});
