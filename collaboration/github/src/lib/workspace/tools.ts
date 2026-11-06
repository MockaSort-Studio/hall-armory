import { Type } from "typebox";
import {
  operation,
  type OperationDescriptor,
  registerOperations,
} from "../core/tool-registration.ts";
import { snapshotRepository } from "./index.ts";

const bounded = (maxLength: number) => Type.String({ minLength: 1, maxLength });

export function workspaceOperationDescriptors(): OperationDescriptor[] {
  return [
    operation(
      "github_workspace_snapshot",
      "Populate an empty private guest workspace from a repository revision.",
      Type.Object({ repo: bounded(256), revision: bounded(255) }),
      (input) => snapshotRepository(input.repo, input.revision),
    ),
  ];
}

export function registerWorkspaceTools(pi) {
  registerOperations(pi, workspaceOperationDescriptors());
}
