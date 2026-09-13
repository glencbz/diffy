# Serving a workspace

Review happens in the browser, against a running copy: the app to click through
the change, and the docs site because the docs *are* the source. Work happens in
jj workspaces, several of them at once, so "a running copy" has to mean one per
workspace rather than one per machine. That rules out fixed ports. `just run`
and `just docs` take the port as an argument, and `just serve` hands each
workspace a pair of free ones, remembers them, and keeps both servers alive
under them.

## Starting and refreshing

`just serve` starts the app and the docs site detached, so they outlive the
shell that launched them, and prints where they landed. Run it again to refresh:
it stops what it started before and relaunches against the code that is in the
workspace now. The ports survive the refresh, so a URL already handed to a
reviewer keeps pointing at the same workspace for the life of the review.

Ports are picked once, on the first `just serve` in a workspace, by walking up
from 3000 for the app and 8000 for the docs until a port nobody is listening on
turns up. They live in `/tmp/diffy-serve/<workspace>/ports` alongside the logs
and pidfiles for the two processes.

```just
#| id: just-serve

serve_state := "/tmp/diffy-serve/" + file_stem(justfile_directory())

# Serve this workspace's app and docs detached; re-run to refresh them
serve:
  #!/usr/bin/env bash
  set -euo pipefail
  mkdir -p "{{serve_state}}"
  if [ ! -f "{{serve_state}}/ports" ]; then
    printf 'app=%s\ndocs=%s\n' "$(just _free-port 3000)" "$(just _free-port 8000)" \
      > "{{serve_state}}/ports"
  fi
  source "{{serve_state}}/ports"
  just serve-stop
  for name in app docs; do
    if (exec 3<>/dev/tcp/127.0.0.1/"${!name}") 2>/dev/null; then
      echo "port ${!name} is held by something this workspace did not start" >&2
      exit 1
    fi
  done
  just _spawn "{{serve_state}}/app" env NODE_ENV=production just run "$app"
  just _spawn "{{serve_state}}/docs" just docs "$docs"
  for name in app docs; do
    for _ in $(seq 100); do
      if (exec 3<>/dev/tcp/127.0.0.1/"${!name}") 2>/dev/null; then continue 2; fi
      sleep 0.1
    done
    echo "$name never answered on ${!name}; see {{serve_state}}/$name.log" >&2
    exit 1
  done
  echo "app   http://$(hostname):$app   ssh exe.dev share port $(hostname) $app"
  echo "docs  http://$(hostname):$docs  ssh exe.dev share port $(hostname) $docs"

# Stop this workspace's detached app and docs
serve-stop:
  #!/usr/bin/env bash
  set -euo pipefail
  for pidfile in "{{serve_state}}"/*.pid; do
    [ -e "$pidfile" ] || continue
    pid="$(cat "$pidfile")"
    kill -- "-$pid" 2>/dev/null || true
    while kill -0 "$pid" 2>/dev/null; do sleep 0.1; done
    rm -f "$pidfile"
  done
```

Stopping waits for each process to actually go away before `serve` binds the
port again, and skips pidfiles that are not there, so `just serve` behaves the
same whether or not anything was running. Starting waits too: `serve` prints the
URLs only once both ports answer, and otherwise fails pointing at the log, so a
green run means the servers are really up rather than merely spawned.

The two checks bracket the spawn for a reason. A port this workspace was given
can still be taken by something it did not start, a server left behind by an
older way of doing this or another tool entirely, and then waiting for an answer
would find that stranger's server and call it ours. So `serve` refuses to start
on a port that is still answering after its own processes are gone, rather than
quietly handing a reviewer a URL to someone else's work.

## Reaching them from outside

The VM's ports are only reachable through the exe.dev HTTPS proxy, and only
after someone with the exe.dev SSH key runs `ssh exe.dev share port <vm> <port>`
from their own machine. Nothing inside the VM can do that, which is why `just
serve` prints the two commands to hand over rather than trying. Once shared, the
URL is `https://<vm>.exe.xyz:<port>/`.

The proxy rewrites the `Host` header on the way through, which Bun's dev server
reads as an attack: it answers `Blocked: Host header does not match the dev
server` and nothing else. So `serve` starts the app with `NODE_ENV=production`,
which drops that check along with hot reload. A plain `just run` keeps dev mode
and its reload, which is the right trade locally and the wrong one for anything
a reviewer opens, so a server to be shared is started by `just serve` and not by
hand.

## Detaching and port picking

A served process runs in a session of its own via `setsid`, writes its own pid
where `serve-stop` can find it, and sends everything to a log next to the
pidfile. Because it leads its own process group, stopping it takes the group
down with it, including whatever `just` and `bun` spawned underneath.

```just
#| id: just-serve-helpers

# Run a command detached, logging to <prefix>.log, recording <prefix>.pid
_spawn prefix +command:
  #!/usr/bin/env bash
  set -euo pipefail
  rm -f "{{prefix}}.pid"
  setsid bash -c 'echo $$ > "$0.pid"; exec "$@"' "{{prefix}}" {{command}} \
    > "{{prefix}}.log" 2>&1 < /dev/null &
  for _ in $(seq 40); do
    if [ -s "{{prefix}}.pid" ]; then break; fi
    sleep 0.05
  done

# Print the first port at or above the given one that nothing is listening on
_free-port start:
  #!/usr/bin/env bash
  port={{start}}
  while (exec 3<>/dev/tcp/127.0.0.1/$port) 2>/dev/null; do
    port=$((port + 1))
  done
  echo "$port"
```

`_spawn` clears the old pidfile and returns only once the new one is written,
so `serve` cannot race ahead and leave a process it has no way to stop later.
