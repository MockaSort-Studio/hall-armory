import { Type } from "typebox";
import * as gitData from "./index.ts";
import {
  operation,
  type OperationDescriptor,
  registerOperations,
} from "../core/tool-registration.ts";

const S = Type.String;
const O = Type.Optional;
const obj = (properties) => Type.Object(properties);

export function gitDataOperationDescriptors(): OperationDescriptor[] {
  return [
    operation(
      "github_ref_create",
      "Create a repository branch reference from an existing commit SHA.",
      obj({ repo: S(), branch: S(), sha: S() }),
      (x) => gitData.createBranch(x.repo, x.branch, x.sha),
    ),
    operation(
      "github_file_update",
      "Create or update one UTF-8 repository file on a branch through the GitHub API.",
      obj({
        repo: S(),
        branch: S(),
        path: S(),
        content: S(),
        message: S(),
        sha: O(S()),
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
      obj({ repo: S(), head: S(), base: S(), title: S(), body: O(S()) }),
      (x) => gitData.createPullRequest(x.repo, x.head, x.base, x.title, x.body),
    ),
  ];
}

export function registerGitDataTools(pi) {
  registerOperations(pi, gitDataOperationDescriptors());
}
