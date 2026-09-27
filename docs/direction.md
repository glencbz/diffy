# Direction

Where diffy is going after the review features in the
[tech plan](tech-plan.md), and why. This is a sketch to be filled in, not a
design: each stage below gets a design of its own before any code is written
for it.

The end state is a review loop between a person and a coding agent. The agent
presents its work to the reader as a series of jj changes, the reader reviews
it in diffy and leaves feedback, and the agent reads that feedback, rewrites
the changes, and hands them back. The loop needs two things diffy lacks, so they
come first. Local review has to do everything pull request review does, and
review comments have to live somewhere an agent can read them.

## What review is for

Code review tools are built around tasks such as picking a version, reading a
diff, leaving a comment, and approving. Designing for the goals behind those tasks shows where
the tools fall short, diffy included.

| Who | Goals |
|---|---|
| Author | Get merged in few round trips. Make the intent easy to read. Know nothing is outstanding. |
| First-pass reviewer | Understand the shape before the detail. Find the risky parts. |
| Returning reviewer | Spend attention only on what moved since the last look. Confirm earlier concerns were addressed. |
| Owner | Know what is waiting on them. Approve only what they answer for. Merge with confidence. |
| Self-reviewer | Catch their own mistakes before anyone else sees them. |
| Archaeologist | Learn why the code is the way it is. |

The unit a tool reviews decides which of these goals it can reach. GitHub
reviews a branch, and a force push replaces the thing under review, so
"what changed since I last looked" is unreliable after a rebase and old
comments turn "Outdated" and hide. Gerrit, Google's Critique, and mailing-list
review with `git range-diff` review a change whose identity survives a
rewrite, so the same question is built in. Branch review makes the author
choose between a clean history and a reviewer who can follow it, and habits
like "address review" fixup commits and "rebased, no changes" comments are
authors paying for that choice. diffy sits with the change-identity tools
while reading GitHub's data, and that is its reason to exist.

Two ideas from other tools matter most for where diffy goes. Critique and
Gerrit keep an *attention set* on every change, the people whose turn it is
to act, which answers "what is waiting on me" per person instead of per
change. Reviewable lets each comment say whether it blocks, is being
discussed, or is only for information, which turns "is this resolved" into
"was my concern addressed".

diffy today serves the returning reviewer and the self-reviewer, but each
screen holds half of the loop. The local history screen keeps comments,
marks, and viewed files, and has no memory of where the reader last stopped.
The pull request screen opens on what changed since the head last reviewed,
and keeps no comments or marks. Nothing a reader writes leaves the browser.

## Local review does what pull request review does

A reader reviewing a local series should get everything a pull request
gives them, and the reverse.

The pull request screen has a history axis of heads, and remembers the last
one the reader marked reviewed. The local screen's history axis is the jj
operation log, which is deep and records every mutation, so the local
equivalent of a head is not one operation but the state of one series at
the operations where it changed. Finding that axis, and what "the series"
means when nothing like a pull request names it, is the first design
question. A bookmark is the obvious candidate. A change id and its
descendants are another, and suit an agent that does not make bookmarks.

The review document already follows a change through an amend, and the pull
request screen needs it too. A reader's corrections to the pairing should
survive a reload, since the returning reviewer is the one who needs them.

## Comments move into a backend

Comments, marks, and viewed files live in the browser's `localStorage`, which
[review](architecture/frontend/review.md#storage) chose because a
synchronous read needs no loading state and a synchronous write needs no
optimistic update. An agent cannot read a browser's storage, and neither can
a second browser, so the review document moves to the server, and the loading
and failure states that choice avoided come back.

Review state left `.jj/` because that directory is jj's and diffy's
bookkeeping does not belong in it, and that still holds. Where it goes instead, whether
beside the repository, in a data directory keyed by repository, or in the
repository's own history where it travels with the code, is open.

A comment needs things the browser never asked of it once more than one
party writes it: who wrote it, whether it blocks, and replies. A comment is
also the natural place to carry a disposition, so "stale" can grow into
"addressed" or "not addressed".

## Reviewing with an agent

Both directions of the loop run through the same review document.

From the reader to the agent, feedback is comments anchored to a line, a
file, or a whole change, as they are now. The agent reads the open ones,
rewrites the changes they are on, and answers each comment. Because jj keeps
a change's id through the rewrite, the reader's next visit opens on the
interdiff from what they reviewed to what the agent did, and every comment
shows whether the line it is about moved. The reader checks the answer to
their feedback, not the whole change again.

From the agent to the reader, work arrives as a series of changes whose
messages say what each one does and why, which is what the commit stack
already reads best. The agent can also comment on its own changes to point
at what it is unsure of or what deserves a close read, which answers the
first-pass reviewer's question of where the risk is.

Whose turn it is ties the two together. A series is waiting on the reader
when the agent has rewritten it since the reader last reviewed, and waiting
on the agent when open blocking comments sit on it. That is an attention set
of two, worked out from state diffy already keeps, and it is what lets a
reader run several agents at once and see which of them needs them.

## Open questions

- How an agent reaches the review document: a CLI, an HTTP API next to the
  one the frontend uses, or an MCP server.
- What names a local series that no bookmark marks.
- Whether review comments are kept with the repository and shared, or kept
  per reader.
- How comments written in diffy reach a GitHub pull request, and whether the
  two kinds of comment are one kind.
