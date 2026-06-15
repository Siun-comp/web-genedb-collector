# Large Result Stability Step Prompts

## Phase 9F Prompt: Streaming Retrieval Prototype

상태: 완료. 구현 기준은 JSON2_S primary 유지, XML ReadableStream fallback, streaming 불가/실패 시 text XML + Web Worker fallback이다.

추가된 검증:

- synthetic stream tests
- partial chunk boundary tests
- stream read-error salvage test
- JSON2_S success path test
- XML streaming success path test
- stream-unavailable text fallback test

## Phase 9G Prompt: Real Large-run Validation

```text
web-genedb-collector/docs/LARGE_RESULT_STABILITY_PLAN.md를 기준으로 Phase 9G validation을 수행하라.

Phase 9A~9F의 RNA U->T normalization, qseq fallback warning/count, N-only ambiguous split,
structured JSON2_S/XML fallback, partialXmlTail completeness reporting, summary meta/records.jsonl split,
ZIP size estimate/degradation, Web Worker parser, XML streaming prototype과 text Worker fallback을 유지하라.

목표는 GitHub Pages URL에서 실제 사용 가능한 공개/짧은 test sequence 또는 사용자가 제공한 조건으로
RID 발급, 60초 이상 polling, acquisition mode, streamingAttempt status, partialXmlTail, completeHitBlocksSeen,
aligned/ambiguous/dropped count, ZIP 다운로드를 검증하는 것이다.

원본 query sequence, raw BLAST result, 실제 분석 sequence, API key, 개인정보, 회사 내부자료는 repository와 문서에 포함하지 말고
RID/status/count/network summary만 보고하라.
```

이 문서는 `web-genedb-collector/docs/LARGE_RESULT_STABILITY_PLAN.md`를 구현하기 위한 단계별 프롬프트다. 각 단계는 이전 단계의 테스트 통과 후 진행한다.

공통 금지:

- 실제 분석 sequence, raw BLAST result, API key, 개인정보, 회사 내부자료를 repository에 포함하지 말라.
- 화면/console/log/IndexedDB에는 full query sequence와 raw BLAST result를 남기지 말라.
- fixture는 synthetic/minimized data만 사용하라.
- 분석/설계/코드작성에는 전문가 에이전트를 활용하라.

## Phase 9A Prompt: RNA Result Handling

상태: 완료. 구현 기준은 `U->T 변환`, `Hsp_qseq fallback 저장하고 경고`, ambiguous 분리 `N만`이다.

```text
docs/PROJECT_STATE.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/NEXT_TASK.md, docs/FAILURES.md와
web-genedb-collector/docs/LARGE_RESULT_STABILITY_PLAN.md를 기준으로 Phase 9A를 시작하라.

목표는 BLAST result HSP 자체에 RNA U가 포함되는 경우도 drop하지 않고 수집할 수 있게 하는 것이다.
입력 RNA U->T 변환은 유지하되, parser result sequence에 U가 들어오는 synthetic JSON2_S/XML fixture를 추가하라.

단, RNA result FASTA 출력 정책은 사용자 결정 필요 항목 D1이다.
사용자가 아직 결정하지 않았다면 구현을 멈추고 질문하라.

사용자 결정 후:
- result sequence normalization helper를 추가하라.
- U를 ambiguous N과 다르게 정상 염기로 처리하라.
- Hsp_hseq를 우선 사용하고, Hsp_qseq fallback record는 sequenceSource=qseq, qseqFallbackCount, warning으로 표시하라.
- ambiguous N 분리 정책은 유지하되, 다른 IUPAC ambiguity code는 별도 count로 기록하라.
- output metadata에 resultSequenceNormalization 정책과 uCount summary를 기록하라.
- FASTA/log/meta에 raw query sequence나 raw BLAST result를 남기지 말라.

검증:
- npm run typecheck
- npm test
- npm run build
```

## Phase 9B Prompt: Fallback And Completeness Reporting

상태: 완료. 구현 기준은 structured fallback object, `primaryFailure`/`fallbackFailure` 보존, `완성 Hit block만 회수됨` completeness 표시다.

```text
web-genedb-collector/docs/LARGE_RESULT_STABILITY_PLAN.md를 기준으로 Phase 9B를 구현하라.

목표는 JSON2_S 실패와 XML fallback 성공을 사용자에게 명확히 구분해 보여주고,
partialXmlTail=true 결과를 "완성 Hit block만 회수됨"으로 UI/log/meta/run_info에 일관되게 표시하는 것이다.

구현:
- BlastResultDownload에 structured fallback object를 추가하라.
- 실패 reason을 timeout/network_or_cors/http_status/empty_response/parse_failed/unknown 범주로 정리하라.
- JSON2_S와 XML fallback이 모두 실패하면 primaryFailure와 fallbackFailure를 함께 보존하고 표시하라.
- UI result summary에 completeness badge를 추가하라.
- process.log, meta.json, run_info.json에 resultCompleteness summary를 추가하라.
- partialXmlTail=true일 때 한국어 UI/log 문구는 "완성 Hit block만 회수됨"으로 통일하라.
- 기존 json2FailureReason 호환은 유지하되 새 구조를 우선 사용하라.

검증:
- fallback unit tests
- partial XML fixture tests
- output metadata/log tests
- npm run typecheck
- npm test
- npm run build
```

## Phase 9C Prompt: Summary Meta And Full Provenance Split

상태: 완료. 구현 기준은 `*_meta.json` summary-only, 기본 포함 `*_records.jsonl`, sequence 본문 없는 JSONL provenance, 사용자 선택에 따른 records JSONL omitted mode다.

```text
web-genedb-collector/docs/LARGE_RESULT_STABILITY_PLAN.md를 기준으로 Phase 9C를 구현하라.

목표는 대용량 result에서 meta.json 크기를 줄이기 위해 summary meta와 full provenance를 분리하는 것이다.

단, full provenance 기본 포함 여부와 파일 형식은 사용자 결정 필요 항목 D2/D3/D4이다.
사용자 결정이 아직 없다면 구현을 멈추고 질문하라.

사용자 결정 후:
- 기존 *_meta.json은 summary-only로 축소하거나, 결정된 호환 방식으로 유지하라.
- record-level provenance는 records.jsonl 또는 결정된 형식으로 분리하라.
- ZIP manifest와 README/docs를 업데이트하라.
- FASTA header는 기존 GeneDB 수준을 유지하라.
- provenance에는 sequence 본문을 넣지 말고 accession/title/HSP range/query range/identity/e-value/bit score/disposition만 기록하라.

검증:
- output file names tests
- meta size regression test with synthetic many-record result
- ZIP writer tests
- npm run typecheck
- npm test
- npm run build
```

## Phase 9D Prompt: ZIP Risk Controls For Large Results

상태: 완료. 구현 기준은 ZIP source size estimate, full provenance ZIP 1차 시도, 실패 시 `records.jsonl` 제외 summary-only ZIP 자동 1회 fallback, omission reason 기록이다.

```text
web-genedb-collector/docs/LARGE_RESULT_STABILITY_PLAN.md를 기준으로 Phase 9D를 구현하라.

목표는 parser가 성공했는데 ZIP 생성이나 provenance metadata 크기 때문에 최종 다운로드가 실패하는 상황을 줄이는 것이다.

단, ZIP 실패 시 FASTA-only ZIP 또는 provenance omitted ZIP을 허용할지는 사용자 결정 필요 항목 D11이다.
사용자 결정이 아직 없다면 구현을 멈추고 질문하라.

사용자 결정 후:
- ZIP 생성 전 output size estimate와 경고를 추가하라.
- ZIP 생성 실패를 parser 실패와 구분하라.
- FASTA-only ZIP, summary-only ZIP, provenance omitted ZIP 중 결정된 fallback 경로를 구현하라.
- ZIP manifest와 process.log에 포함/제외 파일, 제외 사유, resultCompleteness를 기록하라.
- 화면/console/log/IndexedDB에 raw query sequence나 raw BLAST result를 남기지 말라.

검증:
- ZIP writer failure simulation test
- large provenance omitted manifest test
- aligned FASTA fallback download test
- npm run typecheck
- npm test
- npm run build
```

## Phase 9E Prompt: Worker Parser For Large Results

상태: 완료. 구현 기준은 기존 parser semantics 유지, Web Worker transport, requestId guard, count-only progress, generated 10k synthetic XML Worker contract test다.

```text
web-genedb-collector/docs/LARGE_RESULT_STABILITY_PLAN.md를 기준으로 Phase 9E를 구현하라.

목표는 대용량 BLAST result parsing을 main thread가 아니라 Web Worker에서 수행해 UI freeze와 memory pressure를 줄이는 것이다.

구현:
- blastParser.worker.ts placeholder를 실제 parser worker로 교체하라.
- main thread는 raw result를 화면/log/IndexedDB에 저장하지 말고 worker에만 전달하라.
- Phase 9D의 ZIP source estimate와 summary-only ZIP fallback은 유지하라.
- worker는 progress event로 parsedHitCount, droppedCount, partialXmlTail 여부를 보낸다.
- parser complete 후 output bundle 생성을 이어간다.
- cancellation hook은 가능하면 추가하되, 구현 복잡도가 크면 문서화된 후속 작업으로 남긴다.

검증:
- worker message contract unit/integration tests
- synthetic incomplete XML tail test
- synthetic large hit block stress test
- npm run typecheck
- npm test
- npm run build
- 로컬 브라우저에서 UI가 parser 중 멈추지 않는지 smoke test
```

## Phase 9F Prompt: Streaming Retrieval Prototype

```text
web-genedb-collector/docs/LARGE_RESULT_STABILITY_PLAN.md를 기준으로 Phase 9F prototype을 구현하라.

목표는 fetch ReadableStream을 사용할 수 있는 브라우저에서 XML result를 chunk 단위로 읽고 complete Hit block을 incremental parsing하는 것이다.

구현:
- downloadBlastResultStream prototype을 추가하라.
- CORS 또는 브라우저 제약으로 stream body를 사용할 수 없으면 기존 text fallback으로 돌아가라.
- Phase 9E의 Worker parser와 count-only progress UI를 유지하라.
- large result mode에서 XML 계열 streaming을 우선 시도하는 옵션을 추가하라.
- streaming mode/text fallback mode를 UI/log/meta에 표시하라.

주의:
- NCBI에 과도한 재요청을 보내지 말라.
- raw BLAST result를 repository/test fixture에 넣지 말라.
- 실제 100,000 hit급 smoke test는 사용자가 명시적으로 요청한 조건에서만 수행하라.

검증:
- synthetic stream tests
- partial chunk boundary tests
- fallback tests
- npm run typecheck
- npm test
- npm run build
```

## Phase 9G Prompt: Real Large-run Validation

```text
Phase 9A~9F가 통과한 뒤 실제 large-run validation을 수행하라.

조건:
- 사용자가 제공하거나 공개 사용 가능한 짧은 test sequence만 사용
- 전체 query sequence와 raw BLAST result는 기록하지 않음
- report에는 RID/status/count/format/fallback/completeness/network summary만 기록

검증 항목:
- RID 발급
- 60초 이상 polling 간격 유지
- JSON2_S/XML/streaming fallback 상태
- partialXmlTail 여부
- completeHitBlocksSeen
- aligned/ambiguous/dropped counts
- ZIP 생성 성공
- meta summary size와 records provenance size

실패 시:
- 실패를 숨기지 말고 failed stage, error code, response length, retry 가능 여부만 보고하라.
```
