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
            npmDepsHash = "sha256-jfNNLlx29dUPBzfUK3/am1+ybQfpN9AJzmfxmLRyLpE=";
            npmFlags = [ "--legacy-peer-deps" ];
            dontNpmBuild = true;
            buildPhase = ''
              ${pkgs.esbuild}/bin/esbuild guest-runner.ts --bundle --platform=node --format=esm --outfile=runner.mjs
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
