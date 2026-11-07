import { registerGithubSuite } from "./lib/suite.ts";

// A suite host can inject how `gh` is run and where workspace Git operations act. Without injection the
// package uses the host `gh` and the process filesystem at /workspace.
export function activateSuite(pi, { commandTransport, workspace } = {}) {
  registerGithubSuite(pi, { transport: commandTransport, workspace });
}

export default function (pi) {
  activateSuite(pi);
}
