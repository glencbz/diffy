# ~/~ begin <<docs/devtools/nix.md#nix-flake>>[init]
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
# ~/~ end
