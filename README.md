# Variant Curation

A free webpage that takes an rsID, reference allele and nucleotide change (A, delC, insGA) and pulls curation information into one readable report, in the order ActX needs:

1. Variant type: dbSNP Gene : Consequence
2. Frequency: dbSNP frequency list plus the gnomAD v4 Total column and homozygote count
3. Computational scores: gnomAD in silico predictors and UCSC GERP (hg19)
4. ACMG information: ClinVar records and germline classification, plus direct Varsome and Franklin links

Live page: https://wolffar01.github.io/Variant_Curation/

The page runs in the browser. Requests go through a small Cloudflare Worker relay (`worker/relay.js`, settings in `wrangler.toml`) because some of these APIs don't accept requests straight from a browser. Nothing you enter is stored.

Run the offline checks with `node tests/run.js`.
