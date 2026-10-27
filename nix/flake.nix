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

      # ~/~ begin <<docs/devtools/nix.md#nix-diffy-package>>[init]
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
            # The lock's hash in the name gives each lock its own store path. A
            # fixed-output path is found by hash alone, so without it a stale
            # node_modules already in the store would pass for the new one.
            name = "diffy-node-modules-${builtins.hashFile "sha256" ../bun.lock}";
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
            outputHash = "sha256-cNvhgNSzQ0pDfKKTDpF3z21Y2unkRo7SXo61HKcQ6Go=";
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
            # playwright-core finds its own files through __dirname, which a bundle
            # breaks, so it stays on disk beside the binary.
            bun build --compile --minify --external playwright-core src/cli.ts --outfile diffy
          '';
          installPhase = ''
            install -Dm755 diffy $out/libexec/diffy
            mkdir -p $out/lib/node_modules
            cp -r node_modules/playwright-core $out/lib/node_modules
            makeBinaryWrapper $out/libexec/diffy $out/bin/diffy \
              --set NODE_ENV production \
              --set NODE_PATH $out/lib/node_modules \
              --prefix PATH : ${pkgs.lib.makeBinPath (tools pkgs)}
          '';
          meta.mainProgram = "diffy";
        };
      # ~/~ end
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
# ~/~ end
