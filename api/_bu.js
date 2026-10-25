// Leitura dos boletins de urna no servidor (usado por api/lote.js e servidor-local.js).
// Mesmo código do navegador (public/dados.js), em lotes: bem mais rápido que urna por urna.
function acharHashes(o) {
  if (Array.isArray(o)) { if (o.some(x => x && x.hash)) return o; for (const v of o) { const r = acharHashes(v); if (r) return r; } }
  else if (o && typeof o === "object") for (const v of Object.values(o)) { const r = acharHashes(v); if (r) return r; }
  return null;
}
// horário de recebimento do boletim, se o TSE informar (dd/mm/aaaa hh:mm ou aaaa-mm-dd hh:mm)
function dataDe(o) {
  if (!o || typeof o !== "object") return null;
  const t = Object.values(o).filter(v => typeof v === "string").join(" ");
  let m = t.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime();
  m = t.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  return null;
}
/* ---- leitor do boletim binário (-bu.dat / .bu): ASN.1 DER, especificação do TSE (bu.asn1, IMPLICIT TAGS) ---- */
function derLer(b, ini = 0, fim = b.length) {
  const nos = [];
  let i = ini;
  while (i < fim) {
    const tag = b[i++];
    if ((tag & 0x1f) === 0x1f) { while (b[i++] & 0x80); }           // tag longa (não usada no BU)
    let len = b[i++];
    if (len & 0x80) { const n = len & 0x7f; len = 0; for (let k = 0; k < n; k++) len = len * 256 + b[i++]; }
    const no = { tag, ini: i, fim: i + len };
    if (tag & 0x20) no.f = derLer(b, i, i + len);
    nos.push(no); i += len;
  }
  return nos;
}
const derInt = (b, no) => { let v = 0; for (let i = no.ini; i < no.fim; i++) v = v * 256 + b[i]; return v; };
// devolve { votos:{numero:qtd}, extra:{aptos, comp, brancos, nulos} } de Presidente na eleição pedida
function lerBUdat(b, idEleicao) {
  const env = derLer(b)[0];
  if (!env || !env.f) return null;
  const conteudo = [...env.f].reverse().find(n => n.tag === 0x04);
  if (!conteudo) return null;
  const bu = derLer(b, conteudo.ini, conteudo.fim)[0];
  if (!bu || !bu.f) return null;
  let achou = null;
  // ResultadoVotacaoPorEleicao: SEQUENCE { INTEGER idEleicao, INTEGER aptos, INTEGER, INTEGER, SEQUENCE OF ResultadoVotacao, OCTET, OCTET }
  (function procurar(nos) {
    for (const n of nos || []) {
      if (achou) return;
      const f = n.f;
      const resv = f && f.find((x, i) => i >= 2 && x.tag === 0x30);
      if (n.tag === 0x30 && f && f.length >= 3 && f[0].tag === 0x02 && f[1].tag === 0x02 && resv) {
        const id = derInt(b, f[0]);
        if (!idEleicao || id === +idEleicao) {
          const r = { votos: {}, extra: { aptos: derInt(b, f[1]), comp: 0, brancos: 0, nulos: 0 } };
          let temPres = false;
          for (const rv of resv.f || []) {                // ResultadoVotacao { ENUM tipoCargo, INTEGER comparecimento, SEQUENCE OF TotalVotosCargo }
            const g = rv.f || []; if (g.length < 3) continue;
            for (const tc of g[2].f || []) {               // TotalVotosCargo { [1] cargo, INTEGER ordem, SEQUENCE OF TotalVotosVotavel }
              const h = tc.f || []; if (h.length < 3) continue;
              if (!(h[0].tag === 0x81 && derInt(b, h[0]) === 1)) continue;   // 1 = presidente
              temPres = true; r.extra.comp = derInt(b, g[1]);
              for (const vv of h[2].f || []) {             // TotalVotosVotavel { [1] tipo, [2] qtd, [3] {partido, codigo}?, ... }
                const c = vv.f || [];
                const tipo = c.find(x => x.tag === 0x81), qtd = c.find(x => x.tag === 0x82), ident = c.find(x => x.tag === 0xa3);
                if (!tipo || !qtd) continue;
                const t = derInt(b, tipo), q = derInt(b, qtd);
                if (t === 1 && ident && ident.f && ident.f[1]) r.votos[String(derInt(b, ident.f[1]))] = q;
                else if (t === 2) r.extra.brancos += q;
                else if (t === 3) r.extra.nulos += q;
              }
            }
          }
          if (temPres) { achou = r; return; }
        }
      }
      if (f) procurar(f);
    }
  })(bu.f);
  return achou;
}
// escolhe o pacote de arquivos válido no -aux.json: "Totalizado" ou o último publicado
function escolherHash(aux) {
  const hs = (acharHashes(aux) || []).filter(h => h && h.hash && h.hash !== "0" && !/exclu|cancel|anula/i.test(h.st || ""));
  if (!hs.length) return null;
  const tot = hs.filter(h => /^totalizad/i.test(h.st || ""));
  const h = tot.length ? tot[tot.length - 1] : hs[hs.length - 1];
  const nomes = [...(h.arq || []).map(a => a && (a.tp === "bu" ? "!" : "") + (a.nm || "")), ...(h.nmarq || [])];
  let bu = nomes.find(n => n.startsWith("!"));
  bu = bu ? bu.slice(1) : nomes.find(n => /(-bu\.dat|\.bu)$/i.test(n));
  const img = nomes.find(n => /(-imgbu\.dat|\.imgbu)$/i.test(n));
  return { h, bu, img };
}

const pad6 = c => String(+c).padStart(6, "0");
const BASE = process.env.TSE_BASE || "https://resultados.tse.jus.br/oficial/";
const H = { "User-Agent": "Mozilla/5.0 (apuracao)", Accept: "*/*" };

/* ---- ritmo dos pedidos ao TSE: poucos ao mesmo tempo, com intervalo; se vier 429, pausa e tenta de novo ---- */
const MAX_JUNTOS = 4, INTERVALO_MS = 200;   // até ~5 pedidos por segundo (pausa sozinho se o TSE reclamar)
let ativos = 0, ultimoPedido = 0, pausaAte = 0, seguidos = 0;
const fila = [];
const dormir = ms => new Promise(r => setTimeout(r, ms));
async function vez(prio) {
  // pedidos do painel (prio) passam na frente da leitura do monitor
  if (ativos >= MAX_JUNTOS) await new Promise(r => prio ? fila.unshift(r) : fila.push(r));
  ativos++;
  for (;;) {
    const agora = Date.now(), espera = Math.max(pausaAte - agora, ultimoPedido + INTERVALO_MS - agora);
    if (espera <= 0) break;
    await dormir(espera);
  }
  ultimoPedido = Date.now();
}
function liberar() { ativos--; const p = fila.shift(); if (p) p(); }
const status = { pausas: 0, ultimoAviso: "" };
async function tseFetch(url, prio) {
  for (let t = 0; t < 6; t++) {
    await vez(prio);
    let r;
    try { r = await fetch(url, { headers: H }); } finally { liberar(); }
    if (r.status !== 429 && r.status !== 503) { seguidos = 0; return r; }
    seguidos++;
    const ra = Number(r.headers.get("retry-after")) || 0;
    const ms = Math.max(ra * 1000, Math.min(120000, 5000 * 2 ** Math.min(seguidos - 1, 5)));   // 5 s, 10 s, 20 s… até 2 min
    // só aumenta a pausa se ela já não estiver valendo (vários 429 juntos contam como um)
    if (pausaAte < Date.now()) pausaAte = Date.now() + ms;
    status.pausas++; status.ultimoAviso = `TSE pediu para esperar (HTTP ${r.status}); pausa de ${Math.round(ms / 1000)} s`;
    console.log(status.ultimoAviso);
  }
  throw new Error("o TSE está limitando os pedidos (HTTP 429); tente de novo em alguns minutos");
}

/* ---- arquivos que não mudam (lista de urnas, configuração, 2022, 1º turno) ficam salvos no disco ---- */
const fsx = require("fs"), px = require("path");
const DIR_CACHE = process.env.CACHE_DIR || px.join(__dirname, "..", "cache-tse");
const estavel = p => /\/config\//.test(p) || /^ele2022\//.test(p) || /\/6257\//.test(p) || /\/arquivo-urna\/3220\//.test(p) && !/-aux\.json$/.test(p);
const arqDe = p => px.join(DIR_CACHE, p.replace(/[^\w.-]+/g, "_"));
// busca um arquivo do TSE pelo caminho (ex.: "ele2026/arquivo-urna/3221/config/zz/zz-p003221-cs.json");
// se for estável e já estiver no disco, nem pergunta ao TSE
async function tseArquivo(p, prio) {
  if (estavel(p)) { try { const b = fsx.readFileSync(arqDe(p)); return new Response(b, { status: 200 }); } catch {} }
  const r = await tseFetch(BASE + p, prio);
  if (estavel(p) && r.ok) {
    const b = Buffer.from(await r.arrayBuffer());
    try { fsx.mkdirSync(DIR_CACHE, { recursive: true }); fsx.writeFileSync(arqDe(p), b); } catch {}
    return new Response(b, { status: 200 });
  }
  return r;
}

/* ---- cache: boletim lido não muda; "ainda sem boletim" vale 20 s ---- */
const cache = new Map();
function doCache(k) {
  const c = cache.get(k); if (!c) return null;
  if (c.v.votos || Date.now() - c.t < 20000) return c.v;
  return null;
}

// lê uma seção: { votos, extra, quando } | { pendente: true } | { erro }
async function lerSecao(ano, pl, id, mu, z, ns, forcar) {
  const k = `${ano}/${pl}/${id}/${mu}-${z}-${ns}`;
  const c = doCache(k); if (c && (c.votos || !forcar)) return c.votos ? { ...c, doCache: true } : c;
  const v = await lerSecaoTSE(ano, pl, id, mu, z, ns);
  if (v.votos || v.pendente) cache.set(k, { t: Date.now(), v });
  return v;
}
async function lerSecaoTSE(ano, pl, id, mu, z, ns) {
  const base = `${BASE}ele${ano}/arquivo-urna/${pl}/dados/zz/${mu}/${z}/${ns}`;
  const ra = await tseFetch(`${base}/p${pad6(pl)}-zz-m${mu}-z${z}-s${ns}-aux.json`);
  if (ra.status === 404) return { pendente: true };
  if (!ra.ok) return { erro: "aux HTTP " + ra.status };
  const aux = await ra.json();
  const e = escolherHash(aux);
  if (!e || !e.bu) return { pendente: true };
  const rb = await tseFetch(`${base}/${e.h.hash}/${e.bu}`);
  if (!rb.ok) return rb.status === 404 ? { pendente: true } : { erro: "bu HTTP " + rb.status };
  const r = lerBUdat(new Uint8Array(await rb.arrayBuffer()), id);
  if (!r || !Object.keys(r.votos).length) return { erro: "boletim sem votos de Presidente" };
  r.quando = dataDe(e.h) || dataDe(aux);
  return r;
}
// lista: ["mu-z-ns", ...] (até 60)
async function lote(ano, pl, id, lista, forcar) {
  const out = {};
  await Promise.all(lista.map(async k => {
    const [mu, z, ns] = k.split("-");
    try { out[k] = await lerSecao(ano, pl, id, mu, z, ns, forcar); } catch (e) { out[k] = { erro: String(e.message || e) }; }
  }));
  return out;
}
// valida os parâmetros vindos da URL
function validar(q) {
  const ano = String(q.ano || ""), pl = String(q.pl || ""), id = String(q.id || "");
  const lista = String(q.s || "").split(",").filter(Boolean);
  if (!/^20\d\d$/.test(ano) || !/^\d{3,5}$/.test(pl) || !/^\d{3,5}$/.test(id)) return null;
  if (!lista.length || lista.length > 60 || !lista.every(k => /^\d{5}-\d{4}-\d{4}$/.test(k))) return null;
  return { ano, pl, id, lista };
}
// diagnóstico: mostra, para as urnas de uma cidade, o que o TSE devolve em cada passo
async function diagnostico(ano, pl, id, busca) {
  const norm = x => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const rc = await fetch(`${BASE}ele${ano}/arquivo-urna/${pl}/config/zz/zz-p${pad6(pl)}-cs.json`, { headers: H });
  if (!rc.ok) return { erro: "lista de urnas: HTTP " + rc.status };
  const cs = await rc.json();
  const cidades = [];
  (function andar(o) {
    if (Array.isArray(o)) return o.forEach(andar);
    if (!o || typeof o !== "object") return;
    if (o.nm && /^\d{5}$/.test(String(o.cd)) && norm(o.nm).includes(norm(busca))) cidades.push(o);
    Object.values(o).forEach(andar);
  })(cs);
  const out = { busca, cidades: [] };
  for (const c of cidades.slice(0, 3)) {
    const secs = [];
    (function andar(o, z) {
      if (Array.isArray(o)) return o.forEach(v => andar(v, z));
      if (!o || typeof o !== "object") return;
      if (/^\d{4}$/.test(String(o.cd))) z = String(o.cd);
      if (o.ns != null && z) { secs.push({ z, ns: String(o.ns).padStart(4, "0"), nsp: o.nsp }); return; }
      Object.values(o).forEach(v => andar(v, z));
    })(c.zon || c);
    const info = { cd: c.cd, nm: c.nm, urnas: secs.length, amostra: [] };
    for (const s of secs.slice(0, 4)) {
      const base = `${BASE}ele${ano}/arquivo-urna/${pl}/dados/zz/${c.cd}/${s.z}/${s.ns}`;
      const d = { secao: `${s.z}/${s.ns}`, nsp: s.nsp };
      try {
        const ra = await fetch(`${base}/p${pad6(pl)}-zz-m${c.cd}-z${s.z}-s${s.ns}-aux.json`, { headers: H });
        d.aux_http = ra.status;
        if (ra.ok) {
          const aux = await ra.json();
          d.aux = JSON.stringify(aux).slice(0, 700);
          const e = escolherHash(aux);
          d.arquivo_bu = e && e.bu;
          if (e && e.bu) {
            const rb = await fetch(`${base}/${e.h.hash}/${e.bu}`, { headers: H });
            d.bu_http = rb.status;
            if (rb.ok) {
              const b = new Uint8Array(await rb.arrayBuffer());
              d.bu_bytes = b.length; d.bu_inicio = Buffer.from(b.slice(0, 24)).toString("hex");
              d.leitura = lerBUdat(b, id);
              if (!d.leitura) { const qualquer = lerBUdat(b, null); d.leitura_sem_filtro = qualquer; }
            }
          }
        }
      } catch (e) { d.erro = String(e.message || e); }
      info.amostra.push(d);
    }
    out.cidades.push(info);
  }
  return out;
}
function exportarCache() { const o = {}; for (const [k, c] of cache) if (c.v.votos) o[k] = c.v; return o; }
function importarCache(o) { for (const [k, v] of Object.entries(o || {})) if (v && v.votos) cache.set(k, { t: Date.now(), v }); return cache.size; }
const pausaRestante = () => Math.max(0, pausaAte - Date.now());
module.exports = { lote, validar, lerBUdat, derLer, diagnostico, tseFetch, tseArquivo, exportarCache, importarCache, status, pausaRestante };
