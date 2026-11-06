import { Type } from "typebox";
import {
  operation,
  type OperationDescriptor,
  registerOperations,
} from "../core/tool-registration.ts";
import * as workspace from "./git.ts";

const bounded = (maxLength: number) => Type.String({ minLength: 1, maxLength });
const repo = bounded(256);
const paths = Type.Array(bounded(4096), { minItems: 1, maxItems: 1000 });
const closed = (properties) => Type.Object(properties, { additionalProperties: false });

export function workspaceOperationDescriptors(): OperationDescriptor[] {
  return [
    operation(
      "github_workspace_checkout",
      "Create a branch at the workspace's checked-out revision and switch to it. Files are unchanged.",
      closed({ repo, revision: bounded(64), branch: bounded(255) }),
      (x) => workspace.checkout(x.repo, x.revision, x.branch),
    ),
    operation(
      "github_git_status",
      "List changed, staged and untracked files in the workspace.",
      closed({ repo }),
      (x) => workspace.status(x.repo),
    ),
    operation(
      "github_git_diff",
      "Unified diff of the workspace against the current commit, optionally limited to paths.",
      closed({ repo, paths: Type.Optional(paths) }),
      (x) => workspace.diff(x.repo, x.paths),
    ),
    operation(
      "github_git_stage",
      "Stage workspace paths as they are now; a deleted file is staged as removed.",
      closed({ repo, paths }),
      (x) => workspace.stage(x.repo, x.paths),
    ),
    operation(
      "github_git_commit",
      "Commit the staged changes on the checked-out branch.",
      closed({ repo, message: bounded(4096) }),
      (x) => workspace.commit(x.repo, x.message),
    ),
    operation(
      "github_git_push",
      "Push the checked-out branch to the same-named branch on GitHub. Fast-forward only.",
      closed({ repo, branch: bounded(255) }),
      (x) => workspace.push(x.repo, x.branch),
    ),
  ];
}

export function registerWorkspaceTools(pi) {
  registerOperations(pi, workspaceOperationDescriptors());
}
