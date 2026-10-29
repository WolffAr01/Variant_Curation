// Cloudflare Worker that relays read-only requests to the curation APIs and
// adds the CORS header browsers need. Only the routes below are allowed.
//   GET /dbsnp/775194825             ->  NCBI Variation Services refsnp record
//   GET /clinvar-search/1194479      ->  ClinVar variation IDs for a ClinVar allele ID
//   GET /clinvar-summary/1035131     ->  ClinVar summary (JSON) for a variation ID
//   GET /clinvar-vcv/1035131         ->  ClinVar full record (VCV XML) for a variation ID
//   GET /gnomad/11-19185046-C-A      ->  gnomAD v4 frequencies and in silico predictors
//   GET /hg38-base/11/19185045       ->  one GRCh38 reference base (1-based position), from UCSC
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const NUMBER = /^\d+$/;

const GNOMAD_QUERY = `query ($id: String!) {
  variant(variantId: $id, dataset: gnomad_r4) {
    variant_id
    exome { ac an homozygote_count filters }
    genome { ac an homozygote_count filters }
    in_silico_predictors { id value }
  }
}`;

const ROUTES = {
  dbsnp: { check: NUMBER, url: (id) => "https://api.ncbi.nlm.nih.gov/variation/v0/refsnp/" + id },
  "clinvar-search": {
    check: NUMBER,
    url: (id) => EUTILS + "esearch.fcgi?db=clinvar&retmode=json&tool=variant-curation&term=" + id + "%5Balleleid%5D",
  },
  "clinvar-summary": {
    check: NUMBER,
    url: (id) => EUTILS + "esummary.fcgi?db=clinvar&retmode=json&tool=variant-curation&id=" + id,
  },
  "clinvar-vcv": {
    check: NUMBER,
    url: (id) => EUTILS + "efetch.fcgi?db=clinvar&rettype=vcv&tool=variant-curation&id=" + id,
  },
  gnomad: {
    check: /^([1-9]|1\d|2[0-2]|X|Y|M)-\d+-[ACGT]+-[ACGT]+$/,
    url: () => "https://gnomad.broadinstitute.org/api",
    init: (id) => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: GNOMAD_QUERY, variables: { id } }),
    }),
  },
  "hg38-base": {
    check: /^([1-9]|1\d|2[0-2]|X|Y|M)\/\d+$/,
    url: (id) => {
      const [chrom, pos] = id.split("/");
      return "https://api.genome.ucsc.edu/getData/sequence?genome=hg38;chrom=chr" + chrom +
        ";start=" + (Number(pos) - 1) + ";end=" + pos;
    },
  },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: CORS });

    const [, source, ...rest] = new URL(request.url).pathname.split("/");
    const route = ROUTES[source];
    const id = decodeURIComponent(rest.join("/"));
    if (!route || !route.check.test(id)) return new Response("Not found", { status: 404, headers: CORS });

    const upstream = await fetch(route.url(id), route.init ? route.init(id) : undefined);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...CORS,
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
};
