---
name: submit-for-review
description: >
  Use when a change in this repo is ready for review: "submit this for review",
  "put this up", "ready for review", "open a PR for this", or as the last step
  of finishing a piece of work. Pushes the change, opens a pull request if
  there is not one already, serves this workspace's app and docs on ports of
  their own, and reports the URLs and the commands that expose them.
---

# Submitting work for review

Review here is a pull request to read plus two running servers to click
through: the app, and the docs site the app was generated from.

Run every command below from the workspace the change lives in. Several
changes are usually up for review at once, one per jj workspace, each with its
own ports.

## 1. Make the change reviewable

`docs/**` is the source of truth, so a code change starts there and reaches
`src/` or `justfile` through `just en-sync`. See the `entangled` skill.

```sh
just test && just typecheck && just lint
```

Shape and describe the commits with the `commit-shape` skill. A reviewer reads
the messages first.

## 2. Rebase onto main, then push

Never push a branch built on a stale main. Fetch and restack the whole series
first, every time, including follow-up rounds.

```sh
jj --config git.abandon-unreachable-commits=false git fetch --remote origin
jj rebase -s <root-change> -o 'trunk()'
jj log -r 'conflicts()'
```

A jj rebase does not stop on a conflict, it records one, so that last command
is how you find out. Resolve it in the conflicted change rather than at the tip
of the stack, as in the `jj-commit-stack` skill.

If the rebase moved anything, run step 1 again. Those checks measured the old
base and no longer say anything about what you are about to push.

Then bookmark the tip and push. A Git bookmark goes on the change only at this
boundary.

```sh
jj bookmark set <bookmark> -r <change>   # move it if the change was rewritten
jj git push --bookmark <bookmark>
```

To update a change that already has a PR: amend it, move the bookmark, push.
Never stack a "review fixes" commit on top and never open a second PR.

## 3. Serve this workspace

```sh
just serve
```

It starts the app and the docs site detached on this workspace's own ports,
prints both URLs, and prints the `ssh exe.dev share port` command that exposes
each one. Re-run it to refresh both against the current code; the ports do not
move, so URLs already in the PR stay correct. Do that at the end of every
follow-up round too. See `docs/devtools/serving.md`.

Never start a server for review by hand. `just serve` runs the app in
production mode, and `just run` on its own leaves Bun in dev mode, which
answers every request arriving through the exe.dev proxy with `Blocked: Host
header does not match the dev server` and nothing else. A shared URL saying
that was started the wrong way: stop it and run `just serve`.

## 4. Open the pull request, or update the one that exists

`gh pr create` is not proxied from this VM. Only `/repos/OWNER/REPO/...` is, so
use `gh api`.

```sh
export GH_HOST=github.int.exe.xyz
gh api "/repos/glencbz/diffy/pulls?state=open&head=glencbz:<bookmark>" \
  --jq '.[0].number'
```

Empty output means there is no PR yet. Create one, with a body that carries the
URLs from step 3:

```sh
gh api --method POST /repos/glencbz/diffy/pulls \
  -f title="<commit subject>" -f head=<bookmark> -f base=main -F body=@body.md
```

A number means the push has already updated that PR. Leave it alone unless its
preview section is stale, in which case rewrite the body:

```sh
gh api --method PATCH /repos/glencbz/diffy/pulls/<number> -F body=@body.md
```

End the body with the two URLs and the two commands exactly as `just serve`
printed them, under a `## Preview` heading, saying they work once the reviewer
runs the commands from their own machine. Take the host and ports from that
output rather than from here; the VM is ephemeral and the ports depend on what
else is already serving.

PRs are authored by `exe-dev-github-integration[bot]`, not by the person asking.

## 5. Hand it over

Report the PR URL, both preview URLs, and both `ssh exe.dev share port`
commands in the reply, not only in the PR body. Those commands need the
reviewer's own exe.dev key, so nothing in the VM can run them.
