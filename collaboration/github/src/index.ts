import { registerGithubSuite } from "./lib/suite.ts";

export function activateSuite(pi, { commandTransport } = {}) {
  registerGithubSuite(pi, { transport: commandTransport });
}

export default function (pi) {
  activateSuite(pi);
}
