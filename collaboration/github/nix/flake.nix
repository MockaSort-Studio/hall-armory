{
  description = "Hall Armory GitHub CLI closure";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/f45c6f04c2f013f004bf94e284e95d72898d9393";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forSystems = nixpkgs.lib.genAttrs systems;
    in {
      packages = forSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in { default = pkgs.gh; gh = pkgs.gh; });
      apps = forSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.gh}/bin/gh";
        };
        gh = self.apps.${system}.default;
      });
    };
}
