// Offline checks for input parsing and allele matching: node tests/run.js
const assert = require("assert");
const D = require("../js/dbsnp.js");
const fx = require("./fixture-rs775194825.json");

const r = D.extract(fx, D.parseInput("rs775194825", "C", "A"));
assert.strictEqual(r.matched, "C>A");
assert.strictEqual(r.grch38.position, 19185046);
assert.strictEqual(r.grch37.position, 19206593);
assert.deepStrictEqual(r.frequencies.map((f) => f.text), [
  "A=0.000013 (2/149264, GnomAD_genomes)",
  "A=0.000008 (1/121018, ExAC)",
  "A=0.000034 (4/119022, ALFA)",
  "A=0.00000 (0/78702, PAGE_STUDY)",
]);
assert.strictEqual(r.genes[0].gene + " : " + r.genes[0].consequences[0], "CSRP3 : Splice Acceptor Variant");
assert.strictEqual(r.clinical.length, 3);
assert.ok(r.clinvarAlleleUrl.includes("1194479"));

// The T allele returns only its own ClinVar record.
assert.deepStrictEqual(D.extract(fx, D.parseInput("775194825", "c", "t")).clinical.map((c) => c.accession), ["RCV001035131.1"]);

// Gene-strand input (G>T) matches on the reverse strand.
assert.strictEqual(D.extract(fx, D.parseInput("rs775194825", "G", "T")).strand, "reverse");

// An allele dbSNP does not have is reported with what it does have.
assert.throws(() => D.extract(fx, D.parseInput("rs775194825", "C", "G")), /dbSNP lists: C>A, C>T/);

// Indels: a repeat written in full still matches the net change.
const del = { deleted_sequence: "CCC", inserted_sequence: "CC" };
assert.ok(D.changeMatches(del, D.parseInput("rs1", "C", "delC")));
assert.ok(D.changeMatches({ deleted_sequence: "GAGA", inserted_sequence: "GAGAGA" }, D.parseInput("rs1", "", "insGA")));
assert.ok(D.changeMatches({ deleted_sequence: "TCTCT", inserted_sequence: "TCT" }, D.parseInput("rs1", "", "delTC")));
assert.ok(!D.changeMatches(del, D.parseInput("rs1", "C", "delCC")));

// Bad input is rejected with a readable message.
assert.throws(() => D.parseInput("abc", "C", "A"), /rsID/);
assert.throws(() => D.parseInput("rs1", "C", "X"), /Nucleotide/);

// ClinVar: allele ID search -> variation ID -> classification.
const C = require("../js/clinvar.js");
assert.strictEqual(C.variationIdFromSearch(require("./fixture-clinvar-search.json")), "1035131");
assert.strictEqual(C.variationIdFromSearch({ esearchresult: { idlist: [] } }), null);
const cv = C.fromSummary(require("./fixture-clinvar-summary.json"), "1035131");
assert.strictEqual(cv.classification, "Conflicting classifications of pathogenicity");
assert.strictEqual(cv.stars, 1);
assert.strictEqual(C.starsFor("reviewed by expert panel"), 3);
assert.strictEqual(C.starsFor("criteria provided, multiple submitters, no conflicts"), 2);
assert.strictEqual(C.starsFor("no assertion criteria provided"), 0);

// gnomAD: variant ID from dbSNP's allele, Total column, predictors.
const G = require("../js/gnomad.js");
const snv = G.leftNormalize(r.grch38.spdi);
assert.strictEqual(G.variantId("11", snv), "11-19185046-C-A");
const delRun = G.leftNormalize({ position: 100, deleted_sequence: "CCC", inserted_sequence: "CC" });
assert.deepStrictEqual(delRun, { position0: 100, deleted: "C", inserted: "", needsAnchor: true });
assert.strictEqual(G.variantId("1", delRun, "T"), "1-100-TC-T");
const insRun = G.leftNormalize({ position: 50, deleted_sequence: "GAGA", inserted_sequence: "GAGAGA" });
assert.strictEqual(G.variantId("2", insRun, "A"), "2-50-A-AGA");
assert.strictEqual(G.formatAf(28, 1612340), "0.00001737");
const g = G.extract(require("./fixture-gnomad.json"), "A");
assert.strictEqual(g.freqText, "A=0.00001737 (28/1612340, gnomAD)");
assert.strictEqual(g.homText, "Number of homozygotes (gnomAD total) = 0");
assert.strictEqual(G.scoresText(g), "CADD: 25.4 | REVEL: 0.933 | SpliceAI: 0.00 | Pangolin: 0.00 | phyloP: 6.38 | PolyPhen (max): 0.999");
assert.deepStrictEqual(G.extract({ errors: [{ message: "Variant not found" }], data: { variant: null } }, "A"), { found: false });

// UCSC GERP: score at the variant base and window max, both data shapes.
const U = require("../js/ucsc.js");
assert.deepStrictEqual(U.window37(19206593), { start: 19206492, end: 19206693 });
const gerp = U.extract(require("./fixture-gerp.json"), "11", 19206593);
assert.strictEqual(gerp.atVariant, 5.41);
assert.strictEqual(gerp.windowMax, 5.41);
assert.strictEqual(U.scoreText(gerp), "GERP: 5.41 (UCSC, hg19)");
const nested = { allHg19RS_BW: { chr11: [{ start: 9, end: 10, value: 1.234 }, { start: 10, end: 11, value: 2 }] } };
assert.deepStrictEqual([U.extract(nested, "11", 10).atVariant, U.extract(nested, "11", 10).windowMax], [1.23, 2]);
assert.strictEqual(U.extract({}, "11", 10).atVariant, null);

console.log("all checks passed");
