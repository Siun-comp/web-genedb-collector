# Phase 9G Validation Report - 2026-06-16

This report records GitHub Pages validation only with safe summaries. It does not include full query sequence, raw BLAST JSON/XML result, FASTA body, API key, personal data, or company internal material.

## Scope

- URL: `https://siun-comp.github.io/web-genedb-collector/`
- App commit under test: `d504127`
- Validation target: Phase 9A-9F behavior preserved through real Pages execution.
- Browser note: Codex in-app Browser does not support saving downloaded files. Therefore ZIP file-save could not be captured automatically. The validation confirmed that the ZIP button became enabled after output preparation; file save should be manually confirmed in a normal browser.

## Public Small Run

- Input source: public NCBI accession-derived sequence, `300 bp`
- Taxid: `10244`
- Max hits: `200`
- RID: `306KBGGF014`
- RTOE: `30 sec`
- Polling: first SearchInfo check occurred after the app-enforced 60 sec delay.
- SearchInfo: `READY`
- Result format: `JSON2_S`
- Acquisition mode: `text_json2_worker`
- XML streaming: `not_attempted`
- Response length: `1,778,506`
- Parsed records: `200`
- Aligned: `194`
- Ambiguous N split: `6`
- Dropped: `0`
- Complete Hit blocks: `0` because JSON2_S path was used.
- partialXmlTail: `false`
- ZIP source estimate: `189.5 KB`, records.jsonl `109.2 KB`
- ZIP risk: `normal`
- ZIP state: download button enabled; file save not captured because the in-app Browser does not support downloads.
- Console errors: none observed.

## Public Large Run

- Input source: public NCBI accession-derived sequence, `1,027 bp`
- Taxid: `11320`
- Max hits: `50,000`
- Full provenance records.jsonl: disabled for large-run stability.
- RID: `306S233T016`
- RTOE: `30 sec`
- Polling: first SearchInfo check occurred after the app-enforced 60 sec delay.
- SearchInfo: `READY`
- JSON2_S primary: failed with `network_or_cors/failed_network`
- XML fallback: succeeded
- Result format: `XML`
- Acquisition mode: `streaming_xml`
- XML streaming status: `stream_succeeded`
- XML response length: `114,507,258`
- Streaming parse elapsed: `58,738 ms`
- Parsed records: `28,089`
- Complete Hit blocks: `28,089`
- partialXmlTail: `true`
- Completeness interpretation: complete Hit blocks only were recovered.
- Aligned: `27,692`
- Ambiguous N split: `397`
- Dropped: `0`
- Unique sequence reference count: `17,092`
- Aligned length range: `940-1,060 bp`
- ZIP source estimate: `32.9 MB`, records.jsonl omitted
- ZIP risk: `large`
- ZIP state: download button enabled; file save not captured because the in-app Browser does not support downloads.
- Console errors: none observed.

## Security Check

- Full query sequence was not written to this report.
- Raw BLAST JSON/XML result was not written to this report.
- FASTA body and ZIP output were not committed to the repository.
- Browser status/log sampling was limited to RID, mode, response length, completeness, and count summaries.
- No `RAW_BLAST_RESULT_TEXT` marker appeared in the visible page checks.

## Interpretation

Phase 9G confirmed both important real-world paths:

- Small result path: `JSON2_S` primary download succeeded and was parsed by the Web Worker.
- Large result path: `JSON2_S` failed, XML fallback succeeded, and Phase 9F XML streaming parsed complete Hit blocks incrementally.

The large run also confirmed the expected limitation: `partialXmlTail=true` means the output is a valid partial recovery of complete Hit blocks, not proof that the full requested `maxHits` set was completely received.

## Remaining Validation Gap

Automatic ZIP file-save verification remains unresolved only because the Codex in-app Browser blocks download handling. In a normal browser, the next manual check is to click `ZIP 다운로드` for the same completed run and confirm that the ZIP file is saved.
