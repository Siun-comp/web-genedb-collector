import type { CollectionStatus, ValidationResult } from "./types";

export function buildCollectionStatus(validation: ValidationResult): CollectionStatus {
  if (validation.errors.length > 0) {
    return {
      status: "blocked_invalid_input",
      title: "입력 수정 필요",
      detail: `${validation.errors.length}개 항목 때문에 아직 BLAST 제출 준비가 되지 않았습니다.`,
      nextAction: "빨간 오류 항목을 먼저 수정하세요."
    };
  }

  if (validation.warnings.length > 0) {
    return {
      status: "ready_to_submit",
      title: "제출 가능, 경고 확인 필요",
      detail: "필수 입력은 충족했습니다. 다만 결과량, 서열 성격, 필터 조건을 한 번 더 확인하는 것이 좋습니다.",
      nextAction: "경고를 검토한 뒤 Phase 2에서 NCBI 제출 기능을 연결합니다."
    };
  }

  return {
    status: "ready_to_submit",
    title: "제출 준비 완료",
    detail: "필수 입력과 기본 수집 조건이 BLAST 제출 가능한 상태입니다.",
    nextAction: "Phase 2에서 실제 NCBI BLAST submit과 RID polling을 연결합니다."
  };
}
