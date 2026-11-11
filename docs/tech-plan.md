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

Lining up two series is [its own module](architecture/backend/series.md).

### Planned improvements

These are review features other review tools have that diffy lacks.

#### Good to have

* [x] Show a summary of files changed and lines added and removed for a
  whole review, as each commit already has.
* [x] Show a side-by-side diff as well as the unified one.
* [x] Mark a single file as viewed, fold it when it is marked, and count the
  files viewed so far.
* [ ] Show images before and after, and render Markdown and SVG, instead of
  "Binary file, no textual diff."
* [x] Remember the version a reader last reviewed, and open a review on the
  changes since that version.

#### Beyond these

[Direction](direction.md) sketches where diffy goes after this list:
keeping comments on the server, and using review as the loop between a
reader and a coding agent.

## Architecture

### Web frontend

A React + Zod app that only renders; see
[architecture/frontend/index.md](architecture/frontend/index.md).

### Commit backend

Commits come from jj, which is reached through its CLI, since that is more
stable than the library. File content for highlighting comes from the local
git object store. See [jj.md](architecture/backend/jj.md) and
[git.md](architecture/backend/git.md).
