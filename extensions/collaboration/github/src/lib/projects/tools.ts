import { Type } from "typebox";
import * as projects from "./index.ts";
import {
  operation,
  registerOperations,
  type OperationDescriptor,
} from "../core/tool-registration.ts";

const S = Type.String;
const I = Type.Integer;
const obj = (properties) => Type.Object(properties);

export function projectOperationDescriptors(): OperationDescriptor[] {
  return [
    operation(
      "github_project_fields",
      "Read live Project field and option IDs.",
      obj({ org: S(), project: I() }),
      (x) => projects.getFieldMap(x.org, x.project),
    ),
    operation(
      "github_project_item_add",
      "Add an Issue or PR URL to a Project.",
      obj({ org: S(), project: I(), url: S() }),
      (x) => projects.addItem(x.org, x.project, x.url),
    ),
    operation(
      "github_project_item_find",
      "Find a Project item for an Issue.",
      obj({ org: S(), project: I(), issueNumber: I() }),
      (x) => projects.findItemId(x.org, x.project, x.issueNumber),
    ),
    operation(
      "github_project_field_set",
      "Set a single-select Project field.",
      obj({
        org: S(),
        project: I(),
        itemId: S(),
        fieldName: S(),
        valueName: S(),
      }),
      (x) =>
        projects.setField(x.org, x.project, x.itemId, x.fieldName, x.valueName),
    ),
  ];
}

export function registerProjectTools(pi) {
  registerOperations(pi, projectOperationDescriptors());
}
