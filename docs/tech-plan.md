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

The backend uses Bun, which is really convenient to set up and reduces the
complexity hell that is most Node projects.

### Commit backend

Commits come from a commit backend. There are two, jj and a GitHub pull
request, and no shared interface between them. Two implementations is not
enough to know what the abstraction should be, and one guessed from either
would only describe that one again. They stay apart until a third case, or a
real need to swap them, says what they have in common.

A backend has to answer three questions:

* Get a list of commits with topological sorting.
* Get the diff of single commit.
* Get the parent of the commit.

jj answers all three through one CLI. The GitHub backend takes two modules to
do it, one for which commits a pull request has had and one for what they
contain.

#### jj backend

jj is reached through its CLI, which is more stable than the library.

#### GitHub backend

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
