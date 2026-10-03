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
