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
failed-step log tail (`{ runId, log }`, or `unavailable`), as before. Its
optional evidence inputs read selected, bounded evidence from one run instead:

| Input | Meaning |
| --- | --- |
| `jobId` | A job of this run (default: the first failed job). |
| `step` | A step number of that job (needs `jobId`; default: its first failed step). |
| `firstFailure` | `false` starts at line 1 instead of 30 lines before the first `##[error]`. |
| `startLine`, `startChar` | Where the page starts; `startChar` (needs `startLine`) continues inside an over-long line. For an artifact file list, `startLine` is the first entry. |
| `maxLines` | Lines (or file-list entries) per page, 1 to 2,000 (default 200). |
| `maxChars` | Characters per page, 1 to 12,000 (default 12,000), for text and file lists alike. |
| `artifactId`, `artifactName` | An artifact of this run (cannot be combined with job selection). |
| `artifactPath` | One file in that artifact; without it, the artifact's file list. |

Every evidence result carries `state`:

- `ok`: a page with `startLine`, `endLine`, `totalLines` (or `startEntry`,
  `endEntry`, `totalEntries` and `entries` for a file list), `truncated`, and a
  `continuation` (`{ startLine }`, or `{ startLine, startChar }` when
  `lineTruncated`) to pass back for the next page; `null` at the end.
- `running`: the run or job has not completed; artifacts are read only from a
  completed run.
- `unavailable`: GitHub could not provide the evidence (for example HTTP 404 for
  a log), or the command transport cannot return binary data.
- `expired`: GitHub reports the log or artifact has expired (HTTP 410 or the
  artifact's `expired` flag).
- `missing`: the run, job, step, artifact, file or page does not exist in this
  repository and run.
- `oversized`: the log (16 MiB), artifact (8 MiB), entry count (1,000) or
  selected file (4 MiB) exceeds its bound.
- `malformed`: unparseable GitHub data, an artifact without a valid size, a
  digest mismatch, an unsafe or invalid archive, or a file that is not UTF-8
  text.

`listTruncated` marks a job or artifact list cut at 1,000 items. Error reasons
have URL query strings and control characters removed.

Jobs and artifacts are bound to the requested repository and run through the
API before anything is fetched; downloads use URLs built from those ids, never
URLs from metadata. Archives are read in memory with
[yauzl](https://github.com/thejoshwolfe/yauzl): links, special files, unsafe,
bidirectional-control or duplicate names, ZIP64, encryption and size or CRC-32
mismatches are rejected, an artifact `digest` is verified when present, and
only the selected entry is decompressed. `github_workflow_run_view` with
`artifacts: true` adds the run's artifacts without download URLs
(`artifactsTruncated` when the list was cut).

## Waiting for checks

`github_pull_request_checks_wait` returns `success`, `failure` (with failed-step
log tails), `none` (no checks after the grace period), `closed`, or `stale`:
the requested `sha` is still not the pull request's head after the grace
period, and `headSha` carries the current head so the caller can re-target.

## Cancellation and transports

Every operation receives the tool call's abort signal, also through an injected
command transport: `options.signal` is passed to the transport only when the
call has one, and a call rejects on abort even if the transport ignores it.
Binary downloads ask the transport for `encoding: "buffer"` with a `maxBuffer`
bound; a transport that returns only text is reported as unable to. Text
responses above a caller's `maxBuffer` are reported as oversized even when the
transport ignored the bound.

## Verification

`test-install.sh` creates an npm tarball, installs it into a clean temporary
project, and asks Pi to load the installed package while checking registered
tools.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
