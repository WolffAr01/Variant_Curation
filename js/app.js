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

  // A link plus an "Open beside" button. Every button loads into the same
  // pop-up window placed on the right half of the screen, so sites can be
  // read next to the report (they refuse to be shown inside the page).
  function sideButton(url) {
    return '<button type="button" class="secondary side" data-url="' + esc(url) + '">Open beside</button>';
  }

  function sideLink(url, text) {
    return link(url, text) + " " + sideButton(url);
  }

  function openBeside(url) {
    const w = Math.round(screen.availWidth / 2);
    const h = screen.availHeight;
    const left = (screen.availLeft || 0) + screen.availWidth - w;
    const top = screen.availTop || 0;
    const win = window.open(url, "curation-side", "popup,width=" + w + ",height=" + h + ",left=" + left + ",top=" + top);
    if (win) win.focus();
    else location.assign(url); // pop-ups blocked: fall back to a normal visit
  }

  // Windows opened by "Look up" for Varsome and Franklin, stacked on the right
  // half of the screen. Browsers only allow pop-ups during the click itself, so
  // they open blank right away and get their address once the variant is known.
  let autoWins = {};

  function openAutoWindows() {
    const w = Math.round(screen.availWidth / 2);
    const h = Math.round(screen.availHeight / 2);
    const left = (screen.availLeft || 0) + screen.availWidth - w;
    const top = screen.availTop || 0;
    const open = (name, row) => {
      const win = window.open("", name, "popup,width=" + w + ",height=" + h + ",left=" + left + ",top=" + (top + row * h));
      if (win) {
        try {
          win.document.title = "Loading...";
          win.document.body.innerHTML = '<p style="font:15px system-ui;padding:16px">Waiting for the variant lookup...</p>';
        } catch (e) {
          // The window still shows the previous variant's site; it is replaced shortly.
        }
      }
      return win;
    };
    autoWins = { varsome: open("curation-varsome", 0), franklin: open("curation-franklin", 1) };
    const blocked = !autoWins.varsome || !autoWins.franklin;
    $("popup-note").hidden = !blocked;
  }

  function sendAutoWindow(which, url) {
    const win = autoWins[which];
    if (win && !win.closed) win.location.href = url;
    autoWins[which] = null;
  }

  function closeAutoWindows() {
    for (const k of Object.keys(autoWins)) if (autoWins[k] && !autoWins[k].closed) autoWins[k].close();
    autoWins = {};
  }

  $("auto").addEventListener("change", () => {
    try { localStorage.setItem("autoOpen", $("auto").checked ? "1" : "0"); } catch (e) { /* not saved */ }
  });
  try { if (localStorage.getItem("autoOpen") === "0") $("auto").checked = false; } catch (e) { /* default on */ }

  $("result").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button.side");
    if (btn) openBeside(btn.dataset.url);
  });

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

  // What each source has returned so far, for the ActX text block.
  let state = {};

  function updateText() {
    const g = state.gnomad;
    const extras = {
      freq: g && g.found ? [g.freqText, g.homText] : g ? ["Not found in gnomAD v4"] : [],
      scores: [
        ...(g && g.found && g.predictors.length ? [GnomAD.scoresText(g) + " (gnomAD)"] : []),
        ...(state.gerp ? [Ucsc.scoreText(state.gerp)] : []),
      ],
      tail: [state.clinvar ? ClinVar.toText(state.clinvar) : "", state.varsome ? "Varsome germline classification\n  " + state.varsome : ""]
        .filter(Boolean).join("\n\n"),
    };
    // The ActX text block is hidden for now; this keeps it ready to bring back.
    if ($("text")) $("text").textContent = DbSnp.toText(state.dbsnp, extras);
  }

  function render(r, note) {
    state = { dbsnp: r };
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
          "<dt>dbSNP page</dt><dd>" + sideLink(r.dbsnpUrl) + "</dd>" +
        "</dl>" +
        "<h3>1. Variant type <span class=\"src\">Gene : Consequence</span></h3><ul>" + genes + "</ul>" +
        "<h3>2. Frequency</h3><ul class=\"plain\">" + freqs + "</ul>" +
        "<h3>Clinical Significance <span class=\"src\">allele " + esc(r.matched) + "</span></h3>" +
          (r.clinvarAlleleUrl ? "<p>ClinVar link for this allele (allele ID " + esc(r.alleleId) + "): " + sideLink(r.clinvarAlleleUrl) + "</p>" : "") +
          clin +
        '<p class="muted">dbSNP build ' + esc(r.build) + ". " + link(RAW_DBSNP + r.rsid.slice(2), "Raw dbSNP data") + "</p>" +
      "</details>" +
      '<details class="card" open><summary><h2>ClinVar <span class="src">germline classification</span></h2></summary>' +
        '<div id="clinvar">' + (r.alleleId ? '<p class="muted">Looking up allele ID ' + esc(r.alleleId) + " in ClinVar...</p>" : "<p>No ClinVar record for this allele.</p>") + "</div>" +
      "</details>" +
      '<details class="card" open><summary><h2>gnomAD <span class="src">v4, Total column</span></h2></summary>' +
        '<div id="gnomad"><p class="muted">Looking up ' + esc(r.matched) + " in gnomAD...</p></div>" +
      "</details>" +
      '<details class="card" open><summary><h2>UCSC Genome Browser <span class="src">GERP, hg19</span></h2></summary>' +
        '<div id="ucsc">' + (r.grch37 ? '<p class="muted">Looking up GERP scores...</p>' : "<p>dbSNP has no GRCh37 position for this variant, so GERP (hg19) can't be looked up.</p>") + "</div>" +
      "</details>" +
      '<details class="card" open><summary><h2>Varsome <span class="src">link only</span></h2></summary>' +
        '<div id="varsome"><p class="muted">Preparing the Varsome link...</p></div>' +
      "</details>" +
      '<details class="card" open><summary><h2>Franklin <span class="src">link only</span></h2></summary>' +
        '<div id="franklin"><p class="muted">Preparing the Franklin link...</p></div>' +
      "</details>";

    if (r.alleleId) loadClinVar(r);
    loadGnomad(r);
    if (r.grch37) loadGerp(r);
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
          "<dt>Description</dt><dd><strong>" + link(c.url, c.title || "Variation " + c.variationId) + "</strong> " + sideButton(c.url) + "</dd>" +
          "<dt>Classification</dt><dd><strong>" + esc(c.classification) + "</strong>" +
            (c.breakdown ? "<div>" + esc(c.breakdown) + "</div>" : "") + "</dd>" +
          '<dt>Review status</dt><dd><span class="stars">' + stars + "</span> " + esc(c.reviewStatus) + "</dd>" +
          (c.submissions != null ? "<dt>Submissions</dt><dd>" + esc(c.submissions) + "</dd>" : "") +
          (c.lastEvaluated ? "<dt>Last evaluated</dt><dd>" + esc(c.lastEvaluated) + "</dd>" : "") +
        "</dl>";
      if (state.dbsnp !== r) return; // a newer lookup has started
      state.clinvar = c;
      updateText();
    } catch (e) {
      box.innerHTML = '<div class="error">Could not load the ClinVar classification. Use the allele ID link above.</div>';
    }
  }

  // Varsome takes the same chrom-pos-ref-alt ID as gnomAD. Without one, fall
  // back to the rsID, where Varsome asks you to pick the allele.
  function showVarsome(r, id) {
    if (state.dbsnp !== r) return;
    const url = id
      ? "https://varsome.com/variant/hg38/chr" + id
      : "https://varsome.com/variant/hg38/" + r.rsid;
    state.varsome = url;
    updateText();
    sendAutoWindow("varsome", url);
    $("varsome").innerHTML =
      "<p>" + sideLink(url, "Open " + (id ? "chr" + id : r.rsid) + " on Varsome") + "</p>" +
      '<p class="muted">Click Germline Classification on that page for the ACMG rules.' +
      (id ? "" : " Select " + esc(r.matched) + " from the options at the top.") + "</p>";
    showFranklin(r, id);
  }

  // Franklin has no public API, so link to the variant page (hg38 form of the
  // same chrom-pos-ref-alt ID). Without an ID, open Franklin's search page.
  function showFranklin(r, id) {
    const url = id
      ? "https://franklin.genoox.com/clinical-db/variant/snp/chr" + id + "-hg38"
      : "https://franklin.genoox.com/clinical-db/home";
    sendAutoWindow("franklin", url);
    $("franklin").innerHTML =
      "<p>" + sideLink(url, id ? "Open chr" + id + " on Franklin" : "Search Franklin for " + r.rsid) + "</p>" +
      '<p class="muted">Read the Suggested Classification and the met evidence; the UNMET lines can be skipped.' +
      (id ? "" : " Search for " + esc(r.rsid) + " and select " + esc(r.matched) + ".") + "</p>";
  }

  // Convert dbSNP's allele to gnomAD's variant ID, then read the Total column.
  async function loadGnomad(r) {
    const box = $("gnomad");
    const chrom = r.grch38.chrom === "MT" ? "M" : r.grch38.chrom;
    let id;
    try {
      const norm = GnomAD.leftNormalize(r.grch38.spdi);
      let anchor = null;
      if (norm.needsAnchor) {
        // Insertions and deletions need the reference base just before the change.
        const seq = await getJson("hg38-base/" + chrom + "/" + norm.position0);
        anchor = String(seq.dna || "").toUpperCase();
        if (!/^[ACGT]$/.test(anchor)) throw new Error("no reference base");
      }
      id = GnomAD.variantId(chrom, norm, anchor);
      showVarsome(r, id);
      const label = r.matched.includes(">") ? norm.inserted : r.matched;
      const g = GnomAD.extract(await getJson("gnomad/" + id), label);
      if (state.dbsnp !== r) return; // a newer lookup has started
      state.gnomad = g;
      updateText();
      if (!g.found) {
        box.innerHTML = "<p>" + esc(id) + " is not in gnomAD v4 (no carriers observed). " + link(GnomAD.pageUrl(id), "Check on gnomAD") + "</p>";
        return;
      }
      const preds = g.predictors.length
        ? "<ul>" + g.predictors.map((p) => "<li>" + esc(p.label) + ": " + esc(p.value) + "</li>").join("") + "</ul>"
        : "<p>No in silico predictors listed.</p>";
      box.innerHTML =
        '<dl class="facts">' +
          "<dt>Variant</dt><dd>" + sideLink(GnomAD.pageUrl(g.variantId), g.variantId + " (GRCh38)") + "</dd>" +
          "<dt>Total</dt><dd>Allele count " + esc(g.ac) + ", allele number " + esc(g.an) + ", frequency " + esc(g.af) +
            '<div class="muted">Exomes + genomes' + (g.sources.length < 2 ? " (" + esc(g.sources.join("")) + " only)" : "") +
            (g.filters.length ? "; filters: " + esc(g.filters.join(", ")) : "") + "</div></dd>" +
          "<dt>Homozygotes</dt><dd>" + esc(g.hom) + "</dd>" +
        "</dl>" +
        "<h3>2. Frequency <span class=\"src\">added to the list</span></h3><ul class=\"plain\"><li><code>" + esc(g.freqText) + "</code></li><li><code>" + esc(g.homText) + "</code></li></ul>" +
        "<h3>3. Computational scores <span class=\"src\">In Silico Predictors</span></h3>" + preds;
    } catch (e) {
      if (!id) showVarsome(r, null);
      box.innerHTML = '<div class="error">Could not load gnomAD' + (id ? " for " + esc(id) : "") + ". " +
        link("https://gnomad.broadinstitute.org/", "Search gnomAD directly") + ".</div>";
    }
  }

  // GERP++ on hg19 around the GRCh37 position, as in the UCSC browser view.
  async function loadGerp(r) {
    const box = $("ucsc");
    const chrom = r.grch37.chrom === "MT" ? "M" : r.grch37.chrom;
    const pos = r.grch37.position;
    const url = Ucsc.browserUrl(chrom, pos);
    try {
      const w = Ucsc.window37(pos);
      const g = Ucsc.extract(await getJson("hg19-gerp/" + chrom + "/" + w.start + "/" + w.end), chrom, pos);
      if (state.dbsnp !== r) return; // a newer lookup has started
      state.gerp = g;
      updateText();
      box.innerHTML =
        '<dl class="facts">' +
          "<dt>GERP at variant</dt><dd><strong>" + (g.atVariant === null ? "no score at this base" : esc(g.atVariant)) + "</strong>" +
            '<div class="muted">chr' + esc(chrom) + ":" + esc(pos) + " (hg19)</div></dd>" +
          "<dt>Browser view</dt><dd>" + sideLink(url, "Open in UCSC (variant highlighted)") + "</dd>" +
        "</dl>";
    } catch (e) {
      box.innerHTML = '<div class="error">Could not load GERP scores. ' + link(url, "Open the UCSC browser view") + ".</div>";
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

    if (ev && $("auto").checked) openAutoWindows();
    $("go").disabled = true;
    $("result").innerHTML = '<p class="muted">Looking up rs' + esc(want.rsid) + " in dbSNP...</p>";
    try {
      const { json, note } = await fetchRefsnp(want.rsid);
      render(DbSnp.extract(json, want), note);
    } catch (e) {
      closeAutoWindows();
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
