// gnomAD: build the variant ID from dbSNP's allele and read the Total column
// and in silico predictors. Pure functions, so they run in Node tests too.
(function (root) {
  "use strict";

  // dbSNP writes indels across a whole repeat (SPDI). gnomAD uses the
  // left-most minimal form with the base before the change as an anchor.
  // Returns { position0, deleted, inserted, needsAnchor }.
  function leftNormalize(spdi) {
    let d = spdi.deleted_sequence, i = spdi.inserted_sequence, pos = spdi.position;
    while (d && i && d[d.length - 1] === i[i.length - 1]) { d = d.slice(0, -1); i = i.slice(0, -1); }
    while (d && i && d[0] === i[0]) { d = d.slice(1); i = i.slice(1); pos++; }
    return { position0: pos, deleted: d, inserted: i, needsAnchor: !d || !i };
  }

  // gnomAD variant ID, e.g. 11-19185046-C-A. `anchor` is the reference base
  // just before the change, needed only for insertions and deletions.
  function variantId(chrom, norm, anchor) {
    if (!norm.needsAnchor) return chrom + "-" + (norm.position0 + 1) + "-" + norm.deleted + "-" + norm.inserted;
    if (!anchor) throw new Error("anchor base needed");
    return chrom + "-" + norm.position0 + "-" + anchor + norm.deleted + "-" + anchor + norm.inserted;
  }

  // Plain decimal with 4 significant figures, never exponent form: 0.00001737.
  function formatAf(ac, an) {
    if (!an) return "NA";
    if (!ac) return "0";
    const f = ac / an;
    const digits = Math.max(0, 3 - Math.floor(Math.log10(f)));
    return f.toFixed(Math.min(digits, 20));
  }

  const PREDICTORS = {
    cadd: "CADD",
    revel_max: "REVEL",
    spliceai_ds_max: "SpliceAI",
    pangolin_largest_ds: "Pangolin",
    phylop: "phyloP",
    sift_max: "SIFT (max)",
    polyphen_max: "PolyPhen (max)",
  };

  // GraphQL response -> gnomAD's own Total column (`joint`) and predictors.
  // Exome and genome counts are never added up here: when a variant is missing
  // from one of them, gnomAD's Total still counts that data set's allele number.
  function extract(json, alleleLabel) {
    const v = ((json || {}).data || {}).variant;
    if (!v) {
      const msg = (((json || {}).errors || [])[0] || {}).message || "";
      if (/not found/i.test(msg)) return { found: false };
      throw new Error(msg || "gnomAD returned no data");
    }
    const j = v.joint;
    const total = j && j.an ? { ac: j.ac || 0, an: j.an, hom: j.homozygote_count || 0, af: formatAf(j.ac || 0, j.an) } : null;
    return {
      found: true,
      variantId: v.variant_id,
      total,
      sources: [v.exome && "exomes", v.genome && "genomes"].filter(Boolean),
      filters: [v.exome, v.genome].filter(Boolean).flatMap((p) => p.filters || []),
      freqText: total ? alleleLabel + "=" + total.af + " (" + total.ac + "/" + total.an + ", gnomAD)" : "No gnomAD Total found",
      homText: total ? "Number of homozygotes (gnomAD total) = " + total.hom : "",
      predictors: (v.in_silico_predictors || []).map((p) => ({
        id: p.id,
        label: PREDICTORS[p.id] || p.id,
        value: p.value,
      })),
    };
  }

  function scoresText(g) {
    return g.predictors.map((p) => p.label + ": " + p.value).join(" | ");
  }

  function pageUrl(id) {
    return "https://gnomad.broadinstitute.org/variant/" + id + "?dataset=gnomad_r4";
  }

  const api = { leftNormalize, variantId, formatAf, extract, scoresText, pageUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GnomAD = api;
})(typeof window !== "undefined" ? window : globalThis);
