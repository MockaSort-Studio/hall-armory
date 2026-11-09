import { Type } from "typebox";
import { operation, type OperationDescriptor } from "../core/tool-registration.ts";
import * as workflows from "./index.ts";
const S = Type.String, I = Type.Integer, O = Type.Optional;
export function workflowOperationDescriptors(): OperationDescriptor[] {
  return [
    operation("github_workflow_runs_list", "List bounded GitHub Actions workflow runs.", Type.Object({ repo: S(), workflow: O(S()), limit: O(I({ minimum: 1, maximum: 100 })) }), (x) => workflows.listWorkflowRuns(x.repo, x.workflow, x.limit)),
    operation(
      "github_workflow_run_view",
      "View one GitHub Actions workflow run and jobs. Set `artifacts` to also list the run's artifacts (id, name, size, expiry, digest).",
      Type.Object({ repo: S(), runId: I({ minimum: 1 }), artifacts: O(Type.Boolean()) }),
      (x, context) => workflows.viewWorkflowRun(x.repo, x.runId, { artifacts: x.artifacts, signal: context?.signal }),
    ),
    operation(
      "github_workflow_run_failed_log",
      "Read a bounded failed-step log tail for one workflow run. Evidence options select instead: `jobId`/`step` (default: the first failed job and step) paged by `startLine`/`maxLines` from the first error, or with `artifactId`/`artifactName` the file list or one `artifactPath` text file of a completed run's artifact. For an artifact file list, `startLine`/`maxLines` count entries. Results carry `state` (ok, running, unavailable, expired, missing, oversized, malformed) and, when truncated, a `continuation` (`startLine`, plus `startChar` inside an over-long line) to pass back.",
      Type.Object({
        repo: S(),
        runId: I({ minimum: 1 }),
        maxChars: O(I({ minimum: 1, maximum: 12000 })),
        jobId: O(I({ minimum: 1 })),
        step: O(I({ minimum: 1, maximum: 1000 })),
        firstFailure: O(Type.Boolean()),
        startLine: O(I({ minimum: 1 })),
        startChar: O(I({ minimum: 0, maximum: 4194304 })),
        maxLines: O(I({ minimum: 1, maximum: 2000 })),
        artifactId: O(I({ minimum: 1 })),
        artifactName: O(S({ minLength: 1, maxLength: 256 })),
        artifactPath: O(S({ minLength: 1, maxLength: 1024 })),
      }),
      (x, context) => workflows.workflowRunFailureEvidence(x, context?.signal),
    ),
  ];
}
