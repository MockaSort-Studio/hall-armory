import { registerNpmSuite } from "./lib/suite.ts";

// A suite host can inject where the lockfile is read and the dependency tree is written (`workspace`, the same
// shape the GitHub suite takes) and how HTTPS is done (`fetch`). Without injection the package uses the process
// filesystem at /workspace and the global `fetch`.
export function activateSuite(pi, { workspace, fetch } = {}) {
  registerNpmSuite(pi, { workspace, fetch });
}

export default function (pi) {
  activateSuite(pi);
}
