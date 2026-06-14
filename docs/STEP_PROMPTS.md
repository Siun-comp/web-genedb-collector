# Web GeneDB Collector 단계별 구현 프롬프트

이 문서는 이후 구현을 여러 턴으로 나눠 진행할 때 사용할 프롬프트 모음이다. 각 단계는 이전 단계 결과를 확인한 뒤 진행한다.

## 공통 시작 프롬프트

```text
docs/PROJECT_STATE.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/NEXT_TASK.md, docs/FAILURES.md, web-genedb-collector/docs/CONFIRMED_REQUIREMENTS.md, web-genedb-collector/docs/IMPLEMENTATION_PLAN.md를 읽고 현재 단계의 구현을 진행하라.

사용자는 분자진단 전문가이다. UI와 문구는 프로그래머용이 아니라 target sequence와 taxid 기반 BLAST hit 수집 흐름으로 구성하라.

분석/설계/코드작성/구현 계획에는 전문가 에이전트를 최대한 활용하라. 단순 질답은 직접 처리하라.

작업 후 변경 파일, 검증 결과, 다음 단계, 문서 갱신 여부를 요약하라.

명백한 보강사항은 직접 반영하되, 사용자 결정이 필요한 항목은 구현하지 말고 별도 표시하라.
```

## Phase 0 프롬프트: 프로젝트 구조 생성

```text
web-genedb-collector에 GitHub Pages 배포 가능한 Vite + TypeScript 정적 웹앱 구조를 생성하라.

필수:
- package.json
- index.html
- vite.config.ts
- src/main.ts
- src/styles.css
- src/config/defaults.ts
- src/domain/types.ts
- src/domain/fasta.ts
- src/domain/filters.ts
- src/domain/outputs.ts
- src/services/blastClient.ts
- src/services/storage.ts
- src/services/zipWriter.ts
- src/workers/blastParser.worker.ts

아직 NCBI 실제 호출은 구현하지 말고, 앱이 로드되고 기본 화면 골격이 표시되는 수준까지 구현하라.

검증:
- npm install
- npm test
- npm run build
- 가능하면 npm run dev 실행 확인
- GitHub Pages base path 문제를 고려

문서:
- GitHub Pages 배포 방식에 맞춰 GITHUB_PAGES_DEPLOYMENT.md의 미정 문구를 보정하라.
```

## Phase 1 프롬프트: UI skeleton

```text
Web GeneDB Collector의 첫 화면 UI를 구현하라.

필수 입력:
- Task name
- Reference DNA sequence
- Taxid
- Database 기본 core_nt
- BLAST mode 기본 megablast
- Max hits 기본 20000, 최대 100000
- Expect 기본 0.05
- Word size 기본 11
- Length filter checkbox + min/max 기본 90~500
- Keyword filter checkbox + 기본 keywords
- Ambiguous N exclude checkbox
- Tool/email

필수 표시:
- sequence length
- 허용되지 않는 문자
- N count
- 빈 서열/짧은 서열/단백질처럼 보이는 입력 경고
- Entrez query preview
- NCBI로 서열이 전송된다는 안내
- 20000 초과 max hits 선택 시 경고
- 100000 근처 max hits 선택 시 강한 경고
- 상태 영역
- 결과 count/다운로드 영역

NCBI 호출은 아직 mock으로 두어도 된다.

검증:
- 입력값 변경 시 preview와 validation이 동작한다.
- 모바일/좁은 화면에서도 입력 영역이 겹치지 않는다.
- UI가 API 설정표가 아니라 `서열 입력 -> taxid 제한 -> 수집 조건 -> RID 대기 -> 결과 검토 -> ZIP 다운로드` 흐름으로 보인다.
```

## Phase 2 프롬프트: NCBI BLAST submit/polling

```text
blastClient.ts에 NCBI BLAST URL API submit/polling 기능을 구현하라.

필수:
- CMD=Put POST 요청
- RID/RTOE parser
- SearchInfo polling
- RID별 최소 60초 polling 간격
- WAITING/READY/FAILED/UNKNOWN/no hit 상태 구분
- CORS/network/timeout 오류 구분
- process log 이벤트 생성
- 상태 머신 구현: idle, submitting, waiting, ready, downloading, parsing, generatingZip, done, failed
- 마지막 확인 시각과 다음 확인 예정 시각 표시용 값 제공

주의:
- API key 저장 금지
- NCBI guideline 위반 polling 금지
- 100000 hit는 보장값이 아니라 요청값으로 표시

검증:
- 작은 query로 RID 발급 확인
- 상태 parser unit test 작성
- BLAST 요청 생성값 unit test 작성
- fake timer로 60초 polling 제한 테스트
- 실제 대기 시간이 긴 경우 수동 테스트 결과를 기록
- `TASK=megablast` 방식과 `MEGABLAST=on` 방식의 RID 발급/응답 차이를 실측 기록
```

## Phase 3 프롬프트: BLAST result download/parser skeleton

```text
READY + hits RID에서 BLAST result download service와 parser skeleton을 구현하라.

우선순위:
1. JSON2_S parser
2. classic XML fallback parser

필수:
- SearchInfo가 READY + ThereAreHits=yes일 때만 result download로 진입
- JSON2_S result download
- JSON2_S download 실패 시 XML fallback
- hit 순회
- 첫 번째 HSP 중심 처리
- Hsp_hseq 우선 추출
- Hsp_qseq fallback
- gap '-' 제거
- accession/title/HSP range/query range/identity/e-value/bit score 등 가능한 provenance 추출
- saved/dropped/ambiguous/unique count 계산
- parser unit test와 synthetic/minimized fixture 추가

FASTA 생성, 필터 적용, ZIP output은 다음 phase에서 완성해도 되지만 parser data structure는 필터 적용을 지원해야 한다.

검증:
- synthetic JSON/XML fixture에서 HSP 구조 추출
- HSP sequence가 없는 hit는 drop
- parsing 오류가 UI로 전달됨
- multiple HSP fixture에서 현재 정책인 첫 번째 HSP 처리가 재현됨
- HSP 전체 record가 아니라 alignment 구간만 추출됨
- 화면/console/log에 전체 query sequence와 raw BLAST result가 표시되지 않음
```

## Phase 4 프롬프트: 필터와 ZIP output

```text
필터와 ZIP output 생성을 구현하라.

필터:
- length filter: query length 대비 min/max percent
- keyword filter: hit definition 기준 case-insensitive
- ambiguous N filter: N 포함 sequence 별도 FASTA로 분리

ZIP output:
- <task>_Aligned.fasta
- <task>_excluded_ambiguous.fasta
- <task>_meta.json
- run_info.json
- process.log

주의:
- 기존 GeneDB 파일명 규칙 유지
- process.log에 전체 sequence를 과도하게 남기지 않음
- process.log에는 sequence length/hash, RID, 요청 파라미터, 필터 설정, 단계별 상태, 오류 요약을 남김
- API key 저장 금지
- ZIP 다운로드 전 결과 검토 화면을 제공

검증:
- 필터별 unit test
- ZIP 안 파일명 확인
- empty ambiguous file 처리 정책 확인
- metadata key와 log redaction snapshot/manifest 테스트
- 결과 0개와 실패 상태를 구분해 표시
- 중복 sequence라도 accession/hit 단위 FASTA record가 보존되는지 확인
- 전체 query sequence와 raw BLAST result가 meta/run_info/process.log/ZIP에 저장되지 않는지 확인
```

## Phase 5 프롬프트: IndexedDB 상태 저장/복구

```text
RID와 작업 상태를 IndexedDB에 저장하고 복구하는 기능을 구현하라.

저장 항목:
- task id
- created at
- RID/RTOE
- query length
- taxid query
- BLAST options
- filter options
- current status
- last polling time
- process logs

필수:
- 새로고침 후 진행 중 작업 목록 표시
- RID가 살아 있으면 재조회 가능
- IndexedDB를 최종 보관소로 표현하지 않음
- raw target/reference sequence는 저장하지 않음

검증:
- 새로고침 후 task 상태 복구
- 저장소가 비어 있을 때 정상 표시
- 저장 실패 시 사용자 메시지
- RID UNKNOWN/만료 시 재제출 안내
```

## Phase 6 프롬프트: GitHub Pages 배포 문서 및 smoke test 계획

```text
GitHub Free public repository + GitHub Pages 배포를 실제 사용자가 따라할 수 있게 보정하고, 로컬 build 및 GitHub Pages URL 기준 smoke test 계획을 작성하라.

필수 검증:
- 로컬 typecheck/test/build/audit
- GitHub Actions workflow 설정 확인
- GitHub Pages Source=GitHub Actions 안내
- public repository에 올릴 폴더가 web-genedb-collector 하나로 제한되는지 확인
- 민감정보/실제 결과 파일 push 방지 체크리스트
- GitHub Pages URL 기준 page load, NCBI submit/RID, polling, ZIP download smoke test 계획
- 20000 hit request 가능 여부 확인
- 100000 input warning 확인
- 브라우저 콘솔 오류 확인 계획
- 회사망과 일반망의 NCBI 호출 차이 기록 양식

문서:
- GITHUB_PAGES_DEPLOYMENT.md를 실제 명령과 repository 구조에 맞춰 보정
- SMOKE_TEST_PLAN.md를 작성하거나 갱신
- docs/NEXT_TASK.md에 다음 단계 반영
- 실패/제약 발견 시 docs/FAILURES.md 갱신
- GitHub Pages 배포 방식을 하나로 확정해 문서에 반영

완료 조건:
- 로컬 build 성공
- 배포 절차 문서 완성
- 가능하면 실제 GitHub Pages URL에서 smoke test 완료
- 실제 분석 sequence/API key/개인정보/회사 내부자료/실제 NCBI full result가 repository에 포함되지 않음
```

## 전문가 검토 요청 프롬프트

### API/Parser 검토

```text
NCBI BLAST URL API submit/polling/result parser 구현을 검토하라. NCBI guideline, CORS, FORMAT_TYPE, HSP sequence extraction, 20000~100000 HITLIST_SIZE 실패 조건, parser fallback 관점에서 빠진 위험을 찾아라. 사용자 결정이 필요한 항목과 즉시 반영해야 할 보강사항을 구분하라.
```

### UI/사용성 검토

```text
분자진단 전문가가 사용하는 Web GeneDB Collector UI를 검토하라. 프로그래머용 parameter UI가 되지 않도록 target sequence, taxid, aligned hit 수집, FASTA 다운로드 흐름이 명확한지 확인하라. 실패 메시지와 경고 문구를 보강하라.
```

### 테스트/배포 검토

```text
GitHub Pages 배포와 테스트 전략을 검토하라. 로컬 build, unit test, parser fixture, manual NCBI test, GitHub Pages smoke test, 문서 갱신 규칙 관점에서 누락된 검증을 찾아라.
```
