# Rollback To Stable Commit

작성일: 2026-06-15  
목적: Phase 9A 이후 수정으로 기존에 잘 되던 Web GeneDB Collector 동작이 깨졌을 때, Phase 9A 전 안정 기준으로 되돌리는 명령어를 보관한다.

## 안정 기준

Phase 9A 구현 전 안정 기준 commit:

```text
15f2fe3f9f4b0b73765b6ed5313149df4bb55b8e
```

보관 tag:

```text
stable-before-phase-9a
```

이 기준은 다음 상태를 의미한다.

- Phase 8 SUP12 비교 preset/CLI 반영
- sequence 입력 clear button 반영
- RNA 입력 `U->T` 변환과 GenBank `ORIGIN` 추출 반영
- Phase 9 대용량 안정화 계획 문서 반영
- Phase 9A 코드 구현은 아직 반영 전

## 가장 안전한 복구: 문제 commit만 revert

Phase 9A 이후 특정 commit 하나가 문제라면 이 방식을 우선 사용한다. Git 기록을 지우지 않고, 문제 commit을 취소하는 새 commit을 만든다.

```powershell
git switch main
git pull --ff-only origin main
git log --oneline -5
git revert --no-edit <문제가_된_commit_hash>
git push origin main
```

GitHub Pages는 push 후 GitHub Actions로 다시 배포된다.

배포 확인:

```powershell
gh run list --repo Siun-comp/web-genedb-collector --limit 3
gh run watch <run_id> --repo Siun-comp/web-genedb-collector --exit-status
```

## 안정 기준 commit까지 정확히 되돌리기

Phase 9A 이후 여러 commit이 얽혀 있고, 현재 코드를 Phase 9A 전 안정 기준과 같게 만들려면 아래 방식을 사용한다.

```powershell
git switch main
git pull --ff-only origin main
git log --oneline stable-before-phase-9a..HEAD
git revert --no-edit stable-before-phase-9a..HEAD
git push origin main
```

주의:

- 이 명령은 `stable-before-phase-9a` 이후의 commit들을 되돌리는 새 commit을 만든다.
- conflict가 발생하면 진행을 멈추고 충돌 파일을 확인한 뒤 해결해야 한다.
- 완료 후 `npm test`, `npm run build`, GitHub Pages smoke test를 수행한다.

검증:

```powershell
npm test
npm run build
gh run list --repo Siun-comp/web-genedb-collector --limit 3
```

## 기준 commit을 임시로 확인만 하기

코드를 되돌리지 않고 기준 commit 상태를 확인만 하고 싶다면 detached checkout을 사용한다.

```powershell
git fetch --tags origin
git switch --detach stable-before-phase-9a
npm test
npm run build
git switch main
```

## 최후 수단: 강제 reset

아래 방식은 GitHub 원격 이력을 강제로 바꾼다. 혼자 쓰는 repository라도 이후 commit 기록이 사라질 수 있으므로 기본 복구 방식으로 사용하지 않는다.

```powershell
git switch main
git fetch --tags origin
git reset --hard stable-before-phase-9a
git push --force-with-lease origin main
```

원칙:

- 일반 복구는 `git revert`를 사용한다.
- `git reset --hard`와 force push는 사용자가 명시적으로 허용할 때만 사용한다.
- 실제 분석 sequence, raw BLAST result, API key, 개인정보, 회사 내부자료는 복구 과정에서도 commit하지 않는다.
