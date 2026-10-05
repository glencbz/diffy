// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-review>>[init]
import * as z from "zod";
import {
  type Anchor,
  type LocalVersion,
  localReview,
  type ReviewDocument,
} from "../../frontend/model/review";
import { JjError, type JjLogEntry, jjCommits } from "../commit/jj";
import { RegistrationError, resolveRegistration } from "../review/local";
import type { ReviewStore } from "../review/store";
import { type Tool, ToolError, tool } from "./mcp";

export const AGENT = "claude";

export const INSTRUCTIONS = `diffy is where the reader reviews your work. When a piece of work is ready, register it with register_review under its bookmark and give the reader the link it returns. Before you change work the reader has reviewed, read_comments on it, and answer or resolve what they wrote.`;

function newest(document: ReviewDocument, name: string): LocalVersion {
  const version = localReview(document, name)?.versions.at(-1);
  if (version === undefined) {
    throw new ToolError(`no local review is named ${name}`);
  }
  return version;
}

function link(origin: string, name: string): string {
  return `${origin}/reviews/${encodeURIComponent(name)}`;
}

function subject(entry: JjLogEntry): string {
  return entry.description.split("\n")[0] || "(no description)";
}

async function commitsOf(version: LocalVersion): Promise<JjLogEntry[]> {
  const found = await jjCommits(version.commits);
  return version.commits.flatMap((id) => found.get(id) ?? []);
}

function where(anchor: Anchor): string {
  switch (anchor.kind) {
    case "line":
      return `${anchor.path}:${anchor.line}${anchor.side === "before" ? " (before)" : ""}`;
    case "file":
      return anchor.path;
    case "comparison":
      return "whole commit";
  }
}

const Name = z.string().min(1).describe("the local review's name");

export function reviewTools(store: ReviewStore): Tool[] {
  return [
    tool({
      name: "register_review",
      description:
        "Register a new version of a local review for the reader, and answer with its link. A new name reads trunk()..<name>; an existing one reads the revset of its last version.",
      input: z.object({
        name: Name.describe(
          "the local review's name, usually the bookmark of the work",
        ),
        revset: z
          .string()
          .min(1)
          .optional()
          .describe("the commits to review, oldest to newest"),
      }),
      call: async ({ name, revset }, { origin }) => {
        let version: LocalVersion;
        try {
          ({ version } = await resolveRegistration(
            store.read().document,
            { name, revset },
            new Date().toISOString(),
          ));
        } catch (error) {
          if (error instanceof RegistrationError || error instanceof JjError) {
            throw new ToolError(error.message);
          }
          throw error;
        }
        store.apply({ kind: "register", name, version });
        const commits = await commitsOf(version);
        return [
          link(origin, name),
          ...commits.map(
            (entry) => `${entry.changeId.slice(0, 8)} ${subject(entry)}`,
          ),
        ].join("\n");
      },
    }),
    tool({
      name: "list_reviews",
      description:
        "List the local reviews, with how many versions each has and their links.",
      input: z.object({}),
      call: async (_input, { origin }) => {
        const { document } = store.read();
        const lines = document.localReviews
          .filter((review) => review.forgottenAt === undefined)
          .map((review) => {
            const last = review.versions.at(-1);
            return `${review.name}: ${review.versions.length} version(s), last ${last?.registeredAt ?? "never"}, ${link(origin, review.name)}`;
          });
        return lines.length === 0 ? "no local reviews" : lines.join("\n");
      },
    }),
    tool({
      name: "read_comments",
      description:
        "Read the comments on the newest version of a local review, as JSON. Each names its change, where it sits, who wrote it, and whether it is resolved or stale.",
      input: z.object({
        name: Name,
        unresolvedOnly: z.boolean().default(true),
      }),
      call: async ({ name, unresolvedOnly }) => {
        const { document } = store.read();
        const version = newest(document, name);
        const commits = await commitsOf(version);
        const byKey = new Map(
          commits.flatMap((entry) => [
            [`change:${entry.changeId}`, entry],
            [`rev:${entry.commitId}`, entry],
          ]),
        );
        const comments = document.comments.flatMap((comment) => {
          const entry = byKey.get(comment.reviewKey);
          if (entry === undefined) return [];
          if (unresolvedOnly && comment.resolved) return [];
          return [
            {
              id: comment.id,
              author: comment.author,
              change: entry.changeId.slice(0, 8),
              subject: subject(entry),
              commit: comment.commitId.slice(0, 12),
              at: where(comment),
              body: comment.body,
              resolved: comment.resolved,
              stale: !version.commits.includes(comment.commitId),
            },
          ];
        });
        return JSON.stringify(comments, null, 2);
      },
    }),
    tool({
      name: "add_comment",
      description:
        "Comment on a change in the newest version of a local review: on a line of a file with path and line, on a whole file with path alone, or on the whole commit with neither.",
      input: z.object({
        name: Name,
        change: z
          .string()
          .min(1)
          .describe("a change id or commit id in the review, or a prefix"),
        path: z.string().min(1).optional(),
        line: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("a line number in the file as the commit leaves it"),
        side: z
          .enum(["before", "after"])
          .default("after")
          .describe("before for a line the commit removes"),
        body: z.string().min(1),
      }),
      call: async ({ name, change, path, line, side, body }) => {
        const version = newest(store.read().document, name);
        const matches = (await commitsOf(version)).filter(
          (entry) =>
            entry.changeId.startsWith(change) ||
            entry.commitId.startsWith(change),
        );
        const [entry, ...others] = matches;
        if (entry === undefined || others.length > 0) {
          throw new ToolError(
            `${change} names ${matches.length} commits of ${name}'s newest version, not one`,
          );
        }
        if (line !== undefined && path === undefined) {
          throw new ToolError("a line comment needs a path");
        }
        const anchor: Anchor =
          path === undefined
            ? { kind: "comparison" }
            : line === undefined
              ? { kind: "file", path }
              : { kind: "line", path, side, line };
        const id = crypto.randomUUID();
        store.apply({
          kind: "add-comment",
          comment: {
            id,
            reviewKey: `change:${entry.changeId}`,
            commitId: entry.commitId,
            body,
            resolved: false,
            createdAt: new Date().toISOString(),
            author: AGENT,
            ...anchor,
          },
        });
        return id;
      },
    }),
    tool({
      name: "resolve_comment",
      description: "Resolve a comment, or reopen it with resolved false.",
      input: z.object({
        id: z.string().min(1),
        resolved: z.boolean().default(true),
      }),
      call: async ({ id, resolved }) => {
        if (!store.read().document.comments.some((each) => each.id === id)) {
          throw new ToolError(`no comment has id ${id}`);
        }
        store.apply({ kind: "resolve-comment", id, resolved });
        return resolved ? "resolved" : "reopened";
      },
    }),
  ];
}
// ~/~ end
