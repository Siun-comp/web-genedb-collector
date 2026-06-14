# Smoke Test Plan

This checklist verifies Phase 6 without storing real analysis sequence, API keys, personal data, company internal material, or full NCBI results in the repository.

## Scope

Smoke testing checks that the deployed static web app can:

- load from GitHub Pages
- validate user input
- submit an allowed NCBI BLAST URL API request
- receive RID/RTOE
- poll SearchInfo at safe intervals
- download a READY result
- parse aligned HSP records
- create FASTA/metadata/log ZIP output
- restore RID/status/options through IndexedDB without storing raw query sequence or raw BLAST result

## Test Data Rule

Use only one of these:

- a user-approved short public test sequence
- a synthetic sequence for validation-only tests

Do not paste or record:

- full real query sequence
- raw BLAST JSON/XML
- downloaded real FASTA/ZIP content
- API key or personal email
- company internal material

## Local Build Smoke

Run from:

```powershell
cd "H:\Vibe Cording\SUP12 web ver\web-genedb-collector"
```

Commands:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

Optional browser preview:

```powershell
npm run preview
```

Acceptance:

- page opens locally
- form, request preview, status, output preview, and recovery panel are visible
- validation blocks invalid sequence/taxid/options
- sequence preview shows only safe preview/hash/length
- no full query sequence is shown in status/log preview
- no unexpected browser console error

## GitHub Pages Load Smoke

Open:

```text
https://<USER>.github.io/web-genedb-collector/
```

Acceptance:

- page loads without 404
- CSS and JS assets load
- no blank screen
- no unexpected browser console error
- recovery panel states IndexedDB is only a recovery aid

If the page is 404:

- confirm `Settings -> Pages -> Source -> GitHub Actions`
- confirm the Actions workflow completed successfully
- wait several minutes and retry
- confirm the URL uses `/<REPO>/`

## Live NCBI Smoke

Use a public short test sequence only. For the first live smoke test, set:

```text
taxid: numeric only
max hits: 10 or 50
database: core_nt
task: megablast
expect: 0.05
word size: 11
```

Acceptance:

- submit is enabled only after validation passes
- RID and RTOE are displayed
- same RID is not polled more often than every 60 seconds
- SearchInfo shows WAITING, READY, FAILED, UNKNOWN, or NO_HITS clearly
- READY + hits proceeds to result download
- ZIP can be downloaded when parsing/output succeeds
- process log contains only redacted query summary and counts

Record only:

```text
Date/time:
GitHub Pages URL:
Browser:
Network: company / personal
Taxid:
Max hits:
RID issued: yes / no
Final status:
Aligned count:
Ambiguous count:
Dropped count:
ZIP created: yes / no
Console error summary:
Network error summary:
```

Do not record the full query sequence or raw BLAST result.

## IndexedDB Recovery Smoke

After RID is issued:

1. Refresh the browser.
2. Confirm the previous job appears in recovery.
3. Confirm sequence textarea is not repopulated with the raw query sequence.
4. Resume polling the same RID when allowed by the 60 second interval.
5. Clear recovery data.

Acceptance:

- RID/status/options/count summary are restored
- query length/hash are restored
- raw query sequence is not restored
- raw BLAST result is not restored
- recovery clear removes the saved snapshot

## Company Network Comparison

If possible, compare:

- company network
- personal network

Record only summary data:

```text
NCBI BLAST web page reachable: yes / no
NCBI URL API submit reachable: yes / no
CORS/network error visible: yes / no
RID issued: yes / no
ZIP created: yes / no
```

Do not attach downloaded NCBI results to the repository.
