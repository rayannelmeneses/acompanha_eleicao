// Monitor da apuração: lê os boletins de urna do exterior (e, a partir das 17h, o resultado oficial)
// direto do TSE e manda as novidades para o seu Telegram.
//
// Uso:
//   1) No Telegram, fale com @BotFather, mande /newbot e siga os passos. Ele te dá um TOKEN.
//   2) Abra o seu bot no Telegram e mande "oi" para ele (isso libera o envio para você).
//   3) Na pasta do projeto:   node monitor-telegram.js SEU_TOKEN
//      (o token fica salvo em telegram.json; das próximas vezes basta  node monitor-telegram.js)
//
// A cada 8 minutos ele manda uma mensagem com o que mudou. Também liga o painel (o mesmo do servidor-local)
// e manda o link. Para o link funcionar fora de casa, suba o projeto na Vercel e coloque o endereço
// em telegram.json no campo "painel".
// Precisa de Node 18 ou mais novo. Não instala nada. Para parar: Ctrl+C.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { lote, tseFetch, tseArquivo, exportarCache, importarCache, pausaRestante } = require("./api/_bu.js");

const BASE = process.env.TSE_BASE || "https://resultados.tse.jus.br/oficial/";
const TG = process.env.TELEGRAM_API || "https://api.telegram.org";
const ARQ_CONF = path.join(__dirname, "telegram.json");
const ARQ_CACHE = path.join(__dirname, "boletins-lidos.json");
const PAUSA_MS = (+process.env.PAUSA_S || 15) * 1000;    // pausa curta entre uma leitura e a próxima (painel sempre em dia)
const CICLO_MS = (+process.env.CICLO_S || 360) * 1000;   // mensagem no Telegram no máximo a cada 6 minutos (e só se mudou algo)
const ARQ_ESTADO = path.join(__dirname, "monitor-estado.json"); // o que já foi visto/fechado fica gravado aqui

/* ---------- configuração do Telegram ---------- */
let conf = {};
try { conf = JSON.parse(fs.readFileSync(ARQ_CONF, "utf8")); } catch {}
if (process.argv[2]) conf.token = process.argv[2].trim();
if (!conf.token) {
  console.log("Falta o token do bot. Crie um com o @BotFather no Telegram e rode:\n  node monitor-telegram.js SEU_TOKEN");
  process.exit(1);
}
async function tg(metodo, corpo) {
  const r = await fetch(`${TG}/bot${conf.token}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo || {}) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram (${metodo}): ${j.description || r.status}`);
  return j.result;
}
async function acharChat() {
  if (conf.chat) return;
  console.log('Procurando sua conversa com o bot... (mande "oi" para o bot no Telegram, se ainda não mandou)');
  for (let i = 0; i < 60 && !conf.chat; i++) {
    const ups = await tg("getUpdates", {});
    const m = [...ups].reverse().find(u => (u.message || u.channel_post || {}).chat);
    if (m) conf.chat = (m.message || m.channel_post).chat.id;
    else await new Promise(r => setTimeout(r, 5000));
  }
  if (!conf.chat) { console.log("Não achei nenhuma mensagem para o bot. Mande \"oi\" para ele e rode de novo."); process.exit(1); }
  fs.writeFileSync(ARQ_CONF, JSON.stringify(conf, null, 2));
  console.log("Conversa encontrada e salva em telegram.json.");
}
async function enviar(texto) {
  await tg("sendMessage", { chat_id: conf.chat, text: texto, disable_web_page_preview: true });
  console.log(`[${new Date().toLocaleTimeString("pt-BR")}] enviado:\n${texto}\n`);
}

/* ---------- reaproveita a leitura do site (public/dados.js) ---------- */
function falsoFetch(url, op) {
  const u = String(url);
  if (u.startsWith("/api/tse?path=")) return tseArquivo(decodeURIComponent(u.slice(14)));
  if (u.startsWith("/api/lote?")) {
    const q = new URLSearchParams(u.slice(10));
    return lote(q.get("ano"), q.get("pl"), q.get("id"), q.get("s").split(","), q.get("f") === "1").then(r => {
      const v = Object.values(r), novas = v.filter(x => x.votos && !x.doCache).length, err = v.filter(x => x.erro);
      const turno = q.get("pl") === String(D.ATUAL.pl1) ? "1º turno" : "2º turno";
      if (novas || err.length) console.log(`[${new Date().toLocaleTimeString("pt-BR")}] ${turno}: ${novas} boletins novos${err.length ? `, ${err.length} com erro (ex.: ${err[0].erro})` : ""}${D.BU.status ? ` · ${D.BU.status}` : ""}`);
      return new Response(JSON.stringify({ r }), { status: 200 });
    });
  }
  if (u.startsWith("https://resultados.tse.jus.br/oficial/")) return tseArquivo(u.slice(38));
  // tudo o que já foi lido (carregado do arquivo boletins-lidos.json): volta de uma vez, sem reler
  if (u.startsWith("/api/estado?")) {
    const q = Object.fromEntries(new URLSearchParams(u.slice(12))), out = {};
    for (const [k, v] of Object.entries(exportarCache())) {
      const [ano, pl, id, sec] = k.split("/");
      if (ano !== q.ano) continue;
      if (pl === q.pl && id === q.id) Object.assign(out[sec] || (out[sec] = {}), { votos: v.votos, extra: v.extra, quando: v.quando });
      else if (pl === q.pl1 && id === q.id1) Object.assign(out[sec] || (out[sec] = {}), { v1: v.votos, e1: v.extra });
    }
    return Promise.resolve(new Response(JSON.stringify({ r: out }), { status: 200 }));
  }
  return fetch(u, op);
}
const memoria = {};
const ctx = vm.createContext({
  console, setTimeout, clearTimeout, setInterval, URL, URLSearchParams, TextDecoder, Uint8Array, Response, Promise, Date, Math, JSON,
  fetch: falsoFetch, location: { search: "" },
  localStorage: { getItem: k => memoria[k] ?? null, setItem: (k, v) => { memoria[k] = v; } },
  estado: { tela: "" }, render: () => {}, setStatus: () => {},
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "public", "dados.js"), "utf8"), ctx, { filename: "dados.js" });
const D = vm.runInContext("({ BU, ATUAL, REF, NOMES_ANO, atualizarBU, exteriorAgregado, res, ler, resultadoBruto, somarAgs, CONTINENTES, REGIOES, REGIAO_DE, montarTexto, oficiaisPais, paisDe, lerSecoesAgora })", ctx);

/* ---------- contas ---------- */
const f1 = n => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fI = n => Math.round(n).toLocaleString("pt-BR");
const sg = n => (n >= 0 ? "+" : "−") + fI(Math.abs(n));
const seta = d => d == null ? "" : `${d >= 0 ? "▲" : "▼"}${f1(Math.abs(d))}`;
const curto = s => String(s).trim().split(/\s+/)[0];
const nome = n => curto((D.NOMES_ANO[D.ATUAL.ano] || {})[n] || `Nº ${n}`);
const EM = { "13": "🔴", "22": "🔵" };
const doisMais = v => Object.entries(v || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).sort((a, b) => a - b);
const fatia = (v, nums) => { const t = nums.reduce((s, n) => s + (v[n] || 0), 0); return t ? Object.fromEntries(nums.map(n => [n, 100 * (v[n] || 0) / t])) : null; };
const hora = t => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const votosDe = t => t ? Object.fromEntries(t.cands.map(c => [c.n, c.votos])) : null;
const UFS = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" ");

/* ---------- memória entre rodadas (gravada em arquivo) ---------- */
let mem = { fechados: {}, ext: null, br: null, zz: null, ufs: {}, rodada: 0 };
try { mem = { ...mem, ...JSON.parse(fs.readFileSync(ARQ_ESTADO, "utf8")) }; } catch {}
const gravar = () => { try { fs.writeFileSync(ARQ_ESTADO, JSON.stringify(mem, null, 1)); } catch {} };

/* ---------- endereço do painel ---------- */
function linkPainel() {
  if (conf.painel) return conf.painel;
  const ip = Object.values(require("os").networkInterfaces()).flat().find(i => i && i.family === "IPv4" && !i.internal);
  return `http://${ip ? ip.address : "localhost"}:${process.env.PORT || 3000}/?tela=exterior`;
}

/* ---------- partes da mensagem ---------- */
// resumão do exterior + lista dos lugares que mudaram nesta rodada
function blocoExterior() {
  if (!D.BU.secoes) return { linhas: [`🌍 EXTERIOR: ${D.BU.erro || "lendo a lista de urnas…"}`], mudaram: [], nums: [] };
  const { lista, todos: S } = D.exteriorAgregado();
  const nums = doisMais(S.votos);
  if (nums.length < 2) return { linhas: ["🌍 EXTERIOR: nenhum boletim do 2º turno ainda"], mudaram: [], nums };
  const [A, B] = nums, sh = fatia(S.votos, nums);
  const ant = mem.ext;
  const fech = lista.filter(p => p.situacao === "ok"), part = lista.filter(p => p.situacao === "part"), esp = lista.filter(p => p.situacao === "esp");
  const l = [`🌍 EXTERIOR · ${fI(S.com)} de ${fI(S.total)} urnas (${f1(100 * S.com / S.total)}%)${S.ultimo ? ` · último boletim ${hora(S.ultimo)}` : ""}`,
    `${EM[A]} ${nome(A)} ${f1(sh[A])}% (${fI(S.votos[A] || 0)}) · ${EM[B]} ${nome(B)} ${f1(sh[B])}% (${fI(S.votos[B] || 0)})`];
  if (S.nM) {
    const a = fatia(S.m1, nums), b = fatia(S.m2, nums);
    l.push(`Mesmas ${fI(S.nM)} urnas vs 1º turno: ${nome(A)} ${f1(a[A])}% → ${f1(b[A])}% (${seta(b[A] - a[A])})`);
  }
  if (S.nE) {
    const gA = (S.m2[A] || 0) - (S.m1[A] || 0), gB = (S.m2[B] || 0) - (S.m1[B] || 0);
    const d1 = (S.m1[B] || 0) - (S.m1[A] || 0), d2 = (S.m2[B] || 0) - (S.m2[A] || 0);
    l.push(`Em votos: ${nome(A)} ${sg(gA)} · ${nome(B)} ${sg(gB)}${gA + gB > 0 ? ` (${nome(A)} ficou com ${f1(100 * gA / (gA + gB))}% do que os dois ganharam)` : ""}`);
    l.push(`Diferença ${nome(d2 >= 0 ? B : A)} sobre ${nome(d2 >= 0 ? A : B)}: ${fI(Math.abs(d1))} → ${fI(Math.abs(d2))} votos${Math.sign(d1) !== Math.sign(d2) && d1 && d2 ? " (virou!)" : ""}`);
    if (S.ap1 && S.ap2) {
      const a1 = 100 * (1 - S.c1 / S.ap1), a2 = 100 * (1 - S.c2 / S.ap2);
      l.push(`Abstenção: ${f1(a1)}% → ${f1(a2)}% (${a2 <= a1 ? "▼" : "▲"}${f1(Math.abs(a2 - a1))} pontos) · ${fI(S.ap2 - S.c2)} de ${fI(S.ap2)} eleitores não votaram`);
      l.push(`Brancos ${fI(S.br2)} · nulos ${fI(S.nu2)}`);
    }
  }

  // o que mudou desde a última rodada
  const vistos = mem.paises || {};
  const mudaram = lista.filter(p => p.com && (!vistos[p.cd] || vistos[p.cd].com !== p.com));
  const fecharamAgora = mudaram.filter(p => p.situacao === "ok");
  if (ant && S.com >= ant.com) {
    l.push("", `🆕 Nesta rodada: ${sg(S.com - ant.com)} urnas · ${nome(A)} ${seta(sh[A] - ant.a)}` +
      (fecharamAgora.length ? ` · ${fecharamAgora.length} ${fecharamAgora.length === 1 ? "país fechou" : "países fecharam"}` : "") +
      (mudaram.length - fecharamAgora.length > 0 ? ` · ${mudaram.length - fecharamAgora.length} com urnas novas` : ""));
  }
  const votando = lista.filter(p => p.votando);
  l.push(`📦 Total: ✅ ${fech.length} fechados · 🟡 ${part.length} apurando · ⏳ ${esp.length} sem boletim`);
  if (votando.length) l.push(`🗳️ Ainda votando: ${votando.length} países · o último fecha às ${hora(Math.max(...votando.map(p => p.fecha)))} (Brasília)`);

  // por continente
  const porCont = [...Object.keys(D.CONTINENTES), "Outros"].map(c => ({ c, X: D.somarAgs(lista.filter(p => p.cont === c), {}) })).filter(x => x.X.com);
  if (porCont.length) {
    l.push("", `🗺️ Por continente (urnas · ${nome(A)} · vs 1º turno):`);
    porCont.forEach(({ c, X }) => {
      const s2 = fatia(X.votos, nums), a = X.nM && fatia(X.m1, nums), b = X.nM && fatia(X.m2, nums);
      l.push(`${c}: ${fI(X.com)}/${fI(X.total)} · ${f1(s2[A])}%${a && b ? ` (${seta(b[A] - a[A])})` : ""}`);
    });
  }
  mem.ext = { com: S.com, a: sh[A] };
  return { linhas: l, mudaram, nums, primeira: !ant, lista };
}

// cartão de um país, no formato dos posts: 1º → 2º turno nas mesmas urnas, situação e 2022
async function cartaoPais(p, nums) {
  const [A, B] = nums, ant = (mem.paises || {})[p.cd];
  const fechou = p.situacao === "ok";
  let sit = fechou ? `✅ Todas as ${p.total} urnas apuradas${ant && ant.com < p.total ? ` (antes: ${ant.com} de ${p.total})` : ""}`
                   : `🟡 Em apuração: ${p.com} de ${p.total} urnas${ant ? ` (antes: ${ant.com})` : ""}`;
  // 1º → 2º turno nas mesmas urnas
  const linhas = [A, B].map(n => ({ n, nome: (D.NOMES_ANO[D.ATUAL.ano] || {})[n] || n, v1: p.nE ? (p.m1[n] || 0) : 0, v2: p.nE ? (p.m2[n] || 0) : (p.votos[n] || 0) }));
  // 2022 (só quando o país fechou: total com total)
  let ref = null;
  if (fechou) {
    try { const o = await D.oficiaisPais(p); if (o && o.r2) ref = [...o.r2.cands].sort((a, b) => b.votos - a.votos).slice(0, 2).map(c => ({ n: c.n, nome: c.nome, v: c.votos })); } catch {}
  }
  let txt = D.montarTexto({ icone: p.flag, local: p.nome, linhas, ref, fonte: "" }) || `${p.flag} ${p.nome.toUpperCase()}`;
  const partes = txt.split("\n");
  partes.splice(1, 0, sit);
  if (ant && ant.a != null) { const s2 = fatia(p.votos, nums); partes.splice(2, 0, `Desde a última rodada: ${nome(A)} ${f1(ant.a)}% → ${f1(s2[A])}% (${seta(s2[A] - ant.a)})`); }
  if (!p.nE) partes.push("", "(comparação com o 1º turno quando as mesmas urnas forem lidas)");
  return partes.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function blocoOficial() {
  const [br2, br1, zz2, zz1] = await Promise.all([
    D.res(D.ATUAL.ano, D.ATUAL.t2, "br"), D.res(D.ATUAL.ano, D.ATUAL.t1, "br"),
    D.res(D.ATUAL.ano, D.ATUAL.t2, "zz"), D.res(D.ATUAL.ano, D.ATUAL.t1, "zz")]);
  if (!br2 || !br2.pst) return null;   // ainda não começou (17h)
  const l = [];
  const resumo = (rot, icone, t2, t1, chave) => {
    const v2 = votosDe(t2), v1 = votosDe(t1), nums = doisMais(v2); if (nums.length < 2) return;
    const [A, B] = nums, sh = fatia(v2, nums), a1 = v1 && fatia(v1, nums), ant = mem[chave];
    const dif = (v2[A] || 0) - (v2[B] || 0);
    if (l.length) l.push("");
    l.push(`${icone} ${rot} · oficial TSE · ${f1(t2.pst)}% das seções${ant && t2.pst !== ant.pst ? ` (+${f1(t2.pst - ant.pst)} desde a última)` : ""}`,
      `${EM[A]} ${nome(A)} ${f1(sh[A])}% · ${EM[B]} ${nome(B)} ${f1(sh[B])}% · diferença ${fI(Math.abs(dif))} para ${nome(dif >= 0 ? A : B)}`);
    if (a1) l.push(`vs resultado final do 1º turno: ${nome(A)} ${f1(a1[A])}% → ${f1(sh[A])}% (${seta(sh[A] - a1[A])})`);
    mem[chave] = { pst: t2.pst, a: sh[A] };
  };
  resumo("BRASIL", "🇧🇷", br2, br1, "br");
  if (zz2 && zz2.pst) resumo("EXTERIOR", "🌍", zz2, zz1, "zz");

  // estados
  const ufs = await Promise.all(UFS.map(async u => ({ u, t2: await D.res(D.ATUAL.ano, D.ATUAL.t2, u.toLowerCase()), t1: await D.res(D.ATUAL.ano, D.ATUAL.t1, u.toLowerCase()) })));
  const com = ufs.filter(x => x.t2 && x.t2.pst);
  if (com.length) {
    const nums = doisMais(votosDe(com[0].t2)), [A, B] = nums;
    const regs = Object.keys(D.REGIOES).map(rg => {
      const xs = com.filter(x => D.REGIAO_DE[x.u] === rg); if (!xs.length) return null;
      const v2 = {}, v1 = {}; xs.forEach(x => { x.t2.cands.forEach(c => v2[c.n] = (v2[c.n] || 0) + c.votos); if (x.t1) x.t1.cands.forEach(c => v1[c.n] = (v1[c.n] || 0) + c.votos); });
      return { rg, n: xs.length, sh: fatia(v2, nums), a1: fatia(v1, nums), pst: xs.reduce((s, x) => s + x.t2.pst, 0) / xs.length };
    }).filter(Boolean);
    if (regs.length) {
      l.push("", `🗺️ Regiões (${nome(A)} × ${nome(B)} · média apurada · vs 1º turno):`);
      regs.forEach(r => l.push(`${r.rg}: ${f1(r.sh[A])} × ${f1(r.sh[B])} · ${f1(r.pst)}% (${r.n} est.)${r.a1 ? ` · ${seta(r.sh[A] - r.a1[A])}` : ""}`));
    }
    l.push("", `📍 Estados (${nome(A)} × ${nome(B)} · % apurado · vs 1º turno):`);
    com.sort((a, b) => b.t2.pst - a.t2.pst).forEach(x => {
      const sh = fatia(votosDe(x.t2), nums), a1 = x.t1 && fatia(votosDe(x.t1), nums), ant = mem.ufs[x.u];
      const andou = ant ? x.t2.pst - ant : null;
      l.push(`${x.u} ${f1(sh[A])} × ${f1(sh[B])} · ${f1(x.t2.pst)}%${andou ? ` (+${f1(andou)})` : ""}${a1 ? ` · ${seta(sh[A] - a1[A])}` : ""}`);
      mem.ufs[x.u] = x.t2.pst;
    });
    const faltam = ufs.length - com.length;
    if (faltam) l.push(`…${faltam} estados ainda sem votos`);
  }
  return l;
}

/* ---------- rodada ---------- */
let proxima = Date.now() + CICLO_MS, situacao = { lendo: true }, acordar = null;
let pedidoTela = false;          // alguém apertou "Atualizar" no painel: manda já se tiver novidade
const SINAL_MS = (+process.env.SINAL_S || 1200) * 1000;     // sem novidade por 20 min: manda um aviso curto de que está tudo ligado
async function rodada() {
  const backup = JSON.stringify({ ext: mem.ext, br: mem.br, zz: mem.zz, ufs: mem.ufs, rodada: mem.rodada, paises: mem.paises });
  // foto de antes, para saber se algo mudou nesta leitura
  const antes = JSON.stringify({ c: mem.ext && mem.ext.com, br: mem.br && mem.br.pst, zz: mem.zz && mem.zz.pst, ufs: mem.ufs });
  const primeira = !mem.ext;
  mem.rodada = (mem.rodada || 0) + 1;
  // a leitura dos boletins roda sozinha em segundo plano; aqui só usamos o que já foi lido
  try { fs.writeFileSync(ARQ_CACHE, JSON.stringify(exportarCache())); } catch {}
  const agora = Date.now();
  const l = [`🕐 Rodada ${mem.rodada} · ${hora(agora)} · próxima às ${hora(proxima)}`, ""];
  let oficial = null;
  try { oficial = await blocoOficial(); } catch (e) { console.log("oficial:", e.message); }
  if (oficial && oficial.length) l.push(...oficial, "");
  const ext = blocoExterior();
  l.push(...ext.linhas);
  if (!oficial) l.push("", "🇧🇷 Oficial do Brasil e dos estados: começa às 17h (horário de Brasília).");

  // últimos lugares atualizados: os 5 com boletim mais recente (na 1ª rodada, os 5 últimos que chegaram)
  const MAX = 5;
  const alvo = (ext.primeira ? (ext.lista || []).filter(p => p.com) : ext.mudaram)
    .sort((a, b) => (b.ultimo || 0) - (a.ultimo || 0) || b.com - a.com).slice(0, MAX);
  const resto = (ext.primeira ? 0 : ext.mudaram.length - alvo.length);
  if (alvo.length) l.push("", `👇 ${ext.primeira ? "Últimos lugares apurados" : "Lugares atualizados nesta rodada"}${resto > 0 ? ` (mostrando ${alvo.length}; os outros ${resto} estão no painel)` : ""}`);
  l.push("", `🔗 Painel: ${linkPainel()}`);
  const depois = JSON.stringify({ c: mem.ext && mem.ext.com, br: mem.br && mem.br.pst, zz: mem.zz && mem.zz.pst, ufs: mem.ufs });
  if (!primeira && antes === depois) {           // nada novo: não manda o resumão
    mem.rodada--;
    const desde = mem.ultimoEnvio || 0;
    if (Date.now() - desde >= SINAL_MS) {          // mas avisa de vez em quando que está ligado
      const e1 = ext.linhas[0] || "";
      try {
        await enviar(`⏸️ ${hora(Date.now())} · Nenhuma urna nova desde ${mem.ultimaNovidade ? hora(mem.ultimaNovidade) : "a última mensagem"}. O monitor continua lendo.\n${e1}${!oficial ? "\n🇧🇷 Oficial do Brasil e dos estados: às 17h." : ""}\n🔗 Painel: ${linkPainel()}`);
        mem.ultimoEnvio = Date.now();
      } catch (e) { console.log("aviso não enviado:", e.message); }
    }
    gravar();
    console.log(`[${hora(Date.now())}] sem novidade nesta leitura (${mem.ext ? mem.ext.com : 0} urnas, igual à última mensagem); resumão não enviado`);
    return;
  }
  let txt = l.join("\n");
  if (txt.length > 4000) txt = txt.slice(0, 3990) + "\n…";   // limite do Telegram
  try { await enviar(txt); }
  catch (e) {                                       // o Telegram falhou: desfaz, para mandar de novo na próxima
    Object.assign(mem, JSON.parse(backup)); gravar();
    throw new Error("Telegram não recebeu a mensagem (" + e.message + "); tento de novo na próxima leitura");
  }
  mem.ultimoEnvio = mem.ultimaNovidade = Date.now();

  for (const p of alvo) {
    try { await enviar(await cartaoPais(p, ext.nums)); } catch (e) { console.log("cartão:", e.message); }
  }
  // guarda o estado de cada país para a próxima rodada
  mem.paises = mem.paises || {};
  (ext.lista || []).forEach(p => { if (p.com) { const s2 = fatia(p.votos, ext.nums); mem.paises[p.cd] = { com: p.com, a: s2 ? s2[ext.nums[0]] : null }; } });
  (ext.lista || []).filter(p => p.situacao === "ok").forEach(p => { mem.fechados[p.cd] = mem.fechados[p.cd] || { nome: p.nome, flag: p.flag, quando: agora }; });
  gravar();
}

(async () => {
  try { console.log(`${importarCache(JSON.parse(fs.readFileSync(ARQ_CACHE, "utf8")))} boletins carregados do arquivo`); } catch {}
  const eu = await tg("getMe").catch(e => { console.log("Token inválido? " + e.message); process.exit(1); });
  console.log(`Bot conectado: @${eu.username}`);
  await acharChat();
  fs.writeFileSync(ARQ_CONF, JSON.stringify(conf, null, 2));
  // o painel (mesmo processo) pega daqui tudo o que o monitor já leu, sem pedir nada ao TSE
  global.__estadoBU = () => ({ secoes: D.BU.secoes, lidos: D.BU.lidos, nomes: D.NOMES_ANO, status: D.BU.status, rodando: D.BU.rodando, situacao, pausaTSE: pausaRestante() });
  // botão "Atualizar [país]": lê agora só as urnas daquele país
  global.__lerPais = async cd => {
    const secs = (D.BU.secoes || []).filter(s => D.paisDe(s.nm).cd === cd);
    if (!secs.length) return { total: 0, lidas: 0 };
    const lidas = await D.lerSecoesAgora(secs);
    pedidoTela = true; if (acordar) { const f = acordar; acordar = null; f(); }   // manda no Telegram se tiver novidade
    console.log(`[${new Date().toLocaleTimeString("pt-BR")}] atualização pedida no painel: ${cd} · ${lidas} de ${secs.length} urnas com boletim`);
    return { total: secs.length, lidas };
  };
  // botão "Atualizar agora" do painel: acorda o monitor no meio da pausa
  global.__acordar = () => { pedidoTela = true; if (acordar) { const f = acordar; acordar = null; f(); return "lendo agora"; } return situacao.lendo ? "já está lendo" : "lendo agora"; };
  if (!process.env.SEM_PAINEL) { try { require("./servidor-local.js"); } catch (e) { console.log("painel não abriu:", e.message); } }
  try { D.ler(await D.resultadoBruto(D.ATUAL.ano, D.ATUAL.t1, "br"), D.ATUAL.ano, true); } catch {}
  try { D.ler(await D.resultadoBruto(D.REF.ano, D.REF.t2, "br"), D.REF.ano, true); } catch {}
  await enviar(`✅ Monitor da apuração ligado. Vou ler os boletins, mandar o resultado e fazer uma pausa de ${Math.round(CICLO_MS / 60000)} minutos antes da próxima leitura: exterior pelos boletins de urna agora e, a partir das 17h, o oficial do Brasil e dos estados.\n🔗 Painel: ${linkPainel()}`);
  setInterval(() => {
    if (situacao.lendo && D.BU.status) {
      const lidas = Object.values(D.BU.lidos).filter(l => l.votos).length;
      console.log(`[${new Date().toLocaleTimeString("pt-BR")}] lendo… ${D.BU.status} · ${lidas} urnas com boletim até agora`);
    }
  }, 30000);
  // ciclo: lê tudo o que falta → pausa curta → lê de novo…; a mensagem sai quando passou o intervalo e há novidade
  let ultimaMsg = 0;
  for (;;) {
    situacao = { lendo: true, desde: Date.now() };
    const t0 = Date.now();
    try { await D.atualizarBU(); } catch (e) { console.log("leitura:", e.message); }
    try { fs.writeFileSync(ARQ_CACHE, JSON.stringify(exportarCache())); } catch {}
    const lidas = Object.values(D.BU.lidos).filter(l => l.votos).length;
    situacao = { lendo: false, proxima: Date.now() + PAUSA_MS };
    console.log(`[${new Date().toLocaleTimeString("pt-BR")}] leitura terminou em ${Math.round((Date.now() - t0) / 1000)} s · ${lidas} urnas com boletim`);
    if (pedidoTela || Date.now() - ultimaMsg >= CICLO_MS - 5000) {
      if (pedidoTela) console.log(`[${new Date().toLocaleTimeString("pt-BR")}] atualização pedida no painel: mando no Telegram se tiver novidade`);
      pedidoTela = false;
      proxima = Date.now() + CICLO_MS;
      const n = mem.rodada;
      try { await rodada(); } catch (e) { console.log("erro nesta rodada:", e.message); }
      if (mem.rodada !== n) ultimaMsg = Date.now();          // só conta como enviada se mandou de fato
    }
    await new Promise(r => { acordar = r; setTimeout(r, PAUSA_MS); });
    acordar = null;
  }
})();
