# Direction

Where diffy is going after the review features in the
[tech plan](tech-plan.md), and why. The first two stages are designed below.
The third is still a sketch, and gets a design of its own before any code
is written for it.

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

diffy today serves the returning reviewer and the self-reviewer, but each
screen holds half of the loop. The local history screen keeps comments,
marks, and viewed files, and has no memory of where the reader last stopped.
The pull request screen opens on what changed since the head last reviewed,
and keeps no comments or marks. Nothing a reader writes leaves the browser.

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

### A row's identity follows the pairing

Marks, comments, and viewed files are filed under a row's review key, and the
key has to survive a rewrite for any of them to carry over. A local commit
has a jj change id and keeps using `change:<id>`. A pull request commit has
only the subject-line guess the pairing starts from, and a key built from
that guess would disagree with the pairing as soon as the reader corrected
it.

So on the pull request screen a row takes the key of the commit its pairing
puts on the before side, and a row with nothing before it, or a before
commit that was never reviewed, takes `rev:<commit id>` of its after side.
The review document records which key each reviewed commit was given, so
the next version can inherit it. A reader who pairs a commit by hand moves
its marks and comments with it.

### The pairing is kept

A correction to the pairing is kept under the series and the two heads it
pairs, and read back when the reader opens the same two heads again. A
correction made against other heads describes commits that are not on
screen, so it is not applied anywhere else.

## The review document moves to the server

Comments, marks, and viewed files live in the browser's `localStorage`, which
[review](architecture/frontend/review.md#storage) chose because a
synchronous read needs no loading state and a synchronous write needs no
optimistic update. An agent cannot read a browser's storage, and neither can
a second browser, so the review document moves to the server, and the loading
and failure states that choice avoided come back.

### A SQLite file per repository, outside it

The review document is a SQLite file in diffy's data directory,
`$XDG_DATA_HOME/diffy/`, one per repository, read and written by the server
with `bun:sqlite`.

It stays out of the repository's own directories for the reason it left
`.jj/`: those directories belong to jj and git. A file in the working copy
would be snapshotted into whatever change is checked out. The repository's
history, under a ref of diffy's own the way git-notes works, would let
review travel with the code, and it loses for now on two counts. jj cannot
see refs outside the ones it manages, and concurrent writers to a ref need a
merge of their own. Sharing review between people is what
[publishing to GitHub](tech-plan.md#publishing-to-github) is for.

A repository is named by the real path of its `.jj/repo` directory, which
every workspace of one repository points at. Review state is then shared by
all of a repository's workspaces, and one review screen per workspace reads
the same marks.

Pull request review lives in the same file as the local repository's,
since the pull request screen reads the GitHub repository the local one
pushes to.

Settings stay in the browser. Text size and diff layout belong to a screen,
and a phone and a desktop reading the same repository want different ones.

### Commands, not documents

The browser does not send the document back. It sends one command per
change a reader makes, and the server applies it. Two writers, a browser and
an agent or two tabs, then cannot overwrite each other the way two copies of
a whole document would.

Each command says what the state should become rather than which way to
flip it: mark this comparison seen or unseen, mark this file viewed or not,
add this comment under an id the caller chose, resolve it, delete it. A
command sent twice leaves the same state as a command sent once, so a
client can retry after a failure without asking whether the first attempt
landed. The model's `flipSeen` and `flipViewed` become setters for the same
reason.

The model stays one set of pure functions the server and the browser both
import. The server applies a command with them and stores the result. The
browser applies the same command to what it holds so the screen changes at
once, and replaces it with the server's answer when that arrives, or puts
the old state back and says so when the write fails.

### Loading and failure

The review document loads once per screen, beside the comparison. Until it
arrives the diff draws without review state, since the diff is what the
reader came for and is usable without it. When the review document cannot
be read, the diff draws the same way under a strip saying review state is
unavailable, with nothing on the screen offering to write it.

### Other writers

The server tells every open screen when the review document changes, over a
WebSocket, which `Bun.serve` supports without a dependency, and each screen
reads the document again. A comment an agent writes reaches the reader's
open screen without a reload.

### Authorship

Every comment records who wrote it from the start. Once anything other than
the browser can write, a comment without an author cannot be told apart, and
adding the field to a table later would leave every earlier comment
unattributed. A comment written in the browser is the reader's. Replies and
dispositions wait for the agent loop, which is the first thing that needs
them.

### Moving what the browser holds

Whenever a screen finds the browser's `diffy.session.v1` and
`diffy.last-reviewed.v1:` keys holding anything, it sends them to the server
as one import, which adds what the server lacks and keeps what it has, and
clears them once the server has them. Nobody loses the review state already
written, including a second browser's.

## Order of work

Stage one adds state that has to be kept: registered local reviews and the
versions marked reviewed on them, marks and comments on pull request rows,
and pairing corrections.
Writing each of those to `localStorage` and then moving it would build every
one of them twice, so the store moves first.

1. The review document on the server, the command API, the import, and
   `useReview` reading through it.
2. Change notifications over the WebSocket.
3. Marks, comments, and viewed files on the pull request stack, with review
   keys that follow the pairing.
4. Pairing corrections kept.
5. Registering a local review, the list of registered reviews, and the
   series review generalised over a source, with versions marked reviewed
   and a local review's address.

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
