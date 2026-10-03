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

These are review features GitHub and GitLab both have that diffy lacks.

#### Good to have

* [x] Show a summary of files changed and lines added and removed for a
  whole pull request, as each commit already has.
* [x] Show a side-by-side diff as well as the unified one.
* [x] Mark a single file as viewed, fold it when it is marked, and count the
  files viewed so far.
* [ ] Show images before and after, and render Markdown and SVG, instead of
  "Binary file, no textual diff."
* [x] Remember the head a reader last reviewed, and open a pull request on
  the changes since that head.

#### Publishing to GitHub

A future extension, because GitHub is a metadata oracle today and nothing
written in diffy leaves the browser.

* [ ] Post comments to the pull request, and show the comments already on
  it.
* [ ] Keep comments and viewed marks on the pull request screen, as the local
  history screen does.

#### Beyond these

[Direction](direction.md) sketches where diffy goes after this list:
giving local review everything pull request review has, keeping comments on
the server, and using review as the loop between a reader and a coding
agent.

## Architecture

### Web frontend

A React + Zod app that only renders; see
[architecture/frontend/index.md](architecture/frontend/index.md).

### Commit backends

Commits come from jj or from a GitHub pull request, with no shared interface
between them. Two implementations are not enough to know what the abstraction
should be, so they stay apart until a third case says what they share.

jj is reached through its CLI, which is more stable than the library. GitHub
only supplies metadata (which heads a pull request has had); commit content
comes from the local git object store. See
[github.md](architecture/backend/github.md) and
[git.md](architecture/backend/git.md).
