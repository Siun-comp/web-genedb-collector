import { BLAST_DEFAULTS } from "../config/defaults";
import { parseKeywords } from "./filters";
import { buildEntrezQuery, summarizeSequence } from "./fasta";
import type { CollectionFormState, ValidationMessage, ValidationResult } from "./types";

const MIN_USEFUL_SEQUENCE_LENGTH = 18;
const LARGE_HIT_WARNING_THRESHOLD = 20000;
const VERY_LARGE_HIT_WARNING_THRESHOLD = 90000;

export function validateCollectionForm(state: CollectionFormState): ValidationResult {
  const messages: ValidationMessage[] = [];
  const sequence = summarizeSequence(state.referenceSequence);
  const taxid = state.taxid.trim();

  if (!state.taskName.trim()) {
    messages.push(error("taskName", "작업 이름이 비어 있습니다.", "ZIP 파일명을 만들 수 있도록 작업 이름을 입력하세요."));
  }

  if (sequence.cleanedLength === 0) {
    messages.push(error("referenceSequence", "target/reference DNA sequence가 비어 있습니다.", "FASTA 또는 raw DNA sequence를 붙여 넣으세요."));
  } else {
    if (sequence.cleanedLength < MIN_USEFUL_SEQUENCE_LENGTH) {
      messages.push(
        warning(
          "referenceSequence",
          `정리된 서열 길이가 ${sequence.cleanedLength} bp입니다.`,
          "너무 짧은 서열은 BLAST hit 수집 결과가 불안정할 수 있습니다. 입력 서열이 target 설계에 충분한 길이인지 확인하세요."
        )
      );
    }
    if (sequence.invalidCharacters.length > 0) {
      messages.push(
        error(
          "referenceSequence",
          `DNA/IUPAC 코드가 아닌 문자가 포함되어 있습니다: ${sequence.invalidCharacters.join(", ")}`,
          "염기서열에는 A, C, G, T, U, N 및 표준 IUPAC ambiguity 코드만 남기세요."
        )
      );
    }
    if (Number.isInteger(state.wordSize) && state.wordSize > 0 && sequence.cleanedLength < state.wordSize) {
      messages.push(
        error(
          "wordSize",
          "서열 길이가 word size보다 짧아 BLAST 요청을 만들 수 없습니다.",
          `정리된 서열은 ${sequence.cleanedLength} bp이고 word size는 ${state.wordSize}입니다. 서열을 늘리거나 word size를 낮추세요.`
        )
      );
    }
    if (sequence.looksProteinLike) {
      messages.push(
        warning(
          "referenceSequence",
          "입력값이 단백질 서열처럼 보입니다.",
          "이 도구는 blastn 기반 DNA 수집기입니다. amino acid sequence가 아니라 DNA sequence인지 확인하세요."
        )
      );
    }
    if (sequence.uCount > 0) {
      messages.push(
        warning("referenceSequence", "U가 포함되어 RNA 서열처럼 보일 수 있습니다.", "DNA BLAST 대상이면 U를 T로 바꿀지 확인하세요.")
      );
    }
    if (sequence.nCount > 0 && state.excludeAmbiguousN) {
      messages.push(
        info("referenceSequence", `입력 서열에 N이 ${sequence.nCount.toLocaleString()}개 있습니다.`, "수집 결과에서는 N 포함 hit를 별도 제외 파일로 분리할 예정입니다.")
      );
    }
  }

  if (!taxid) {
    messages.push(error("taxid", "taxid가 비어 있습니다.", "NCBI Taxonomy ID 숫자를 입력하세요. 예: Monkeypox 계열 taxid 10244"));
  } else if (!/^\d+$/.test(taxid)) {
    messages.push(error("taxid", "taxid는 organism name이 아니라 숫자 ID여야 합니다.", "NCBI Taxonomy에서 확인한 숫자 taxid만 입력하세요."));
  } else if (Number.parseInt(taxid, 10) <= 0) {
    messages.push(error("taxid", "taxid는 1 이상의 숫자여야 합니다.", "NCBI Taxonomy ID를 다시 확인하세요."));
  }

  if (!Number.isInteger(state.maxHits) || state.maxHits < 1 || state.maxHits > BLAST_DEFAULTS.maxHitsLimit) {
    messages.push(
      error("maxHits", `Max hits는 1~${BLAST_DEFAULTS.maxHitsLimit.toLocaleString()} 사이여야 합니다.`, "기본값 20000을 권장하며, 필요할 때만 더 크게 조정하세요.")
    );
  } else if (state.maxHits >= VERY_LARGE_HIT_WARNING_THRESHOLD) {
    messages.push(
      warning(
        "maxHits",
        "Max hits가 100000에 가깝습니다.",
        "이는 NCBI에 보내는 요청값이지 보장값이 아닙니다. 대기 시간이 길어지거나 NCBI에서 실패할 수 있습니다."
      )
    );
  } else if (state.maxHits > LARGE_HIT_WARNING_THRESHOLD) {
    messages.push(
      warning(
        "maxHits",
        "Max hits가 기본값 20000을 초과합니다.",
        "NCBI 웹의 5000 hit 화면 제한보다 크게 요청할 수 있지만, 서버 상태와 query 조건에 따라 실제 수집량은 달라집니다."
      )
    );
  }

  if (!Number.isFinite(state.expect) || state.expect <= 0) {
    messages.push(error("expect", "Expect 값은 0보다 큰 숫자여야 합니다.", "기본값 0.05를 권장합니다."));
  }

  if (!Number.isInteger(state.wordSize) || state.wordSize < 1) {
    messages.push(error("wordSize", "Word size는 1 이상의 정수여야 합니다.", "megablast 기본 설정에서는 11을 권장합니다."));
  }

  if (state.lengthFilterEnabled) {
    if (!Number.isFinite(state.minLengthPercent) || !Number.isFinite(state.maxLengthPercent)) {
      messages.push(error("lengthFilter", "Length filter 값은 숫자여야 합니다.", "기본값 90%~500%를 권장합니다."));
    } else if (state.minLengthPercent < 0 || state.maxLengthPercent < 0) {
      messages.push(error("lengthFilter", "Length filter에는 음수를 사용할 수 없습니다.", "0 이상의 percent 값을 입력하세요."));
    } else if (state.minLengthPercent > state.maxLengthPercent) {
      messages.push(error("lengthFilter", "Min length %가 Max length %보다 큽니다.", "예: 90%~500%처럼 최소값이 최대값보다 작게 설정하세요."));
    }
  }

  if (state.keywordFilterEnabled && parseKeywords(state.keywords).length === 0) {
    messages.push(warning("keywords", "Keyword exclude가 켜져 있지만 keyword가 비어 있습니다.", "synthetic, construct, predicted, unverified 같은 제외어를 입력하거나 옵션을 끄세요."));
  }

  if (!state.tool.trim()) {
    messages.push(error("tool", "NCBI tool 이름이 비어 있습니다.", "기본값 WebGeneDBCollector를 사용하세요."));
  }

  if (state.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email.trim())) {
    messages.push(warning("email", "Email 형식이 일반적이지 않습니다.", "NCBI 권장 파라미터입니다. 비워 두거나 올바른 email 형식으로 입력하세요."));
  }

  const errors = messages.filter((message) => message.severity === "error");
  const warnings = messages.filter((message) => message.severity === "warning");
  const infos = messages.filter((message) => message.severity === "info");

  return {
    canSubmit: errors.length === 0,
    errors,
    warnings,
    infos,
    messages,
    sequenceSummary: sequence,
    entrezQuery: buildEntrezQuery(state.taxid)
  };
}

function error(field: string, message: string, action: string): ValidationMessage {
  return { field, severity: "error", message, action };
}

function warning(field: string, message: string, action: string): ValidationMessage {
  return { field, severity: "warning", message, action };
}

function info(field: string, message: string, action: string): ValidationMessage {
  return { field, severity: "info", message, action };
}
