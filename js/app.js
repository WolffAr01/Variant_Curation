(function () {
  "use strict";

  // dbSNP blocks direct browser requests, so lookups go through our Cloudflare relay (worker/relay.js).
  const RELAY = "https://variant-curation.wolffar01.workers.dev/";
  const API = RELAY + "dbsnp/";
  const RAW_DBSNP = "https://api.ncbi.nlm.nih.gov/variation/v0/refsnp/";
  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function link(url, text) {
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(text || url) + "</a>";
  }

  // Fetch a refsnp record, following a merge to the current rsID once.
  async function fetchRefsnp(id, note) {
    const res = await fetch(API + id);
    if (res.status === 404) throw new Error("dbSNP has no record for rs" + id + ".");
    if (!res.ok) throw new Error("dbSNP did not answer (HTTP " + res.status + "). Try again in a moment.");
    const json = await res.json();
    if (json.primary_snapshot_data) return { json, note };
    const merged = ((json.merged_snapshot_data || {}).merged_into || [])[0];
    if (merged && !note) {
      return fetchRefsnp(merged, "rs" + id + " was merged into rs" + merged + "; showing rs" + merged + ".");
    }
    throw new Error("rs" + id + " is withdrawn or has no current data in dbSNP.");
  }

  function render(r, note) {
    const genes = r.genes.length
      ? r.genes.map((g) =>
          "<li><strong>" + esc(g.gene) + "</strong> : " + esc(g.consequences.join(", ") || "no consequence listed") +
          (g.hgvs.length ? '<div class="muted">' + esc(g.hgvs.join(", ")) + "</div>" : "") + "</li>").join("")
      : "<li>No gene annotation (intergenic)</li>";

    const freqs = r.frequencies.length
      ? r.frequencies.map((f) => "<li><code>" + esc(f.text) + "</code></li>").join("")
      : "<li>No frequency data in dbSNP</li>";

    const clin = r.clinical.length
      ? "<table><thead><tr><th>ClinVar accession</th><th>Disease names</th><th>Clinical significance</th></tr></thead><tbody>" +
        r.clinical.map((c) =>
          "<tr><td>" + link(c.url, c.accession) + "</td><td>" + esc(c.diseases) + "</td><td>" + esc(c.significance) + "</td></tr>").join("") +
        "</tbody></table>"
      : "<p>Not reported in ClinVar for this allele.</p>";

    const notes = [];
    if (note) notes.push(note);
    if (r.strand === "reverse") {
      notes.push("Your alleles matched on the reverse strand. dbSNP writes this allele as " + r.matched + " on the forward strand.");
    }

    $("result").innerHTML =
      (notes.length ? '<div class="note">' + notes.map(esc).join("<br>") + "</div>" : "") +
      '<details class="card" open><summary><h2>dbSNP <span class="src">' + esc(r.rsid) + " " + esc(r.matched) + "</span></h2></summary>" +
        '<dl class="facts">' +
          "<dt>Position</dt><dd>chr" + esc(r.grch38.chrom) + ":" + esc(r.grch38.position) + " (" + esc(r.grch38.assembly) + ")" +
            (r.grch37 ? '<div class="muted">GRCh37: chr' + esc(r.grch37.chrom) + ":" + esc(r.grch37.position) + "</div>" : "") + "</dd>" +
          "<dt>Alleles in dbSNP</dt><dd>" + esc(r.allAlleles) + "</dd>" +
          "<dt>Variation type</dt><dd>" + esc(r.variantType) + "</dd>" +
          "<dt>dbSNP page</dt><dd>" + link(r.dbsnpUrl) + "</dd>" +
        "</dl>" +
        "<h3>1. Variant type <span class=\"src\">Gene : Consequence</span></h3><ul>" + genes + "</ul>" +
        "<h3>2. Frequency</h3><ul class=\"plain\">" + freqs + "</ul>" +
        "<h3>Clinical Significance <span class=\"src\">allele " + esc(r.matched) + "</span></h3>" +
          (r.clinvarAlleleUrl ? "<p>ClinVar link for this allele (allele ID " + esc(r.alleleId) + "): " + link(r.clinvarAlleleUrl) + "</p>" : "") +
          clin +
        '<p class="muted">dbSNP build ' + esc(r.build) + ". " + link(RAW_DBSNP + r.rsid.slice(2), "Raw dbSNP data") + "</p>" +
      "</details>" +
      '<details class="card" open><summary><h2>ClinVar <span class="src">germline classification</span></h2></summary>' +
        '<div id="clinvar">' + (r.alleleId ? '<p class="muted">Looking up allele ID ' + esc(r.alleleId) + " in ClinVar...</p>" : "<p>No ClinVar record for this allele.</p>") + "</div>" +
      "</details>" +
      '<section class="card"><div class="row"><h3>Text for ActX</h3><button id="copy" type="button">Copy</button></div>' +
        '<pre id="text">' + esc(DbSnp.toText(r)) + "</pre></section>";

    $("copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText($("text").textContent);
        $("copy").textContent = "Copied";
      } catch (e) {
        $("copy").textContent = "Select the text and copy";
      }
    });

    if (r.alleleId) loadClinVar(r);
  }

  async function getJson(path) {
    const res = await fetch(RELAY + path);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  // Follow dbSNP's allele ID link: allele ID -> variation ID -> classification.
  async function loadClinVar(r) {
    const box = $("clinvar");
    try {
      const id = ClinVar.variationIdFromSearch(await getJson("clinvar-search/" + r.alleleId));
      if (!id) {
        box.innerHTML = "<p>ClinVar found no record for allele ID " + esc(r.alleleId) + ".</p>";
        return;
      }
      const c = ClinVar.fromSummary(await getJson("clinvar-summary/" + id), id);
      if (!c) throw new Error("empty summary");
      try {
        const res = await fetch(RELAY + "clinvar-vcv/" + id);
        if (res.ok) ClinVar.addVcvDetails(c, new DOMParser().parseFromString(await res.text(), "text/xml"));
      } catch (e) {
        // The counts are a bonus; the summary above is enough to show.
      }
      const stars = "&#9733;".repeat(c.stars) + '<span class="off">' + "&#9733;".repeat(4 - c.stars) + "</span>";
      box.innerHTML =
        '<dl class="facts">' +
          "<dt>Description</dt><dd><strong>" + link(c.url, c.title || "Variation " + c.variationId) + "</strong></dd>" +
          "<dt>Classification</dt><dd><strong>" + esc(c.classification) + "</strong>" +
            (c.breakdown ? "<div>" + esc(c.breakdown) + "</div>" : "") + "</dd>" +
          '<dt>Review status</dt><dd><span class="stars">' + stars + "</span> " + esc(c.reviewStatus) + "</dd>" +
          (c.submissions != null ? "<dt>Submissions</dt><dd>" + esc(c.submissions) + "</dd>" : "") +
          (c.lastEvaluated ? "<dt>Last evaluated</dt><dd>" + esc(c.lastEvaluated) + "</dd>" : "") +
        "</dl>";
      $("text").textContent += "\n\n" + ClinVar.toText(c);
    } catch (e) {
      box.innerHTML = '<div class="error">Could not load the ClinVar classification. Use the allele ID link above.</div>';
    }
  }

  function showError(msg) {
    $("result").innerHTML = '<div class="error">' + esc(msg) + "</div>";
  }

  async function run(ev) {
    if (ev) ev.preventDefault();
    let want;
    try {
      want = DbSnp.parseInput($("rsid").value, $("ref").value, $("nuc").value);
    } catch (e) {
      showError(e.message);
      return;
    }
    const params = new URLSearchParams({ rsid: "rs" + want.rsid, ref: $("ref").value.trim(), nuc: $("nuc").value.trim() });
    history.replaceState(null, "", "?" + params);

    $("go").disabled = true;
    $("result").innerHTML = '<p class="muted">Looking up rs' + esc(want.rsid) + " in dbSNP...</p>";
    try {
      const { json, note } = await fetchRefsnp(want.rsid);
      render(DbSnp.extract(json, want), note);
    } catch (e) {
      showError(e instanceof TypeError ? "Could not reach the dbSNP relay. Check your connection and try again." : e.message);
    } finally {
      $("go").disabled = false;
    }
  }

  $("form").addEventListener("submit", run);

  // Prefill from the address bar so a result can be bookmarked or shared.
  const q = new URLSearchParams(location.search);
  if (q.get("rsid")) {
    $("rsid").value = q.get("rsid");
    $("ref").value = q.get("ref") || "";
    $("nuc").value = q.get("nuc") || "";
    run();
  }
})();
