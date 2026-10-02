# Nix

Diffy shells out to other programs: `jj` and `git` for commits, and
[difftastic](https://difftastic.wilfred.me.uk/) for [structural
diffs](../architecture/backend/difft.md). A version drift in any of them
changes what the app shows, and difftastic's JSON output is explicitly
unstable, so the versions are pinned by a Nix flake rather than left to
whatever the machine has installed.

The runtime set is what the server needs to run from source; the development
set adds `just` and `uv`. Users install neither, only [the `diffy`
command](#installing-diffy).

The flake lives in `nix/`, not at the root. A root flake is read from git,
and a jj workspace under `.claude/worktrees/` has no `.git`, so Nix would read
the main checkout instead. A `path:` flake avoids git but copies its whole
directory into the store on every evaluation, which at the root means
`node_modules` and `.venv`.

```nix
#| id: nix-flake
#| file: nix/flake.nix
{
  description = "Diffy, a code-review tool for jj and GitHub pull requests";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      eachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # What the server shells out to.
      tools = pkgs: [
        pkgs.difftastic
        pkgs.git
        pkgs.jujutsu
      ];

      # What running the server from source takes.
      runtime = pkgs: [ pkgs.bun ] ++ tools pkgs;

      # What working on diffy takes on top of running it.
      development = pkgs: [
        pkgs.just
        pkgs.uv
      ];

      <<nix-diffy-package>>
    in
    {
      packages = eachSystem (pkgs: {
        default = diffy pkgs;
        runtime = pkgs.buildEnv {
          name = "diffy-runtime";
          paths = runtime pkgs;
        };
        development = pkgs.buildEnv {
          name = "diffy-development";
          paths = runtime pkgs ++ development pkgs;
        };
      });

      devShells = eachSystem (pkgs: {
        runtime = pkgs.mkShell { packages = runtime pkgs; };
        default = pkgs.mkShell { packages = runtime pkgs ++ development pkgs; };
      });
    };
}
```

To work on diffy, enter the development shell:

```sh
nix --extra-experimental-features 'nix-command flakes' develop path:nix
```

The server and test recipes enter the runtime shell themselves, so a server
started from a non-Nix shell still finds difftastic.

```just
#| id: just-nix
# Run a command with diffy's runtime dependencies on PATH
nix_runtime := "nix --extra-experimental-features 'nix-command flakes' develop path:" + justfile_directory() / "nix#runtime -c"
```

## Installing diffy

The flake's default package is the `diffy` command. Run it from inside a jj
repository and it serves that repository, in production mode, with its own
pinned `jj`, `git`, and difftastic. Install it from a checkout of `main`:

```sh
nix --extra-experimental-features 'nix-command flakes' \
  profile install "git+file:$PWD?dir=nix"
```

or straight from GitHub, with `github:glencbz/diffy?dir=nix` in place of the
`git+file` URL.

The package needs the whole source tree, which `path:nix` cannot see, so it
installs through git; `?dir=nix` copies only tracked files. The shells stay on
`path:nix` so they work from a jj workspace.

The command is `src/cli.ts` compiled by `bun build --compile` with the
frontend bundled in. A wrapped `bun run` would skip compiling, but would
re-bundle the frontend on every launch and carry Bun and every dependency's
sources in the closure.

```nix
#| id: nix-diffy-package
# The diffy command: src/cli.ts compiled with its frontend inside it.
diffy =
  pkgs:
  let
    src = pkgs.lib.fileset.toSource {
      root = ../.;
      fileset = pkgs.lib.fileset.unions [
        ../src
        ../package.json
        ../bun.lock
        ../tsconfig.json
      ];
    };

    nodeModules = pkgs.stdenvNoCC.mkDerivation {
      pname = "diffy-node-modules";
      version = "0";
      inherit src;
      nativeBuildInputs = [ pkgs.bun ];
      dontConfigure = true;
      buildPhase = ''
        export HOME=$TMPDIR BUN_INSTALL_CACHE_DIR=$TMPDIR/bun-cache
        bun install --frozen-lockfile --production --ignore-scripts --no-progress
      '';
      installPhase = "cp -r node_modules $out";
      dontFixup = true;
      outputHashMode = "recursive";
      outputHashAlgo = "sha256";
      # Fixed-output, so it may fetch. A bun.lock change fails the build with
      # the new hash, which goes here.
      outputHash = "sha256-DhZ6xo336k5VWKj4IUf/hDi5TsfAntVISnK+UDZG6kM=";
    };
  in
  pkgs.stdenvNoCC.mkDerivation {
    pname = "diffy";
    version = "0";
    inherit src;
    nativeBuildInputs = [
      pkgs.bun
      pkgs.makeBinaryWrapper
    ];
    dontConfigure = true;
    # A copy, not a symlink: Bun resolves a package's imports from its real
    # path, and a store path has no node_modules above it.
    buildPhase = ''
      cp -r ${nodeModules} node_modules
      bun build --compile --minify src/cli.ts --outfile diffy
    '';
    installPhase = ''
      install -Dm755 diffy $out/libexec/diffy
      makeBinaryWrapper $out/libexec/diffy $out/bin/diffy \
        --set NODE_ENV production \
        --prefix PATH : ${pkgs.lib.makeBinPath (tools pkgs)}
    '';
    meta.mainProgram = "diffy";
  };
```
