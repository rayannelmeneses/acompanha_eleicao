/* ============================================================
   CONFIGURAÇÃO
   Se a descoberta automática falhar, preencha os códigos aqui
   (ou use na URL: ?e2026=COD1,COD2&pl2026=PLEITO)
   ============================================================ */
const CODIGOS_2026_MANUAL = null;   // ex.: ["619", "620"]
const PLEITO_2026_MANUAL = null;    // ex.: "801"
const TSE = "https://resultados.tse.jus.br/oficial/";
const UFS = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" ");
const NOME_UF = {AC:"Acre",AL:"Alagoas",AM:"Amazonas",AP:"Amapá",BA:"Bahia",CE:"Ceará",DF:"Distrito Federal",ES:"Espírito Santo",GO:"Goiás",MA:"Maranhão",MG:"Minas Gerais",MS:"Mato Grosso do Sul",MT:"Mato Grosso",PA:"Pará",PB:"Paraíba",PE:"Pernambuco",PI:"Piauí",PR:"Paraná",RJ:"Rio de Janeiro",RN:"Rio Grande do Norte",RO:"Rondônia",RR:"Roraima",RS:"Rio Grande do Sul",SC:"Santa Catarina",SE:"Sergipe",SP:"São Paulo",TO:"Tocantins"};
const qs = new URLSearchParams(location.search);
// ?bu=1t → modo teste: lê os boletins do 1º turno de 2026 e confere com o resultado oficial do 1º turno
const TESTE = qs.get("bu") === "1t";
const REF = { ano: 2022, t1: "544", t2: "545" };
// 2026: eleição 6257 (1º turno) e 6258 (2º turno); pleitos 3220 e 3221 (arquivos de urna)
let ATUAL = TESTE ? { ano: 2026, t1: "6257", t2: "6257", pl: "3220", pl1: null }
                  : { ano: 2026, t1: "6257", t2: "6258", pl: "3221", pl1: "3220" };

/* ============================================================ download */
async function baixar(path, tipo) {
  const tent = [`/api/tse?path=${encodeURIComponent(path)}`, TSE + path];
  let ult;
  for (const url of tent) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) { ult = new Error("HTTP " + r.status); if (r.status === 404) break; continue; }
      if (tipo === "txt") return new TextDecoder("windows-1252").decode(await r.arrayBuffer());
      if (tipo === "bin") return new Uint8Array(await r.arrayBuffer());
      return await r.json();
    } catch (e) { ult = e; }
  }
  throw ult || new Error("sem resposta");
}
const getJSON = p => baixar(p, "json");
const getTexto = p => baixar(p, "txt");
const getBin = p => baixar(p, "bin");
async function pool(itens, fn, conc = 12) {
  let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (i < itens.length) { const k = i++; try { await fn(itens[k]); } catch {} }
  }));
}
const pad6 = c => String(+c).padStart(6, "0");

// cache de resultados: o que já fechou fica guardado; o 2º turno atual expira em 30 s
const cacheRes = {};
const padraoOk = {};
function caminhos(ano, cd, abr, mu) {
  return mu ? [
    `ele${ano}/${cd}/dados/${abr}/${abr}${mu}-c0001-e${pad6(cd)}-u.json`,
    `ele${ano}/${cd}/dados/${abr}/${abr}${mu}-c0001-e${pad6(cd)}-v.json`,
    `ele${ano}/${cd}/dados-simplificados/${abr}/${abr}${mu}-c0001-e${pad6(cd)}-r.json`,
  ] : [
    `ele${ano}/${cd}/dados/${abr}/${abr}-c0001-e${pad6(cd)}-u.json`,
    `ele${ano}/${cd}/dados-simplificados/${abr}/${abr}-c0001-e${pad6(cd)}-r.json`,
  ];
}
async function resultadoBruto(ano, cd, abr, mu) {
  let lista = caminhos(ano, cd, abr, mu);
  const k = ano + cd + (mu ? "m" : "");
  if (padraoOk[k] != null) lista = [lista[padraoOk[k]], ...lista.filter((_, i) => i !== padraoOk[k])];
  let erro;
  for (const p of lista) {
    try { const d = await getJSON(p); padraoOk[k] = caminhos(ano, cd, abr, mu).indexOf(p); return d; }
    catch (e) { erro = e; }
  }
  throw erro;
}
// resultado lido (com nomes); null se ainda não existe
// o resultado oficial do 2º turno só começa a ser divulgado às 17h de Brasília (20h UTC)
const antesDaDivulgacao = () => !TESTE && !qs.get("depois17") && Date.now() < Date.UTC(2026, 9, 25, 20, 0) - 2 * 60000;
async function res(ano, cd, abr, mu = "") {
  if (!cd) return null;
  if (ano == ATUAL.ano && cd == ATUAL.t2 && antesDaDivulgacao()) return null;   // ainda não existe: nem pergunta
  const k = [ano, cd, abr, mu].join("|");
  const vivo = ano == ATUAL.ano && cd == ATUAL.t2;
  const c = cacheRes[k];
  if (c && (!vivo || Date.now() - c.t < 30000)) return c.v;
  let v = null;
  try { v = await lerComNomes(await resultadoBruto(ano, cd, abr, mu), ano, cd); if (!v.cands.length || !v.total) v = null; } catch {}
  cacheRes[k] = { t: Date.now(), v };
  return v;
}

/* ============================================================ códigos de 2026 */
async function descobrir() {
  if (TESTE) return;
  const q = qs.get("e2026");
  if (q && q.includes(",")) [ATUAL.t1, ATUAL.t2] = q.split(",").map(s => s.trim());
  else if (CODIGOS_2026_MANUAL) [ATUAL.t1, ATUAL.t2] = CODIGOS_2026_MANUAL;
  ATUAL.pl = qs.get("pl2026") || PLEITO_2026_MANUAL || ATUAL.pl;
  ATUAL.pl1 = qs.get("pl1") || ATUAL.pl1;
  if (ATUAL.t1 && ATUAL.t2 && ATUAL.pl && ATUAL.pl1) return;
  for (const p of ["comum/config/ele-c.json", "ele2026/comum/config/ele-c.json"]) {
    let cfg; try { cfg = await getJSON(p); } catch { continue; }
    const achados = [];
    (function andar(o, ciclo, pai) {
      if (Array.isArray(o)) return o.forEach(v => andar(v, ciclo, pai));
      if (!o || typeof o !== "object") return;
      const cd = String(o.cd ?? "");
      if (cd.startsWith("ele")) ciclo = cd;
      const eleicao = /^\d+$/.test(cd) && "nm" in o;
      if (eleicao) achados.push({ ciclo, o, pai });
      const ehPleito = /^\d+$/.test(cd) && !eleicao;
      Object.values(o).forEach(v => andar(v, ciclo, ehPleito ? cd : pai));
    })(cfg);
    const fed = achados.filter(x => (x.ciclo === "ele2026" || String(x.o.nm).includes("2026")) && /federal/i.test(x.o.nm));
    const t1 = fed.find(x => String(x.o.t) === "1"), t2 = fed.find(x => String(x.o.t) === "2");
    if (!ATUAL.t1 && t1) ATUAL.t1 = String(t1.o.cd);
    if (!ATUAL.t2) ATUAL.t2 = String((t1 && t1.o.cdt2) || (t2 && t2.o.cd) || "") || null;
    if (!ATUAL.pl && ATUAL.t2) { const e2 = achados.find(x => String(x.o.cd) === ATUAL.t2); if (e2 && e2.pai) ATUAL.pl = e2.pai; }
    if (!ATUAL.pl1 && ATUAL.t1) { const e1 = achados.find(x => String(x.o.cd) === ATUAL.t1); if (e1 && e1.pai) ATUAL.pl1 = e1.pai; }
    if (ATUAL.t1) return;
  }
}

/* ============================================================ leitura */
const num = x => {
  if (x == null || x === "") return 0;
  if (typeof x === "number") return x;
  let s = String(x).trim();
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
};
// todos os candidatos (objetos com "n" e "vap"), do primeiro cargo do arquivo.
// Em 2026 cada candidato fica dentro de agremiação → partido → cand, então é preciso juntar tudo.
function acharCands(o) {
  const raiz = o && Array.isArray(o.carg) && o.carg.length ? o.carg[0] : o;
  const out = [], vistos = new Set();
  (function andar(x) {
    if (Array.isArray(x)) return x.forEach(andar);
    if (!x || typeof x !== "object") return;
    if ("vap" in x && x.n != null) { const k = String(x.n); if (!vistos.has(k)) { vistos.add(k); out.push(x); } return; }
    for (const [k, v] of Object.entries(x)) if (k !== "vs") andar(v);   // "vs" = vices
  })(raiz);
  return out.length ? out : null;
}
function acharChave(o, k) {
  if (Array.isArray(o)) { for (const v of o) { const r = acharChave(v, k); if (r != null) return r; } }
  else if (o && typeof o === "object") {
    if (k in o) return o[k];
    for (const v of Object.values(o)) { const r = acharChave(v, k); if (r != null) return r; }
  }
  return null;
}
const NOMES_ANO = {};
const titulo = s => s.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Da|De|Do|Dos|Das|E)\b/g, w => w.toLowerCase());
function ler(d, ano, nacional) {
  const N = (NOMES_ANO[ano] = NOMES_ANO[ano] || {});
  const cands = (acharCands(d) || []).map(c => {
    const n = String(c.n ?? ""), bruto = String(c.nmu || c.nm || "").trim();
    if (bruto && (nacional || !N[n])) N[n] = titulo(bruto);   // o nome do arquivo nacional sempre vale
    return { n, nome: N[n] || `Nº ${n}`, semNome: !bruto && !N[n], votos: Math.round(num(c.vap)), pct: num(c.pvap) };
  });
  const total = cands.reduce((s, c) => s + c.votos, 0);
  if (total) cands.forEach(c => { if (!c.pct) c.pct = +(100 * c.votos / total).toFixed(2); });
  let pst = num(acharChave(d, "pst"));
  if (!pst) { const ss = d && d.s; if (ss && num(ss.ts)) pst = 100 * num(ss.st) / num(ss.ts); }
  return { cands, total, pst, ex: extrasDe(d) };
}
// eleitores, comparecimento, abstenção, brancos e nulos do arquivo oficial (e: {te, est, c, a}; v: {vb, tvn}; s: {ts, st})
function extrasDe(d) {
  const e = d && d.e, v = d && d.v, s = d && d.s;
  if (!e || typeof e !== "object") return null;
  const x = { te: num(e.te), est: num(e.est), c: num(e.c), a: num(e.a),
    vb: v ? num(v.vb) : 0, vn: v ? num(v.tvn != null ? v.tvn : v.vn) : 0, ts: s ? num(s.ts) : 0, st: s ? num(s.st) : 0 };
  if (!x.est) x.est = x.c + x.a;
  // só usa se as contas fecham (comparecimento + abstenção = eleitores das seções apuradas)
  if (!x.c || Math.abs(x.c + x.a - x.est) > Math.max(2, x.est * 0.01)) return null;
  return x;
}
const nomesOk = {};
async function lerComNomes(d, ano, cd) {
  const t = ler(d, ano);
  if (t.cands.some(c => c.semNome) && !nomesOk[ano + cd]) {
    nomesOk[ano + cd] = true;
    try { ler(await resultadoBruto(ano, cd, "br"), ano, true); } catch {}
  }
  const N = NOMES_ANO[ano] || {};
  t.cands.forEach(c => { if (c.semNome && N[c.n]) { c.nome = N[c.n]; c.semNome = false; } });
  return t;
}
// soma vários resultados (ex.: cidades de um país)
function somar(lista, ano, pst = 100) {
  const ok = lista.filter(Boolean); if (!ok.length) return null;
  const v = {};
  ok.forEach(t => t.cands.forEach(c => v[c.n] = (v[c.n] || 0) + c.votos));
  return deVotos(v, ano, pst);
}
function deVotos(v, ano, pst = 100) {
  const N = NOMES_ANO[ano] || {};
  const total = Object.values(v).reduce((s, x) => s + x, 0);
  if (!total) return null;
  return { total, pst, cands: Object.entries(v).map(([n, votos]) => ({ n, nome: N[n] || `Nº ${n}`, votos, pct: +(100 * votos / total).toFixed(2) })) };
}

/* ============================================================ análise */
function comparar(t1, t2) {
  const base = t2 && t2.cands.length ? t2 : t1;
  if (!base || !base.cands.length) return [];
  const fin = [...base.cands].sort((a, b) => b.votos - a.votos).slice(0, 2).sort((a, b) => +a.n - +b.n);
  return fin.map(f => {
    const c1 = t1 && t1.cands.find(c => c.n === f.n), c2 = t2 && t2.cands.find(c => c.n === f.n);
    const v1 = c1 ? c1.votos : 0, p1 = c1 ? c1.pct : 0;
    const L = { n: f.n, nome: f.nome, v1, p1, v2: null, p2: null, ganho: null, cresc: null, dpp: null };
    if (c2) {
      L.v2 = c2.votos; L.p2 = c2.pct; L.ganho = c2.votos - v1; L.dpp = +(c2.pct - p1).toFixed(2);
      if (v1) L.cresc = +(100 * L.ganho / v1).toFixed(2);
    }
    return L;
  });
}
const infoAno = (ano, t1, t2, rotulo) => ({ ano, t1, t2, rotulo, linhas: comparar(t1, t2) });
async function anosOficiais(abr) {
  const out = [];
  if (ATUAL.t1) {
    const [a, b] = await Promise.all([res(ATUAL.ano, ATUAL.t1, abr), res(ATUAL.ano, ATUAL.t2, abr)]);
    out.push(infoAno(ATUAL.ano, a, b));
  }
  const [c, d] = await Promise.all([res(REF.ano, REF.t1, abr), res(REF.ano, REF.t2, abr)]);
  out.push(infoAno(REF.ano, c, d));
  return out;
}

/* ============================================================ formatação */
const fN = n => n == null ? "—" : n.toLocaleString("pt-BR");
const fP = (n, s) => n == null ? "—" : (s && n > 0 ? "+" : "") + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fInt = n => n.toLocaleString("pt-BR");
const f1 = n => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = n => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cl = n => n == null ? "" : n >= 0 ? "pos" : "neg";
const CORES = ["var(--a)", "var(--b)"];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sgn = x => (x >= 0 ? "+" : "−") + fInt(Math.abs(x));

function cardAno(a) {
  const t2 = a.t2, pst = t2 ? t2.pst : 0;
  const st = a.rotulo || (t2 ? `2º turno: ${fP(pst)}% das seções` : "2º turno: aguardando divulgação");
  let h = `<div class="card"><div class="card-h"><h3>${a.ano}</h3><div class="st">${st}</div></div>
           <div class="prog"><i style="width:${Math.min(100, pst)}%"></i></div>`;
  if (!a.linhas.length) h += `<div class="err">sem dados ainda</div>`;
  a.linhas.forEach((l, i) => {
    h += `<div class="cand"><div class="nome"><span class="dot" style="background:${CORES[i]}"></span>${esc(l.nome)} <span class="num">${esc(l.n)}</span></div>`;
    if (l.v2 != null) {
      h += pst < 100
        ? `<div class="big ${cl(l.dpp)}">${fP(l.dpp, 1)} <span style="font-size:15px;font-weight:500">p.p.</span></div>
           <div class="kv"><span>ganho até agora <b>${sgn(l.ganho)}</b> votos (apuração parcial)</span></div>`
        : `<div class="big ${cl(l.ganho)}">${sgn(l.ganho)} <span style="font-size:15px;font-weight:500">votos</span></div>
           <div class="kv"><span>crescimento <b class="${cl(l.cresc)}">${l.cresc == null ? "—" : fP(l.cresc, 1) + "%"}</b></span>
           <span>variação <b class="${cl(l.dpp)}">${fP(l.dpp, 1)} p.p.</b></span></div>`;
    }
    h += `<div class="bars">
            <div class="br"><span>1º turno</span><div class="track"><i style="width:${l.p1}%;background:${CORES[i]};opacity:.45"></i></div><span>${fP(l.p1)}%</span></div>
            <div class="br"><span>2º turno</span><div class="track"><i style="width:${l.p2 || 0}%;background:${CORES[i]}"></i></div><span>${l.p2 != null ? fP(l.p2) + "%" : "—"}</span></div>
          </div>
          <div class="kv"><span>1º turno <b>${fN(l.v1)}</b></span><span>2º turno <b>${fN(l.v2)}</b></span></div></div>`;
  });
  return h + "</div>";
}

/* ============================================================ textos para postar */
const EMOJI = { "13": "🔴", "22": "🔵" };
const curto = s => { const p = String(s).trim().split(/\s+/); return p.length > 1 ? p[0] : p[0] || s; };
const mesma = (a, b) => a.n === b.n && a.nome.toLowerCase() === b.nome.toLowerCase();

// Post de um local (formato: 1º → 2º turno + comparação com 2022)
// d = { icone, local, linhas:[{n,nome,v1,v2}], ref:[{n,nome,v}]|null, parcial, fonte }
function montarTexto(d) {
  const L = d.linhas.filter(l => l.v2 != null);
  if (!L.length) return "";
  const tot = L.reduce((s, l) => s + l.v2, 0) || 1;
  const out = [`${d.icone || "📍"} ${d.local.toUpperCase()} | 1º → 2º turno${d.parcial ? ` (${d.parcial})` : ""}`, ""];
  L.forEach(l => {
    const g = l.v2 - l.v1, c = l.v1 ? `${g >= 0 ? "+" : "−"}${f1(Math.abs(100 * g / l.v1))}%` : "novo";
    out.push(`${EMOJI[l.n] || "⚪"} ${curto(l.nome)}: ${fInt(l.v1)} → ${fInt(l.v2)} (${sgn(g)} / ${c})`);
  });
  const ref = (d.ref || []).filter(r => r.v != null);
  if (ref.length) {
    const tr = ref.reduce((s, r) => s + r.v, 0) || 1;
    const blocos = [];
    L.forEach(l => {
      const p26 = 100 * l.v2 / tot;
      const r = ref.find(r => mesma(r, l));
      if (r) {
        const p22 = 100 * r.v / tr;
        blocos.push(p26 >= p22
          ? `📈 ${curto(l.nome)} superou 2022: passou de ${fInt(r.v)} votos (${f2(p22)}%) para ${fInt(l.v2)} (${f2(p26)}%)`
          : `📉 ${curto(l.nome)} ficou abaixo de 2022: passou de ${fInt(r.v)} votos (${f2(p22)}%) para ${fInt(l.v2)} (${f2(p26)}%)`);
        return;
      }
      const o = ref.find(r => r.n === l.n);
      if (o) {
        const p22 = 100 * o.v / tr, dif = p26 - p22;
        blocos.push(`${curto(l.nome)} ficou com ${f2(p26)}%, ${Math.abs(dif) >= 10 ? "muito " : ""}${dif >= 0 ? "acima" : "abaixo"} dos ${f2(p22)}% de ${curto(o.nome)}.`);
      }
    });
    blocos.forEach(b => out.push("", b));
  }
  if (d.fonte) out.push("", d.fonte);
  return out.join("\n");
}

// Post somando vários locais (2º turno 2022 × 2026, nos mesmos locais)
// rows: [{ l, icone, a22, b22, a26, b26 }]
function textoAgregado({ tit, nA26, nA22, nB26, nB22, rows: ok, unidade = ["local", "locais"], fonte }) {
  const n = x => +String(x ?? "").replace(/\D/g, "");
  const S = k => ok.reduce((s, r) => s + n(r[k]), 0);
  const a22 = S("a22"), b22 = S("b22"), a26 = S("a26"), b26 = S("b26");
  const pa22 = 100 * a22 / (a22 + b22), pa26 = 100 * a26 / (a26 + b26);
  const dA = a26 - a22, dB = b26 - b22, pp = pa26 - pa22;
  const pr = r => ({ p22: 100 * n(r.a22) / (n(r.a22) + n(r.b22)), p26: 100 * n(r.a26) / (n(r.a26) + n(r.b26)) });
  const melhorou = ok.filter(r => { const p = pr(r); return p.p26 > p.p22; }).length;
  const pc = (d, base) => base ? `${d >= 0 ? "+" : "−"}${f1(Math.abs(100 * d / base))}%` : "—";
  const N = ok.length, [u1, uN] = unidade;
  const A = curto(nA26), B = curto(nB26), B22 = curto(nB22);
  const av = ok.map(r => ({ r, pp: pr(r).p26 - pr(r).p22 })).filter(x => x.pp > 0).sort((x, y) => y.pp - x.pp).slice(0, 3);
  const linhas = [
    `🌍 ${tit.toUpperCase()} - 2º turno | ${A} 2026 × ${curto(nA22)} 2022`, "",
    `Em ${N} ${N === 1 ? u1 + " apurado" : uN + " apurados"}:`,
    `🔴 2022: ${fInt(a22)} votos (${f2(pa22)}%)`,
    `🔴 2026: ${fInt(a26)} (${f2(pa26)}%)`, "",
    `${dA >= 0 ? "📈" : "📉"} ${A} ${dA >= 0 ? "ganhou" : "perdeu"} ${fInt(Math.abs(dA))} votos (${pc(dA, a22)}), ${pp >= 0 ? "avançou" : "recuou"} ${f2(Math.abs(pp))} pontos e melhorou proporcionalmente em ${melhorou} de ${N} ${N === 1 ? u1 : uN}.`,
  ];
  if (av.length && N > 1) linhas.push("", "Maiores avanços:", ...av.map(x => `${x.r.icone || "•"} ${x.r.l} +${f2(x.pp)}`));
  linhas.push("",
    `${N === 1 ? `No mesmo ${u1}` : `Nos mesmos ${N} ${uN}`}, comparando em quantidade absoluta de votos nos segundos turnos de 2022 e 2026:`, "",
    `🔴 ${A}: ${sgn(dA)} votos`,
    `🔵 ${B}${B.toLowerCase() !== B22.toLowerCase() ? ` em relação a ${B22}` : ""}: ${sgn(dB)} votos`,
    `📊 Diferença: ${dA >= dB ? A : B} cresceu ${fInt(Math.abs(dA - dB))} votos a mais.`, "",
    `Proporcionalmente: ${A} ${pc(dA, a22)} × ${B} ${pc(dB, b22)}.`);
  if (fonte) linhas.push("", fonte);
  return linhas.join("\n");
}
const caixaTexto = (id, titulo, txt) => txt ? `<h3 class="sec">${esc(titulo)}</h3><textarea class="post" id="${id}" readonly rows="${txt.split("\n").length + 1}" style="min-height:0">${esc(txt)}</textarea>
  <button class="btn" data-copia="${id}">Copiar texto</button>` : "";
const refDe = t => t ? [...t.cands].sort((a, b) => b.votos - a.votos).slice(0, 2).map(c => ({ n: c.n, nome: c.nome, v: c.votos })) : null;
function textoDeAnos(anos, local, icone, extra = {}) {
  const a = anos.find(x => x.ano == ATUAL.ano && x.t2), r = anos.find(x => x.ano == REF.ano && x !== a);
  if (!a) return "";
  return montarTexto({ icone, local, linhas: a.linhas, ref: r && refDe(r.t2), ...extra });
}

/* ============================================================ países do exterior */
// cidades-sede de seção eleitoral no exterior → país (ISO). Cidade sem país aqui aparece com o próprio nome.
const PAISES = {
  // Américas
  "ASSUNCAO|CIUDAD DEL ESTE|ENCARNACION|PEDRO JUAN CABALLERO|SALTO DEL GUAIRA|CONCEPCION|HERNANDARIAS|KATUETE|CORONEL OVIEDO|SANTA RITA": ["PY", "Paraguai"],
  "BUENOS AIRES|CORDOBA|MENDOZA|ROSARIO|PUERTO IGUAZU|PASO DE LOS LIBRES|BARILOCHE|SAN CARLOS DE BARILOCHE": ["AR", "Argentina"],
  "MONTEVIDEU|RIVERA|CHUY|ARTIGAS|RIO BRANCO|SALTO|PUNTA DEL ESTE|MALDONADO": ["UY", "Uruguai"],
  "SANTIAGO|SANTIAGO DO CHILE": ["CL", "Chile"], "LIMA|IQUITOS": ["PE", "Peru"],
  "BOGOTA|LETICIA|MEDELLIN": ["CO", "Colômbia"],
  "CARACAS|SANTA ELENA DE UAIREN|PUERTO AYACUCHO|CIUDAD GUAYANA": ["VE", "Venezuela"],
  "LA PAZ|SANTA CRUZ DE LA SIERRA|COCHABAMBA|COBIJA|GUAYARAMERIN|PUERTO QUIJARRO|RIBERALTA": ["BO", "Bolívia"],
  "QUITO|GUAYAQUIL": ["EC", "Equador"], "GEORGETOWN|LETHEM": ["GY", "Guiana"], "PARAMARIBO": ["SR", "Suriname"],
  "CAIENA|SAINT GEORGES|SAINT-GEORGES DE L'OYAPOCK": ["GF", "Guiana Francesa"],
  "CIDADE DO MEXICO|MEXICO": ["MX", "México"], "GUATEMALA|CIDADE DA GUATEMALA": ["GT", "Guatemala"],
  "SAN SALVADOR": ["SV", "El Salvador"], "TEGUCIGALPA": ["HN", "Honduras"], "MANAGUA": ["NI", "Nicarágua"],
  "SAN JOSE": ["CR", "Costa Rica"], "CIDADE DO PANAMA|PANAMA": ["PA", "Panamá"], "HAVANA": ["CU", "Cuba"],
  "SANTO DOMINGO|SAO DOMINGOS": ["DO", "República Dominicana"], "PORTO PRINCIPE": ["HT", "Haiti"],
  "KINGSTON": ["JM", "Jamaica"], "PORT OF SPAIN|PORTO DE ESPANHA": ["TT", "Trinidad e Tobago"],
  "BRIDGETOWN": ["BB", "Barbados"], "NASSAU": ["BS", "Bahamas"],
  "TORONTO|MONTREAL|VANCOUVER|OTTAWA|CALGARY": ["CA", "Canadá"],
  "ATLANTA|BOSTON|CHICAGO|HARTFORD|HOUSTON|LOS ANGELES|MIAMI|NOVA YORK|NOVA IORQUE|NEW YORK|ORLANDO|SAO FRANCISCO|SAN FRANCISCO|WASHINGTON|NEWARK|FILADELFIA|PHILADELPHIA|DALLAS|DENVER|SEATTLE|SAN DIEGO|LAS VEGAS|PHOENIX|FORT LAUDERDALE|POMPANO BEACH|BOCA RATON|TAMPA|DANBURY|FRAMINGHAM|SOMERVILLE|PORTLAND|SALT LAKE CITY|CHARLOTTE|NASHVILLE|AUSTIN|SAN ANTONIO": ["US", "Estados Unidos"],
  // Europa
  "LISBOA|PORTO|FARO|COIMBRA|BRAGA|SETUBAL": ["PT", "Portugal"], "MADRI|MADRID|BARCELONA|VALENCIA|SEVILHA|MALAGA": ["ES", "Espanha"],
  "PARIS|LYON|MARSELHA|NICE": ["FR", "França"], "LONDRES|EDIMBURGO|MANCHESTER": ["GB", "Reino Unido"], "DUBLIN|DUBLIM": ["IE", "Irlanda"],
  "ROMA|MILAO|MILANO": ["IT", "Itália"], "BERLIM|MUNIQUE|FRANKFURT|HAMBURGO|COLONIA": ["DE", "Alemanha"],
  "ZURIQUE|GENEBRA|BERNA|BASILEIA": ["CH", "Suíça"], "BRUXELAS": ["BE", "Bélgica"], "AMSTERDA|AMSTERDAM|ROTERDA|HAIA": ["NL", "Países Baixos"],
  "VIENA": ["AT", "Áustria"], "ESTOCOLMO": ["SE", "Suécia"], "OSLO": ["NO", "Noruega"], "COPENHAGUE": ["DK", "Dinamarca"],
  "HELSINQUE": ["FI", "Finlândia"], "VARSOVIA": ["PL", "Polônia"], "PRAGA": ["CZ", "Tchéquia"], "BUDAPESTE": ["HU", "Hungria"],
  "ATENAS": ["GR", "Grécia"], "MOSCOU": ["RU", "Rússia"], "KIEV|KIIV|KYIV": ["UA", "Ucrânia"], "BUCARESTE": ["RO", "Romênia"],
  "SOFIA": ["BG", "Bulgária"], "BELGRADO": ["RS", "Sérvia"], "ZAGREB": ["HR", "Croácia"], "LIUBLIANA": ["SI", "Eslovênia"],
  "BRATISLAVA": ["SK", "Eslováquia"], "LUXEMBURGO": ["LU", "Luxemburgo"], "NICOSIA": ["CY", "Chipre"], "VALETA|LA VALLETTA": ["MT", "Malta"],
  "REYKJAVIK": ["IS", "Islândia"], "TALIN|TALLINN": ["EE", "Estônia"], "RIGA": ["LV", "Letônia"], "VILNIUS": ["LT", "Lituânia"],
  "TIRANA": ["AL", "Albânia"], "ISTAMBUL|ANCARA": ["TR", "Turquia"], "TBILISI": ["GE", "Geórgia"], "EREVAN|IEREVAN": ["AM", "Armênia"],
  "BAKU": ["AZ", "Azerbaijão"], "MINSK": ["BY", "Belarus"], "ANDORRA LA VELLA": ["AD", "Andorra"], "MONACO": ["MC", "Mônaco"],
  // África
  "LUANDA": ["AO", "Angola"], "MAPUTO": ["MZ", "Moçambique"], "PRAIA": ["CV", "Cabo Verde"], "BISSAU": ["GW", "Guiné-Bissau"],
  "SAO TOME": ["ST", "São Tomé e Príncipe"], "PRETORIA|CIDADE DO CABO|JOANESBURGO": ["ZA", "África do Sul"], "CAIRO": ["EG", "Egito"],
  "ABUJA|LAGOS": ["NG", "Nigéria"], "ACRA|ACCRA": ["GH", "Gana"], "ADIS ABEBA": ["ET", "Etiópia"], "ARGEL": ["DZ", "Argélia"],
  "RABAT": ["MA", "Marrocos"], "TUNIS": ["TN", "Tunísia"], "DACAR": ["SN", "Senegal"], "NAIROBI": ["KE", "Quênia"],
  "DAR ES SALAAM": ["TZ", "Tanzânia"], "ABIDJAN": ["CI", "Costa do Marfim"], "KINSHASA": ["CD", "R. D. do Congo"],
  "BRAZZAVILLE": ["CG", "Congo"], "LIBREVILLE": ["GA", "Gabão"], "IAUNDE": ["CM", "Camarões"], "MALABO": ["GQ", "Guiné Equatorial"],
  "HARARE": ["ZW", "Zimbábue"], "LUSACA|LUSAKA": ["ZM", "Zâmbia"], "GABORONE": ["BW", "Botsuana"], "WINDHOEK": ["NA", "Namíbia"],
  "COTONOU": ["BJ", "Benin"], "LOME": ["TG", "Togo"], "CONACRI": ["GN", "Guiné"], "UAGADUGU": ["BF", "Burkina Faso"], "CARTUM": ["SD", "Sudão"],
  // Ásia e Oriente Médio
  "TOQUIO|NAGOIA|HAMAMATSU|OSAKA": ["JP", "Japão"], "SEUL": ["KR", "Coreia do Sul"],
  "PEQUIM|XANGAI|CANTAO|GUANGZHOU": ["CN", "China"], "HONG KONG": ["HK", "Hong Kong"], "TAIPE": ["TW", "Taiwan"],
  "SINGAPURA": ["SG", "Singapura"], "BANGCOC|BANGKOK|BANCOC": ["TH", "Tailândia"], "KUALA LUMPUR": ["MY", "Malásia"],
  "JACARTA": ["ID", "Indonésia"], "MANILA": ["PH", "Filipinas"], "HANOI|HO CHI MINH": ["VN", "Vietnã"],
  "NOVA DELHI|MUMBAI|BOMBAIM": ["IN", "Índia"], "ISLAMABAD": ["PK", "Paquistão"], "DACA": ["BD", "Bangladesh"],
  "COLOMBO": ["LK", "Sri Lanka"], "KATMANDU": ["NP", "Nepal"], "TEERA": ["IR", "Irã"], "BAGDA": ["IQ", "Iraque"],
  "DAMASCO": ["SY", "Síria"], "BEIRUTE": ["LB", "Líbano"], "AMA": ["JO", "Jordânia"], "TEL AVIV|TEL-AVIV": ["IL", "Israel"],
  "RAMALA": ["PS", "Palestina"], "RIADE|JIDA|JEDA": ["SA", "Arábia Saudita"], "KUWAIT|CIDADE DO KUWAIT|KUAITE": ["KW", "Kuwait"],
  "DOHA": ["QA", "Catar"], "ABU DHABI|ABU DABI|DUBAI": ["AE", "Emirados Árabes"], "MASCATE": ["OM", "Omã"], "MANAMA": ["BH", "Bahrein"],
  "ASTANA": ["KZ", "Cazaquistão"],
  // Oceania
  "SYDNEY|CAMBERRA|CANBERRA|MELBOURNE|BRISBANE|PERTH|GOLD COAST|ADELAIDE": ["AU", "Austrália"], "WELLINGTON|AUCKLAND": ["NZ", "Nova Zelândia"],
};
const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const MAPA_PAIS = {};
Object.entries(PAISES).forEach(([cs, v]) => cs.split("|").forEach(c => MAPA_PAIS[c] = v));
const bandeira = iso => iso && iso.length === 2 ? String.fromCodePoint(...[...iso].map(c => 127397 + c.charCodeAt(0))) : "🌍";
// continente de cada país (pelo código ISO)
const CONTINENTES = {
  "América do Sul": "AR BO CL CO EC GY GF PE PY SR UY VE",
  "América do Norte": "CA US MX",
  "América Central e Caribe": "BB BS CR CU DO GT HN HT JM NI PA SV TT",
  "Europa": "AD AL AT BE BG BY CH CY CZ DE DK EE ES FI FR GB GE GR HR HU IE IS IT LT LU LV MC MT NL NO PL PT RO RS RU SE SI SK TR UA AM AZ",
  "África": "AO BF BJ BW CD CG CI CM CV DZ EG ET GA GH GN GQ GW KE MA MZ NA NG SD SN ST TG TN TZ ZA ZM ZW",
  "Oriente Médio": "AE BH IL IQ IR JO KW LB OM PS QA SA SY",
  "Ásia": "BD CN HK ID IN JP KR KZ LK MY NP PH PK SG TH TW VN",
  "Oceania": "AU NZ",
};
const CONT_DE = {};
Object.entries(CONTINENTES).forEach(([c, l]) => l.split(" ").forEach(i => CONT_DE[i] = c));
// regiões do Brasil
const REGIOES = { "Norte": "AC AM AP PA RO RR TO", "Nordeste": "AL BA CE MA PB PE PI RN SE", "Centro-Oeste": "DF GO MS MT", "Sudeste": "ES MG RJ SP", "Sul": "PR RS SC" };
const REGIAO_DE = {};
Object.entries(REGIOES).forEach(([r, l]) => l.split(" ").forEach(u => REGIAO_DE[u] = r));
function paisDe(cidade) {
  const m = MAPA_PAIS[norm(cidade)];
  return m ? { cd: m[0], nome: m[1], flag: bandeira(m[0]), cont: CONT_DE[m[0]] || "Outros" }
           : { cd: "X-" + norm(cidade), nome: titulo(String(cidade)), flag: "🌍", cont: "Outros" };
}
/* ---- fuso horário: no exterior a votação vai das 8h às 17h no horário local ----
   Diferença para o UTC em 25/10/2026 (Europa já no horário de inverno; EUA, Canadá, Cuba, Bahamas ainda no de verão;
   Austrália e Nova Zelândia no de verão). Cidade em país com mais de um fuso tem valor próprio. */
const FUSO_PAIS = {
  AR: -3, BO: -4, CL: -3, CO: -5, EC: -5, GY: -4, GF: -3, PE: -5, PY: -3, SR: -3, UY: -3, VE: -4,
  MX: -6, BB: -4, BS: -4, CR: -6, CU: -4, DO: -4, GT: -6, HN: -6, HT: -4, JM: -5, NI: -6, PA: -5, SV: -6, TT: -4,
  CA: -4, US: -4,
  PT: 0, GB: 0, IE: 0, IS: 0,
  ES: 1, FR: 1, DE: 1, IT: 1, NL: 1, BE: 1, AT: 1, CH: 1, DK: 1, NO: 1, SE: 1, PL: 1, CZ: 1, HU: 1, HR: 1, SI: 1, SK: 1, LU: 1, MT: 1, AD: 1, MC: 1, AL: 1, RS: 1,
  GR: 2, RO: 2, BG: 2, FI: 2, EE: 2, LV: 2, LT: 2, CY: 2, UA: 2, RU: 3, BY: 3, TR: 3, GE: 4, AM: 4, AZ: 4,
  AO: 1, BF: 0, BJ: 1, BW: 2, CD: 1, CG: 1, CI: 0, CM: 1, CV: -1, DZ: 1, EG: 2, ET: 3, GA: 1, GH: 0, GN: 0, GQ: 1, GW: 0, KE: 3, MA: 1,
  MZ: 2, NA: 2, NG: 1, SD: 2, SN: 0, ST: 0, TG: 0, TN: 1, TZ: 3, ZA: 2, ZM: 2, ZW: 2,
  AE: 4, BH: 3, IL: 2, IQ: 3, IR: 3.5, JO: 3, KW: 3, LB: 2, OM: 4, PS: 2, QA: 3, SA: 3, SY: 3,
  BD: 6, CN: 8, HK: 8, ID: 7, IN: 5.5, JP: 9, KR: 9, KZ: 5, LK: 5.5, MY: 8, NP: 5.75, PH: 8, PK: 5, SG: 8, TH: 7, TW: 8, VN: 7,
  AU: 11, NZ: 13,
};
const FUSO_CIDADE = {
  "CHICAGO": -5, "HOUSTON": -5, "DALLAS": -5, "AUSTIN": -5, "SAN ANTONIO": -5, "NASHVILLE": -5,
  "DENVER": -6, "SALT LAKE CITY": -6, "PHOENIX": -7,
  "LOS ANGELES": -7, "SAO FRANCISCO": -7, "SAN FRANCISCO": -7, "SEATTLE": -7, "SAN DIEGO": -7, "LAS VEGAS": -7, "PORTLAND": -7,
  "VANCOUVER": -7, "CALGARY": -6, "BRISBANE": 10, "GOLD COAST": 10, "PERTH": 8, "ADELAIDE": 10.5,
};
// horário (ms) em que a votação termina na cidade hoje: 17h locais
function fechamentoDe(cidade) {
  const p = paisDe(cidade), iso = p.cd.length === 2 ? p.cd : null;
  const fuso = FUSO_CIDADE[norm(cidade)] ?? (iso != null ? FUSO_PAIS[iso] : undefined);
  if (fuso == null) return null;
  const dia = TESTE ? Date.UTC(2026, 9, 4) : Date.UTC(2026, 9, 25);   // dia da votação (1º turno: 4/10; 2º: 25/10)
  return dia + (17 - fuso) * 3600000;
}
// a votação ainda não acabou ali? (com 30 min de folga, por segurança)
const aindaVotando = cidade => { const f = fechamentoDe(cidade); return f != null && Date.now() < f - 90 * 60000; };

// lista de municípios de um estado (arquivo de configuração do TSE)
let CFG_MUN = null;
async function municipios(uf) {
  if (!CFG_MUN) {
    for (const cd of [ATUAL.t2, ATUAL.t1]) { try { CFG_MUN = await getJSON(`ele${ATUAL.ano}/${cd}/config/mun-e${pad6(cd)}-cm.json`); break; } catch {} }
    if (!CFG_MUN) return [];
  }
  const abr = (CFG_MUN.abr || []).find(a => String(a.cd).toUpperCase() === uf.toUpperCase());
  return abr ? (abr.mu || []).map(m => ({ cd: String(m.cd), nm: titulo(String(m.nm)) })).sort((a, b) => a.nm.localeCompare(b.nm, "pt-BR")) : [];
}

/* ============================================================ boletins de urna (exterior) */
const BU = { secoes: null, lidos: {}, rodando: false, erro: null, status: "", exemploFalha: null, ok: false };
function secoesDe(cs) {
  const out = [];
  (function andar(o, mu, nm, z) {
    if (Array.isArray(o)) return o.forEach(v => andar(v, mu, nm, z));
    if (!o || typeof o !== "object") return;
    const cd = String(o.cd ?? "");
    if (o.nm && /^\d{5}$/.test(cd)) { mu = cd; nm = String(o.nm); }
    else if (mu && /^\d{4}$/.test(cd)) z = cd;
    if (o.ns != null && mu && z) { if (o.nsp == null || o.nsp === "") out.push({ mu, nm, z, ns: String(o.ns).padStart(4, "0") }); return; }
    Object.values(o).forEach(v => andar(v, mu, nm, z));
  })(cs);
  return out;
}
function lerBU(txt) {
  const L = txt.split(/\r?\n/), votos = {}, extra = {};
  let i0 = L.findIndex(l => /presidente/i.test(l)); if (i0 < 0) i0 = 0;
  const pega = (re, k) => L.forEach(l => { const m = l.match(re); if (m && extra[k] == null) extra[k] = +m[1]; });
  pega(/eleitores\s+aptos\D*(\d+)/i, "aptos"); pega(/compareci\w*\D*(\d+)/i, "comp");
  const ignora = /total|nominais|branco|nulo|apto|compar|falto|legenda|eleitor|se[cç][aã]o|zona|munic/i;
  for (let i = i0 + 1; i < L.length; i++) {
    const l = L[i];
    if (/governador|senador|deputad/i.test(l)) break;
    let m;
    if ((m = l.match(/^\s*brancos?\D*(\d+)\s*$/i)) && extra.brancos == null) { extra.brancos = +m[1]; continue; }
    if ((m = l.match(/^\s*nulos?\D*(\d+)\s*$/i)) && extra.nulos == null) { extra.nulos = +m[1]; continue; }
    m = l.match(/^\s*(\D*?\S)\s{2,}(\d{2})\s{2,}(\d+)\s*$/);
    if (m && !ignora.test(m[1])) { votos[m[2]] = +m[3]; continue; }
    m = l.match(/^\s*(\d{2})\s*[-–]?\s+([^\d]*?\S)\s{2,}(\d+)\s*$/);
    if (m && !ignora.test(m[2])) { votos[m[1]] = +m[3]; continue; }
    m = l.match(/^\s*(\d{2})\s*[-–]?\s+[^\d]+$/);
    if (m) { const nx = (L[i + 1] || "").match(/^\s*(?:votos\s*:?)?\s*(\d+)\s*$/i); if (nx) { votos[m[1]] = +nx[1]; i++; } }
  }
  return { votos, extra };
}
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
  if (m) return Date.UTC(+m[3], m[2] - 1, +m[1], +m[4] + 3, +m[5], +(m[6] || 0));   // horário de Brasília (UTC−3), em qualquer servidor
  m = t.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4] + 3, +m[5], +(m[6] || 0));
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
// baixa e lê o boletim de uma seção num pleito; null se ainda não publicado
async function boletim(pl, s, idEleicao) {
  const base = `ele${ATUAL.ano}/arquivo-urna/${pl}/dados/zz/${s.mu}/${s.z}/${s.ns}`;
  const aux = await getJSON(`${base}/p${pad6(pl)}-zz-m${s.mu}-z${s.z}-s${s.ns}-aux.json`);
  const e = escolherHash(aux);
  if (!e || (!e.bu && !e.img)) return null;
  let r = null;
  if (e.bu) {
    try { r = lerBUdat(await getBin(`${base}/${e.h.hash}/${e.bu.replace(/^!/, "")}`), idEleicao); }
    catch (err) { if (!BU.exemploFalha) BU.exemploFalha = `Falha ao ler ${e.bu}: ${err.message}`; }
  }
  if ((!r || !Object.keys(r.votos).length) && e.img) {
    const txt = await getTexto(`${base}/${e.h.hash}/${e.img}`);
    r = lerBU(txt);
    if (!Object.keys(r.votos).length && !BU.exemploFalha) BU.exemploFalha = txt.slice(0, 1500);
  }
  if (!r || !Object.keys(r.votos).length) {
    if (!BU.exemploFalha) BU.exemploFalha = `Boletim sem votos de Presidente: ${base}/${e.h.hash}/${e.bu || e.img}`;
    return { erro: true };
  }
  r.quando = dataDe(e.h) || dataDe(aux);
  return r;
}
async function lerSecao(s) {
  const k = `${s.mu}-${s.z}-${s.ns}`;
  const l = BU.lidos[k] || (BU.lidos[k] = {});
  if (!l.votos) {
    const r = await boletim(ATUAL.pl, s, ATUAL.t2);
    if (!r) return;
    if (r.erro) { l.erro = true; return; }
    l.votos = r.votos; l.extra = r.extra; l.quando = r.quando; l.erro = false;
  }
  // mesma seção no 1º turno (as seções do exterior são as mesmas nos dois turnos)
  if (l.votos && !l.v1 && ATUAL.pl1 && !l.semV1) {
    try { const r1 = await boletim(ATUAL.pl1, s, ATUAL.t1); if (r1 && r1.votos) l.v1 = r1.votos; else l.semV1 = true; } catch { l.semV1 = true; }
  }
}
// lê várias seções de uma vez pelo servidor (/api/lote); se não houver servidor, cai para uma por uma
let loteOk = true;
async function lerLote(grupo, pl, id, forcar) {
  if (loteOk) {
    try {
      const q = `/api/lote?ano=${ATUAL.ano}&pl=${pl}&id=${id}&s=${grupo.map(s => `${s.mu}-${s.z}-${s.ns}`).join(",")}${forcar ? "&f=1" : ""}`;
      const r = await fetch(q, { cache: "no-store" });
      if (r.ok) return (await r.json()).r || {};
      if (r.status === 404) loteOk = false;
      else { BU.status = "o TSE pediu para ir mais devagar; esperando…"; setStatus(); await new Promise(z => setTimeout(z, 15000)); return {}; }
    } catch { }
  }
  const out = {};
  await pool(grupo, async s => {
    const k = `${s.mu}-${s.z}-${s.ns}`;
    try { out[k] = (await boletim(pl, s, id)) || { pendente: true }; } catch (e) { out[k] = /404/.test(e.message) ? { pendente: true } : { erro: e.message }; }
  }, 6);
  return out;
}
let ultimaTela = 0;
function mostrarAosPoucos(forcar) {
  if (estado.tela !== "exterior") return;
  if (forcar || Date.now() - ultimaTela > 2500) { ultimaTela = Date.now(); render(); }
}
async function rodadaLotes(lista, pl, id, aplicar, rotulo, forcar) {
  const grupos = [];
  for (let i = 0; i < lista.length; i += 30) grupos.push(lista.slice(i, i + 30));
  let feitos = 0;
  await pool(grupos, async g => {
    const r = await lerLote(g, pl, id, forcar);
    g.forEach(s => { const k = `${s.mu}-${s.z}-${s.ns}`; aplicar(BU.lidos[k] || (BU.lidos[k] = {}), r[k] || { erro: "sem resposta" }); });
    feitos += g.length;
    BU.status = `${rotulo} ${feitos} de ${lista.length} que ainda faltam`; setStatus();
    mostrarAosPoucos();
    if (Math.random() < .3) guardarLidos();
  }, loteOk ? 2 : 1);
}
// lê agora, sem esperar a fila, as urnas de um lugar (botão "Atualizar este lugar")
const aplicar2 = (l, r) => { if (r.votos) { l.votos = r.votos; l.extra = r.extra; l.quando = r.quando; l.erro = false; } else if (r.erro) l.erro = true; };
const aplicar1 = (l, r) => { if (r.votos) { l.v1 = r.votos; l.e1 = r.extra; } };
async function lerSecoesAgora(secs) {
  const falta2 = secs.filter(s => !(BU.lidos[`${s.mu}-${s.z}-${s.ns}`] || {}).votos);
  await rodadaLotes(falta2, ATUAL.pl, ATUAL.t2, aplicar2, "atualizando o lugar:", true);
  if (ATUAL.pl1) {
    const falta1 = secs.filter(s => { const l = BU.lidos[`${s.mu}-${s.z}-${s.ns}`] || {}; return l.votos && (!l.v1 || !l.e1); });
    await rodadaLotes(falta1, ATUAL.pl1, ATUAL.t1, aplicar1, "1º turno do lugar:", true);
  }
  return secs.filter(s => (BU.lidos[`${s.mu}-${s.z}-${s.ns}`] || {}).votos).length;
}
const CHAVE_LIDOS = () => `bu:${ATUAL.ano}:${ATUAL.pl}:${ATUAL.pl1 || ""}`;
function guardarLidos() {
  try { const o = {}; for (const [k, l] of Object.entries(BU.lidos)) if (l.votos) o[k] = { votos: l.votos, extra: l.extra, quando: l.quando, v1: l.v1, e1: l.e1 }; localStorage.setItem(CHAVE_LIDOS(), JSON.stringify(o)); } catch {}
}
function carregarLidos() {
  try { const o = JSON.parse(localStorage.getItem(CHAVE_LIDOS()) || "{}"); for (const [k, l] of Object.entries(o)) BU.lidos[k] = l; } catch {}
}
// quando o painel é aberto pelo monitor, ele só copia o que o monitor já leu (rápido e sem pedir nada ao TSE)
async function copiarDoMonitor() {
  try {
    const r = await fetch(`/api/estado?ano=${ATUAL.ano}&pl=${ATUAL.pl}&id=${ATUAL.t2}&pl1=${ATUAL.pl1 || ""}&id1=${ATUAL.t1}`, { cache: "no-store" });
    if (!r.ok) return false;
    const j = await r.json();
    if (!j.servidorLe) return false;
    if (!j.secoes) {   // monitor ligado, mas ainda sem a lista de urnas (ex.: TSE pedindo para esperar)
      BU.modoMonitor = true; BU.status = j.status || "monitor aguardando o TSE liberar a lista de urnas"; setStatus();
      return true;
    }
    BU.secoes = j.secoes;
    for (const [k, v] of Object.entries(j.r || {})) BU.lidos[k] = Object.assign(BU.lidos[k] || {}, v);
    if (j.nomes) for (const [ano, N] of Object.entries(j.nomes)) NOMES_ANO[ano] = Object.assign(NOMES_ANO[ano] || {}, N);
    BU.status = j.status || ""; BU.erro = null; BU.ok = true; BU.modoMonitor = true;
    if (typeof setStatus === "function") setStatus();   // mostra na hora "lendo 30 de 114" ou "TSE pediu para esperar"
    return true;
  } catch { return false; }
}
async function atualizarBU() {
  if (BU.modoMonitor || (!BU.tentouMonitor && (BU.tentouMonitor = true))) {
    if (await copiarDoMonitor()) { mostrarAosPoucos(true); return; }
    if (BU.modoMonitor) return;          // monitor saiu do ar por um instante: tenta de novo na próxima
  }
  if (BU.rodando) return; BU.rodando = true;
  if (!BU.carregou) {
    BU.carregou = true; carregarLidos();
    // pega de uma vez o que o servidor/monitor já leu
    try {
      const r = await fetch(`/api/estado?ano=${ATUAL.ano}&pl=${ATUAL.pl}&id=${ATUAL.t2}&pl1=${ATUAL.pl1 || ""}&id1=${ATUAL.t1}`, { cache: "no-store" });
      if (r.ok) {
        const o = (await r.json()).r || {};
        for (const [k, v] of Object.entries(o)) {
          const l = BU.lidos[k] || (BU.lidos[k] = {});
          if (v.votos && !l.votos) { l.votos = v.votos; l.extra = v.extra; l.quando = v.quando; }
          if (v.v1 && !l.v1) { l.v1 = v.v1; l.e1 = v.e1; }
        }
      }
    } catch {}
  }
  try {
    if (!ATUAL.pl) { BU.erro = "Ainda não encontrei o código do pleito no TSE (use ?pl2026=CÓDIGO)."; return; }
    if (!BU.secoes) {
      BU.status = "lendo a lista de urnas do exterior…"; setStatus();
      BU.secoes = secoesDe(await getJSON(`ele${ATUAL.ano}/arquivo-urna/${ATUAL.pl}/config/zz/zz-p${pad6(ATUAL.pl)}-cs.json`));
      if (!BU.secoes.length) throw new Error("lista de urnas vazia");
      mostrarAosPoucos(true);
    }
    // 1) boletins do 2º turno que ainda faltam
    // urnas ainda sem boletim; primeiro as de cidades que já começaram a apurar (são as próximas a sair)
    const cidadeAberta = new Set(BU.secoes.filter(s => (BU.lidos[`${s.mu}-${s.z}-${s.ns}`] || {}).votos).map(s => s.mu));
    // (as de lugares onde ainda estão votando ficam para depois: não existe boletim antes de fechar)
    // (cidade que já tem algum boletim é sempre olhada, mesmo que o fuso diga que ainda estão votando)
    BU.passada = (BU.passada || 0) + 1;
    const olharTudo = BU.passada % 8 === 1;          // a cada 8 passadas confere também os lugares que ainda não abriram nada
    const falta2 = BU.secoes.filter(s => !(BU.lidos[`${s.mu}-${s.z}-${s.ns}`] || {}).votos && (cidadeAberta.has(s.mu) || (olharTudo && !aindaVotando(s.nm))))
      .sort((a, b) => (cidadeAberta.has(b.mu) ? 1 : 0) - (cidadeAberta.has(a.mu) ? 1 : 0));
    await rodadaLotes(falta2, ATUAL.pl, ATUAL.t2, (l, r) => {
      if (r.votos) { l.votos = r.votos; l.extra = r.extra; l.quando = r.quando; l.erro = false; }
      else if (r.erro) { l.erro = true; if (!BU.exemploFalha) BU.exemploFalha = r.erro; }
    }, "procurando boletins novos:");
    // 2) as mesmas urnas no 1º turno (só das que já têm boletim do 2º)
    if (ATUAL.pl1) {
      const falta1 = BU.secoes.filter(s => { const l = BU.lidos[`${s.mu}-${s.z}-${s.ns}`] || {}; return l.votos && (!l.v1 || !l.e1) && !l.semV1; });
      await rodadaLotes(falta1, ATUAL.pl1, ATUAL.t1, (l, r) => { if (r.votos) { l.v1 = r.votos; l.e1 = r.extra; } else l.semV1 = true; }, "lendo o 1º turno das urnas novas:");
    }
    BU.erro = null; BU.ok = true; BU.status = "";
  } catch (e) { BU.erro = /429/.test(e.message) ? "O TSE pediu para ir mais devagar. A página tenta de novo sozinha em 2 minutos." : "Não consegui ler os boletins: " + e.message; }
  finally { BU.rodando = false; guardarLidos(); mostrarAosPoucos(true); }
}
// agrega seções → cidades → países
// votos: 2º turno de todas as seções com boletim; m2/m1: só seções que têm boletim nos dois turnos
const CAMPOS_M = ["nE", "ap1", "ap2", "c1", "c2", "br1", "br2", "nu1", "nu2"];
function novoAg(o) { Object.assign(o, { total: 0, com: 0, votos: {}, m1: {}, m2: {}, nM: 0, aptos: 0, comp: 0, brancos: 0, nulos: 0 }); CAMPOS_M.forEach(k => o[k] = 0); return o; }
function juntar(A, l) {
  A.com++;
  if (l.quando) A.ultimo = Math.max(A.ultimo || 0, l.quando);
  for (const [n, v] of Object.entries(l.votos)) A.votos[n] = (A.votos[n] || 0) + v;
  const e = l.extra || {}; ["aptos", "comp", "brancos", "nulos"].forEach(k => A[k] += e[k] || 0);
  if (l.v1 && l.e1) {
    A.nM++; A.nE++;
    for (const [n, v] of Object.entries(l.votos)) A.m2[n] = (A.m2[n] || 0) + v;
    for (const [n, v] of Object.entries(l.v1)) A.m1[n] = (A.m1[n] || 0) + v;
    const e2 = l.extra || {}, e1 = l.e1;
    A.ap1 += e1.aptos || 0; A.ap2 += e2.aptos || 0; A.c1 += e1.comp || 0; A.c2 += e2.comp || 0;
    A.br1 += e1.brancos || 0; A.br2 += e2.brancos || 0; A.nu1 += e1.nulos || 0; A.nu2 += e2.nulos || 0;
  }
}
// soma vários agregados (ex.: países de um continente)
function somarAgs(lista, base) {
  const A = novoAg(base || {});
  lista.forEach(c => {
    A.total += c.total; A.com += c.com; A.nM += c.nM;
    ["votos", "m1", "m2"].forEach(k => Object.entries(c[k]).forEach(([n, v]) => A[k][n] = (A[k][n] || 0) + v));
    ["aptos", "comp", "brancos", "nulos", ...CAMPOS_M].forEach(k => A[k] += c[k]);
    if (c.ultimo) A.ultimo = Math.max(A.ultimo || 0, c.ultimo);
  });
  return A;
}
function exteriorAgregado() {
  const cid = {};
  for (const s of BU.secoes || []) {
    const c = cid[s.mu] || (cid[s.mu] = novoAg({ mu: s.mu, nm: titulo(s.nm) }));
    c.total++;
    const l = BU.lidos[`${s.mu}-${s.z}-${s.ns}`];
    if (l && l.votos) juntar(c, l);
  }
  const paises = {}, todos = novoAg({ nome: "Exterior" });
  Object.values(cid).forEach(c => {
    const p = paisDe(c.nm);
    const P = paises[p.cd] || (paises[p.cd] = novoAg({ ...p, cidades: [] }));
    P.cidades.push(c);
    [P, todos].forEach(A => {
      A.total += c.total; A.com += c.com; A.nM += c.nM;
      ["votos", "m1", "m2"].forEach(k => Object.entries(c[k]).forEach(([n, v]) => A[k][n] = (A[k][n] || 0) + v));
      ["aptos", "comp", "brancos", "nulos", ...CAMPOS_M].forEach(k => A[k] += c[k]);
      if (c.ultimo) A.ultimo = Math.max(A.ultimo || 0, c.ultimo);
    });
  });
  const lista = Object.values(paises).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  lista.forEach(p => {
    p.situacao = p.com === p.total ? "ok" : p.com > 0 ? "part" : "esp";
    const fs = p.cidades.map(c => fechamentoDe(c.nm)).filter(Boolean);
    p.fecha = fs.length ? Math.max(...fs) : null;
    p.votando = p.fecha != null && Date.now() < p.fecha;
  });
  return { lista, todos };
}
// dados oficiais somados das cidades de um país
async function oficiaisPais(p) {
  const pegar = async (ano, cd) => somar(await Promise.all(p.cidades.map(c => res(ano, cd, "zz", c.mu))), ano);
  const [a1, a2, r1, r2] = await Promise.all([
    pegar(ATUAL.ano, ATUAL.t1), pegar(ATUAL.ano, ATUAL.t2),
    pegar(REF.ano, REF.t1), pegar(REF.ano, REF.t2)]);
  return { a1, a2, r1, r2 };
}

