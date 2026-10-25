// Proxy somente-leitura para os arquivos públicos do TSE (resultados e boletins de urna).
// Uso: /api/tse?path=ele2022/544/dados-simplificados/zz/zz-c0001-e000544-r.json
//      /api/tse?path=ele2022/arquivo-urna/407/dados/zz/29882/0001/0123/<hash>/<arquivo>.imgbu
const BASE = "https://resultados.tse.jus.br/oficial/";
const { tseFetch } = require("./_bu.js");
const PERMITIDO = /^(comum|ele20\d\d)\/[A-Za-z0-9_\-\/\.]+\.(json|imgbu|dat|bu)$/;

module.exports = async (req, res) => {
  const path = String((req.query && req.query.path) || "");
  if (!PERMITIDO.test(path) || path.includes("..")) {
    res.status(400).json({ erro: "path inválido" });
    return;
  }
  try {
    const r = await tseFetch(BASE + path);
    const corpo = Buffer.from(await r.arrayBuffer());
    // cache na borda da Vercel: protege o TSE e aguenta muito acesso simultâneo
    let cache = "public, s-maxage=30, stale-while-revalidate=60";            // resultados ao vivo, aux de seção
    if (/\/[0-9a-f]{20,}\//i.test(path) || /\.(imgbu|dat|bu)$/.test(path))          // arquivo de boletim (não muda)
      cache = "public, s-maxage=86400, immutable";
    else if (path.startsWith("ele2022") || path.startsWith("comum") || /\/config\//.test(path))
      cache = "public, s-maxage=600, stale-while-revalidate=3600";
    if (r.status === 404) cache = "public, s-maxage=20";
    res.setHeader("Cache-Control", cache);
    res.setHeader("Content-Type", path.endsWith(".json") ? "application/json; charset=utf-8" : "application/octet-stream");
    res.status(r.status).send(corpo);
  } catch (e) {
    res.status(502).json({ erro: "falha ao consultar o TSE", detalhe: String(e) });
  }
};
