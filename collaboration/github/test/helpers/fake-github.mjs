// A hermetic GitHub command transport for tests: answers `gh` argument vectors from a route table and records every
// call with the options it received. A route is a value (JSON-encoded unless it is a string or bytes), an Error to
// throw, or a function of (args, options).
export function fakeGithub(routes) {
  const calls = [];
  const transport = {
    async run(args, options) {
      calls.push({ args, options });
      const key = args.join(" ");
      if (!(key in routes)) throw Object.assign(new Error(`HTTP 404: no route for ${key}`), { status: 404 });
      let answer = routes[key];
      if (typeof answer === "function") answer = await answer(args, options);
      if (answer instanceof Error) throw answer;
      if (typeof answer === "string" || answer instanceof Uint8Array) return answer;
      return JSON.stringify(answer);
    },
  };
  return { transport, calls, keys: () => calls.map((call) => call.args.join(" ")) };
}

export function fakePi() {
  const tools = new Map();
  return { tools, registerTool: (tool) => tools.set(tool.name, tool) };
}

export const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

// What a failed synchronous `gh` call looks like: `status` is the exit code, the HTTP status is only in stderr.
export const ghFailure = (http, text) => Object.assign(new Error(`Command failed: gh api`), { status: 1, stderr: `gh: ${text} (HTTP ${http})` });
