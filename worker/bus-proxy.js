/**
 * 澳門巴士即時報站 —— Cloudflare Worker 代理範本
 *
 * 為什麼需要它？
 *   1. 澳門官方（DSAT）與 data.gov.mo 的實時報站服務沒有開放跨網域（CORS），瀏覽器無法直呼
 *   2. API Key 不該放在前端（公開網站會外洩）
 * 這個 Worker 幫你：加上 CORS 標頭 + 在伺服器端保管 Key
 *
 * 部署：
 *   npm i -g wrangler
 *   wrangler deploy worker/bus-proxy.js --name macau-bus-proxy
 *   wrangler secret put DSAT_KEY        # 填入你的 API Key（若上游需要）
 * 然後在網站「圖層面板 → 🚌 設定即時報站 API」填入：
 *   https://macau-bus-proxy.<你的帳號>.workers.dev/?stop={stop}
 *
 * 回傳格式（本專案前端可自動解析）：
 *   [{"route":"9A","eta":"3 分鐘"}, {"route":"18","eta":"即將到站"}]
 */

const UPSTREAM = "https://api.dsati.gov.mo/bus/REPLACE_ME"; // ← 換成實際上遊端點（或用環境變數 UPSTREAM）

export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOW_ORIGIN ?? "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Cache-Control": "no-store",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const stop = url.searchParams.get("stop") ?? "";
    const name = url.searchParams.get("name") ?? "";
    if (!stop && !name) {
      return Response.json({ error: "missing stop parameter" }, { status: 400, headers: cors });
    }

    const upstream = (env.UPSTREAM ?? UPSTREAM)
      .replace("{stop}", encodeURIComponent(stop))
      .replace("{name}", encodeURIComponent(name));
    const headers = { "User-Agent": "macau-3d-atlas/1.0" };
    if (env.DSAT_KEY) headers.Authorization = `Bearer ${env.DSAT_KEY}`;

    try {
      const res = await fetch(upstream, { headers, cf: { cacheTtl: 10 } });
      const text = await res.text();
      // 若上游已回傳前端可解析的格式，原樣轉出；若為 HTML 則提示需自行轉換
      const looksJson = text.trim().startsWith("[") || text.trim().startsWith("{");
      if (!looksJson) {
        return Response.json(
          { error: "upstream 回傳非 JSON，請在 Worker 內轉換格式（見檔案說明）", sample: text.slice(0, 200) },
          { status: 502, headers: cors }
        );
      }
      return new Response(text, { headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 502, headers: cors });
    }
  },
};
