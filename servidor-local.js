// Servidor local para testar sem a Vercel.
// Uso:  node servidor-local.js      e abra  http://localhost:3000/?tela=exterior&bu=1t
// Precisa de Node 18 ou mais novo. Não instala nada.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { lote, validar, diagnostico, tseFetch, tseArquivo, exportarCache, importarCache } = require("./api/_bu.js");
// boletins já lidos ficam guardados neste arquivo: reiniciar não baixa tudo de novo
const ARQ_CACHE = path.join(__dirname, "boletins-lidos.json");
try { console.log(`${importarCache(JSON.parse(fs.readFileSync(ARQ_CACHE, "utf8")))} boletins carregados do arquivo`); } catch {}
setInterval(() => { try { fs.writeFileSync(ARQ_CACHE, JSON.stringify(exportarCache())); } catch {} }, 20000);

const PORTA = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const BASE = process.env.TSE_BASE || "https://resultados.tse.jus.br/oficial/";
const PERMITIDO = /^(comum|ele20\d\d)\/[A-Za-z0-9_\-\/\.]+\.(json|imgbu|dat|bu)$/;
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json" };

// cache simples em memória: boletins não mudam; o resto expira em 30 s
const cache = new Map();

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname === "/api/diag") {
    const q = u.searchParams;
    try {
      const r = await diagnostico(q.get("ano") || "2026", q.get("pl") || "3221", q.get("id") || "6258", q.get("q") || "TOQUIO");
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(r, null, 2));
    } catch (e) { res.writeHead(502); res.end(String(e)); }
    return;
  }
  // tudo o que já foi lido, de uma vez (o painel abre instantâneo em qualquer aparelho)
  if (u.pathname === "/api/estado") {
    if (global.__estadoBU) {
      const e = global.__estadoBU(), lidos = {};
      for (const [k, l] of Object.entries(e.lidos || {})) if (l.votos) lidos[k] = { votos: l.votos, extra: l.extra, quando: l.quando, v1: l.v1, e1: l.e1 };
      res.writeHead(200, { "Content-Type": "application/json" });
      const s = e.situacao || {};
      const espera = Math.ceil((e.pausaTSE || 0) / 1000);
      const status = espera > 0 ? `⏳ TSE pediu para esperar · volta a ler em ${espera} s` : s.lendo ? `monitor lendo agora${e.status ? ` (${e.status.replace(/^.*?:\s*/, "")})` : ""}`
                             : s.proxima ? `próxima leitura às ${new Date(s.proxima).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}` : "";
      return res.end(JSON.stringify({ servidorLe: true, secoes: e.secoes, r: lidos, nomes: e.nomes, status }));
    }
    const q = Object.fromEntries(u.searchParams), out = {};
    for (const [k, v] of Object.entries(exportarCache())) {
      const [ano, pl, id, sec] = k.split("/");
      if (ano !== q.ano) continue;
      if (pl === q.pl && id === q.id) Object.assign(out[sec] || (out[sec] = {}), { votos: v.votos, extra: v.extra, quando: v.quando });
      else if (pl === q.pl1 && id === q.id1) Object.assign(out[sec] || (out[sec] = {}), { v1: v.votos, e1: v.extra });
    }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ r: out }));
    return;
  }
  // botão "Atualizar agora": faz o monitor ler na hora
  if (u.pathname === "/api/agora") {
    const pais = u.searchParams.get("pais");
    if (pais && global.__lerPais) {
      try { const x = await global.__lerPais(pais); res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ r: "lido", ...x })); }
      catch (e) { res.writeHead(502); return res.end(JSON.stringify({ erro: String(e) })); }
    }
    const r = global.__acordar ? global.__acordar() : "monitor desligado";
    const e = global.__estadoBU ? global.__estadoBU() : {};
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ r, pausaTSE: e.pausaTSE || 0 }));
  }
  if (u.pathname === "/api/lote") {
    const p = validar(Object.fromEntries(u.searchParams));
    if (!p) { res.writeHead(400); return res.end('{"erro":"parâmetros inválidos"}'); }
    try { const r = await lote(p.ano, p.pl, p.id, p.lista, u.searchParams.get("f") === "1");
      const v = Object.values(r), ok = v.filter(x => x.votos).length, pend = v.filter(x => x.pendente).length, err = v.filter(x => x.erro);
      // só mostra quando chegou boletim novo ou deu erro (as urnas sem boletim ainda são normais)
      const novas = v.filter(x => x.votos && !x.doCache).length;
      if (novas || err.length) console.log(`[${new Date().toLocaleTimeString("pt-BR")}] pleito ${p.pl}: ${novas} boletins novos${err.length ? `, ${err.length} com erro (ex.: ${err[0].erro})` : ""}`);
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ r })); }
    catch (e) { res.writeHead(502); res.end(JSON.stringify({ erro: String(e) })); }
    return;
  }
  if (u.pathname === "/api/tse") {
    const p = u.searchParams.get("path") || "";
    if (!PERMITIDO.test(p) || p.includes("..")) { res.writeHead(400); return res.end('{"erro":"path inválido"}'); }
    const fixo = /\.(imgbu|dat|bu)$/.test(p) || /\/[0-9a-f]{20,}\//i.test(p);
    const c = cache.get(p);
    // arquivos que não mudam (2022, 1º turno, configuração): guardados por 10 min, inclusive o "não existe"
    const estavel = /^ele2022\//.test(p) || /\/6257\//.test(p) || /\/config\//.test(p);
    if (c && (fixo || Date.now() - c.t < (estavel ? 600000 : 30000))) { res.writeHead(c.status, { "Content-Type": c.tipo }); return res.end(c.corpo); }
    try {
      const r = await tseArquivo(p, true);   // pedido do painel: prioridade
      const corpo = Buffer.from(await r.arrayBuffer());
      const tipo = p.endsWith(".json") ? "application/json; charset=utf-8" : "application/octet-stream";
      cache.set(p, { t: Date.now(), status: r.status, tipo, corpo });   // inclusive "não existe ainda" (30 s)
      res.writeHead(r.status, { "Content-Type": tipo }); res.end(corpo);
    } catch (e) {
      res.writeHead(502); res.end(JSON.stringify({ erro: "falha ao consultar o TSE", detalhe: String(e) }));
    }
    return;
  }
  let arq = path.join(PUBLIC, u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname));
  if (!arq.startsWith(PUBLIC) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) arq = path.join(PUBLIC, "index.html");
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)] || "application/octet-stream" });
  fs.createReadStream(arq).pipe(res);
}).listen(PORTA, () => {
  console.log(`Apuração rodando em http://localhost:${PORTA}`);
  console.log(`Teste (1º turno): http://localhost:${PORTA}/?tela=exterior&bu=1t`);
  console.log(`Exterior hoje:    http://localhost:${PORTA}/?tela=exterior`);
});
