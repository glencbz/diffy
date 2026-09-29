# Nix

Diffy shells out to other programs: `jj` and `git` for commits, and
[difftastic](https://difftastic.wilfred.me.uk/) for [structural
diffs](../architecture/backend/difft.md). A version drift in any of them
changes what the app shows, and difftastic's JSON output is explicitly
unstable, so the versions are pinned by a Nix flake rather than left to
whatever the machine has installed.

The flake splits the tools in two. The runtime set is what the server needs
on `PATH` to run from source. The development set is what working on diffy
takes on top of that: `just` to run the recipes, and `uv` for Entangled and
the docs site. Each set is offered both as a shell and as a package. A machine
that only uses diffy installs neither; it installs [the `diffy`
command](#installing-diffy).

The flake lives in `nix/`, not at the root. A flake at the root of a git
repository is read from git, and a jj workspace under `.claude/worktrees/` has
no `.git` of its own, so Nix walks up to the main checkout and reads that
instead. Naming the flake by path avoids git altogether, and a path flake
copies its whole directory into the store on every evaluation. At the root
that directory would include `node_modules` and `.venv`, hundreds of
megabytes. In `nix/` it is just the flake and its lock.

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

The recipes that run diffy's own code, the server and the tests, enter the
runtime shell themselves. That way a server started by `just serve` finds
difftastic whether or not the shell that started it is a Nix one. The
experimental features are named on the command line because they are off by
default and enabling them is a change to the machine, not to this repository.

```just
#| id: just-nix
# Run a command with diffy's runtime dependencies on PATH
nix_runtime := "nix --extra-experimental-features 'nix-command flakes' develop path:" + justfile_directory() / "nix#runtime -c"
```

## Installing diffy

The flake's default package is `diffy`, the server as one executable. Run it
from inside a jj repository and it serves that repository on `$PORT`, or 3000,
in production mode, with its own pinned `jj`, `git`, and difftastic. Install it from a checkout of `main`:

```sh
nix --extra-experimental-features 'nix-command flakes' \
  profile install "git+file:$PWD?dir=nix"
```

or straight from GitHub, with `github:glencbz/diffy?dir=nix` in place of the
`git+file` URL.

This is the one place the flake reads the rest of the repository, and it is
why the URL goes through git rather than `path:nix`. A `path:nix` flake is
only the `nix/` directory, so the source it would build is out of reach. A git
URL with `?dir=nix` copies the whole tracked tree, which leaves out
`node_modules` and `.venv` because git never tracked them. The shells stay on
`path:nix`; evaluating them never touches the package, so they still work from
a jj workspace.

The package is `src/server.ts` compiled by `bun build --compile` into one
executable. The frontend is bundled into it at build time, so starting diffy
does no bundling and the installed closure holds no Bun and no
`node_modules`. Running the source through a wrapped `bun run` would avoid
compiling, but every launch would bundle the frontend again and the closure
would carry Bun and every dependency's sources. The wrapper around the
executable sets `NODE_ENV=production` and puts the pinned tools first on
`PATH`.

Nix builds without network access, so the dependencies are installed by a
fixed-output derivation, the one kind allowed to fetch because its result is
checked against a hash. The hash covers `node_modules` as `bun install`
lays it out from `bun.lock`. Any change to `bun.lock` changes it: the build
then fails and prints the hash it got, which goes into `outputHash`. Only the
runtime dependencies are installed; the development ones are type
definitions and tools the compiled executable never loads.

```nix
#| id: nix-diffy-package
# The diffy server: src/server.ts compiled with its frontend inside it.
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
      bun build --compile --minify src/server.ts --outfile diffy
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
