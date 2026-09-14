# Techy planning things

## Features

### v0 - Plain GUI for diffing

* Show a list of commits
* Pick a commit and show its diff

### v1 - Interdiff

...i.e. the change in commit over time

* Show a before and after list of commits
* Pick a commit on the before side and interdiff it with the after side.
* Pick whole series on both sides and interdiff them commit by commit.

The two sides pick their commits independently, each at whatever repo
operation it is looking at, so a commit can be compared against its own
earlier self. Lining up two series is its own problem and has its own module,
[architecture/backend/series.md](architecture/backend/series.md).

## Architecture

### Web frontend

We first tried htmx, but the v0 UI (a commit picker whose selection drives a
diff panel) has enough client-side state that we switched to React. The
frontend is now a small React + Zod app, described in
[architecture/frontend.md](architecture/frontend.md). The backend still runs jj
and parses the diffs; the frontend only renders.

### Web backend

The backend will use Bun, which is really convenient to set up and reduces the
complexity hell that is most Node projects.

### Commit backend

To get the source of commits, we'll introduce an abstraction over a source of
commits: the Commit backend. The first commit backend we want is jj, but
subsequently we'll also grab commits from different PR versions on GitHub.

A commit backend must support the following operations:

* Get a list of commits with topological sorting.
* Get the diff of single commit.
* Get the parent of the commit.

#### jj backend

We'll use jj via CLI because that's more stable than the library.

#### GitHub backend

The second source of commits is a GitHub pull request, and it is deliberately
a separate backend rather than a second implementation of the jj one. Two
implementations is not enough to know what the shared interface should be, and
an interface guessed from one of them would only describe jj again. They stay
apart until a third case, or a real need to swap them, says what they have in
common.

A pull request's history axis is its chain of force pushes. Every force push
records the head before it and the head after it, so the heads a branch has
had, oldest first, are recoverable, and that ordered list plays the part the
operation log plays for jj: it is the list of versions a reviewer can compare.
The head the pull request was opened with only exists in the GraphQL timeline,
so that is the API we use.

GitHub is a metadata oracle and nothing more. It answers which pull requests
exist and which object ids their heads have been, and no type crossing that
boundary carries a commit message, an author or a patch. Content comes from
the local git object store, which fetches a force-pushed commit by id, pins it
under a ref of our own so garbage collection cannot take it, and reads it back
with `git log`. See [architecture/backend/github.md](architecture/backend/github.md)
and [architecture/backend/git.md](architecture/backend/git.md).
