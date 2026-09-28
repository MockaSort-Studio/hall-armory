# @mockasort-studio/pi-github-tools

A standalone Pi extension package that registers GitHub repository, issue, pull
request, discussion, project, and label tools backed by the GitHub CLI (`gh`).

## Install

```sh
npm install @mockasort-studio/pi-github-tools
pi -e @mockasort-studio/pi-github-tools
```

The host must provide an authenticated `gh` executable. This package does not
install, authenticate, or configure GitHub CLI credentials.

## Scope

This package is Crew-agnostic: it has no Crew profile, runtime, sandbox, or
catalog dependency. It only registers its declared GitHub tools. An external
Armory catalog may select the package and prepare `gh` for a sandbox, but that
preparation is deliberately outside this package.

Calling the extension factory more than once for the same Pi instance is safe;
the tool suite is registered once. Tool operations execute through `gh` and
return structured JSON-compatible results.

## Verification

`test-install.sh` creates an npm tarball, installs it into a clean temporary
project, and asks Pi to load the installed package while checking registered
tools.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
