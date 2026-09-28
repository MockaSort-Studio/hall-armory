// This package owns one complete GitHub operation descriptor set. Static Pi
// installation and future sandbox preparation both register through this same
// descriptor list, so neither path has a separate schema copy to maintain.
// Catalog placement, Crew profiles, and native-tool preparation belong outside
// this package.

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
