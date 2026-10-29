// Cloudflare Worker that relays read-only requests to the curation APIs and
// adds the CORS header browsers need. Only the routes below are allowed.
//   GET /dbsnp/775194825           ->  NCBI Variation Services refsnp record
//   GET /clinvar-search/1194479    ->  ClinVar variation IDs for a ClinVar allele ID
//   GET /clinvar-summary/1035131   ->  ClinVar summary (JSON) for a variation ID
//   GET /clinvar-vcv/1035131       ->  ClinVar full record (VCV XML) for a variation ID
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const ROUTES = {
  dbsnp: (id) => "https://api.ncbi.nlm.nih.gov/variation/v0/refsnp/" + id,
  "clinvar-search": (id) => EUTILS + "esearch.fcgi?db=clinvar&retmode=json&tool=variant-curation&term=" + id + "%5Balleleid%5D",
  "clinvar-summary": (id) => EUTILS + "esummary.fcgi?db=clinvar&retmode=json&tool=variant-curation&id=" + id,
  "clinvar-vcv": (id) => EUTILS + "efetch.fcgi?db=clinvar&rettype=vcv&tool=variant-curation&id=" + id,
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
    const build = ROUTES[source];
    const id = rest.join("/");
    if (!build || !/^\d+$/.test(id)) return new Response("Not found", { status: 404, headers: CORS });

    const upstream = await fetch(build(id));
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
