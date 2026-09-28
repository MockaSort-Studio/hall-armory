import { Type } from "typebox";
import * as labels from "./index.ts";
import {
  operation,
  registerOperations,
  type OperationDescriptor,
} from "../core/tool-registration.ts";

const S = Type.String;
const I = Type.Integer;
const O = Type.Optional;
const obj = (properties) => Type.Object(properties);

export function labelOperationDescriptors(): OperationDescriptor[] {
  return [
    operation(
      "github_label_list",
      "List all labels in a repository.",
      obj({ repo: S() }),
      (x) => labels.listLabels(x.repo),
    ),
    operation(
      "github_label_create",
      "Create a new label in a repository.",
      obj({ repo: S(), name: S(), color: S(), description: O(S()) }),
      (x) => labels.createLabel(x.repo, x.name, x.color, x.description),
    ),
    operation(
      "github_label_update",
      "Update an existing label's color or description.",
      obj({ repo: S(), name: S(), color: O(S()), description: O(S()) }),
      (x) => labels.updateLabel(x.repo, x.name, x.color, x.description),
    ),
    operation(
      "github_issue_add_label",
      "Add one or more labels to an Issue.",
      obj({ repo: S(), issueNumber: I(), labels: Type.Array(S()) }),
      (x) => labels.addLabels(x.repo, x.issueNumber, x.labels),
    ),
    operation(
      "github_issue_remove_label",
      "Remove a specific label from an Issue.",
      obj({ repo: S(), issueNumber: I(), label: S() }),
      (x) => labels.removeLabel(x.repo, x.issueNumber, x.label),
    ),
  ];
}

export function registerLabelTools(pi) {
  registerOperations(pi, labelOperationDescriptors());
}
