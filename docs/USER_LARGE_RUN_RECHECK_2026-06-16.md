# User Large Run Recheck - 2026-06-16

This note records the user's same-condition large-run recheck without storing the query sequence, raw BLAST result, FASTA bodies, API keys, private data, or internal company material.

## Observed Run

- RID: `306JGF97014`
- taxid: `11320`
- requested maxHits: `100000`
- acquisition mode: `streaming_xml`
- streaming status: `stream_succeeded`
- JSON2_S status: large download failed, XML fallback succeeded
- responseLength: `139386362`
- completeHitBlocksSeen: `33289`
- partialXmlTail: `true`
- completeness interpretation: complete Hit blocks only were recovered
- aligned: `32947`
- ambiguous: `195`
- dropped: `147`
- ZIP mode: `primary`
- ZIP bytes: `6439812`
- uncompressedBytes: `81617654`
- detailed provenance bytes estimate: `36700610`

## ZIP Entry Summary

The uploaded ZIP was inspected by entry name and size only. Sequence contents were not printed or copied.

| Entry | Uncompressed bytes | Compressed bytes |
| --- | ---: | ---: |
| `FluA_M_Collection_Aligned.fasta` | `44674571` | `3543717` |
| `FluA_M_Collection_excluded_ambiguous.fasta` | `232655` | `16965` |
| `FluA_M_Collection_meta.json` | `3925` | `1470` |
| `FluA_M_Collection_records.jsonl` | `36700610` | `2873959` |
| `run_info.json` | `1809` | `858` |
| `process.log` | `4084` | `1443` |

## Interpretation

The difference from earlier same-condition runs is consistent with RID-specific NCBI remote BLAST behavior plus large XML tail completeness limits. `HITLIST_SIZE` is a requested upper bound, not a guarantee that every RID will return the same number of complete, downloadable Hit blocks.

When `partialXmlTail=true`, the result must not be described as complete recovery of requested `maxHits`. The correct interpretation is:

- NCBI accepted the run and returned a large result.
- The app recovered complete `<Hit>...</Hit>` blocks that arrived intact.
- The XML tail was incomplete, so records after the last complete Hit block cannot be claimed as recovered.

For comparisons between Web GeneDB runs or against SUP12, count-only comparison is insufficient. The comparison record should include:

- RID
- requested maxHits
- acquisition mode
- responseLength
- completeHitBlocksSeen
- partialXmlTail
- aligned / ambiguous / dropped counts
- ZIP mode and whether detailed provenance was included

## UX Finding

The previous `Include full provenance records.jsonl` checkbox looked like a filter condition and exposed an implementation file name as the primary label. It only controls whether the ZIP includes detailed record-level trace information. It does not change BLAST submission, parser count, aligned FASTA count, or ambiguous FASTA count.

The UI was updated to show this as:

- `ZIP에 상세 추적 정보 포함`
- helper text clarifying that accession/range/score are stored, sequence bodies/raw BLAST results are not stored, and the option does not affect FASTA collection count.

## Next Validation Direction

The core collection pipeline is now at a practical testing stage. The recommended next work is repeated real-world validation across several target/taxid conditions, recording only RID/status/count/network summaries. Runs with `partialXmlTail=true` should be compared separately from complete-tail runs.
