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

console.log("all checks passed");
