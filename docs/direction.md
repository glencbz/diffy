# Direction

Where diffy is going after the [tech plan](tech-plan.md), and why. The
agent loop at the end is still a sketch.

The end state is a review loop between a person and a coding agent. The agent
presents its work to the reader as a series of jj changes, the reader reviews
it in diffy and leaves feedback, and the agent reads that feedback, rewrites
the changes, and hands them back. The loop needs two things diffy lacks, so they
come first. Local review has to do everything pull request review does, and
review comments have to live somewhere an agent can read them.

## What review is for

Code review tools are built around tasks such as picking a version, reading a
diff, leaving a comment, and approving. Designing for the goals behind those
tasks shows where the tools fall short, diffy included.

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

## Local review does what pull request review does

The pull request screen reviews a series that has versions. The local
history screen compares any commits at any operations. The first is built
around what a reviewer wants and the second around what jj can answer, and
local review gets parity by gaining the first screen, not by growing the
second.

| | Pull requests | Local history |
|---|---|---|
| A list of things to review | Pull requests | None |
| Remembers where the reader stopped | Last reviewed head | None |
| Commit stack, message first, added, dropped, amended, reworded | Yes | No, one interdiff row per commit |
| Pairing the reader can correct | Yes, lost on reload | No, `alignSeries` decides |
| Marks, comments, viewed files | No | Yes |
| Size of the whole series | Yes | No |
| A place in the address | Yes | No |

### A local review is registered

A local review exists because someone registered it. Most local work is not
up for review: experiments, half-finished changes, and bookmarks kept for
reference sit beside the few series that are. The list of local reviews
holds only those few, so the reader opens diffy onto what is waiting for
them and nothing else.

A registration is an operation and a revset, and names the commits the
revset held at that operation. The operation defaults to the current one
and the revset to `trunk()..<bookmark>`, with the bookmark at or nearest
below the working copy filled in and editable. Any revset can be given, so
an agent that does not make bookmarks registers `trunk()..<change id>`.
Registering is one command on the server's API, which is what lets an agent
declare its own work done, and the local list offers the same command to
the reader.

A review has a name, which defaults to the bookmark's, and registering
under a name that exists adds a version to that review rather than starting
another. Each version keeps its own revset, and a new version's revset
defaults to the last one's, so a series that is split or renamed can stay
one review.

Listing every bookmark was the other candidate, since the jj-commit-stack
workflow already bookmarks every change up for review. It loses because
bookmarks are not only for review, and a list of all of them buries the
series that needs the reader under the ones that do not, so the reader has
to go looking. A registration is also the point at which someone says the
work is ready, which no bookmark records.

### A version is a registration

A pull request's versions are the heads its branch has had. A local
review's versions are its registrations, and the series at a version is its
revset evaluated at its operation. The operation fixes the whole view of
the repository, so `trunk()` and the bookmark resolve the way they did when
the work was declared ready, and jj reads the hidden commits of an old
operation by id, so a version stays readable after its commits are
rewritten.

A bookmark's live position is not a version. It moves with every amend and
snapshot, and work in progress is exactly what the reader is not asked to
review. The operation screen still shows any of it on request. Recording
the head's commit id instead of the operation would pin a series with one
head, but not a revset with several, and would leave `trunk()` to be
resolved against today's repository.

"Mark reviewed" records a version against its review on both screens, and
keeps every version marked rather than the last one only. On the pull
request screen marked heads annotate GitHub's list of heads. On the local
screen the reader's marks sit on the registrations, and the review opens on
the interdiff from the last marked version to the newest.

### One review screen over two sources

`PullReview` becomes a series review that reads its versions, each
version's commits, and each row's comparison from a source, with a pull
request and a registered local review as its two sources. The commit stack, the paired
graph, the pairing, the last-reviewed strip, and the size summary come with
it unchanged.

Writing a second screen for local reviews would copy all of that and let the two
drift. The tech plan keeps the jj and GitHub backends apart until a third
case shows what they share, and that still holds for the backends. The
screen is a different case. It already exists, and its two sources answer
the same questions: which versions there are, which commits a version
holds, what one row's comparison is, and how big the whole series is.

The operation screen stays as it is, under a tab named for what it does,
comparing any commits at any operations. It is the tool for the question no
series answers, and it keeps its marks and comments.

A local review has an address shaped like a pull request's, the review's
name where the number is, with the same `from`, `to`, commit, file, and line
after it.

## The review document is on the server

An agent cannot read a browser's storage, so review state lives in the
[review store](architecture/backend/review-store.md). Settings stay in the
browser, since a phone and a desktop want different ones.

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
already reads best. The agent registers the series when it considers the
work done, and each registration is a version the reader can compare with
the last one they reviewed. The agent can also comment on its own changes to point
at what it is unsure of or what deserves a close read, which answers the
first-pass reviewer's question of where the risk is.

Whose turn it is ties the two together. A series is waiting on the reader
when the agent has registered a version since the reader last reviewed, and waiting
on the agent when open blocking comments sit on it. That is an attention set
of two, worked out from state diffy already keeps, and it is what lets a
reader run several agents at once and see which of them needs them.

## Open questions

- How an agent reaches the review document: a CLI, an HTTP API next to the
  one the frontend uses, or an MCP server.
- When a local review leaves the list: when the reader closes it, or on
  its own once its revset is empty at the current operation because the
  series landed.
- How comments written in diffy reach a GitHub pull request, and whether the
  two kinds of comment are one kind.
- Whether review should travel with the code under a ref of diffy's own, the
  way git-notes does. jj cannot see such refs today, and concurrent writers to
  a ref need a merge of their own.
