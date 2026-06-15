# Web GeneDB Collector

Serverless static web app for collecting NCBI BLAST aligned HSP sequences inside a user-selected taxid.

The goal is not a simple Entrez search. The intended workflow is:

```text
input target/reference DNA sequence
-> restrict BLAST by numeric taxid
-> collect only aligned hit/HSP sequences
-> download FASTA + metadata + process log as ZIP
```

## Current Phase

Phase 7 large-result stabilization is in progress.

Implemented through Phase 7:

- Vite + TypeScript static app
- input cleaning and validation
- NCBI BLAST URL API `CMD=Put` submit
- RID/RTOE parsing
- SearchInfo polling model with 60 second interval guard
- JSON2_S/XML result download and parser tests
- aligned HSP FASTA generation
- length filter, keyword exclude, ambiguous N split
- metadata, run_info, process.log, ZIP output
- IndexedDB recovery for RID/status/options/count summary
- large XML fallback parsing by complete `<Hit>...</Hit>` blocks
- parser diagnostics for `completeHitBlocksSeen` and `partialXmlTail`

IndexedDB is only a recovery aid. It does not store raw query sequence or raw BLAST result.

## Default Collection Settings

- database: `core_nt`
- BLAST task: `megablast`
- max hits default: `20000`
- max hits UI maximum: `100000`
- expect: `0.05`
- word size: `11`
- length filter: `90%` to `500%`
- keyword exclude: `synthetic`, `construct`, `predicted`, `unverified`
- ambiguous `N`: split to excluded FASTA by default

## Safety Rules

This repository must not contain:

- real analysis sequence
- API key, password, token, credential, or personal email
- company internal material
- real NCBI full result JSON/XML
- downloaded ZIP/FASTA/FASTQ/XML/log output
- parent SUP12 workspace results, logs, cache, or certificates

The browser sends the submitted sequence to NCBI. The app UI, console/log preview, IndexedDB recovery data, and repository files must use only safe query preview/hash/length and summary counts.

## Local Commands

```powershell
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

## GitHub Pages Deployment

Use GitHub Free public repository + GitHub Actions + GitHub Pages.

Only upload this folder as the repository root:

```powershell
H:\Vibe Cording\SUP12 web ver\web-genedb-collector
```

Do not upload the parent workspace.

Deployment guide:

- `docs/GITHUB_PAGES_DEPLOYMENT.md`

Smoke test plan:

- `docs/SMOKE_TEST_PLAN.md`

## Important Limitation

`HITLIST_SIZE=20000` to `100000` is a request value sent to NCBI, not a guaranteed result count. NCBI may return fewer hits because of actual database content, taxid scope, BLAST behavior, service limits, or network/service errors.

For very large BLAST jobs, `JSON2_S` download can fail in the browser and the app may fall back to XML. If XML fallback succeeds, this is not a failed run.

If metadata shows `partialXmlTail=true`, the downloaded XML did not end as a complete BLAST XML document. The app preserves complete hit blocks that were received, but this must be interpreted as "complete blocks recovered from the received response", not "all requested max hits were guaranteed."
