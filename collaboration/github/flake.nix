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
          guest = pkgs.buildNpmPackage {
            pname = "hall-armory-github-guest";
            version = "0.1.0";
            src = ./.;
            npmDeps = pkgs.fetchNpmDeps {
              src = ./guest-suite-build;
              hash = "sha256-P1JSOTAE7wLU/MfqzJm07c7QeAqte1AHudR+CKOk6jY=";
            };
            postPatch = ''
              cp guest-suite-build/package.json guest-suite-build/package-lock.json .
            '';
            dontNpmBuild = true;
            buildPhase = ''
              ${pkgs.esbuild}/bin/esbuild guest-suite-build/runner.ts --bundle --platform=node --format=esm --outfile=runner.mjs
            '';
            installPhase = ''
              mkdir -p $out/lib $out/bin
              cp runner.mjs $out/lib/runner.mjs
              cat > $out/bin/armory-suite <<'EOF'
              #!${pkgs.runtimeShell}
              export PATH=${pkgs.gh}/bin:$PATH
              exec ${pkgs.nodejs}/bin/node "$(dirname "$0")/../lib/runner.mjs" "$@"
              EOF
              chmod +x $out/bin/armory-suite
            '';
          };
        in { default = guest; guest = guest; gh = pkgs.gh; });
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
