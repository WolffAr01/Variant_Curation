// Input parsing, allele matching and dbSNP (refsnp JSON) extraction.
// Pure functions only, so they run in the browser and in Node tests.
(function (root) {
  "use strict";

  const BASES = /^[ACGT]+$/;

  // Turn the three form fields into a requested change.
  // Returns { rsid, ref, kind, deleted, inserted, label } or throws an Error.
  function parseInput(rsidText, refText, nucText) {
    const rsid = String(rsidText || "").trim().toLowerCase().replace(/^rs/, "");
    if (!/^\d+$/.test(rsid)) throw new Error("rsID should look like rs775194825.");

    const ref = String(refText || "").trim().toUpperCase();
    if (ref && !BASES.test(ref)) throw new Error("Reference should only contain A, C, G or T.");

    const nuc = String(nucText || "").trim();
    const m = /^(del|ins|dup)?([ACGTacgt]+)$/i.exec(nuc);
    if (!m) throw new Error("Nucleotide should look like A, delC or insGA.");
    const op = (m[1] || "").toLowerCase();
    const bases = m[2].toUpperCase();

    if (op === "del") {
      return { rsid, ref, kind: "del", deleted: bases, inserted: "", label: "del" + bases };
    }
    if (op === "ins" || op === "dup") {
      return { rsid, ref, kind: "ins", deleted: "", inserted: bases, label: op + bases };
    }
    if (!ref) throw new Error("Enter the reference base for a substitution (for example C).");
    return { rsid, ref, kind: "sub", deleted: ref, inserted: bases, label: ref + ">" + bases };
  }

  // Remove shared leading and trailing bases, so a change written against a
  // whole repeat (CCC>CC) compares equal to the net change (delC).
  function netChange(deleted, inserted) {
    let d = deleted, i = inserted;
    while (d && i && d[0] === i[0]) { d = d.slice(1); i = i.slice(1); }
    while (d && i && d[d.length - 1] === i[i.length - 1]) { d = d.slice(0, -1); i = i.slice(0, -1); }
    return { d, i };
  }

  // Same length and a rotation of each other: delCT and delTC in a CTCT repeat
  // describe the same event, just shifted.
  function sameRepeatUnit(a, b) {
    return a.length === b.length && (a + a).includes(b);
  }

  const COMP = { A: "T", C: "G", G: "C", T: "A" };
  function revComp(s) {
    return s.split("").reverse().map((c) => COMP[c] || c).join("");
  }

  function changeMatches(spdi, want) {
    const net = netChange(spdi.deleted_sequence, spdi.inserted_sequence);
    if (want.kind === "sub") return net.d === want.deleted && net.i === want.inserted;
    if (want.kind === "del") return net.i === "" && sameRepeatUnit(net.d, want.deleted);
    if (want.kind === "ins") return net.d === "" && sameRepeatUnit(net.i, want.inserted);
    return false;
  }

  function flipStrand(want) {
    return Object.assign({}, want, {
      ref: revComp(want.ref),
      deleted: revComp(want.deleted),
      inserted: revComp(want.inserted),
    });
  }

  // ---- Reading the refsnp JSON ----

  function chromFromSeqId(seqId) {
    const m = /^NC_0+(\d+)\./.exec(seqId || "");
    if (!m) return seqId;
    const n = Number(m[1]);
    if (n === 23) return "X";
    if (n === 24) return "Y";
    if (n === 12920) return "MT";
    return String(n);
  }

  function assemblyOf(placement) {
    const traits = (placement.placement_annot || {}).seq_id_traits_by_assembly || [];
    return traits.length ? traits[0].assembly_name : "";
  }

  // The GRCh38 chromosome placement; its allele order matches allele_annotations.
  function primaryPlacement(snap) {
    const list = snap.placements_with_allele || [];
    return list.find((p) => p.is_ptlp) || list.find((p) => /^GRCh38/.test(assemblyOf(p))) || list[0];
  }

  function grch37Placement(snap) {
    return (snap.placements_with_allele || []).find(
      (p) => /^GRCh37/.test(assemblyOf(p)) && /^NC_/.test(p.seq_id)
    );
  }

  function isReference(spdi) {
    return spdi.deleted_sequence === spdi.inserted_sequence;
  }

  function describeSpdi(spdi) {
    const net = netChange(spdi.deleted_sequence, spdi.inserted_sequence);
    if (!net.i) return "del" + net.d;
    if (!net.d) return "ins" + net.i;
    return net.d + ">" + net.i;
  }

  // 1-based position of the first changed base.
  function position1(spdi) {
    return spdi.position + 1;
  }

  // dbSNP-style frequency number: 0.00000 for zero, six decimals for rare
  // alleles (0.000013), five otherwise (0.29816).
  function formatFreq(count, total) {
    if (!total) return "NA";
    if (!count) return "0.00000";
    const f = count / total;
    return f < 0.001 ? f.toFixed(6) : f.toFixed(5);
  }

  const VARIANT_TYPES = {
    snv: "SNV (Single Nucleotide Variation)",
    mnv: "MNV (Multiple Nucleotide Variation)",
    del: "Deletion",
    ins: "Insertion",
    delins: "Indel (deletion-insertion)",
    identity: "Identity",
  };

  function titleCase(soName) {
    return soName.replace(/_/g, " ").replace(/\b([a-z])/g, (c) => c.toUpperCase())
      .replace(/\bUtr\b/g, "UTR").replace(/\b(\d+)kb\b/gi, "$1KB");
  }

  // "CSRP3 : Splice Acceptor Variant", one line per gene, for one allele.
  function geneConsequences(annotation) {
    const out = [];
    for (const asm of annotation.assembly_annotation || []) {
      for (const gene of asm.genes || []) {
        const names = new Set();
        for (const so of gene.sequence_ontology || []) names.add(so.name);
        for (const rna of gene.rnas || []) {
          for (const so of rna.sequence_ontology || []) names.add(so.name);
          for (const so of ((rna.protein || {}).sequence_ontology) || []) names.add(so.name);
        }
        const cons = [...names].filter(Boolean).map(titleCase);
        const hgvs = (gene.rnas || []).map((r) => r.hgvs).filter(Boolean);
        out.push({ gene: gene.locus, consequences: cons, hgvs });
      }
    }
    return out;
  }

  // Build everything the dbSNP section shows, for the allele that matches `want`.
  // Throws an Error with a readable message when nothing matches.
  function extract(json, want) {
    const snap = json.primary_snapshot_data;
    const placement = primaryPlacement(snap);
    if (!placement) throw new Error("dbSNP returned no genomic position for rs" + json.refsnp_id + ".");

    const alleles = placement.alleles.map((a) => a.allele.spdi);
    const altIndexes = alleles.map((s, i) => i).filter((i) => !isReference(alleles[i]));
    const available = altIndexes.map((i) => describeSpdi(alleles[i]));

    let strand = "forward";
    let idx = altIndexes.find((i) => changeMatches(alleles[i], want));
    if (idx === undefined) {
      const flipped = flipStrand(want);
      idx = altIndexes.find((i) => changeMatches(alleles[i], flipped));
      if (idx !== undefined) strand = "reverse";
    }
    if (idx === undefined) {
      const err = new Error(
        "rs" + json.refsnp_id + " has no " + want.label + " allele. dbSNP lists: " + available.join(", ") + "."
      );
      err.available = available;
      throw err;
    }

    const spdi = alleles[idx];
    const refSpdi = alleles.find(isReference) || spdi;
    const annotation = (snap.allele_annotations || [])[idx] || {};
    const label = describeSpdi(spdi);
    const freqAllele = /^[ACGT]+$/.test(spdi.inserted_sequence) && label.includes(">")
      ? netChange(spdi.deleted_sequence, spdi.inserted_sequence).i
      : label;

    const p37 = grch37Placement(snap);
    let grch37 = null;
    if (p37 && p37.alleles[idx]) {
      const s = p37.alleles[idx].allele.spdi;
      grch37 = { chrom: chromFromSeqId(s.seq_id), position: position1(s), spdi: s };
    }

    const frequencies = (annotation.frequency || []).map((f) => ({
      study: f.study_name,
      count: f.allele_count,
      total: f.total_count,
      text: freqAllele + "=" + formatFreq(f.allele_count, f.total_count) +
        " (" + f.allele_count + "/" + f.total_count + ", " + f.study_name + ")",
    }));

    const clinical = (annotation.clinical || []).map((c) => ({
      accession: c.accession_version,
      diseases: (c.disease_names || []).join(", "),
      significance: (c.clinical_significances || []).map((s) => titleCase(s.replace(/-/g, " "))).join(", "),
      alleleId: c.allele_id,
      url: "https://www.ncbi.nlm.nih.gov/clinvar/" + c.accession_version + "/",
    }));
    const alleleId = clinical.map((c) => c.alleleId).find(Boolean);

    return {
      rsid: "rs" + json.refsnp_id,
      build: json.last_update_build_id,
      strand,
      matched: label,
      alleleIndex: idx,
      allAlleles: (alleles.find(isReference) ? refSpdi.deleted_sequence + " ref; " : "") + available.join(" / "),
      variantType: VARIANT_TYPES[snap.variant_type] || snap.variant_type,
      grch38: {
        chrom: chromFromSeqId(spdi.seq_id),
        position: position1(spdi),
        assembly: assemblyOf(placement),
        spdi,
      },
      grch37,
      genes: geneConsequences(annotation),
      frequencies,
      clinical,
      clinvarAlleleUrl: alleleId
        ? "https://www.ncbi.nlm.nih.gov/clinvar/?term=" + alleleId + "%5Balleleid%5D"
        : null,
      alleleId: alleleId || null,
      dbsnpUrl: "https://www.ncbi.nlm.nih.gov/snp/rs" + json.refsnp_id,
    };
  }

  // Plain-text block for pasting into ActX.
  function toText(r) {
    const lines = [];
    lines.push(r.rsid + "  " + r.matched + "  chr" + r.grch38.chrom + ":" + r.grch38.position + " (" + r.grch38.assembly + ")");
    lines.push("");
    lines.push("Variant type (dbSNP Gene : Consequence)");
    if (r.genes.length) {
      for (const g of r.genes) lines.push("  " + g.gene + " : " + (g.consequences.join(", ") || "no consequence listed"));
    } else {
      lines.push("  No gene annotation (intergenic)");
    }
    lines.push("");
    lines.push("Frequency (dbSNP)");
    if (r.frequencies.length) for (const f of r.frequencies) lines.push("  " + f.text);
    else lines.push("  No frequency data in dbSNP");
    lines.push("");
    lines.push("ClinVar (dbSNP Clinical Significance, allele " + r.matched + ")");
    if (r.clinvarAlleleUrl) lines.push("  " + r.clinvarAlleleUrl);
    if (r.clinical.length) {
      for (const c of r.clinical) lines.push("  " + c.accession + " | " + c.diseases + " | " + c.significance);
    } else {
      lines.push("  Not reported in ClinVar for this allele");
    }
    return lines.join("\n");
  }

  const api = { parseInput, netChange, revComp, changeMatches, formatFreq, extract, toText, chromFromSeqId };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DbSnp = api;
})(typeof window !== "undefined" ? window : globalThis);
