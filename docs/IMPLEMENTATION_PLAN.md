# Web GeneDB Collector 구현 상세계획서

작성일: 2026-06-14  
대상: `web-genedb-collector`  
배포 목표: GitHub Pages  
구현 목표: 서버 없는 웹 기반 NCBI BLAST API GeneDB 수집기

## 1. 목표 정의

이 프로젝트는 기존 SUP12 전체를 웹으로 옮기는 작업이 아니다. 목표는 GeneDB의 핵심 기능만 분리한 웹 수집기다.

```text
사용자가 target/reference DNA sequence 입력
-> taxid 직접 입력
-> NCBI BLAST URL API 실행
-> 지정 taxid 안에서 alignment된 HSP hit sequence 추출
-> 필터 적용
-> FASTA/metadata/log ZIP 다운로드
```

이 도구는 Entrez 검색기가 아니다. taxid 안의 전체 FASTA를 다운로드하는 도구도 아니다. 사용자가 입력한 target sequence와 실제로 BLAST alignment된 구간만 수집한다.

## 2. 확정 요구사항

| 항목 | 확정값 |
| --- | --- |
| 배포 | GitHub Pages |
| 서버 | 없음 |
| 로컬 helper | 없음 |
| local BLAST DB | 없음 |
| NCBI sequence 전송 | 허용 |
| taxid 입력 | taxid 숫자 직접 입력 |
| 기본 database | `core_nt` |
| 기본 BLAST mode | `megablast` |
| 기본 max hits | `20000` |
| max hits UI 최대값 | `100000` |
| 기본 expect | `0.05` |
| 기본 word size | `11` |
| 기본 length filter | on, `90%~500%` |
| 기본 keyword exclude | on |
| 기본 keywords | `synthetic`, `construct`, `predicted`, `unverified` |
| 기본 ambiguous filter | `N` exclude on |
| output | ZIP |
| PoC target | Monkeypox F3L 또는 G2R |
| GitHub plan | Free |
| repository visibility | public repo for GitHub Pages |

## 3. 구현 원칙

1. 분자진단 전문가가 사용하는 화면으로 만든다.
2. API parameter 중심 화면이 아니라 target 수집 workflow 중심 화면으로 만든다.
3. NCBI 요청은 브라우저에서 직접 수행한다.
4. NCBI RID polling은 RID별 60초보다 자주 하지 않는다.
5. 대용량 BLAST 결과 parsing은 Web Worker에서 수행한다.
6. output 파일명은 기존 GeneDB 호환 규칙을 유지한다.
7. `100000` hit는 요청 가능값이지 성공 보장값으로 표현하지 않는다.
8. 구현 중 중요한 결정은 코드에만 두지 않고 문서에 남긴다.
9. 분석/설계/코드작성/계획에는 전문가 에이전트 또는 독립 검증을 활용한다.

## 4. 권장 기술 구조

1차 구현은 Vite + TypeScript 기반 정적 앱을 권장한다.

```text
web-genedb-collector/
  package.json
  index.html
  vite.config.ts
  src/
    main.ts
    styles.css
    config/
      defaults.ts
    domain/
      types.ts
      fasta.ts
      filters.ts
      outputs.ts
    services/
      blastClient.ts
      storage.ts
      zipWriter.ts
    workers/
      blastParser.worker.ts
    test/
      fixtures/
      parser.test.ts
  docs/
    CONFIRMED_REQUIREMENTS.md
    GITHUB_PAGES_DEPLOYMENT.md
    SMOKE_TEST_PLAN.md
    IMPLEMENTATION_PLAN.md
    STEP_PROMPTS.md
```

## 5. 화면 구성

### 5.1 첫 화면

첫 화면은 바로 수집 작업 화면이어야 한다. landing page나 홍보 페이지는 만들지 않는다.

UI는 "BLAST API 설정 화면"이 아니라 "reference hit 수집 절차"로 보여야 한다.

권장 절차:

```text
1. 서열 입력
2. taxid 제한
3. 수집 조건 확인
4. NCBI 제출/RID 대기
5. 결과 검토
6. ZIP 다운로드
```

필수 영역:

1. Target 입력
   - Task name
   - Reference DNA sequence textarea
   - FASTA/raw input accepted in the browser only; raw query sequence must not be committed, logged, or stored in IndexedDB.
   - 공백/줄번호 제거
   - sequence length 표시
   - `N` 포함 수 표시
   - 허용되지 않는 문자 표시
   - 빈 서열/너무 짧은 서열/단백질처럼 보이는 입력 경고
   - FASTA header 자동 보정 안내

2. Taxid 입력
   - Include taxid
   - 선택: exclude taxid
   - Entrez query preview
   - "Organism name이 아니라 NCBI Taxonomy ID 숫자를 입력하세요." 안내
   - NCBI Taxonomy 검색 링크 제공

3. BLAST 설정
   - 기본값은 접힌 "고급 설정"에 둔다.
   - database: `core_nt`
   - BLAST mode: `megablast`
   - max hits: 기본 `20000`, 최대 `100000`
   - expect: `0.05`
   - word size: `11`
   - tool/email

4. 필터 설정
   - length filter checkbox + min/max percent
   - keyword exclude checkbox + keyword input
   - ambiguous N exclude checkbox

5. 실행/상태
   - Submit BLAST
   - RID
   - RTOE
   - polling status
   - elapsed time
   - 마지막 확인 시각
   - 다음 확인 예정 시각
   - current step
   - abort button
   - "새로 제출하지 말고 기다리세요" 안내

6. 결과
   - saved count
   - dropped count
   - ambiguous count
   - unique sequence count
   - length 제외 수
   - keyword 제외 수
   - 최단/최장 sequence length
   - FASTA preview
   - 생성될 파일명 목록
   - ZIP download

### 5.2 사용자 문구 원칙

- "이 서열은 NCBI BLAST로 전송됩니다."를 실행 전 명확히 표시한다.
- NCBI 서열 전송은 필수 기능이므로 별도 동의 체크박스는 만들지 않는다.
- `max hits`가 20000을 넘으면 NCBI 제한 가능성을 표시한다.
- `100000` 근처 값은 장시간 대기/실패 가능성 높음/보장 아님을 강하게 표시한다.
- 실패 시 사용자가 확인할 항목을 함께 표시한다.
- "검색"보다 "BLAST 수집" 또는 "aligned hit 수집"이라는 표현을 우선 사용한다.

실행 전 안내 예시:

```text
입력한 target/reference DNA 서열은 NCBI BLAST로 전송됩니다.
결과 ZIP과 process.log에는 전체 입력 서열을 과도하게 저장하지 않습니다.
```

실패 메시지는 항상 "원인 + 사용자가 할 일" 구조로 표시한다.

예시:

- CORS/Network: 회사망 또는 브라우저에서 NCBI 요청이 차단되었을 수 있습니다. NCBI BLAST 접속 가능 여부를 확인하세요.
- WAITING 장기화: NCBI 서버가 아직 처리 중입니다. RID를 보관하고 나중에 재조회할 수 있습니다.
- UNKNOWN/만료: RID가 만료되었거나 NCBI에서 찾을 수 없습니다. 같은 조건으로 다시 제출해야 합니다.
- Parsing 실패: NCBI 응답 형식이 예상과 다릅니다. `process.log`와 `run_info.json`을 보관하세요.
- ZIP 실패: 브라우저 메모리 또는 다운로드 권한 문제일 수 있습니다. hit 수를 낮춰 재시도하세요.

### 5.3 결과 검토 화면

ZIP 다운로드 전 결과 검토 화면을 표시한다.

최소 표시 항목:

- target length
- taxid
- RID
- requested max hits
- total hit/HSP count
- saved count
- dropped count
- ambiguous excluded count
- length excluded count
- keyword excluded count
- unique sequence count
- shortest/longest sequence length
- FASTA preview 첫 3~10개
- 생성될 파일명 목록

결과가 0개이면 실패와 구분해 표시한다.

```text
정상적으로 실행되었지만 조건에 맞는 aligned HSP가 없습니다.
taxid, target 서열, expect, max hits, length filter를 확인하세요.
```

## 6. NCBI BLAST API 설계

### 6.1 Submit

기본 요청:

```text
POST https://blast.ncbi.nlm.nih.gov/Blast.cgi

CMD=Put
PROGRAM=blastn
DATABASE=core_nt
TASK=megablast
QUERY=<FASTA>
ENTREZ_QUERY=(txidXXXX[ORGN])
HITLIST_SIZE=20000
EXPECT=0.05
WORD_SIZE=11
tool=WebGeneDBCollector
email=<user input or blank>
```

실측 검증 항목:

- 기존 GeneDB 호환 요청: `TASK=megablast`, `WORD_SIZE=11`
- NCBI Common URL API 문서형 요청: `MEGABLAST=on`
- 두 방식의 RID 발급 여부와 결과 차이

1차 구현 기본값은 기존 GeneDB 호환 요청으로 둔다. 단, PoC에서 `MEGABLAST=on` 방식과의 차이를 기록한다.

응답에서 추출:

- `RID`
- `RTOE`

### 6.2 Polling

```text
GET Blast.cgi?CMD=Get&RID=<RID>&FORMAT_OBJECT=SearchInfo
```

규칙:

- 첫 polling은 RTOE 이후 수행한다.
- 이후 같은 RID는 최소 60초 간격을 지킨다.
- WAITING이면 계속 대기한다.
- READY + ThereAreHits=yes이면 결과 다운로드로 이동한다.
- READY + ThereAreHits=no이면 "hit 없음"으로 종료한다.
- FAILED, UNKNOWN은 별도 오류로 표시한다.

상태 머신:

```text
idle
-> submitting
-> waiting
-> ready
-> downloading
-> parsing
-> generatingZip
-> done
```

실패 상태:

```text
failed_network
failed_cors
failed_ncbi
failed_unknown_rid
failed_timeout
failed_parse
failed_zip
```

사용자 중단은 NCBI 작업 취소가 아니라 브라우저 polling 중단으로 취급한다.

### 6.3 Result download

1차 우선순위:

1. `FORMAT_TYPE=JSON2_S`
2. classic `FORMAT_TYPE=XML` fallback

`JSON2`/`XML2`는 zip 응답이므로 1차 PoC에서는 필수로 삼지 않는다. 단, 추후 zip 해제 로직을 붙일 수 있게 구조를 열어둔다.

## 7. Parser 설계

Parser는 Web Worker에서 수행한다.

입력:

- BLAST result text 또는 JSON
- query length
- filter options
- output options

처리:

1. hit 목록 순회
2. 첫 번째 HSP 중심 추출
3. `Hsp_hseq` 우선 사용
4. 없으면 `Hsp_qseq` fallback
5. gap `-` 제거
6. hit definition/header 생성
7. keyword filter
8. length filter
9. ambiguous `N` filter
10. saved/dropped/ambiguous/unique count 계산

FASTA header/meta provenance:

- accession
- hit title/definition
- HSP hit range
- HSP query range
- strand/orientation 정보가 있으면 포함
- identity/align length/e-value/bit score가 있으면 meta에 포함

기본 FASTA header는 기존 GeneDB 호환성을 우선한다. 형식은 description/accession 중심으로 유지한다. 검수용 상세 정보는 `_meta.json`에 더 풍부하게 남긴다.

출력:

```ts
{
  alignedFasta: string;
  ambiguousFasta: string;
  savedCount: number;
  droppedCount: number;
  ambiguousCount: number;
  uniqueCount: number;
  lengthDroppedCount: number;
  keywordDroppedCount: number;
  minLength: number;
  maxLength: number;
  logs: string[];
}
```

## 8. Output 설계

ZIP 내부 파일:

```text
<task>_Aligned.fasta
<task>_excluded_ambiguous.fasta
<task>_meta.json
run_info.json
process.log
```

`_meta.json` 필수 항목:

- task id
- created at
- query length
- query hash
- taxid query
- BLAST options
- filter options
- RID
- output counts
- app version

`run_info.json` 필수 항목:

- TaskID
- Date
- RID
- Options
- Counts
- NCBI request summary

`process.log` 필수 항목:

- submit time
- RID/RTOE
- polling events
- last checked time
- next check time
- download format
- parse summary
- filter summary
- errors if any
- sequence length
- sequence hash

주의:

- 전체 sequence를 process.log에 과도하게 남기지 않는다.
- API key는 저장하지 않는다.

## 9. IndexedDB 상태 저장

저장 항목:

- task id
- created at
- RID
- RTOE
- query length
- taxid query
- BLAST options
- filter options
- status
- last polling time
- logs

Raw target/reference sequence는 사용자가 입력한 target 원문 서열을 의미한다. Phase 5 구현 기준에서는 IndexedDB에 raw sequence를 저장하지 않는다. 작업 복구에는 query length/hash, RID, BLAST/filter 옵션, redacted logs, count summary만 사용한다.

목적:

- 브라우저를 닫았다가 다시 열었을 때 RID 재조회 지원
- 진행 중 작업 확인

주의:

- IndexedDB는 최종 보관소가 아니다.
- 최종 보관 단위는 사용자가 받은 ZIP 파일이다.

## 10. 구현 단계

### Phase 0. 준비

- 기준 문서 확인
- package manager 선택
- Vite + TypeScript scaffold
- GitHub Pages base path 설정

완료 기준:

- 로컬 dev server 실행
- 빈 앱이 표시됨

### Phase 1. UI skeleton

- 입력 화면 구현
- 기본값 반영
- taxid query preview
- validation
- 상태/결과 영역 구현

완료 기준:

- 사용자가 sequence, taxid, max hits, filter를 입력/조정할 수 있음

### Phase 2. BLAST submit/polling

- `blastClient.ts` 구현
- `CMD=Put` 제출
- RID/RTOE parsing
- guideline 기반 polling
- 오류 상태 구분

완료 기준:

- 작은 test query로 RID 발급
- READY/FAILED/UNKNOWN 상태 표시

### Phase 3. Result download/parser skeleton

- `JSON2_S` result download 검증
- READY + hits 상태에서만 result download 진입
- JSON2_S download 실패 시 XML fallback
- HSP sequence extraction skeleton 구현
- XML fallback parser 구현
- synthetic/minimized fixture test 추가

완료 기준:

- JSON2_S/XML result download service가 QUERY 없이 동작
- parser skeleton이 첫 번째 HSP, hseq 우선, qseq fallback, gap 제거를 검증
- saved/dropped/unique/min/max count 구조가 준비됨
- 실제 FASTA/ZIP 생성은 Phase 4에서 완성

### Phase 4. Filters/output

- length filter
- keyword filter
- ambiguous N filter
- meta/run_info/process.log 생성
- ZIP 다운로드
- query sequence/raw BLAST result redaction
- duplicate sequence dedup 금지 및 unique count 참고값 제공

완료 기준:

- 기존 GeneDB 호환 파일명이 ZIP에 포함됨
- aligned HSP FASTA와 ambiguous N FASTA가 생성됨
- metadata에 provenance가 포함됨
- process.log에는 query length/hash와 count만 남고 전체 query sequence/raw BLAST result는 남지 않음

### Phase 5. Persistence/recovery

- IndexedDB 저장
- RID 재조회 화면
- 진행 중 작업 복구

완료 기준:

- 새로고침 후 RID/status 확인 가능

### Phase 6. GitHub Pages 배포

- build 설정
- GitHub Pages 배포 문서 보정
- 배포 URL에서 실제 실행 검증

완료 기준:

- GitHub Pages URL에서 앱 로드
- NCBI 요청/RID polling/ZIP download 확인

## 11. 테스트 전략

### Unit tests

- FASTA cleaning
- sequence validation
- taxid query builder
- BLAST request builder
- response RID/RTOE parser
- SearchInfo status parser
- HSP parser
- filters
- output metadata builder
- ZIP manifest/file-name builder
- IndexedDB storage wrapper

### Fixture tests

- small JSON2_S result
- classic XML result
- no hit result
- ambiguous N result
- keyword drop result
- length drop result
- multiple HSP result
- missing Hsp_hseq fallback result
- gap removal result

Fixture 규칙:

- 한 번 성공한 BLAST 응답은 sample fixture로 보관한다.
- parser 변경 때마다 fixture 기반 회귀 테스트를 실행한다.
- ZIP output은 파일명, metadata key, log redaction을 snapshot 또는 manifest 테스트로 검증한다.

### API behavior tests

- `CMD=Put` 요청 생성값 검증
- `PROGRAM=blastn`
- `DATABASE=core_nt`
- `TASK=megablast`
- `HITLIST_SIZE=20000`
- `EXPECT=0.05`
- `WORD_SIZE=11`
- `ENTREZ_QUERY=(txidXXXX[ORGN])`
- RID/RTOE parsing
- fake timer 기반 60초 polling interval
- `FAILED`, `UNKNOWN`, timeout, network error, CORS error 메시지 분리
- `HITLIST_SIZE=100000` 입력 가능 + 경고 표시 + 실패 처리

### Manual tests

- small hit query
- Monkeypox F3L/G2R 20000 request
- max hits 100000 input validation
- network failure simulation
- CORS failure message path
- GitHub Pages deployed URL test
- 회사망과 일반망의 NCBI 호출 차이 기록

### GitHub Pages acceptance tests

로컬 개발 서버 통과만으로 완료 처리하지 않는다. 실제 GitHub Pages URL에서 최소 1회 다음을 확인한다.

- page load
- NCBI `CMD=Put`
- RID issued
- READY 또는 실패 상태 명확 표시
- result parsing
- ZIP download
- browser console error 없음

## 12. 문서 갱신 규칙

구현 중 아래가 바뀌면 즉시 문서를 갱신한다.

- 요구사항 변경: `docs/PROJECT_STATE.md`
- 절대 규칙 변경: `docs/ARCHITECTURE.md`
- 결정 이유 추가: `docs/DECISIONS.md`
- 다음 작업 변경: `docs/NEXT_TASK.md`
- 금지 패턴 발견: `docs/FAILURES.md`
- 배포 절차 변경: `web-genedb-collector/docs/GITHUB_PAGES_DEPLOYMENT.md`

## 13. 다각도 검토 반영 내역

이 계획서는 세 관점의 독립 검토를 반영했다.

### 13.1 NCBI API/Parser/상태관리 검토

반영한 항목:

- NCBI `CMD=Put`, `CMD=Get`, RID/RTOE, SearchInfo 상태 구분 명시
- RID별 60초 이상 polling 규칙 명시
- `TASK=megablast`와 `MEGABLAST=on` 실측 비교 항목 추가
- `JSON2_S` 우선, classic `XML` fallback, `JSON2/XML2` zip 응답 주의 추가
- 상태 머신과 실패 상태 분리 추가
- IndexedDB는 복구 보조 수단이며 최종 보관은 ZIP이라는 원칙 추가
- raw sequence IndexedDB 저장은 기본적으로 하지 않는 정책 추가

### 13.2 UI/분자진단 사용자 관점 검토

반영한 항목:

- API 설정표가 아니라 `서열 입력 -> taxid 제한 -> 수집 조건 -> RID 대기 -> 결과 검토 -> ZIP 다운로드` 흐름으로 재정의
- sequence validation, length, `N` count, 허용되지 않는 문자 표시 추가
- NCBI 서열 전송 고지 추가
- max hits 값별 경고 수준 추가
- RID/RTOE/마지막 확인/다음 확인 시각 표시 추가
- 결과 검토 화면과 FASTA preview 추가
- 실패 메시지를 "원인 + 사용자가 할 일" 구조로 정의

### 13.3 테스트/배포 검토

반영한 항목:

- module unit test 범위 확장
- BLAST fixture 기반 parser 회귀 테스트 추가
- ZIP manifest/log redaction test 추가
- fake timer 기반 60초 polling test 추가
- GitHub Pages 실제 URL acceptance test 추가
- 회사망/일반망 NCBI 호출 차이 기록 추가
- 배포 방식은 구현 후 하나로 확정해 문서에 반영하도록 명시

## 14. 사용자 결정 필요 항목

현재 확정 요구사항 기준으로 PoC 구현을 막는 사용자 결정 항목은 없다.

확정된 진행값:

- NCBI 서열 전송 동의: 별도 체크박스 없음, 안내 문구만 표시
- FASTA header: 기존 GeneDB 수준 유지, description/accession 중심
- dedup FASTA: 1차 output에는 넣지 않음. 중복이어도 전체 accession/hit 정보를 보존한다.
- raw target/reference sequence IndexedDB 저장 금지: 작업 복구에는 query length/hash와 RID/옵션만 사용
- 여러 HSP 정책: 중요도 낮음. 기존 GeneDB 호환을 위해 첫 번째 HSP 우선
- repository 구조: 구현 편의성과 안정성을 기준으로 개발자가 결정
- GitHub Pages 방식: Vite 사용 시 GitHub Actions 우선
- repository visibility: GitHub Free 기준 public repository
- tool/email: 편의성을 기준으로 기본값 제공, 사용자가 수정 가능
- exclude taxid: advanced 영역
- 100000: 입력 가능, 20000 초과 시 경고 표시

남은 운영 확인사항:

1. 실제 GitHub 업로드 위치
   - 별도 repo를 만들지, 현재 repo 하위 폴더를 Actions로 배포할지는 구현 후 편의성 기준으로 확정한다.

2. Public repository 노출 관리
   - GitHub Free 기준 Pages 배포를 위해 public repository를 사용한다.
   - repository에는 사용자의 실제 분석 sequence, API key, 개인정보, 회사 내부자료를 포함하지 않는다.
