{
  description = "Hall Armory npm guest suite";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/f45c6f04c2f013f004bf94e284e95d72898d9393";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forSystems = nixpkgs.lib.genAttrs systems;
    in {
      packages = forSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          # The guest is Alpine (musl) and already provides Node and sh, so the closure holds only the bundled
          # runner. esbuild bundles every dependency, so the runner is one JS file with no runtime references.
          runner = pkgs.buildNpmPackage {
            pname = "hall-armory-npm-runner";
            version = "0.1.0";
            # Copy the suite into its own content-addressed store path (see the GitHub suite's flake).
            src = pkgs.lib.cleanSource ./.;
            npmDeps = pkgs.fetchNpmDeps {
              src = pkgs.lib.cleanSource ./guest-suite-build;
              hash = "sha256-545XQZoD1wZygUAthiYIUeZ8QzJNl+FI96c49bJsGQY=";
            };
            postPatch = ''
              cp guest-suite-build/package.json guest-suite-build/package-lock.json .
            '';
            dontNpmBuild = true;
            buildPhase = ''
              ${pkgs.esbuild}/bin/esbuild guest-suite-build/runner.ts --bundle --platform=node --target=node22 --format=esm --outfile=runner.mjs \
                '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'
            '';
            installPhase = ''
              mkdir -p $out/lib
              cp runner.mjs $out/lib/runner.mjs
            '';
          };
          guest = pkgs.runCommand "hall-armory-npm-guest-0.1.0" { } ''
            mkdir -p $out/lib $out/bin
            cp ${runner}/lib/runner.mjs $out/lib/runner.mjs
            cat > $out/bin/armory-suite <<'EOS'
            #!/bin/sh
            exec node "$(dirname "$0")/../lib/runner.mjs" "$@"
            EOS
            chmod +x $out/bin/armory-suite
          '';
        in { default = guest; guest = guest; });
      apps = forSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.guest}/bin/armory-suite";
        };
        guest = self.apps.${system}.default;
      });
    };
}
