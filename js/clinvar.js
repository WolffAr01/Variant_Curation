// ClinVar germline classification for the allele ID that dbSNP links to.
// Pure parsing functions, so they run in the browser and in Node tests.
(function (root) {
  "use strict";

  // Gold stars shown on ClinVar, by review status.
  const STARS = [
    [/^no /, 0],
    [/practice guideline/, 4],
    [/expert panel/, 3],
    [/multiple submitters, no conflicts/, 2],
    [/criteria provided/, 1],
  ];

  function starsFor(reviewStatus) {
    const s = String(reviewStatus || "").toLowerCase();
    for (const [re, n] of STARS) if (re.test(s)) return n;
    return 0;
  }

  // esearch JSON -> first ClinVar variation ID, or null.
  function variationIdFromSearch(json) {
    const ids = ((json || {}).esearchresult || {}).idlist || [];
    return ids.length ? ids[0] : null;
  }

  // esummary JSON -> the parts of the germline classification ClinVar shows.
  function fromSummary(json, id) {
    const doc = ((json || {}).result || {})[id];
    if (!doc) return null;
    const g = doc.germline_classification || doc.clinical_significance || {};
    return {
      variationId: id,
      title: doc.title || "",
      accession: doc.accession || "",
      classification: g.description || "",
      reviewStatus: g.review_status || "",
      lastEvaluated: g.last_evaluated || "",
      stars: starsFor(g.review_status),
      breakdown: "",
      submissions: null,
      url: "https://www.ncbi.nlm.nih.gov/clinvar/variation/" + id + "/",
    };
  }

  // Add the per-class counts ("Pathogenic(1); Likely pathogenic(1); ...") and
  // the submission count from the VCV XML. `doc` is a parsed XML Document.
  function addVcvDetails(result, doc) {
    const g = doc.getElementsByTagName("GermlineClassification")[0];
    if (!g) return result;
    const text = (tag) => {
      const el = g.getElementsByTagName(tag)[0];
      return el ? el.textContent.trim() : "";
    };
    // ClinVar's site adds a space before each count: "Pathogenic (1)".
    result.breakdown = text("Explanation").replace(/\s*\((\d+)\)/g, " ($1)");
    const n = g.getAttribute("NumberOfSubmissions");
    if (n) result.submissions = Number(n);
    if (!result.classification) result.classification = text("Description");
    if (!result.reviewStatus) {
      result.reviewStatus = text("ReviewStatus");
      result.stars = starsFor(result.reviewStatus);
    }
    return result;
  }

  function starText(n) {
    return n + (n === 1 ? " star" : " stars");
  }

  function toText(c) {
    const lines = ["ClinVar germline classification", "  " + c.title];
    lines.push("  " + c.classification + ", " + starText(c.stars) + " (" + c.reviewStatus + ")");
    if (c.breakdown) lines.push("  " + c.breakdown);
    if (c.submissions != null) lines.push("  " + c.submissions + " submissions");
    lines.push("  " + c.url);
    return lines.join("\n");
  }

  const api = { starsFor, variationIdFromSearch, fromSummary, addVcvDetails, starText, toText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ClinVar = api;
})(typeof window !== "undefined" ? window : globalThis);
