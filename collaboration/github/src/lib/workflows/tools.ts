import { Type } from "typebox";
import { operation, type OperationDescriptor } from "../core/tool-registration.ts";
import * as workflows from "./index.ts";
const S = Type.String, I = Type.Integer, O = Type.Optional;
export function workflowOperationDescriptors(): OperationDescriptor[] {
  return [
    operation("github_workflow_runs_list", "List bounded GitHub Actions workflow runs.", Type.Object({ repo: S(), workflow: O(S()), limit: O(I({ minimum: 1, maximum: 100 })) }), (x) => workflows.listWorkflowRuns(x.repo, x.workflow, x.limit)),
    operation("github_workflow_run_view", "View one GitHub Actions workflow run and jobs.", Type.Object({ repo: S(), runId: I({ minimum: 1 }) }), (x) => workflows.viewWorkflowRun(x.repo, x.runId)),
    operation("github_workflow_run_failed_log", "Read a bounded failed-step log tail for one workflow run.", Type.Object({ repo: S(), runId: I({ minimum: 1 }), maxChars: O(I({ minimum: 1, maximum: 12000 })) }), (x) => workflows.failedWorkflowRunLog(x.repo, x.runId, x.maxChars)),
  ];
}
