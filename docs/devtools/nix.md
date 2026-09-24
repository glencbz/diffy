# Nix

Diffy shells out to other programs: `jj` and `git` for commits, and
[difftastic](https://difftastic.wilfred.me.uk/) for [structural
diffs](../architecture/backend/difft.md). A version drift in any of them
changes what the app shows, and difftastic's JSON output is explicitly
unstable, so the versions are pinned by a Nix flake rather than left to
whatever the machine has installed.

The flake splits the tools in two. The runtime set is what the server needs
on `PATH` to run. The development set is what working on diffy takes on top
of that: `just` to run the recipes, and `uv` for Entangled and the docs site.
Each set is offered both as a shell and as a package, so a machine that only
serves diffy can install the runtime set with
`nix profile install path:nix#runtime` and nothing more.

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

      # What the server shells out to, or runs on.
      runtime = pkgs: [
        pkgs.bun
        pkgs.difftastic
        pkgs.git
        pkgs.jujutsu
      ];

      # What working on diffy takes on top of running it.
      development = pkgs: [
        pkgs.just
        pkgs.uv
      ];
    in
    {
      packages = eachSystem (pkgs: {
        runtime = pkgs.buildEnv {
          name = "diffy-runtime";
          paths = runtime pkgs;
        };
        default = pkgs.buildEnv {
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
