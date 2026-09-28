import { Type } from "typebox";
import * as discussions from "./index.ts";
import {
  operation,
  registerOperations,
  type OperationDescriptor,
} from "../core/tool-registration.ts";

const S = Type.String;
const I = Type.Integer;
const O = Type.Optional;
const obj = (properties) => Type.Object(properties);

export function discussionOperationDescriptors(): OperationDescriptor[] {
  return [
    operation(
      "github_discussion_comments",
      "Read comments from a Discussion thread.",
      obj({ owner: S(), repo: S(), discussionNumber: I(), limit: O(I()) }),
      (x) =>
        discussions.listComments(x.owner, x.repo, x.discussionNumber, x.limit),
    ),
    operation(
      "github_discussion_post",
      "Post a comment to a Discussion thread.",
      obj({ owner: S(), repo: S(), discussionNumber: I(), body: S() }),
      (x) =>
        discussions.commentOnDiscussion(
          x.owner,
          x.repo,
          x.discussionNumber,
          x.body,
        ),
    ),
    operation(
      "github_discussion_view",
      "Read canonical Discussion title, body, and closure state.",
      obj({ owner: S(), repo: S(), discussionNumber: I() }),
      (x) => discussions.viewDiscussion(x.owner, x.repo, x.discussionNumber),
    ),
    operation(
      "github_discussions_list",
      "List repository Discussions.",
      obj({ owner: S(), repo: S(), limit: O(I()) }),
      (x) => discussions.listDiscussions(x.owner, x.repo, x.limit),
    ),
    operation(
      "github_discussion_delete",
      "Permanently delete a Discussion.",
      obj({ owner: S(), repo: S(), discussionNumber: I() }),
      (x) => discussions.deleteDiscussion(x.owner, x.repo, x.discussionNumber),
    ),
  ];
}

export function registerDiscussionTools(pi) {
  registerOperations(pi, discussionOperationDescriptors());
}
