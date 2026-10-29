// UCSC Genome Browser: GERP++ scores on hg19 (track allHg19RS_BW) around the
// variant. Pure functions, so they run in Node tests too.
(function (root) {
  "use strict";

  const TRACK = "allHg19RS_BW";
  const FLANK = 100; // same 201-base window as the browser link in the workflow doc

  // 0-based half-open window around a 1-based GRCh37 position.
  function window37(pos1) {
    return { start: Math.max(0, pos1 - 1 - FLANK), end: pos1 + FLANK };
  }

  // getData returns the scores under the track name, sometimes nested by chromosome.
  function scoreRows(json, chrom) {
    let rows = (json || {})[TRACK];
    if (rows && !Array.isArray(rows)) rows = rows["chr" + chrom] || Object.values(rows).find(Array.isArray);
    return Array.isArray(rows) ? rows : [];
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  // Score at the variant base and the highest score in the window.
  function extract(json, chrom, pos1) {
    const rows = scoreRows(json, chrom);
    const p0 = pos1 - 1;
    const at = rows.find((r) => r.start <= p0 && p0 < r.end);
    let max = null;
    for (const r of rows) if (max === null || r.value > max.value) max = r;
    return {
      atVariant: at ? round2(at.value) : null,
      windowMax: max ? round2(max.value) : null,
      windowMaxPos: max ? max.start + 1 : null,
      window: window37(pos1),
    };
  }

  function browserUrl(chrom, pos1) {
    const w = window37(pos1);
    return "https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg19&position=chr" + chrom + "%3A" + (w.start + 1) + "-" + w.end +
      "&highlight=hg19.chr" + chrom + "%3A" + pos1 + "-" + pos1;
  }

  function scoreText(g) {
    if (g.atVariant === null) return "GERP: no score at this base (UCSC, hg19)";
    return "GERP: " + g.atVariant + " (UCSC, hg19)";
  }

  const api = { TRACK, window37, extract, browserUrl, scoreText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Ucsc = api;
})(typeof window !== "undefined" ? window : globalThis);
