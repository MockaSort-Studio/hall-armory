import { Type } from "typebox";
import * as repo from "./repo.ts";
import {
  operation,
  registerOperations,
  type OperationDescriptor,
} from "./tool-registration.ts";

const S = Type.String;
const obj = (properties) => Type.Object(properties);

export function coreOperationDescriptors(): OperationDescriptor[] {
  return [
    operation(
      "github_repo_discussions_set",
      "Enable or disable repository Discussions.",
      obj({ repo: S(), enabled: Type.Boolean() }),
      (x) => repo.setDiscussionsEnabled(x.repo, x.enabled),
    ),
  ];
}

export function registerCoreTools(pi) {
  registerOperations(pi, coreOperationDescriptors());
}
