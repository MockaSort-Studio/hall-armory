// One complete GitHub operation descriptor set, registered through one schema
// path for every Pi installation.

import { coreOperationDescriptors } from "./core/tools.ts";
import { discussionOperationDescriptors } from "./discussions/tools.ts";
import { issueOperationDescriptors } from "./issues/tools.ts";
import { labelOperationDescriptors } from "./labels/tools.ts";
import { projectOperationDescriptors } from "./projects/tools.ts";
import { pullRequestOperationDescriptors } from "./pulls/tools.ts";
import {
  registerOperations,
  type OperationDescriptor,
} from "./core/tool-registration.ts";

export function githubOperationDescriptors(): OperationDescriptor[] {
  return [
    ...coreOperationDescriptors(),
    ...discussionOperationDescriptors(),
    ...issueOperationDescriptors(),
    ...labelOperationDescriptors(),
    ...projectOperationDescriptors(),
    ...pullRequestOperationDescriptors(),
  ];
}

const registeredSuites = new WeakSet<object>();

export function registerGithubSuite(pi) {
  if (registeredSuites.has(pi)) return;
  registerOperations(pi, githubOperationDescriptors());
  registeredSuites.add(pi);
}
