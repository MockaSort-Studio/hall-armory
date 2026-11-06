import { Type } from "typebox";
import * as gitData from "./index.ts";
import {
  operation,
  type OperationDescriptor,
  registerOperations,
} from "../core/tool-registration.ts";

const S = Type.String;
const O = Type.Optional;
const bounded = (maxLength) => Type.String({ minLength: 1, maxLength });
const obj = (properties) => Type.Object(properties);

export function gitDataOperationDescriptors(): OperationDescriptor[] {
  return [
    operation(
      "github_ref_create",
      "Create a repository branch reference from an existing commit SHA.",
      obj({ repo: bounded(256), branch: bounded(255), sha: bounded(64) }),
      (x) => gitData.createBranch(x.repo, x.branch, x.sha),
    ),
    operation(
      "github_file_update",
      "Create or update one UTF-8 repository file on a branch through the GitHub API.",
      obj({
        repo: bounded(256),
        branch: bounded(255),
        path: bounded(1024),
        // GitHub's Contents API accepts at most 1 MiB. Keep room for base64
        // expansion and command arguments rather than relying on host limits.
        content: bounded(700_000),
        message: bounded(512),
        sha: O(bounded(64)),
      }),
      (x) =>
        gitData.updateFile(
          x.repo,
          x.branch,
          x.path,
          x.content,
          x.message,
          x.sha,
        ),
    ),
    operation(
      "github_pull_request_create",
      "Create a pull request from one repository branch to another.",
      obj({
        repo: bounded(256),
        head: bounded(255),
        base: bounded(255),
        title: bounded(256),
        body: O(Type.String({ maxLength: 65_536 })),
      }),
      (x) => gitData.createPullRequest(x.repo, x.head, x.base, x.title, x.body),
    ),
  ];
}

export function registerGitDataTools(pi) {
  registerOperations(pi, gitDataOperationDescriptors());
}
