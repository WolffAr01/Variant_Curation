# Variant Curation

A free webpage that takes an rsID, reference allele and nucleotide change (A, delC, insGA) and pulls curation information into one readable report.

Current step: dbSNP only (variant type, frequencies, ClinVar records for the matching allele). gnomAD, UCSC and Varsome come next.

Everything runs in the browser using NCBI's public Variation Services API. Nothing you enter is stored.

Run the offline checks with `node tests/run.js`.
