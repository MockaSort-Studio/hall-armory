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
      "github_pull_request_create",
      "Create a pull request from one repository branch to another.",
      obj({
        repo: bounded(256),
        head: bounded(255),
        base: bounded(255),
        title: bounded(256),
        body: O(Type.String({ maxLength: 65_536 })),
        draft: O(Type.Boolean()),
      }),
      (x) => gitData.createPullRequest(x.repo, x.head, x.base, x.title, x.body, x.draft),
    ),
  ];
}

export function registerGitDataTools(pi) {
  registerOperations(pi, gitDataOperationDescriptors());
}
