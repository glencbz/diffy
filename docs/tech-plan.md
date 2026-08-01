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

* Bun backend, because it seems pretty nice to use.
* jj for diffing. Invoked via CLI because that's more stable that the library.
