export function syntheticXmlResult(hitCount: number, options: { partialTail?: boolean; qseqEvery?: number; uEvery?: number } = {}): string {
  const hits = Array.from({ length: hitCount }, (_, index) => syntheticXmlHit(index + 1, options)).join("\n");
  const tail = options.partialTail ? "\n<Hit><Hit_id>truncated" : "\n</Iteration_hits></Iteration></BlastOutput_iterations></BlastOutput>";
  return `<?xml version="1.0"?><BlastOutput><BlastOutput_iterations><Iteration><Iteration_hits>\n${hits}${tail}`;
}

export function syntheticJson2SResult(hitCount: number): string {
  return JSON.stringify({
    results: {
      search: {
        hits: Array.from({ length: hitCount }, (_, index) => ({
          accession: accession(index + 1),
          title: `Synthetic large JSON hit ${index + 1}`,
          hsps: [
            {
              hseq: index % 2 === 0 ? "ATG-CU" : "ATGCTA",
              query_from: 1,
              query_to: 6,
              hit_from: 10,
              hit_to: 15,
              identity: 6,
              evalue: 0.001,
              bit_score: 40
            }
          ]
        }))
      }
    }
  });
}

function syntheticXmlHit(index: number, options: { qseqEvery?: number; uEvery?: number }): string {
  const useQseq = options.qseqEvery !== undefined && index % options.qseqEvery === 0;
  const sequence = options.uEvery !== undefined && index % options.uEvery === 0 ? "AU-GCU" : "ATG-CTA";
  const sequenceTag = useQseq ? `<Hsp_qseq>${sequence}</Hsp_qseq>` : `<Hsp_hseq>${sequence}</Hsp_hseq>`;
  return `<Hit><Hit_id>${accession(index)}</Hit_id><Hit_accession>${accession(index)}</Hit_accession><Hit_def>Synthetic large XML hit ${index}</Hit_def><Hit_hsps><Hsp><Hsp_bit-score>40</Hsp_bit-score><Hsp_evalue>0.001</Hsp_evalue><Hsp_query-from>1</Hsp_query-from><Hsp_query-to>6</Hsp_query-to><Hsp_hit-from>10</Hsp_hit-from><Hsp_hit-to>15</Hsp_hit-to><Hsp_identity>6</Hsp_identity>${sequenceTag}</Hsp></Hit_hsps></Hit>`;
}

function accession(index: number): string {
  return `SYNLARGE${String(index).padStart(6, "0")}`;
}
