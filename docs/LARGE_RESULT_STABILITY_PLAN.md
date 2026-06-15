# Large Result Stability Follow-up Plan

작성일: 2026-06-15  
대상: Web GeneDB Collector  
목표: RNA 결과 수집, JSON2_S fallback 메시지, partial XML 회수 표시, 대용량 metadata 구조를 보강하여 100,000 hit에 가까운 작업을 더 안정적으로 처리한다.

보안 원칙:

- 실제 분석 sequence, raw BLAST JSON/XML, API key, 개인정보, 회사 내부자료를 repository에 포함하지 않는다.
- 문서와 log에는 RID, query length/hash, count, format, response size, parser diagnostics만 남긴다.
- 테스트 fixture는 synthetic/minimized data만 사용한다.

공식 API 근거:

- NCBI BLAST URL API는 `CMD=Put` 제출과 `CMD=Get` 상태/결과 조회를 지원한다.
- `QUERY`는 accession/GI/FASTA를 받을 수 있다.
- `HITLIST_SIZE`는 보관할 database sequence 수 요청값이다.
- `FORMAT_TYPE`은 `JSON2_S`, `XML2`, `XML2_S` 등 여러 machine-readable format을 지원한다.
- `HITLIST_SIZE`는 요청값이며, 브라우저/네트워크/NCBI 응답 상태에 따른 실제 수신 완전성을 별도로 검증해야 한다.

참조:

- https://blast.ncbi.nlm.nih.gov/doc/blast-help/urlapi.html
- https://www.ncbi.nlm.nih.gov/home/develop/api/

## 1. 현재 상태 요약

이미 구현된 것:

- RNA 입력 `U`는 BLAST 제출 전 `T`로 변환된다.
- Phase 9A 기준으로 BLAST result HSP의 `U`도 FASTA output 전 `T`로 변환된다.
- `Hsp_hseq`가 없고 `Hsp_qseq`만 있는 record는 저장하되 `sequenceSource=qseq`, `qseqFallbackCount`, parser warning으로 표시한다.
- ambiguous 분리 기준은 `N`만 유지한다. 다른 IUPAC ambiguity code는 drop하지 않고 count로 기록한다.
- result sequence normalization summary는 UI/meta/process.log에 count/policy 중심으로 남기며 raw/original HSP sequence는 저장하지 않는다.
- Phase 9B 기준으로 JSON2_S download/parse 실패 후 XML fallback이 성공하면 `fallback_succeeded`로 구조화해 표시한다.
- JSON2_S와 XML fallback이 모두 실패하면 `primaryFailure`와 `fallbackFailure`를 함께 보존한다.
- fallback failure reason은 `timeout`, `network_or_cors`, `http_status`, `empty_response`, `parse_failed`, `unknown`으로 분류한다.
- `partialXmlTail=true`는 UI/log/meta/run_info에서 `완성 Hit block만 회수됨`으로 표시한다.
- GenBank `ORIGIN ... //` 입력은 sequence body만 추출한다.
- NCBI 줄번호/공백 입력은 숫자/공백 제거 후 처리한다.
- JSON2_S 실패 후 XML fallback이 성공하면 전체 실패가 아니라고 표시한다.
- XML tail이 불완전해도 완성된 `<Hit>...</Hit>` block은 회수한다.
- `partialXmlTail=true`, `completeHitBlocksSeen`을 UI/log/meta에 남긴다.
- SUP12 setting과 Default setting을 버튼으로 전환할 수 있다.

남은 문제:

- `meta.json`이 record 수에 비례해 매우 커진다.
- 대용량 result는 main thread에서 raw text -> parse -> records -> metadata -> ZIP을 만드는 과정에서 메모리 압박이 크다.
- ZIP 생성 단계도 큰 FASTA 문자열과 metadata 문자열을 다시 복사하므로, parser 성공 후 ZIP 생성에서 실패할 수 있다.
- 100,000 hit 요청은 보장값이 아니며, serverless browser app에서 완전 회수를 보장할 방법은 없다.

## 2. 목표 상태

### 2.1 RNA 결과 수집

목표:

- 입력 RNA만이 아니라 BLAST result HSP에 `U`가 들어오는 경우도 drop하지 않는다.
- `U`는 ambiguous `N`과 다르게 정상 염기로 취급한다.
- length filter와 unique count는 RNA/DNA normalization 정책에 맞게 일관되게 계산한다.
- output metadata에는 query/result normalization 정책을 기록한다.

권장 구현:

- parser의 `removeGaps()`를 `normalizeParsedHspSequence()`로 확장한다.
- 결과 sequence alphabet을 검사해 `uCount`, `nCount`, `invalidCharacterCount`를 기록한다.
- 기본은 `U`를 `T`로 변환해 downstream DNA alignment와 호환시킨다.
- `Hsp_hseq`를 권위 있는 hit-side sequence로 우선한다. `Hsp_hseq`가 없어서 `Hsp_qseq`를 fallback으로 쓰는 경우에는 record를 `sequenceSource=qseq`로 표시하고, `qseqFallbackCount`와 경고를 metadata에 남긴다.
- ambiguous 분리는 현재 SUP12 호환을 위해 `N` 기준을 유지한다. 다만 다른 IUPAC ambiguity code가 발견되면 drop하지 말고 count로 기록한 뒤, 별도 filter는 후속 사용자 결정으로 둔다.
- 단, 사용자 결정 전에는 `resultSequenceOutputMode`를 문서상 결정 필요 항목으로 둔다.

### 2.2 JSON2_S 실패 메시지 개선

목표:

- JSON2_S 실패가 전체 run 실패처럼 보이지 않게 한다.
- 실패 원인을 `timeout`, `network_or_cors`, `http_status`, `empty_response`, `parse_failed`, `unknown`으로 분류한다.
- XML fallback 성공 시 UI/log/meta에서 `JSON2_S failed, XML fallback succeeded`를 명확히 표시한다.

권장 구현:

- `BlastResultDownload`에 `fallback` object를 추가한다.
- `json2FailureReason` string은 유지하되 deprecated path로 취급한다.
- JSON2_S와 XML이 모두 실패하면 최종 error에는 `primaryFailure`와 `fallbackFailure`를 함께 담아, 사용자가 "JSON 실패 후 XML도 실패"를 구분할 수 있게 한다.
- process log 예:

```text
JSON2_S download failed; XML fallback succeeded. code=failed_timeout, format=XML
```

### 2.3 partialXmlTail 표시 강화

목표:

- `partialXmlTail=true`를 성공/실패와 별도로 "부분 회수 성공"으로 설명한다.
- 사용자가 100,000 hit 요청값을 전체 회수 성공으로 오해하지 않도록 한다.

권장 구현:

- UI result summary에 completeness badge 추가:
  - `Complete XML result`
  - `Partial XML result: complete Hit blocks recovered`
  - 한국어 UI 문구: `부분 XML 결과: 완성 Hit block만 회수됨`
- process.log와 meta summary에 다음 필드 추가:
  - `resultCompleteness`
  - `completeHitBlocksSeen`
  - `partialXmlTail`
  - `partialTailPolicy`
- ZIP 안의 `run_info.json`에도 간단한 completeness summary를 넣는다.

### 2.4 meta.json 대용량 완화

목표:

- 작은 작업은 기존처럼 사용하기 쉽고, 큰 작업은 브라우저 메모리 부담을 줄인다.
- summary metadata와 full provenance를 분리한다.

권장 output 구조:

```text
Task_Aligned.fasta
Task_excluded_ambiguous.fasta
Task_meta.json                  # summary only
Task_records.jsonl              # optional full provenance, one record per line
run_info.json
process.log
```

`Task_meta.json`에 남길 것:

- task/app/RID/query summary
- request options
- result format/fallback/completeness summary
- filter summary
- counts
- parser diagnostics
- output file manifest

`Task_records.jsonl`에 남길 것:

- accession
- title
- disposition
- sequenceLength
- HSP/query ranges
- identity/evalue/bitScore
- sequenceSource
- outputIndex

FASTA sequence 자체는 JSONL에 넣지 않는다.

### 2.5 대용량 100,000 hit 안정화

목표:

- raw BLAST result 전체를 main thread string으로 오래 들고 있지 않는다.
- parser/output 작업 중 UI freeze를 줄인다.
- partial result를 최대한 salvage한다.

권장 구현 순서:

1. 현재 worker placeholder를 실제 parser worker로 교체한다.
2. XML complete Hit block parser를 worker 내부로 이동한다.
3. main thread는 progress/count/status만 받는다.
4. large result mode에서는 XML 계열 format을 우선하거나, JSON2_S 실패 후 XML fallback을 자동으로 수행한다.
5. 가능하면 streaming fetch + incremental Hit block parsing을 검토한다.
6. ZIP 생성은 summary meta와 JSONL split 구조로 메모리 사용량을 낮춘다.
7. ZIP 생성 전 예상 output size를 계산하고, 실패 시 FASTA-only ZIP, summary-only ZIP, provenance 제외 ZIP 같은 degradation 경로를 제공한다.
8. synthetic large fixture generator로 10k/50k/100k 수준 parser stress test를 수행한다.

현실적 한계:

- GitHub Pages static app은 자체 서버가 없으므로 NCBI 응답 자체의 truncation, timeout, CORS/network failure를 완전히 통제할 수 없다.
- BLAST URL API에 result pagination이 명확히 제공되지 않으므로, 하나의 RID에서 일부 tail이 누락되면 완전한 100,000 hit 회수를 보장할 수 없다.
- 할 수 있는 최선은 format fallback, streaming/chunk parsing, partial hit salvage, 명확한 completeness reporting이다.

## 3. 사용자 결정 필요 항목

아래 항목은 구현 전에 사용자가 결정해야 한다. 이 문서에서는 확정하지 않는다.

| ID | 결정 항목 | 선택지 | 권장안 |
| --- | --- | --- | --- |
| D1 | RNA result FASTA 출력 방식 | `U` 보존 / `U->T` 변환 / 둘 다 생성 | downstream DNA alignment 기준이면 `U->T`, RNA 자체 보존이 중요하면 둘 다 |
| D2 | full provenance 기본 포함 여부 | 항상 포함 / 기본 포함하되 끌 수 있음 / 기본 제외 | 기본 포함하되 large job에서 끌 수 있게 함 |
| D3 | provenance 파일 형식 | JSON array / JSONL / TSV | JSONL |
| D4 | 기존 `_meta.json` 파일명 유지 | 유지 / summary 파일명으로 변경 / 둘 다 제공 | 기존명 유지하되 summary-only로 축소 |
| D5 | large result mode 자동 기준 | maxHits > 20,000 / > 50,000 / 사용자가 직접 선택 | > 50,000 자동 경고, 사용자가 override |
| D6 | partialXmlTail=true일 때 ZIP 다운로드 허용 | 허용 / 확인 modal 필요 / 차단 | 허용하되 강한 경고 |
| D7 | incomplete result 재시도 정책 | 자동 1회 재시도 / 수동 재시도 버튼 / 재시도 없음 | 수동 재시도 버튼 |
| D8 | `Hsp_qseq` fallback record 처리 | 저장 / 별도 ambiguous로 분리 / drop | 저장하되 `sequenceSource=qseq`와 경고 |
| D9 | ambiguous 분리 기준 | `N`만 / 모든 IUPAC ambiguity / 사용자 선택 | 1차는 `N`만, 다른 code는 count |
| D10 | large result format 우선순위 | JSON2_S 우선 / XML 계열 우선 / maxHits 기준 자동 | maxHits가 클 때 XML 계열 우선 검토 |
| D11 | ZIP 실패 시 degradation 허용 | 허용 / 차단 / 사용자 선택 | 허용하되 빠진 파일 manifest를 명확히 표시 |

확정된 항목:

- D1: `U->T` 변환
- D8: 저장하고 `sequenceSource=qseq`/warning/count 표시
- D9: `N`만 ambiguous 분리, 다른 IUPAC ambiguity는 count만 기록

## 4. 구현 단계

### Phase 9A. RNA result handling 완료

작업:

- parser output sequence normalization 정책 추가
- `U` 포함 HSP synthetic fixtures 추가
- output metadata에 `resultSequenceNormalization` 기록
- validation/result count에서 `U`를 정상 염기로 처리

완료 결과:

- HSP `AUGC`가 drop되지 않고 FASTA-ready sequence `ATGC`로 저장된다.
- `qseq` fallback record는 저장하되 warning/count/provenance로 표시된다.
- ambiguous split은 `N`만 유지하며, non-N IUPAC ambiguity는 count로 기록된다.
- raw sequence는 log/meta에 들어가지 않는다.

### Phase 9B. Fallback/completeness reporting 완료

작업:

- `BlastResultDownload.fallback` 구조화
- UI/log/meta/run_info에 fallback summary 추가
- partial XML result badge 추가
- process log 문구 통일

완료 결과:

- JSON2_S 실패 + XML 성공은 `fallback_succeeded`로 표시된다.
- JSON2_S와 XML fallback이 모두 실패하면 `primaryFailure`와 `fallbackFailure`를 함께 보존한다.
- partial XML은 "완성 Hit block만 회수됨"으로 표시된다.
- tests가 fallback code별 메시지와 meta/run_info/process.log completeness를 검증한다.

### Phase 9C. Metadata split

작업:

- `meta.json` summary-only 구조로 축소
- full provenance는 `records.jsonl`로 분리
- ZIP manifest와 README/docs 업데이트
- 기존 parser/output tests 갱신

완료 기준:

- 30k record 이상에서도 `meta.json` 크기가 크게 줄어든다.
- provenance는 JSONL에서 accession/HSP provenance를 유지한다.
- FASTA header는 기존 GeneDB 수준을 유지한다.

### Phase 9D. ZIP risk controls

작업:

- ZIP 생성 전 output size estimate 추가
- ZIP 생성 실패를 parser 실패와 구분
- FASTA-only ZIP, summary-only ZIP, provenance omitted ZIP fallback 검토
- ZIP manifest에 포함/제외 파일과 제외 사유 기록

완료 기준:

- parser 성공 후 ZIP 실패가 전체 분석 실패처럼 보이지 않는다.
- 대용량 provenance 때문에 ZIP이 실패해도 aligned FASTA를 받을 수 있는 fallback 경로가 있다.
- process.log와 UI는 어떤 파일이 생략되었는지 명확히 표시한다.

### Phase 9E. Worker-based large parser

작업:

- `blastParser.worker.ts`를 실제 parser worker로 교체
- main thread parsing 제거
- progress event 추가
- cancellation hook 검토
- synthetic large XML fixture generator 추가

완료 기준:

- parser가 UI thread를 장시간 막지 않는다.
- 10k+ synthetic hit block 테스트를 통과한다.
- partial tail fixture에서 complete Hit block만 회수한다.

### Phase 9F. Streaming/chunked retrieval 검토

작업:

- browser fetch `ReadableStream` 사용 가능성 검증
- XML incremental parser prototype 작성
- JSON2_S는 기존 fallback 대상 유지
- CORS/response body stream 불가 시 graceful fallback

완료 기준:

- streaming이 가능한 환경에서는 raw result 전체 string 보관 없이 parsing한다.
- streaming 불가 환경에서는 기존 text fallback으로 동작한다.
- UI에 streaming/text fallback mode를 표시한다.

## 5. 테스트 전략

Unit tests:

- RNA HSP `U` 처리
- `Hsp_qseq` fallback 표시와 경고
- GenBank/RNA input normalization 유지
- JSON2_S fallback reason 분류
- JSON2_S와 XML fallback 동시 실패의 양쪽 원인 보존
- partial XML completeness metadata
- summary meta vs records JSONL split
- ZIP file manifest
- ZIP 생성 실패 fallback/degradation

Integration tests:

- synthetic XML 10k/50k hit blocks
- incomplete XML tail
- JSON2_S failure -> XML fallback
- large metadata size regression

Manual smoke tests:

- GitHub Pages에서 short public/synthetic test sequence로 RID 발급
- 실제 대용량 작업은 사용자가 제공한 조건으로만 수행
- report에는 RID/status/count/network summary만 기록

## 6. 구현 전 확인 질문

아래 질문은 실제 코드 구현 전에 사용자 확인이 필요하다.

1. RNA result FASTA에서 `U`를 그대로 보존할지, `T`로 변환할지, 둘 다 생성할지?
2. full provenance `records.jsonl`을 기본 포함할지, large job에서 선택 옵션으로 둘지?
3. `partialXmlTail=true` 결과도 지금처럼 ZIP 다운로드를 허용하되 강한 경고만 표시하면 되는지?
4. large result mode 기준을 `maxHits > 50,000`으로 둘지, 다른 기준을 원하는지?
5. `Hsp_hseq`가 없고 `Hsp_qseq`만 있는 record를 저장하되 경고 처리할지?
6. ambiguous 분리 기준을 현재처럼 `N`만으로 둘지, 모든 IUPAC ambiguity code로 넓힐지?
7. ZIP 생성이 실패하거나 너무 큰 경우 FASTA-only ZIP 또는 provenance 생략 ZIP을 허용할지?
