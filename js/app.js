(function () {
  "use strict";

  // dbSNP blocks direct browser requests, so lookups go through our Cloudflare relay (worker/relay.js).
  const API = "https://variant-curation.wolffar01.workers.dev/dbsnp/";
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
      '<section class="card">' +
        "<h2>" + esc(r.rsid) + " &nbsp;" + esc(r.matched) + "</h2>" +
        '<dl class="facts">' +
          "<dt>Position</dt><dd>chr" + esc(r.grch38.chrom) + ":" + esc(r.grch38.position) + " (" + esc(r.grch38.assembly) + ")" +
            (r.grch37 ? '<div class="muted">GRCh37: chr' + esc(r.grch37.chrom) + ":" + esc(r.grch37.position) + "</div>" : "") + "</dd>" +
          "<dt>Alleles in dbSNP</dt><dd>" + esc(r.allAlleles) + "</dd>" +
          "<dt>Variation type</dt><dd>" + esc(r.variantType) + "</dd>" +
          "<dt>dbSNP page</dt><dd>" + link(r.dbsnpUrl) + "</dd>" +
        "</dl>" +
      "</section>" +
      '<section class="card"><h3>1. Variant type <span class="src">dbSNP Gene : Consequence</span></h3><ul>' + genes + "</ul></section>" +
      '<section class="card"><h3>2. Frequency <span class="src">dbSNP</span></h3><ul class="plain">' + freqs + "</ul></section>" +
      '<section class="card"><h3>ClinVar <span class="src">dbSNP Clinical Significance tab, allele ' + esc(r.matched) + "</span></h3>" +
        (r.clinvarAlleleUrl ? "<p>ClinVar link for this allele (allele ID " + esc(r.alleleId) + "): " + link(r.clinvarAlleleUrl) + "</p>" : "") +
        clin + "</section>" +
      '<section class="card"><div class="row"><h3>Text for ActX</h3><button id="copy" type="button">Copy</button></div>' +
        '<pre id="text">' + esc(DbSnp.toText(r)) + "</pre></section>" +
      '<p class="muted">dbSNP build ' + esc(r.build) + ". " + link(RAW_DBSNP + r.rsid.slice(2), "Raw dbSNP data") + "</p>";

    $("copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText($("text").textContent);
        $("copy").textContent = "Copied";
      } catch (e) {
        $("copy").textContent = "Select the text and copy";
      }
    });
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
