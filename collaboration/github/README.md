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

## Workflow failure evidence

`github_workflow_run_failed_log` without extra options returns the bounded
failed-step log tail, as before. Its optional evidence inputs read selected,
bounded evidence from one run instead; every result carries a distinct `state`
(`ok`, `running`, `unavailable`, `expired`, `missing`, `oversized`,
`malformed`):

- `jobId`, `step`, `firstFailure`, `startLine`, `maxLines`, `maxChars`: one job
  log (default: the first failed job and its first failed step), paged by line
  from 30 lines before its first `##[error]`, with `truncated` and a
  `continuation.startLine` for the next page.
- `artifactId` or `artifactName`, optionally `artifactPath`: the file list of a
  completed run's artifact, or one UTF-8 text file in it, paged the same way.

Jobs and artifacts are bound to the requested repository and run through the
API before anything is fetched; downloads use URLs built from those ids, never
URLs from metadata. Archives (at most 8 MiB, 1,000 entries) are read in memory
with [yauzl](https://github.com/thejoshwolfe/yauzl): links, special files,
unsafe or duplicate names, ZIP64, encryption and size or CRC-32 mismatches are
rejected, an artifact `digest` is verified when present, and only the selected
entry (at most 4 MiB) is decompressed. `github_workflow_run_view` with
`artifacts: true` lists a run's artifacts without download URLs.

Every operation receives the tool call's abort signal, also through an injected
command transport: `options.signal` is passed to the transport and a call
rejects on abort even if the transport ignores it. Binary downloads ask the
transport for `encoding: "buffer"` with a `maxBuffer` bound; a transport that
returns only text is reported as unable to.

## Verification

`test-install.sh` creates an npm tarball, installs it into a clean temporary
project, and asks Pi to load the installed package while checking registered
tools.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
