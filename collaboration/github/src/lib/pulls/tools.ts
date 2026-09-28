import { Type } from "typebox";
import * as pulls from "./index.ts";
import * as reviews from "./reviews.ts";
import {
  operation,
  registerOperations,
  type OperationDescriptor,
} from "../core/tool-registration.ts";

const S = Type.String;
const I = Type.Integer;
const O = Type.Optional;
const E = (values) => Type.Union(values.map((value) => Type.Literal(value)));
const obj = (properties) => Type.Object(properties);

export function pullRequestOperationDescriptors(): OperationDescriptor[] {
  return [
    operation(
      "github_pull_requests_list",
      "List repository pull requests.",
      obj({ repo: S(), state: O(S()), limit: O(I()) }),
      (x) => pulls.listPullRequests(x.repo, x.state, x.limit),
    ),
    operation(
      "github_pull_request_view",
      "Read a pull request.",
      obj({ repo: S(), pullNumber: I() }),
      (x) => pulls.viewPullRequest(x.repo, x.pullNumber),
    ),
    operation(
      "github_pull_request_files",
      "Read changed pull-request files and patches.",
      obj({ repo: S(), pullNumber: I() }),
      (x) => reviews.listPullRequestFiles(x.repo, x.pullNumber),
    ),
    operation(
      "github_pull_request_checks",
      "Read pull-request check results.",
      obj({ repo: S(), pullNumber: I() }),
      (x) => reviews.listPullRequestChecks(x.repo, x.pullNumber),
    ),
    operation(
      "github_pull_request_review_threads",
      "Read inline pull-request review threads; unresolved only by default.",
      obj({ repo: S(), pullNumber: I(), includeResolved: O(Type.Boolean()) }),
      (x) =>
        pulls.listPullRequestReviewThreads(
          x.repo,
          x.pullNumber,
          x.includeResolved,
        ),
    ),
    operation(
      "github_pull_request_comment",
      "Post a comment on a pull request.",
      obj({ repo: S(), pullNumber: I(), body: S() }),
      (x) => pulls.commentOnPullRequest(x.repo, x.pullNumber, x.body),
    ),
    operation(
      "github_pull_request_update",
      "Edit pull request title, body, base branch, or state.",
      obj({
        repo: S(),
        pullNumber: I(),
        title: O(S()),
        body: O(S()),
        base: O(S()),
        state: O(S()),
      }),
      (x) => pulls.updatePullRequest(x.repo, x.pullNumber, x),
    ),
    operation(
      "github_pull_request_review_start",
      "Start a pending pull-request review for batched inline comments.",
      obj({ repo: S(), pullNumber: I(), body: O(S()) }),
      (x) => reviews.startPullRequestReview(x.repo, x.pullNumber, x.body),
    ),
    operation(
      "github_pull_request_review_inline_comment",
      "Add an inline comment to a pending pull-request review.",
      obj({
        repo: S(),
        pullNumber: I(),
        reviewId: S(),
        path: S(),
        line: I({ minimum: 1 }),
        side: O(E(["LEFT", "RIGHT"])),
        body: S(),
      }),
      (x) =>
        reviews.addInlinePullRequestReviewComment(
          x.repo,
          x.pullNumber,
          x.reviewId,
          x,
        ),
    ),
    operation(
      "github_pull_request_review_submit",
      "Submit a pending review. Approval is forbidden when blocking findings are declared.",
      obj({
        reviewId: S(),
        event: E(["approve", "request-changes"]),
        body: O(S()),
        hasBlockingFindings: Type.Boolean(),
      }),
      (x) => reviews.submitPullRequestReview(x.reviewId, x),
    ),
    operation(
      "github_pull_request_review",
      "Approve or request changes on a pull request without inline comments.",
      obj({
        repo: S(),
        pullNumber: I(),
        event: E(["approve", "request-changes"]),
        body: O(S()),
      }),
      (x) => pulls.reviewPullRequest(x.repo, x.pullNumber, x.event, x.body),
    ),
    operation(
      "github_pull_request_merge",
      "Merge a pull request.",
      obj({
        repo: S(),
        pullNumber: I(),
        method: O(E(["merge", "squash", "rebase"])),
      }),
      (x) => pulls.mergePullRequest(x.repo, x.pullNumber, x.method),
    ),
    operation(
      "github_pull_request_add_label",
      "Apply labels to a pull request.",
      obj({ repo: S(), pullNumber: I(), labels: Type.Array(S()) }),
      (x) => pulls.addPullRequestLabels(x.repo, x.pullNumber, x.labels),
    ),
    operation(
      "github_pull_request_remove_label",
      "Remove a label from a pull request.",
      obj({ repo: S(), pullNumber: I(), label: S() }),
      (x) => pulls.removePullRequestLabel(x.repo, x.pullNumber, x.label),
    ),
  ];
}

export function registerPullRequestTools(pi) {
  registerOperations(pi, pullRequestOperationDescriptors());
}
