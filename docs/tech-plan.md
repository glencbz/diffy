# Techy planning things

## Features

### v0 - Plain GUI for diffing

* Show a list of commits
* Pick a commit and show its diff

### v1 - Interdiff

...i.e. the change in commit over time

* Show a before and after list of commits
* Pick a commit on the before side and interdiff it with the after side.

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
