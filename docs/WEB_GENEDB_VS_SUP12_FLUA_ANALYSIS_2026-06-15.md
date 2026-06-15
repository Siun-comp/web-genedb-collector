# Web GeneDB vs SUP12 FluA M Result Analysis

Date: 2026-06-15  
Scope: `result competition` comparison folder  
Privacy rule: no full query sequence and no raw BLAST result are included in this report.

## Executive Summary

The web GeneDB result failed because the current web parser could not process the large NCBI XML response, not because NCBI only returned 0 hits.

For the web RID `2ZH1WESM014`, NCBI returned a very large XML response, around 138-140 MB depending on the request attempt. Streaming inspection found more than 33,000 `<Hit>` blocks before the response ended. However, the response did not end with a complete closing XML document, so the current web parser rejected the whole file as `XML parse failed`.

SUP12 handled the same scale because its GeneDB worker has a chunked fallback parser. When XML parsing fails, SUP12 extracts complete `<Hit>...</Hit>` blocks and processes the usable hits. The web implementation currently lacks this fallback and therefore drops the entire result.

Conclusion: current web GeneDB is usable for smaller jobs, but it is not yet reliable for 20,000-50,000 hit-scale influenza-like collections. It needs a large-result parser upgrade before it can replace SUP12 GeneDB for this use case.

## Observed Outputs

### SUP12 Result

Folder:

```text
result competition/(SUP12) InfluenzaA_M_DB
```

Observed files:

```text
[DB] InfluenzaA_M_DB_Aligned.fasta                43,318,830 bytes
[DB] InfluenzaA_M_DB_excluded_ambiguous.fasta        227,992 bytes
[DB] InfluenzaA_M_DB_meta.json                         2,895 bytes
run_info.json                                            812 bytes
process.log                                          526,788 bytes
```

Observed FASTA counts:

```text
Aligned FASTA records:              32,372
Excluded ambiguous FASTA records:      193
SUP12 final log: Saved 32,372, Dropped 194
```

SUP12 RID:

```text
2ZH0UETR016
```

SUP12 options summary:

```text
taxid: 11320
database: core_nt
task: megablast
max_hits: 50000
expect: 0.05
word_size: 11
length filter: 80%-500%
keyword exclude: synthetic, construct, predicted, unverified
exclude ambiguous N: true
API key used: true
```

### Web GeneDB Result

File:

```text
result competition/(web geneDB) FluA_M_Collection.zip
```

ZIP size:

```text
2,670 bytes
```

ZIP contents:

```text
FluA_M_Collection_Aligned.fasta              0 FASTA records
FluA_M_Collection_excluded_ambiguous.fasta   0 FASTA records
FluA_M_Collection_meta.json
run_info.json
process.log
```

Web RID:

```text
2ZH1WESM014
```

Web options summary:

```text
taxid: 11320
database: core_nt
task: megablast
max_hits: 50000
expect: 0.05
word_size: 11
length filter: 90%-500%
keyword exclude: synthetic, construct, predicted, unverified
exclude ambiguous N: true
API key used: no
```

Web output summary:

```text
result format: XML
responseLength recorded by app: 139,037,787 characters
saved: 0
ambiguous: 0
dropped: 1
parserDropped reason: XML parse failed
```

## Important Difference: The Conditions Were Not Fully Identical

The user intended an identical-condition comparison, but the output metadata shows several actual differences:

```text
SUP12 length minimum: 80%
Web length minimum:   90%
```

SUP12 also records additional BLAST/request-related options:

```text
match_scores: 1,-2
gap_costs: 5,2
low_complexity: true
mask_lookup: true
exclude_models: true
exclude_env: true
NCBI_GI=yes on XML download
```

The web implementation currently sends a simpler request:

```text
PROGRAM=blastn
DATABASE=core_nt
TASK=megablast
HITLIST_SIZE=<user value>
EXPECT=0.05
WORD_SIZE=11
ENTREZ_QUERY=(txid11320[ORGN])
```

These differences can affect exact hit ordering/counts. However, they do not explain the web result of 0 records. The web result of 0 records is explained by parser failure.

## Does NCBI Really Stop At 20,000?

Not in this case.

The NCBI web result page may visually show or practically load only around 20,000 rows, and very large RID pages can become slow or fail to open in a browser. That is a display/usability limit, not proof that the API result was only 20,000.

For web RID `2ZH1WESM014`, a streaming structural inspection of the XML API response showed:

```text
HTTP status: 200
response size: about 138-140 MB
starts like XML: yes
ends as complete XML: no
observed <Hit> blocks before truncation/end: about 33,000+
observed <Hsp> blocks before truncation/end: about 33,000+
closing </BlastOutput>: not present
```

Therefore:

```text
HITLIST_SIZE=50000 did request and receive more than 20,000 hits.
The practical returned/usable count was around 33,000, not 50,000.
The web app then lost the usable hits because the XML parser rejected the incomplete XML response.
```

This matches the SUP12 scale:

```text
SUP12 processed around 32,500 hits and saved 32,372 aligned records.
```

## Primary Root Cause

### Current web XML parser rejects incomplete large XML

Current logic:

```text
1. Download full BLAST result as one giant text string.
2. If JSON2_S fails, download XML.
3. Check whether the whole XML starts with "<" and ends with ">".
4. Extract <Hit>...</Hit> blocks only if the whole response passes that check.
```

For the FluA M result, NCBI returned a large XML response that starts correctly but does not end as a complete XML document. The current web parser therefore returns:

```text
records: []
dropped: [{ reason: "XML parse failed" }]
```

That is why the ZIP contains empty FASTA files.

## Why SUP12 Succeeds

SUP12 GeneWorker has two parsing paths:

```text
1. XML iterparse path
2. chunked fallback path
```

When full XML parsing fails, SUP12 logs the failure and falls back to chunk-level `<Hit>...</Hit>` extraction. This means a final incomplete XML tail can be ignored while all complete hit blocks before it are still processed.

The web implementation has no equivalent chunked fallback yet.

## Secondary Causes And Risks

### Browser memory and main-thread pressure

A 140 MB BLAST result is not just 140 MB in the browser. It can become much larger after:

```text
response text allocation
parser intermediate strings
record arrays
metadata arrays
FASTA strings
ZIP generation buffers
DOM/status updates
IndexedDB summary handling
```

This can freeze the page or silently fail on some browsers/machines.

### JSON2_S failure reason is hidden

The web app tries JSON2_S first, then XML fallback. The log only shows the final XML result. It does not preserve whether JSON2_S failed because of:

```text
timeout
HTTP error
invalid JSON
too-large response
NCBI format issue
browser memory issue
```

This makes troubleshooting harder.

### Download request does not explicitly repeat HITLIST_SIZE

The web app sends `HITLIST_SIZE` on `CMD=Put`, but the current result download request only sends:

```text
CMD=Get
RID=<RID>
FORMAT_TYPE=<JSON2_S or XML>
```

SUP12 sends `HITLIST_SIZE` again on XML download:

```text
CMD=Get
RID=<RID>
FORMAT_TYPE=XML
HITLIST_SIZE=<max_hits>
NCBI_GI=yes
```

The RID should normally remember the original settings, and the observed web XML still exceeded 20,000 hits. Even so, repeating `HITLIST_SIZE` on download is safer and closer to SUP12 behavior.

### Exact SUP12 compatibility is not yet implemented

The web app does not yet expose every SUP12 GeneDB BLAST option:

```text
match scores
gap costs
low complexity/masking switches
model/environment exclusion
NCBI_GI download flag
```

For high-fidelity SUP12 comparison, these options should be added or fixed to match legacy behavior.

## Current Reliability Assessment

### Small to medium jobs

Likely usable when:

```text
result response is complete
hit count is modest
JSON2_S or XML parses fully
ZIP size remains moderate
```

### Large jobs around 20,000-50,000 hits

Not reliable yet.

The current web app can submit the request and receive READY, but it may fail at:

```text
large response download
complete XML validation
large XML parsing
large FASTA/meta/ZIP generation
browser memory limits
```

### This FluA M case

Current web result should be treated as failed, not as true no-hit or true filtered-empty output.

Evidence:

```text
web XML response contained tens of thousands of Hit blocks
web parser dropped all records as XML parse failed
SUP12 saved 32,372 aligned records
```

## Required Fix Plan

### Fix 1. Add large XML chunk parser to web GeneDB

The web parser must process complete `<Hit>...</Hit>` blocks even if the XML document tail is incomplete.

Required behavior:

```text
If XML does not end cleanly:
  do not drop the whole response
  extract complete Hit blocks
  process complete hits
  record warning: "XML response incomplete; processed complete Hit blocks only"
  drop only the final partial Hit block
```

This is the most important fix.

### Fix 2. Move large parsing/output to Web Worker

Large result parsing should not run on the UI thread.

Required behavior:

```text
download/parse progress displayed
UI remains responsive
cancel possible
periodic count updates
```

### Fix 3. Add explicit download parameters

Result download should include:

```text
HITLIST_SIZE=<requested max hits>
NCBI_GI=yes
```

This will better match SUP12.

### Fix 4. Preserve JSON2_S failure reason

Current fallback hides the reason JSON2_S failed.

Log should say:

```text
JSON2_S download failed: timeout / parse error / HTTP status / empty response
Trying XML fallback...
```

No raw result should be logged.

### Fix 5. Add large-job warning and processed-hit count

For `maxHits > 20000`, UI should clearly warn:

```text
Large result mode.
NCBI may return incomplete XML or fewer than requested hits.
The app will report processed complete Hit blocks.
```

Output metadata should distinguish:

```text
requestedHitlistSize
downloadedResponseBytes
completeHitBlocksSeen
parsedRecords
partialXmlTail: true/false
parserWarnings
```

### Fix 6. Align SUP12 options before final comparison

For true same-condition comparison, set web options to match SUP12:

```text
length min: 80%
max hits: 50000
database: core_nt
task: megablast
expect: 0.05
word size: 11
keyword exclude: same list
ambiguous N exclude: true
```

Then add or emulate remaining SUP12 options:

```text
match_scores=1,-2
gap_costs=5,2
low_complexity
mask_lookup
exclude_models
exclude_env
NCBI_GI=yes
```

## Recommendation

Do not judge the web GeneDB collector by the current FluA M ZIP. That ZIP is an error artifact.

The correct conclusion is:

```text
Submission and RID polling work.
NCBI large result retrieval partially works and exceeds 20,000 hits.
The current parser/output layer fails for very large incomplete XML responses.
SUP12 succeeds because it has chunked fallback parsing.
```

Before using web GeneDB for production-scale diagnostic target collection, implement the large XML chunk parser and repeat the FluA M comparison.

## Next Implementation Prompt

```text
web-genedb-collector의 Phase 7로 large BLAST result compatibility fix를 구현하라.

근거 문서:
- web-genedb-collector/docs/WEB_GENEDB_VS_SUP12_FLUA_ANALYSIS_2026-06-15.md
- web-genedb-collector/docs/GITHUB_PAGES_DEPLOYMENT.md
- web-genedb-collector/docs/SMOKE_TEST_PLAN.md

요구사항:
1. XML 전체 문서가 incomplete/truncated여도 complete <Hit>...</Hit> block은 버리지 말고 파싱하라.
2. parserDropped는 전체 실패 1건이 아니라 partial tail/drop count와 warning으로 기록하라.
3. result download GET에 HITLIST_SIZE와 NCBI_GI=yes를 포함하라.
4. JSON2_S 실패 사유를 raw result 없이 process log에 남겨라.
5. large job에서 completeHitBlocksSeen, parsedRecords, partialXmlTail 여부를 meta/process log에 남겨라.
6. 전체 query sequence와 raw BLAST result는 UI/console/log/IndexedDB/repository에 저장하거나 출력하지 말라.
7. synthetic minimized fixture로 incomplete XML tail 테스트를 추가하라.
8. 가능하면 FluA M 공개 짧은 sequence + taxid 11320 + maxHits 50000 조건으로 Pages smoke test를 다시 수행하되, sequence/raw result는 기록하지 말고 RID/status/count만 보고하라.
```
