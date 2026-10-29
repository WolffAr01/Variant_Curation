// Cloudflare Worker that relays read-only requests to the curation APIs and
// adds the CORS header browsers need. Only the hosts below are allowed.
//   GET https://<worker>/dbsnp/775194825  ->  NCBI Variation Services refsnp record
const ROUTES = {
  dbsnp: (rest) => "https://api.ncbi.nlm.nih.gov/variation/v0/refsnp/" + rest,
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

    const upstream = await fetch(build(id), { headers: { Accept: "application/json" } });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
    });
  },
};
