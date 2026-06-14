import type { ParserSummary } from "../domain/types";

export interface ParserWorkerRequest {
  type: "parse-placeholder";
}

export interface ParserWorkerResponse {
  type: "parse-placeholder-result";
  summary: ParserSummary;
}

self.onmessage = (event: MessageEvent<ParserWorkerRequest>) => {
  if (event.data.type !== "parse-placeholder") {
    return;
  }

  const response: ParserWorkerResponse = {
    type: "parse-placeholder-result",
    summary: {
      savedCount: 0,
      droppedCount: 0,
      ambiguousCount: 0,
      uniqueCount: 0,
      lengthDroppedCount: 0,
      keywordDroppedCount: 0,
      minLength: 0,
      maxLength: 0
    }
  };

  self.postMessage(response);
};

