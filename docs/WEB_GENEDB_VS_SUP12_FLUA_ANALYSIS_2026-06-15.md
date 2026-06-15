# Web GeneDB vs SUP12 FluA 재실행 분석 보고서

작성일: 2026-06-15  
대상 결과: `result competition/FluA_M_Collection.zip`  
비교 대상: `result competition/(SUP12) InfluenzaA_M_DB`  
보안 원칙: 원본 query sequence와 raw BLAST result는 문서에 포함하지 않는다. 비교는 RID, hash, length, count, 옵션 요약만 사용한다.

## 1. 결론 요약

새 Web GeneDB 결과가 SUP12보다 더 많은 FASTA record를 만든 주된 이유는 다음 3가지가 겹쳤기 때문이다.

1. 이번 Web GeneDB 실행은 `maxHits=100000`으로 요청했고, SUP12 비교 결과는 `max_hits=50000`이었다.
2. Phase 7 수정 이후 Web GeneDB parser가 대용량 XML의 불완전한 끝부분 때문에 전체 결과를 버리지 않고, 완성된 `<Hit>...</Hit>` block만 회수하도록 바뀌었다.
3. NCBI BLAST 결과는 RID, 실행 시각, 요청값, 서버 응답 상태에 따라 반환 hit 수와 순서가 달라질 수 있다.

따라서 이번 결과는 "Web GeneDB가 SUP12보다 항상 더 완전하다"는 의미가 아니다. 다만 이전의 `aligned=0` 문제는 해결되었고, 현재 Web GeneDB는 브라우저 환경에서도 대용량 BLAST XML에서 상당수의 aligned HSP FASTA를 회수할 수 있음을 확인했다.

## 2. 실행 조건 비교

| 항목 | SUP12 | Web GeneDB 새 실행 |
| --- | ---: | ---: |
| RID | `2ZH0UETR016` | `2ZRUUVYW016` |
| DB | `core_nt` | `core_nt` |
| BLAST task | `megablast` | `megablast` |
| taxid | `11320` | `11320` |
| query length | 1027 bp | 1027 bp |
| max hits 요청값 | 50000 | 100000 |
| expect | 0.05 | 0.05 |
| word size | 11 | 11 |
| length filter | 80%~500% | 90%~500% |
| ambiguous N 처리 | 별도 제외 FASTA | 별도 제외 FASTA |
| API key | 사용됨 | 사용 안 함 |
| 결과 형식 | SUP12 내부 처리 | JSON2_S 실패 후 XML fallback |

중요한 차이는 `max hits`와 `length filter`다. `maxHits=100000`은 더 많은 후보를 요청하므로 Web 결과가 늘어날 수 있다. 반대로 Web의 length filter 90%는 SUP12의 80%보다 엄격하므로, 이 조건만 보면 Web 결과를 줄이는 방향이다.

## 3. 산출물 count 비교

| 항목 | SUP12 | Web GeneDB |
| --- | ---: | ---: |
| aligned FASTA records | 32372 | 33778 |
| ambiguous FASTA records | 193 | 196 |
| aligned unique sequence hashes | 32292 | 33694 |
| ambiguous unique sequence hashes | 192 | 195 |
| aligned min length | 847 bp | 924 bp |
| aligned max length | 1029 bp | 1029 bp |
| aligned avg length | 999.35 bp | 999.74 bp |

Sequence hash 기준 aligned unique 비교:

| 비교 | count |
| --- | ---: |
| 양쪽 공통 aligned unique sequence | 32113 |
| Web에만 있는 aligned unique sequence | 1581 |
| SUP12에만 있는 aligned unique sequence | 179 |

Ambiguous unique 비교:

| 비교 | count |
| --- | ---: |
| 양쪽 공통 ambiguous unique sequence | 190 |
| Web에만 있는 ambiguous unique sequence | 5 |
| SUP12에만 있는 ambiguous unique sequence | 2 |

해석:

- Web은 SUP12 결과 대부분을 포함하면서 추가 aligned sequence를 더 회수했다.
- 동시에 SUP12에만 있는 sequence도 소량 존재한다. 따라서 두 결과는 완전한 포함 관계가 아니라, 서로 다른 RID/조건에서 나온 겹치는 결과 집합이다.
- Web 결과의 추가분은 `maxHits=100000` 요청과 parser 회수 개선의 영향이 크다.

## 4. Web GeneDB 로그 해석

새 Web 로그 핵심:

```text
Submit started. query=fnv1a32:dce1038f, length=1027 bp, taxid=11320, maxHits=100000
RID issued. rid=2ZRUUVYW016, rtoe=30s
SearchInfo WAITING ...
SearchInfo READY ...
JSON2_S fallback reason: failed_network ...
Result downloaded and output prepared. format=XML, responseLength=142995608, aligned=33778, ambiguous=196, dropped=147
ZIP generated. bytes=6645997
```

### 4.1 JSON2_S fallback의 의미

`JSON2_S fallback reason: failed_network`는 전체 작업 실패가 아니다.

현재 코드는 JSON2_S 결과를 먼저 내려받고, 실패하면 XML로 다시 시도한다. 이번 실행에서는 JSON2_S 다운로드가 브라우저 fetch 단계에서 실패했고, XML 다운로드가 성공했다. 따라서 최종 ZIP은 XML 결과를 기반으로 생성되었다.

가능한 원인:

- JSON2_S 결과가 매우 커서 브라우저 fetch 또는 네트워크 계층에서 중단됨
- 회사망/브라우저 보안 정책이 큰 응답 또는 특정 응답 형식을 불안정하게 처리함
- CORS 또는 네트워크 오류처럼 보이는 fetch 실패가 발생함

현 코드의 `failed_network` 문구는 넓은 범주의 오류명이다. 이 경우에는 "JSON2_S 대용량 다운로드 실패, XML fallback 성공"으로 해석하는 것이 맞다.

### 4.2 XML partial tail의 의미

이번 결과의 parser 진단:

```text
completeHitBlocksSeen=34121
partialXmlTail=true
warning=XML response did not include closing </BlastOutput>; parsed complete Hit blocks only.
```

이는 XML 파일 끝에 정상 종료 태그가 없었다는 뜻이다. 브라우저가 받은 XML은 약 143 MB였고, 완전한 `<Hit>` block 34121개가 포함되어 있었다. Phase 7 이전 parser는 이런 XML을 전체 실패로 처리해 `aligned=0`이 될 수 있었다. 현재 parser는 완성된 Hit block만 안전하게 회수한다.

해석상 주의:

- `partialXmlTail=true`이므로 "NCBI가 100000개를 완전히 내려줬다"는 뜻은 아니다.
- 실제 회수 가능한 완성 Hit block은 34121개였다.
- 그중 length/keyword/ambiguous 처리 후 aligned 33778개, ambiguous 196개, length dropped 147개가 되었다.

## 5. 왜 이전 Web 실행은 aligned=0이었나

이전 Web 실행은 XML responseLength가 약 139 MB였지만, parser가 XML 전체를 하나의 완전한 문서로 파싱하려 했다. NCBI 응답의 끝부분이 불완전하면 XML 문서 파싱이 실패하고 결과 전체가 drop되었다.

현재 수정된 구조:

```text
대용량 XML 수신
-> 완전한 <Hit>...</Hit> block 단위로 분리
-> 각 block만 parser에 전달
-> 불완전한 tail은 버림
-> parserDiagnostics에 partialXmlTail=true 기록
```

따라서 새 실행에서 `aligned=33778`로 회수된 것은 parser 수정의 직접 효과다.

## 6. SUP12보다 더 많이 나온 원인

가장 큰 원인은 동일 조건 비교가 아니었다는 점이다.

1. SUP12는 `max_hits=50000`, Web은 `maxHits=100000`이었다.
2. Web은 GET result 단계에서도 `HITLIST_SIZE=100000`을 다시 전달한다.
3. NCBI는 동일 query/taxid라도 RID가 다르면 결과 순서와 반환량이 달라질 수 있다.
4. Web parser는 불완전 XML에서도 complete Hit block을 회수한다.

단, Web length filter는 90%라서 SUP12 80%보다 엄격하다. 따라서 Web이 더 많이 나온 것은 length filter가 느슨해서가 아니다.

## 7. 아직 남은 한계

1. `maxHits=100000`은 요청값이지 보장값이 아니다.
2. 이번 XML도 `partialXmlTail=true`였으므로, 결과는 "받은 XML 안의 완성 Hit block 기준"이다.
3. JSON2_S 대용량 다운로드 실패는 계속 발생할 수 있다.
4. `meta.json`은 33778개 record provenance를 담아 37 MB 이상이 되었다. 더 큰 결과에서는 브라우저 메모리 부담이 커질 수 있다.
5. SUP12와 완전 동일 비교를 하려면 Web도 `maxHits=50000`, length filter 80%로 재실행해야 한다.

## 8. 권장 후속 작업

1. Web에 `SUP12 compatibility preset`을 추가한다.
   - `maxHits=50000`
   - length filter 80%~500%
   - keyword/ambiguous 조건은 SUP12와 동일
2. 결과 비교 도구를 추가한다.
   - aligned/ambiguous FASTA record count
   - unique sequence hash count
   - common / Web-only / SUP12-only count
   - accession 중심 diff는 별도 단계로 검토
3. JSON2_S 실패 메시지를 개선한다.
   - 현재: `failed_network`
   - 권장 표시: `JSON2_S 대용량 다운로드 실패, XML fallback 성공`
4. `partialXmlTail=true`가 있을 때 UI와 log에 "완성 Hit block만 회수됨"을 명확히 표시한다.
5. `meta.json` 대용량 문제를 줄이기 위해 summary meta와 full provenance meta 분리 옵션을 검토한다.

## 9. 사용자가 이해해야 할 핵심

이번 새 결과는 실패가 아니라 성공에 가깝다. 다만 100000개를 요청했다고 100000개 전체를 받은 것은 아니다. NCBI가 브라우저에 내려준 대용량 XML 중 완성된 Hit block을 최대한 회수했고, 그 결과가 SUP12 50000 조건 결과보다 많게 나온 것이다.

정확한 성능 비교를 하려면 조건을 맞춰야 한다. 현재 비교는 `SUP12 50000 조건`과 `Web 100000 조건`의 비교이므로, Web이 더 많은 것은 자연스러운 결과다.
