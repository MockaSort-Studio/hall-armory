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
import { withGithubCommandTransport, type GithubCommandTransport } from "./core/gh.ts";

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

export function registerGithubSuite(pi, { transport }: { transport?: GithubCommandTransport } = {}) {
  if (registeredSuites.has(pi)) return;
  const descriptors = githubOperationDescriptors().map((descriptor) => ({
    ...descriptor,
    execute: (input) => withGithubCommandTransport(transport, () => descriptor.execute(input)),
  }));
  registerOperations(pi, descriptors);
  registeredSuites.add(pi);
}
