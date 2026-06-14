# 확정 요구사항

## 배포

- GitHub Pages를 1차 배포지로 한다.
- 구현 후 GitHub에 올리고 GitHub Pages로 사용하는 방법까지 문서화한다.
- 회사 정책상 프로그램은 막혀 있지만 웹페이지는 막혀 있지 않다.
- GitHub 계정 플랜은 Free다.
- GitHub Free 기준으로 GitHub Pages 배포가 가능한 public repository 설정으로 진행한다.
- repository와 배포 산출물에는 민감 서열, API key, 개인 인증정보를 포함하지 않는다.

## 보안/데이터 전송

- 사용자가 입력한 target/reference DNA 서열을 NCBI BLAST로 전송해도 된다.
- UI에는 NCBI로 서열이 전송된다는 사실을 명확히 표시한다.
- NCBI 서열 전송은 필수 기능이므로 매 실행마다 별도 동의 체크박스를 두지 않는다.

## BLAST 목적

목표는 taxid 검색이 아니다.

```text
입력한 target/reference DNA sequence
-> taxid 안에서만 BLAST
-> alignment된 HSP hit sequence만 추출
-> FASTA로 다운로드
```

## Max hits

- 기본값: `20000`
- UI에서 최대 `100000`까지 조정 가능
- `100000`은 요청값이지 보장값이 아니다.
- NCBI 정책/서버 상태/taxid hit 부족에 따라 결과 수가 적거나 실패할 수 있다.

## Taxid

- 1차 버전은 taxid 직접 입력만 지원한다.
- organism name 검색/자동완성은 1차 범위에서 제외한다.

## Output

ZIP 다운로드를 기본으로 한다.

```text
<task>_Aligned.fasta
<task>_excluded_ambiguous.fasta
<task>_meta.json
run_info.json
process.log
```

- FASTA output은 중복 sequence가 있어도 전체 accession/hit 정보를 보존한다.
- dedup FASTA는 1차 필수 output이 아니다.
- unique count/collapse preview는 분석 보조 정보로만 제공한다.

## 필터

기존 GeneDB 패턴을 기본값으로 유지한다.

- Length filter: on, `90%~500%`
- Keyword exclude: on
- Keywords: `synthetic`, `construct`, `predicted`, `unverified`
- Ambiguous `N` exclude: on

단, 모든 필터는 개별 체크박스와 수치/문자열 입력으로 조정 가능해야 한다.

## PoC test

- Monkeypox 계열 target을 사용해도 된다.
- PoC에는 사용자가 제공하거나 공개 사용 가능한 짧은 Monkeypox 계열 test sequence만 사용한다. 기존 로컬 결과 파일의 실제 query sequence를 repository, 문서, 로그에 옮기지 않는다.

## 편의성 기본 결정

- FASTA header는 기존 GeneDB 수준을 유지한다: description/accession 중심.
- Raw target/reference sequence는 IndexedDB에 저장하지 않는다. 작업 복구에는 query length/hash, RID, 옵션, redacted logs만 사용한다.
- 여러 HSP가 있는 hit는 기존 GeneDB와 맞춰 첫 번째 HSP 중심으로 처리한다.
- GitHub repository 구조와 Pages 배포 방식은 구현 편의성과 안정성을 기준으로 개발자가 결정한다.
- Vite/TypeScript 사용 시 GitHub Actions 배포를 우선 검토한다.
- `tool/email`은 사용자 편의성을 기준으로 기본값을 제공하되, 사용자가 수정 가능하게 한다.
