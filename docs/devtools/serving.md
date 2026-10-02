# Serving a workspace

Several jj workspaces run at once, and each serves its own app and docs, so
ports are not fixed. `just run` and `just docs` take the port as an argument,
and `just serve` picks a free pair per workspace, remembers it, and keeps both
servers alive on it.

## Starting and refreshing

`just serve` starts both detached and prints their URLs. Re-running it
restarts them on the same ports, so a URL handed to a reviewer stays valid for
the life of the review. Ports, logs and pidfiles live in
`/tmp/diffy-serve/<workspace>/`.

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
  # Something this workspace did not start would otherwise answer the
  # readiness check below and pass for ours.
  for name in app docs; do
    if (exec 3<>/dev/tcp/127.0.0.1/"${!name}") 2>/dev/null; then
      echo "port ${!name} is held by something this workspace did not start" >&2
      exit 1
    fi
  done
  just _spawn "{{serve_state}}/app" env NODE_ENV=production just run "$app"
  just _spawn "{{serve_state}}/docs" just docs "$docs"
  # Print the URLs only once both ports answer.
  for name in app docs; do
    for _ in $(seq 100); do
      if (exec 3<>/dev/tcp/127.0.0.1/"${!name}") 2>/dev/null; then continue 2; fi
      sleep 0.1
    done
    echo "$name never answered on ${!name}; see {{serve_state}}/$name.log" >&2
    exit 1
  done
  echo "app   https://$(hostname).exe.xyz:$app/"
  echo "docs  https://$(hostname).exe.xyz:$docs/"

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

## Reaching them from outside

The exe.dev proxy forwards ports 3000-9999 at `https://<vm>.exe.xyz:<port>/`,
so nothing needs sharing first. It also rewrites the `Host` header, which Bun's
dev server rejects (`Blocked: Host header does not match the dev server`), so
`serve` runs the app with `NODE_ENV=production`. A plain `just run` keeps dev
mode and hot reload, and is for local use only.

## Helpers

```just
#| id: just-serve-helpers

# Run a command detached, logging to <prefix>.log, recording <prefix>.pid.
# setsid makes it a process-group leader, so serve-stop's group kill takes
# down whatever just and bun spawned under it. Returns only once the pidfile
# exists, so serve never leaves a process it cannot stop.
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
