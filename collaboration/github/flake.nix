{
  description = "Hall Armory GitHub guest suite";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/f45c6f04c2f013f004bf94e284e95d72898d9393";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forSystems = nixpkgs.lib.genAttrs systems;
    in {
      packages = forSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          # The guest is Alpine (musl) and already provides Node and sh, so the
          # closure holds only what it lacks: the bundled runner and `gh`.
          # `gh` is the upstream static release pinned by sha256 (bump
          # ghVersion and both hashes together; they match GitHub's published
          # release checksums).
          ghVersion = "2.101.0";
          ghRelease = {
            x86_64-linux = { arch = "amd64"; hash = "sha256-m8otHBaCXxCZB6IzB2KKLwaY+/mWYrc6XPCwICkwcrg="; };
            aarch64-linux = { arch = "arm64"; hash = "sha256-tX6AY/GIYmR8nSJyfDLp2huWP4v522SP4SOml1aVZA8="; };
          }.${system};
          ghName = "gh_${ghVersion}_linux_${ghRelease.arch}";
          gh = pkgs.runCommand "gh-${ghVersion}" { } ''
            mkdir -p $out
            tar -xzf ${pkgs.fetchurl {
              url = "https://github.com/cli/cli/releases/download/v${ghVersion}/${ghName}.tar.gz";
              hash = ghRelease.hash;
            }} -C $out --strip-components=1 ${ghName}/bin/gh
          '';
          # esbuild bundles every dependency, so the runner is one JS file with
          # no runtime references.
          runner = pkgs.buildNpmPackage {
            pname = "hall-armory-github-runner";
            version = "0.1.0";
            # Copy the suite into its own content-addressed store path. A bare
            # `./.` is a subpath of the whole flake source, which for a `?dir=`
            # flake is the entire repository at one revision, so the derivation
            # (and the cache key) would change with every unrelated commit and
            # differ between `path:` and `github:` locators.
            src = pkgs.lib.cleanSource ./.;
            npmDeps = pkgs.fetchNpmDeps {
              src = pkgs.lib.cleanSource ./guest-suite-build;
              hash = "sha256-P1JSOTAE7wLU/MfqzJm07c7QeAqte1AHudR+CKOk6jY=";
            };
            postPatch = ''
              cp guest-suite-build/package.json guest-suite-build/package-lock.json .
            '';
            dontNpmBuild = true;
            buildPhase = ''
              ${pkgs.esbuild}/bin/esbuild guest-suite-build/runner.ts --bundle --platform=node --target=node22 --format=esm --outfile=runner.mjs
            '';
            installPhase = ''
              mkdir -p $out/lib
              cp runner.mjs $out/lib/runner.mjs
            '';
          };
          guest = pkgs.runCommand "hall-armory-github-guest-0.1.0" { } ''
            mkdir -p $out/lib $out/bin
            cp ${runner}/lib/runner.mjs $out/lib/runner.mjs
            cat > $out/bin/armory-suite <<'EOS'
            #!/bin/sh
            export PATH=${gh}/bin:$PATH
            exec node "$(dirname "$0")/../lib/runner.mjs" "$@"
            EOS
            chmod +x $out/bin/armory-suite
          '';
        in { default = guest; guest = guest; gh = gh; });
      apps = forSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.guest}/bin/armory-suite";
        };
        guest = self.apps.${system}.default;
        gh = {
          type = "app";
          program = "${self.packages.${system}.gh}/bin/gh";
        };
      });
    };
}
