/* Interface da apuração: placar, comparações, gráficos, posts e lista de lugares.
 * Os dados vêm de dados.js (TSE: resultados oficiais e boletins de urna). */

/* ---------------- utilidades ---------------- */
const corDe = n => n === "13" ? "var(--c13)" : n === "22" ? "var(--c22)" : "var(--cx)";
const pct1 = x => x == null ? "—" : f1(x);
const seta = d => d == null ? "" : `<span class="delta ${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"} ${f1(Math.abs(d))} pts</span>`;
const doisMais = v => Object.entries(v || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).sort((a, b) => a - b);
// fatia de cada um entre os dois (como nos boletins: % dos votos dados aos dois)
function entreDois(v, nums) {
  const t = nums.reduce((s, n) => s + (v[n] || 0), 0);
  return t ? Object.fromEntries(nums.map(n => [n, 100 * (v[n] || 0) / t])) : null;
}
const votosDeRes = t => t ? Object.fromEntries(t.cands.map(c => [c.n, c.votos])) : null;
const nomeDe = (ano, n) => (NOMES_ANO[ano] || {})[n] || `Nº ${n}`;

/* ---------------- estado ---------------- */
const horaBR = +new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false });
const estado = { tela: qs.get("tela") || (horaBR < 17 ? "exterior" : "total"), uf: (qs.get("uf") || "").toUpperCase(), pais: qs.get("pais") || "",
  reg: qs.get("reg") || "", cont: qs.get("cont") || "", mun: qs.get("mun") || "", filtro: "todos", busca: "" };
const $tela = document.getElementById("tela");
const abertos = new Set();
const dobras = { hal: false, mapa: true };   // blocos que abrem/fecham: lembra a escolha
let ultima = null;

function setStatus() {
  const s = document.getElementById("status");
  const txt = BU.modoMonitor ? `${ultima ? `atualizado às ${ultima}` : "carregando"}${BU.status ? ` · ${BU.status}` : ""}`
    : estado.tela === "exterior" && BU.status ? BU.status : ultima ? `atualizado às ${ultima}` : "carregando";
  s.innerHTML = `<i></i>${esc(txt)}`;
}
function ir(m, rolarTopo) {
  Object.assign(estado, m);
  const u = new URL(location);
  ["tela", "uf", "pais", "reg", "cont", "mun"].forEach(k => estado[k] ? u.searchParams.set(k, estado[k]) : u.searchParams.delete(k));
  history.replaceState(null, "", u);
  document.querySelectorAll("#nav button").forEach(b => b.setAttribute("aria-pressed", b.dataset.tela === estado.tela));
  document.body.classList.add("trocando");     // mostra "carregando…" na hora do toque
  if (rolarTopo) document.getElementById("nav").scrollIntoView({ behavior: "smooth" });
  render(true);
}

/* ---------------- histórico (para a curva) ---------------- */
const memHist = {};
function historico(chave) {
  const k = `apur:${ATUAL.ano}:${chave}`;
  if (!memHist[k]) { try { memHist[k] = JSON.parse(localStorage.getItem(k) || "[]"); } catch { memHist[k] = []; } }
  return memHist[k];
}
function registrar(chave, x, a, rotulo) {
  if (a == null) return;
  const h = historico(chave), u = h[h.length - 1];
  if (u && u.x === x && Math.abs(u.a - a) < 1e-9) return;
  h.push({ t: Date.now(), x, a, r: rotulo });
  if (h.length > 400) h.splice(0, h.length - 400);
  try { localStorage.setItem(`apur:${ATUAL.ano}:${chave}`, JSON.stringify(h)); } catch {}
}
// curva a partir do horário de recebimento de cada boletim (exterior), se o TSE informar
// curva por urnas: cada ponto = depois de somar X% das urnas do lugar, na ordem em que chegaram ao TSE.
// a2 = fatia do candidato A no 2º turno; a1 = fatia dele no 1º turno, nas mesmas urnas
function curvaBoletins(filtroMu, nums) {
  let total = 0; const lidas = [];
  (BU.secoes || []).forEach((s, ordem) => {
    if (filtroMu && !filtroMu.has(s.mu)) return;
    total++;
    const l = BU.lidos[`${s.mu}-${s.z}-${s.ns}`];
    if (l && l.votos) lidas.push({ l, ordem });
  });
  if (lidas.length < 3 || !total) return null;
  lidas.sort((a, b) => (a.l.quando || 9e15) - (b.l.quando || 9e15) || a.ordem - b.ordem);
  const v2 = {}, v1 = {}, m2 = {}, out = [];
  let ultimo = null;
  lidas.forEach(({ l }, i) => {
    nums.forEach(n => v2[n] = (v2[n] || 0) + (l.votos[n] || 0));
    if (l.v1) nums.forEach(n => { v1[n] = (v1[n] || 0) + (l.v1[n] || 0); m2[n] = (m2[n] || 0) + (l.votos[n] || 0); });
    if (l.quando) ultimo = Math.max(ultimo || 0, l.quando);
    const a = entreDois(v2, nums), b = entreDois(v1, nums);
    if (a) out.push({ x: 100 * (i + 1) / total, n: i + 1, a2: a[nums[0]], a1: b ? b[nums[0]] : null });
  });
  const passo = Math.ceil(out.length / 220);
  return { pts: out.filter((_, i) => i % passo === 0 || i === out.length - 1), total, ultimo };
}
const horaDe = t => t ? new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

// gráfico: linhas cheias = 2º turno, tracejadas = 1º turno nas mesmas urnas; eixo x = % das urnas somadas
function graficoUrnas(C, nums, titulo, exp) {
  if (!C || C.pts.length < 2) return `<div class="bloco"><h3>${titulo}</h3><p class="exp">O gráfico aparece quando chegarem mais boletins.</p></div>`;
  const [A, B] = nums, pts = C.pts, W = largura(), H = Math.round(Math.min(330, Math.max(230, W * .4))), m = { l: 44, r: 16, t: 12, b: 44 };
  const vals = pts.flatMap(p => [p.a2, 100 - p.a2, ...(p.a1 != null ? [p.a1, 100 - p.a1] : [])]);
  let lo = Math.max(0, Math.floor((Math.min(50, ...vals) - 3) / 10) * 10), hi = Math.min(100, Math.ceil((Math.max(50, ...vals) + 3) / 10) * 10);
  const X = x => m.l + x / 100 * (W - m.l - m.r), Y = v => m.t + (hi - v) / (hi - lo) * (H - m.t - m.b);
  const caminho = (f, so) => { let d = "", on = false; pts.forEach(p => { const v = f(p); if (v == null) { on = false; return; } d += `${on ? "L" : "M"}${X(p.x).toFixed(1)},${Y(v).toFixed(1)}`; on = true; }); return d; };
  let g = "";
  for (let v = lo; v <= hi; v += 10) g += `<line class="eixo" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${v}%</text>`;
  g += `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${Y(50)}" y2="${Y(50)}"/>`;
  [0, 25, 50, 75, 100].forEach(x => g += `<text x="${X(x)}" y="${H - 22}" text-anchor="${x === 0 ? "start" : x === 100 ? "end" : "middle"}">${x}%</text>`);
  g += `<text x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle">% das urnas do lugar já somadas, na ordem em que chegaram</text>`;
  const tem1 = pts.some(p => p.a1 != null);
  if (tem1) g += `<path d="${caminho(p => p.a1 == null ? null : 100 - p.a1)}" fill="none" stroke="${corDe(B)}" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/>
                  <path d="${caminho(p => p.a1)}" fill="none" stroke="${corDe(A)}" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/>`;
  g += `<path d="${caminho(p => 100 - p.a2)}" fill="none" stroke="${corDe(B)}" stroke-width="2.8" stroke-linejoin="round"/>
        <path d="${caminho(p => p.a2)}" fill="none" stroke="${corDe(A)}" stroke-width="2.8" stroke-linejoin="round"/>`;
  const u = pts[pts.length - 1];
  g += `<circle cx="${X(u.x)}" cy="${Y(u.a2)}" r="4.5" fill="${corDe(A)}" stroke="var(--panel)" stroke-width="2"/><circle cx="${X(u.x)}" cy="${Y(100 - u.a2)}" r="4.5" fill="${corDe(B)}" stroke="var(--panel)" stroke-width="2"/>`;
  const dados = esc(JSON.stringify(pts.map(p => [X(p.x), `${f1(p.x)}% das urnas`, `${p.n} urnas`, +p.a2.toFixed(2), p.a1 == null ? null : +p.a1.toFixed(2)])));
  g += `<line class="cruz" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--mut)" stroke-width="1" style="display:none"/>
        <rect class="alvo" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" data-pts="${dados}" data-a="${esc(curto(nomeDe(ATUAL.ano, A)))}" data-b="${esc(curto(nomeDe(ATUAL.ano, B)))}"/>`;
  const li = (svg, t) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:18px;white-space:nowrap">${svg}${esc(t)}</span>`;
  const leg = `<p class="nota">` +
    li(`<svg width="26" height="10" style="display:inline;width:26px"><line x1="0" x2="26" y1="5" y2="5" stroke="currentColor" stroke-width="3"/></svg>`, "2º turno") +
    (tem1 ? li(`<svg width="26" height="10" style="display:inline;width:26px"><line x1="0" x2="26" y1="5" y2="5" stroke="currentColor" stroke-width="2" stroke-dasharray="6 5"/></svg>`, "1º turno (as mesmas urnas)") : "") +
    li(`<i style="width:12px;height:12px;border-radius:3px;background:${corDe(A)};display:inline-block"></i>`, curto(nomeDe(ATUAL.ano, A))) +
    li(`<i style="width:12px;height:12px;border-radius:3px;background:${corDe(B)};display:inline-block"></i>`, curto(nomeDe(ATUAL.ano, B))) + `</p>`;
  return `<div class="bloco"><h3>${titulo}</h3><p class="exp">${exp}</p><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}">${g}</svg>${leg}</div>`;
}

/* ---------------- componentes ---------------- */
const largura = () => Math.max(300, Math.min(1100, ($tela.clientWidth || 800) - 42));
let tRes; addEventListener("resize", () => { clearTimeout(tRes); tRes = setTimeout(render, 300); });
// P = { titulo, voltar, contagem, prog, v (votos 2º turno por número), extra, vazio }
function placar(P) {
  let h = `<section class="placar"><div class="ph"><div class="onde"><h2>${P.titulo}</h2>
    ${P.voltar ? `<button class="volta" data-volta>${esc(P.voltar)}</button>` : ""}</div>`;
  if (P.contagem) h += `<div class="urnas"><div class="q">${P.contagem}</div><div class="medidor"><i style="width:${Math.min(100, P.prog || 0)}%"></i></div>${P.atualizar ? `<button class="agora" style="margin-top:10px" data-atualizar="${esc(P.atualizar[0])}">${esc(P.atualizar[1])}</button>` : ""}</div>`;
  h += `</div>`;
  const nums = doisMais(P.v);
  const sh = nums.length === 2 && entreDois(P.v, nums);
  if (!sh) return h + `<div class="vazio">${P.vazio || "Ainda sem votos."}</div></section>`;
  const [A, B] = nums;
  const bloco = (n, dir) => `<div class="cand ${dir ? "dir" : ""}">
      <span class="tag" style="background:${corDe(n)}">${esc(nomeDe(ATUAL.ano, n))} <small>${n}</small></span>
      <div class="pct">${pct1(sh[n])}<sup>%</sup></div>
      <div class="vt"><b>${fInt(P.v[n] || 0)}</b> votos</div></div>`;
  const dif = (P.v[A] || 0) - (P.v[B] || 0);
  const lider = dif === 0 ? "Empate" : `<b>${esc(curto(nomeDe(ATUAL.ano, dif > 0 ? A : B)))}</b> à frente por <b>${fInt(Math.abs(dif))}</b> votos`;
  h += `<div class="cands">${bloco(A)}${bloco(B, true)}</div>
    <div class="barra" role="img" aria-label="${esc(curto(nomeDe(ATUAL.ano, A)))} ${pct1(sh[A])}%, ${esc(curto(nomeDe(ATUAL.ano, B)))} ${pct1(sh[B])}%">
      <i style="width:${sh[A]}%;background:${corDe(A)}"></i><i style="width:${sh[B]}%;background:${corDe(B)}"></i><span class="meio"></span></div>
    <div class="barra-leg"><span>${esc(curto(nomeDe(ATUAL.ano, A)))}</span><span>50%</span><span>${esc(curto(nomeDe(ATUAL.ano, B)))}</span></div>
    <div class="frente">${lider}</div>`;
  h += `<!--desde-->`;
  if (P.extra) h += `<div class="extra">${P.extra}</div>`;
  return h + `</section>`;
}

// destaque "desde o 1º turno" dentro do placar, logo abaixo das porcentagens
let desdeHTML = "";
// extras: [{ nome, de, para, sub }] → abstenção, brancos e nulos (caixa neutra, ao lado dos candidatos)
function desdeNoPlacar(exp, itens, extras) {
  if (!itens || !itens.length) return "";
  const ex = (extras || []).filter(x => x && x.de != null && x.para != null && isFinite(x.de) && isFinite(x.para));
  desdeHTML = `<div class="desde${ex.length ? " quatro" : ""}">` + itens.map(i => {
    const d = i.para - i.de;
    return `<div style="border-color:${corDe(i.n)}"><b class="dn">${esc(nomeDe(ATUAL.ano, i.n)).toUpperCase()}</b>
      <span>${esc(i.rotDe)} <b>${pct1(i.de)}%</b> → ${esc(i.rotPara)} <b>${pct1(i.para)}%</b></span>
      <span class="dd ${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"} ${f1(Math.abs(d))} ${Math.abs(d) >= 0.95 && Math.abs(d) < 1.05 ? "ponto" : "pontos"}</span></div>`;
  }).join("") + ex.map(x => { const d = x.para - x.de;
    return `<div class="neutro"><b class="dn">${esc(x.nome).toUpperCase()}</b>
      <span>1º turno <b>${f1(x.de)}%</b> → 2º turno <b>${f1(x.para)}%</b></span>
      <span class="dd">${d >= 0 ? "▲" : "▼"} ${f1(Math.abs(d))} ${Math.abs(d) >= 0.95 && Math.abs(d) < 1.05 ? "ponto" : "pontos"}</span>${x.sub ? `<small>${x.sub}</small>` : ""}</div>`; }).join("") +
    `</div><p class="exp" style="margin:6px 0 0">${exp}</p>`;
  return "";
}

// linhas "de → para" por candidato; itens: [{ n, nome, de, para, rotDe, rotPara }]
function blocoMov(titulo, exp, itens) {
  if (!itens || !itens.length) return "";
  return `<div class="bloco"><h3>${titulo}</h3><p class="exp">${exp}</p>` + itens.map(i => `
    <div class="mov"><div class="nm"><i style="background:${corDe(i.n)}"></i>${esc(i.nome)}</div>
      <div class="de">${i.rotDe} <b>${pct1(i.de)}%</b> → ${i.rotPara} <b>${pct1(i.para)}%</b></div>${seta(i.para - i.de)}</div>`).join("") + `</div>`;
}
function movDe(v1, v2, rotDe, rotPara, anoDe = ATUAL.ano) {
  const nums = doisMais(v2); if (nums.length < 2 || !v1) return null;
  const a = entreDois(v1, nums), b = entreDois(v2, nums);
  if (!a || !b) return null;
  return nums.map(n => {
    const outro = nomeDe(anoDe, n) !== nomeDe(ATUAL.ano, n);
    return { n, nome: curto(nomeDe(ATUAL.ano, n)), de: a[n], para: b[n], rotDe: outro ? `${rotDe} (${curto(nomeDe(anoDe, n))})` : rotDe, rotPara };
  });
}

// tabela de votos por turno
function blocoTabela(v1, v2, r2, parcial) {
  const nums = doisMais(v2); if (nums.length < 2) return "";
  let h = `<div class="bloco"><h3>Votos por turno</h3><p class="exp">${parcial ? "O 2º turno ainda está sendo apurado, então o ganho vai mudar." : "Número de votos de cada candidato."}</p>
    <div style="overflow-x:auto"><table><thead><tr><th>Candidato</th><th>1º turno ${ATUAL.ano}</th><th>2º turno ${ATUAL.ano}</th><th>Ganho</th>${r2 ? `<th>2º turno ${REF.ano}</th>` : ""}</tr></thead><tbody>`;
  nums.forEach(n => {
    const a = v1 ? v1[n] || 0 : null, b = v2[n] || 0, g = a == null ? null : b - a;
    const outro = nomeDe(REF.ano, n) !== nomeDe(ATUAL.ano, n);
    h += `<tr><td><b>${esc(curto(nomeDe(ATUAL.ano, n)))}</b> <small>${n}</small></td><td>${a == null ? "—" : fInt(a)}</td><td>${fInt(b)}</td>
      <td class="${g == null ? "" : g >= 0 ? "up" : "down"}">${g == null ? "—" : sgn(g)}${g != null && a ? ` <small>(${g >= 0 ? "+" : "−"}${f1(Math.abs(100 * g / a))}%)</small>` : ""}</td>
      ${r2 ? `<td>${r2[n] == null ? "—" : fInt(r2[n])}${outro ? ` <small>${esc(curto(nomeDe(REF.ano, n)))}</small>` : ""}</td>` : ""}</tr>`;
  });
  return h + `</tbody></table></div></div>`;
}

// curva: pts [{t, a (fatia do candidato A), r}]
function graficoCurva(pts, nums, titulo, exp) {
  if (!pts || pts.length < 2) return `<div class="bloco"><h3>${titulo}</h3><p class="exp">A curva aparece quando chegarem mais boletins. Deixe a página aberta que ela vai se formando.</p></div>`;
  const [A, B] = nums, W = largura(), H = Math.round(Math.min(320, Math.max(220, W * .42))), m = { l: 44, r: 120, t: 12, b: 28 };
  const ts = pts.map(p => p.t), t0 = Math.min(...ts), t1 = Math.max(...ts) || t0 + 1;
  const vals = pts.flatMap(p => [p.a, 100 - p.a]);
  let lo = Math.min(50, ...vals) - 3, hi = Math.max(50, ...vals) + 3;
  lo = Math.max(0, Math.floor(lo / 5) * 5); hi = Math.min(100, Math.ceil(hi / 5) * 5);
  const X = t => m.l + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - m.l - m.r);
  const Y = v => m.t + (hi - v) / (hi - lo) * (H - m.t - m.b);
  const linha = f => pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(f(p)).toFixed(1)}`).join("");
  const hora = t => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  let g = "";
  for (let v = lo; v <= hi; v += (hi - lo > 30 ? 10 : 5)) g += `<line class="eixo" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${v}%</text>`;
  g += `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${Y(50)}" y2="${Y(50)}"/>`;
  [t0, (t0 + t1) / 2, t1].forEach((t, i) => g += `<text x="${X(t)}" y="${H - 6}" text-anchor="${["start", "middle", "end"][i]}">${hora(t)}</text>`);
  const u = pts[pts.length - 1];
  g += `<path d="${linha(p => 100 - p.a)}" fill="none" stroke="${corDe(B)}" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="${linha(p => p.a)}" fill="none" stroke="${corDe(A)}" stroke-width="2.5" stroke-linejoin="round"/>
        <circle cx="${X(u.t)}" cy="${Y(u.a)}" r="4.5" fill="${corDe(A)}" stroke="var(--panel)" stroke-width="2"/>
        <circle cx="${X(u.t)}" cy="${Y(100 - u.a)}" r="4.5" fill="${corDe(B)}" stroke="var(--panel)" stroke-width="2"/>`;
  const ya = Y(u.a), yb = Y(100 - u.a), afast = Math.abs(ya - yb) < 18 ? (ya < yb ? -9 : 9) : 0;
  g += `<text class="forte" x="${X(u.t) + 10}" y="${ya + 4 + afast}">${esc(curto(nomeDe(ATUAL.ano, A)))} ${pct1(u.a)}%</text>
        <text class="forte" x="${X(u.t) + 10}" y="${yb + 4 - afast}">${esc(curto(nomeDe(ATUAL.ano, B)))} ${pct1(100 - u.a)}%</text>`;
  const dados = esc(JSON.stringify(pts.map(p => [X(p.t), hora(p.t), p.r || "", +p.a.toFixed(2)])));
  g += `<line class="cruz" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--mut)" stroke-width="1" style="display:none"/>
        <rect class="alvo" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" data-pts="${dados}" data-a="${esc(curto(nomeDe(ATUAL.ano, A)))}" data-b="${esc(curto(nomeDe(ATUAL.ano, B)))}"/>`;
  return `<div class="bloco"><h3>${titulo}</h3><p class="exp">${exp}</p><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}">${g}</svg></div>`;
}

// halteres: um lugar por linha, ponto do 1º turno → ponto do 2º turno (fatia do candidato A)
function graficoHalteres(linhas, A, titulo, exp) {
  const L = linhas.filter(l => l.p1 != null && l.p2 != null).sort((a, b) => (b.p2 - b.p1) - (a.p2 - a.p1));
  if (L.length < 2) return "";
  const W = largura(), lh = 34, m = { l: Math.min(190, W * .32), r: 62, t: 26, b: 8 }, H = m.t + L.length * lh + m.b;
  const vals = L.flatMap(l => [l.p1, l.p2]);
  let lo = Math.max(0, Math.floor((Math.min(50, ...vals) - 3) / 10) * 10), hi = Math.min(100, Math.ceil((Math.max(50, ...vals) + 3) / 10) * 10);
  const X = v => m.l + (v - lo) / (hi - lo) * (W - m.l - m.r);
  let g = "";
  for (let v = lo; v <= hi; v += 10) g += `<line class="eixo" x1="${X(v)}" x2="${X(v)}" y1="${m.t - 6}" y2="${H - m.b}"/><text x="${X(v)}" y="${m.t - 12}" text-anchor="middle">${v}%</text>`;
  g += `<line class="ref" x1="${X(50)}" x2="${X(50)}" y1="${m.t - 6}" y2="${H - m.b}"/>`;
  L.forEach((l, i) => {
    const y = m.t + i * lh + lh / 2, d = l.p2 - l.p1;
    const dica = esc(`${l.nome}: ${f1(l.p1)}% no 1º turno → ${f1(l.p2)}% no 2º (${d >= 0 ? "+" : "−"}${f1(Math.abs(d))} pts)`);
    g += `<g data-dica="${dica}"><rect x="0" y="${y - lh / 2}" width="${W}" height="${lh}" fill="transparent"/>
      <text x="${m.l - 12}" y="${y + 4}" text-anchor="end" class="forte" style="font-weight:600">${esc(l.rot)}</text>
      <line x1="${X(l.p1)}" x2="${X(l.p2)}" y1="${y}" y2="${y}" stroke="${corDe(A)}" stroke-width="3" opacity=".35"/>
      <circle cx="${X(l.p1)}" cy="${y}" r="5.5" fill="var(--panel)" stroke="var(--mut)" stroke-width="2"/>
      <circle cx="${X(l.p2)}" cy="${y}" r="6.5" fill="${corDe(A)}" stroke="var(--panel)" stroke-width="2"/>
      <text x="${W - 4}" y="${y + 4}" text-anchor="end" style="fill:var(${d >= 0 ? "--up" : "--down"});font-weight:700">${d >= 0 ? "+" : "−"}${f1(Math.abs(d))}</text></g>`;
  });
  return `<details class="bloco dobra" data-dobra="hal" ${dobras.hal ? "open" : ""}><summary><h3>${titulo}</h3><span class="abre">toque para ${dobras.hal ? "fechar" : "abrir"}</span></summary><p class="exp">${exp}</p>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}">${g}</svg>
    <p class="nota"><svg viewBox="0 0 230 14" style="display:inline-block;width:230px;vertical-align:-2px"><circle cx="7" cy="7" r="5" fill="var(--panel)" stroke="var(--mut)" stroke-width="2"/><text x="17" y="11">1º turno</text><circle cx="90" cy="7" r="6" fill="${corDe(A)}"/><text x="101" y="11">2º turno</text></svg></p></details>`;
}

function blocoPosts(posts) {
  const P = posts.filter(p => p && p.texto);
  if (!P.length) return "";
  return `<div class="bloco"><h3>Posts prontos</h3><div class="posts">` +
    P.map(p => `<div class="post"><div class="post-h"><span><b>${esc(p.titulo)}</b>${p.sub ? `<small>${esc(p.sub)}</small>` : ""}</span>
      <button class="copiar" data-copia="pre_${p.id}">Copiar</button></div><pre id="pre_${p.id}">${esc(p.texto)}</pre></div>`).join("") + `</div></div>`;
}

// lista de lugares (países ou estados)
function blocoLista(titulo, itens, attr, selecionado, filtros) {
  let h = `<div class="bloco"><h3>${titulo}</h3>`;
  if (filtros) h += `<div class="filtros">${filtros.map(([k, t, n]) => `<button data-filtro="${k}" aria-pressed="${estado.filtro === k}">${t} <span style="opacity:.7">${n}</span></button>`).join("")}</div>`;
  h += `<p class="exp">Toque num lugar para ver só ele.</p><div class="lugares">`;
  h += itens.map(it => {
    const nums = doisMais(it.v), sh = nums.length === 2 && entreDois(it.v, nums);
    const meio = sh ? `<div class="mini"><div class="mb"><i style="width:${sh[nums[0]]}%;background:${corDe(nums[0])}"></i><i style="width:${sh[nums[1]]}%;background:${corDe(nums[1])}"></i></div>
        <div class="nums"><span>${esc(curto(nomeDe(ATUAL.ano, nums[0])))} <b>${pct1(sh[nums[0]])}%</b></span><span>${esc(curto(nomeDe(ATUAL.ano, nums[1])))} <b>${pct1(sh[nums[1]])}%</b></span></div></div>`
      : `<div class="mini"><span class="nums" style="color:var(--mut)">sem votos ainda</span></div>`;
    const dl = it.d != null ? `<div class="dl ${it.d >= 0 ? "up" : "down"}">${it.d >= 0 ? "▲" : "▼"} ${f1(Math.abs(it.d))}<small>${esc(curto(nomeDe(ATUAL.ano, nums[0] || "13")))} vs 1º</small></div>` : `<div class="dl"></div>`;
    return `<button class="lugar" ${attr}="${esc(it.chave)}" aria-current="${it.chave === selecionado}"><span class="q1"><b>${it.rot}</b><span class="${it.stClasse || ""}">${esc(it.st)}</span></span>${meio}${dl}</button>`;
  }).join("");
  return h + `</div></div>`;
}

/* ---------------- dados oficiais por país, sem travar a tela ---------------- */
// devolve o que já tiver chegado; o resto é buscado em segundo plano e a tela se atualiza depois
const oficCache = {}, oficBuscando = new Set();
function oficial(p) {
  const k = p.cd + ":" + p.cidades.length;
  if (oficCache[k]) return oficCache[k];
  if (!oficBuscando.has(k)) {
    oficBuscando.add(k);
    oficiaisPais(p).then(o => { oficCache[k] = o; }).catch(() => { oficCache[k] = {}; })
      .finally(() => { oficBuscando.delete(k); mostrarAosPoucos(); });
  }
  return {};
}

/* ---------------- para onde foram os votos (mesmas urnas, 1º → 2º turno) ---------------- */
function contasFluxo(S, nums) {
  if (!S.nE || nums.length < 2) return null;
  const [A, B] = nums;
  const a1 = S.m1[A] || 0, a2 = S.m2[A] || 0, b1 = S.m1[B] || 0, b2 = S.m2[B] || 0;
  const outros = Object.entries(S.m1).filter(([n]) => n !== A && n !== B).reduce((s, [, v]) => s + v, 0);
  const bn1 = S.br1 + S.nu1, bn2 = S.br2 + S.nu2;
  const abs1 = S.ap1 ? 100 * (1 - S.c1 / S.ap1) : null, abs2 = S.ap2 ? 100 * (1 - S.c2 / S.ap2) : null;
  const gA = a2 - a1, gB = b2 - b1, dC = S.c2 - S.c1;
  return { A, B, a1, a2, b1, b2, outros, bn1, bn2, abs1, abs2, gA, gB, dC, emJogo: outros + dC, dif1: b1 - a1, dif2: b2 - a2, n: S.nE };
}
const pc = (g, base) => base ? `${g >= 0 ? "+" : "−"}${f1(Math.abs(100 * g / base))}%` : "";
function blocoFluxo(S, nums) {
  const F = contasFluxo(S, nums); if (!F) return "";
  const nA = curto(nomeDe(ATUAL.ano, F.A)), nB = curto(nomeDe(ATUAL.ano, F.B));
  const linha = (rot, cor, v1, v2, extra) => {
    const g = v2 - v1;
    return `<tr><td>${cor ? `<i style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${cor};margin-right:7px"></i>` : ""}<b>${rot}</b></td>
      <td>${fInt(v1)}</td><td>${fInt(v2)}</td><td class="${g >= 0 ? "up" : "down"}"><b>${sgn(g)}</b> <small>${pc(g, v1)}</small>${extra || ""}</td></tr>`;
  };
  const somaG = F.gA + F.gB;
  const fatiaA = somaG > 0 ? 100 * F.gA / somaG : null;
  const lider1 = F.dif1 >= 0 ? nB : nA, lider2 = F.dif2 >= 0 ? nB : nA;
  const mudou = Math.abs(F.dif1) - Math.abs(F.dif2);
  let frase;
  if (lider1 !== lider2) frase = `<b>${lider2}</b> virou: no 1º turno <b>${lider1}</b> estava à frente por ${fInt(Math.abs(F.dif1))} votos; agora <b>${lider2}</b> está à frente por ${fInt(Math.abs(F.dif2))}.`;
  else if (mudou > 0) frase = `<b>${lider1 === nA ? nB : nA}</b> tirou <b>${fInt(mudou)}</b> votos da diferença: era ${fInt(Math.abs(F.dif1))} a favor de ${lider1} no 1º turno, agora é ${fInt(Math.abs(F.dif2))}.`;
  else frase = `<b>${lider1}</b> aumentou a vantagem em <b>${fInt(-mudou)}</b> votos: era ${fInt(Math.abs(F.dif1))} no 1º turno, agora é ${fInt(Math.abs(F.dif2))}.`;
  return `<div class="bloco"><h3>Para onde foram os votos</h3>
    <p class="exp">Nas mesmas ${fInt(F.n)} urnas já apuradas, 1º turno → 2º turno.</p>
    <div style="overflow-x:auto"><table><thead><tr><th></th><th>1º turno</th><th>2º turno</th><th>Diferença</th></tr></thead><tbody>
      ${linha(nA, corDe(F.A), F.a1, F.a2)}
      ${linha(nB, corDe(F.B), F.b1, F.b2)}
      ${linha("Brancos e nulos", "", F.bn1, F.bn2)}
      ${linha("Comparecimento", "", S.c1, S.c2, F.abs1 != null && F.abs2 != null ? `<br><small>abstenção ${f1(F.abs1)}% → ${f1(F.abs2)}%</small>` : "")}
    </tbody></table></div>
    ${fatiaA != null ? `<div class="mov"><div class="nm">Ganho dos dois</div><div class="de">Dos <b>${fInt(somaG)}</b> votos que os dois ganharam juntos, ${nA} ficou com <b>${f1(fatiaA)}%</b> e ${nB} com <b>${f1(100 - fatiaA)}%</b></div><span></span></div>` : ""}
    <p class="frente" style="font-size:17px">${frase}</p></div>`;
}
function textoFluxo(S, nums) {
  const F = contasFluxo(S, nums); if (!F) return "";
  const nA = curto(nomeDe(ATUAL.ano, F.A)), nB = curto(nomeDe(ATUAL.ano, F.B));
  const l = [`Nas mesmas ${fInt(F.n)} urnas, do 1º para o 2º turno:`,
    `${EMOJI[F.A] || "⚪"} ${nA}: ${fInt(F.a1)} → ${fInt(F.a2)} (${sgn(F.gA)} / ${pc(F.gA, F.a1)})`,
    `${EMOJI[F.B] || "⚪"} ${nB}: ${fInt(F.b1)} → ${fInt(F.b2)} (${sgn(F.gB)} / ${pc(F.gB, F.b1)})`,
    `⬜ Brancos e nulos: ${fInt(F.bn1)} → ${fInt(F.bn2)}`];
  if (F.abs1 != null && F.abs2 != null) l.push(`🗳️ Abstenção: ${f1(F.abs1)}% → ${f1(F.abs2)}%`);
  const somaG = F.gA + F.gB;
  if (somaG > 0) l.push("", `Dos ${fInt(somaG)} votos que os dois ganharam juntos, ${nA} ficou com ${f1(100 * F.gA / somaG)}% e ${nB} com ${f1(100 * F.gB / somaG)}%.`);
  const lider1 = F.dif1 >= 0 ? nB : nA, lider2 = F.dif2 >= 0 ? nB : nA, mudou = Math.abs(F.dif1) - Math.abs(F.dif2);
  if (lider1 !== lider2) l.push(`${lider2} virou: estava atrás por ${fInt(Math.abs(F.dif1))} e agora está à frente por ${fInt(Math.abs(F.dif2))}.`);
  else l.push(mudou > 0 ? `${lider1 === nA ? nB : nA} tirou ${fInt(mudou)} votos da diferença (de ${fInt(Math.abs(F.dif1))} para ${fInt(Math.abs(F.dif2))}).`
                        : `${lider1} aumentou a vantagem em ${fInt(-mudou)} votos (de ${fInt(Math.abs(F.dif1))} para ${fInt(Math.abs(F.dif2))}).`);
  return l.join("\n");
}

/* ---------------- telas ---------------- */
// abstenção e brancos/nulos (resultado oficial) para as caixas ao lado dos candidatos
function extrasOficiais(t1, t2) {
  const a = t1 && t1.ex, b = t2 && t2.ex;
  if (!a || !b) return null;
  return [{ nome: "Abstenção", de: 100 * a.a / a.est, para: 100 * b.a / b.est, sub: `${fInt(b.a)} de ${fInt(b.est)} não votaram${b.est < b.te ? " (seções apuradas)" : ""}` },
    { nome: "Brancos e nulos", de: 100 * (a.vb + a.vn) / a.c, para: 100 * (b.vb + b.vn) / b.c, sub: `${fInt(b.vb)} brancos · ${fInt(b.vn)} nulos (dos que votaram)` }];
}
// resumo da apuração com os números oficiais (mesmos dados do exterior)
function quadroOficial(t1, t2, extra) {
  const b = t2 && t2.ex, a = t1 && t1.ex;
  if (!b) return extra && extra.length ? quadro(extra) : "";
  const nums = doisMais(votosDeRes(t2));
  return quadro([
    b.ts ? ["Seções apuradas", `${fInt(b.st)} de ${fInt(b.ts)}`, `${f1(t2.pst)}% · faltam ${fInt(b.ts - b.st)}`] : ["Seções apuradas", f1(t2.pst) + "%"],
    ...(extra || []),
    ["Eleitores", fInt(b.te), b.est < b.te ? `${fInt(b.est)} nas seções apuradas` : ""],
    ["Votaram", fInt(b.c), `abstenção de ${f1(100 * b.a / b.est)}%${a ? ` (1º turno: ${f1(100 * a.a / a.est)}%)` : ""}`],
    ["Votos nos dois", fInt(nums.reduce((t, n) => t + ((votosDeRes(t2) || {})[n] || 0), 0)), `brancos ${fInt(b.vb)} · nulos ${fInt(b.vn)}`],
    a ? ["No 1º turno", `${fInt(a.c)} votaram`, `brancos ${fInt(a.vb)} · nulos ${fInt(a.vn)}`] : null]);
}
function blocoAbstencao(t1, t2) {
  const a = t1 && t1.ex, b = t2 && t2.ex; if (!b) return "";
  const p2 = 100 * b.a / b.est;
  if (!a) return `<div class="bloco"><h3>Abstenção</h3><div class="mov"><div class="nm">Não votaram</div><div class="de">2º turno <b>${f1(p2)}%</b></div><span></span></div>
    <p class="nota" style="font-size:16px"><b>${fInt(b.a)}</b> de ${fInt(b.est)} eleitores não votaram.</p></div>`;
  const p1 = 100 * a.a / a.est, dd = p2 - p1;
  return `<div class="bloco"><h3>Abstenção</h3><p class="exp">1º turno completo × 2º turno ${t2.pst < 100 ? "nas seções já apuradas" : "completo"}.</p>
    <div class="mov"><div class="nm">Não votaram</div><div class="de">1º turno <b>${f1(p1)}%</b> → 2º turno <b>${f1(p2)}%</b></div>
    <span class="delta ${dd <= 0 ? "up" : "down"}">${dd <= 0 ? "▼" : "▲"} ${f1(Math.abs(dd))} pontos</span></div>
    <p class="nota" style="font-size:16px"><b>${fInt(b.a)}</b> de ${fInt(b.est)} eleitores não votaram no 2º turno (no 1º, foram ${fInt(a.a)} de ${fInt(a.est)}).</p></div>`;
}
// texto pronto para copiar de um lugar com resultado oficial (Brasil, região, estado, município)
function textoLugar(local, icone, v1, v2, w2, pst, x1, x2) {
  const nums = doisMais(v2 || {}); if (nums.length < 2) return "";
  const sh = entreDois(v2, nums), parcial = pst != null && pst < 100;
  const out = [`${icone} ${local.toUpperCase()} | 2º turno${parcial ? ` (parcial: ${f2(pst)}% das seções)` : ""}`, ""];
  nums.forEach(n => out.push(`${EMOJI[n] || "⚪"} ${curto(nomeDe(ATUAL.ano, n))}: ${f2(sh[n])}% (${fInt(v2[n] || 0)} votos)`));
  const dif = (v2[nums[0]] || 0) - (v2[nums[1]] || 0);
  out.push("", dif === 0 ? "Empate." : `${curto(nomeDe(ATUAL.ano, dif > 0 ? nums[0] : nums[1]))} à frente por ${fInt(Math.abs(dif))} votos.`);
  const a = v1 && entreDois(v1, nums);
  if (a) {
    out.push("", "Desde o 1º turno (só entre os dois):");
    nums.forEach(n => { const d = sh[n] - a[n]; out.push(`${d >= 0 ? "📈" : "📉"} ${curto(nomeDe(ATUAL.ano, n))}: ${f2(a[n])}% → ${f2(sh[n])}% (${d >= 0 ? "+" : "−"}${f2(Math.abs(d))} pontos)`); });
  }
  const r = w2 && entreDois(w2, nums);
  if (r) {
    out.push("", `Comparado ao 2º turno de ${REF.ano}:`);
    nums.forEach(n => { const d = sh[n] - r[n]; const outro = nomeDe(REF.ano, n) !== nomeDe(ATUAL.ano, n);
      out.push(`${d >= 0 ? "📈" : "📉"} ${curto(nomeDe(ATUAL.ano, n))}: ${f2(sh[n])}%, ${d >= 0 ? "acima" : "abaixo"} dos ${f2(r[n])}% de ${outro ? curto(nomeDe(REF.ano, n)) : REF.ano}`); });
  }
  if (x2 && x2.est) {
    const p2 = 100 * x2.a / x2.est;
    out.push("", x1 && x1.est ? `🗳️ Abstenção: ${f1(100 * x1.a / x1.est)}% → ${f1(p2)}% · ${fInt(x2.a)} de ${fInt(x2.est)} eleitores não votaram` : `🗳️ Abstenção: ${f1(p2)}% · ${fInt(x2.a)} de ${fInt(x2.est)} eleitores não votaram`);
    out.push(`⬜ Brancos ${fInt(x2.vb)} · nulos ${fInt(x2.vn)}${x1 ? ` (no 1º turno: ${fInt(x1.vb)} e ${fInt(x1.vn)})` : ""}`);
  }
  out.push("", "Fonte: TSE");
  return out.join("\n");
}
// antes das 17h: o bloco de posts já aparece, avisando quando chega
function postsAguardando(onde) {
  return `<div class="bloco"><h3>Posts prontos</h3><p class="exp">Os textos para copiar ${onde} aparecem aqui assim que o TSE divulgar os primeiros votos (17h, horário de Brasília).</p></div>`;
}
// 1º turno de um lugar, em uma linha (para quando o 2º ainda não chegou)
function linha1T(v1) {
  const n = doisMais(v1 || {}), a = n.length === 2 && entreDois(v1, n);
  return a ? n.map(x => `${esc(curto(nomeDe(ATUAL.ano, x)))} <b>${pct1(a[x])}%</b>`).join(" × ") : "";
}
// mapa dos estados (o mesmo das telas Total e Estados, igual ao do exterior)
function mapaEstados(ufs, reg, sel) {
  const amostra = ufs.find(x => x.t2 || x.t1), nm = amostra ? doisMais(votosDeRes(amostra.t2 || amostra.t1)) : ["13", "22"];
  const usar2 = ufs.some(x => x.t2);
  return blocoMapa("brasil", (reg ? `Mapa: ${reg}` : "Mapa dos estados") + (usar2 ? "" : " · 1º turno (o 2º começa às 17h)"), ufs.filter(x => !reg || x.reg === reg).map(x => {
    const v = votosDeRes(usar2 ? x.t2 : x.t1), sh = v && entreDois(v, nm);
    return { id: x.u.toLowerCase(), chave: x.u, nome: NOME_UF[x.u], pA: sh ? sh[nm[0]] : null, st: x.t2 ? `${f1(x.t2.pst)}% apurado` : "1º turno" };
  }), "uf", nm[0], nm[1], sel);
}
const somaUfs = (lista, k) => { const v = {}; lista.forEach(x => x[k] && x[k].cands.forEach(c => v[c.n] = (v[c.n] || 0) + c.votos)); return v; };
const ufsJa = (com22 = true) => UFS.map(u => { const k = u.toLowerCase();
  return { u, t1: resJa(ATUAL.ano, ATUAL.t1, k), t2: resJa(ATUAL.ano, ATUAL.t2, k), r2: com22 ? resJa(REF.ano, REF.t2, k) : null, reg: REGIAO_DE[u] }; });
// regiões lado a lado (com 1º turno antes das 17h)
function listaRegioes(ufs) {
  const linhas = Object.keys(REGIOES).map(rg => { const l = ufs.filter(x => x.reg === rg), c2 = l.filter(x => x.t2);
    return { rg, n: l.length, c2: c2.length, v: c2.length ? somaUfs(c2, "t2") : null, w: somaUfs(c2.length ? c2 : l, "t1") }; });
  return blocoLista("Regiões", linhas.map(x => {
    const n = doisMais(x.v || x.w), a = entreDois(x.w, n), b = x.v && entreDois(x.v, n);
    return { chave: x.rg, rot: esc(x.rg), v: x.v, st: x.c2 ? `${x.c2} de ${x.n} estados com votos` : `aguardando · 1º turno ${a && n[0] ? `${curto(nomeDe(ATUAL.ano, n[0]))} ${pct1(a[n[0]])}%` : "—"}`,
      stClasse: x.c2 ? (x.c2 === x.n ? "st-ok" : "st-part") : "", d: a && b ? b[n[0]] - a[n[0]] : null };
  }), "data-reg-ir", "");
}
async function telaTotal() {
  const [a1, a2, r2] = await Promise.all([res(ATUAL.ano, ATUAL.t1, "br"), res(ATUAL.ano, ATUAL.t2, "br"), res(REF.ano, REF.t2, "br")]);
  const v2 = votosDeRes(a2), v1 = votosDeRes(a1), w2 = votosDeRes(r2);
  let h = placar({ titulo: "🇧🇷 Brasil", contagem: a2 ? `<b>${f1(a2.pst)}%</b> das seções apuradas` : "aguardando o TSE", prog: a2 ? a2.pst : 0, v: v2,
    vazio: `O TSE começa a divulgar o total às 17h (horário de Brasília).${v1 ? `<br>No 1º turno: ${linha1T(v1)} (só entre os dois).` : ""}<br><button class="volta" data-tela-ir="exterior">Ver o Exterior agora</button>` });
  const r1 = resJa(REF.ano, REF.t1, "br");          // 1º turno de 2022 (para o post), sem travar a tela
  const ufs = ufsJa(false);                           // mapa e regiões: chegam aos poucos, depois do Brasil
  const fim = mapaEstados(ufs, "", "") + listaRegioes(ufs);
  if (!v2) return h + postsAguardando("do Brasil") + fim;
  const nums = doisMais(v2), sh = entreDois(v2, nums);
  registrar("br", a2.pst, sh[nums[0]], `${f1(a2.pst)}% das seções`);
  h += `<div class="duas">` +
    desdeNoPlacar( "Comparado ao resultado final do 1º turno, só entre os dois. Com a apuração parcial, ainda pode mudar.", movDe(v1, v2, "1º turno", "2º turno"), extrasOficiais(a1, a2)) +
    blocoMov(`Comparado com ${REF.ano}`, `Fatia de cada número no 2º turno de ${REF.ano}.`, movDe(w2, v2, String(REF.ano), String(ATUAL.ano), REF.ano)) + `</div>`;
  h += quadroOficial(a1, a2) + blocoAbstencao(a1, a2);
  h += graficoCurva(historico("br"), nums, "Como a apuração evoluiu", "Fatia de cada um a cada atualização, desde que esta página foi aberta.");
  h += blocoTabela(v1, v2, w2, a2.pst < 100);
  const anos = [infoAno(ATUAL.ano, a1, a2), infoAno(REF.ano, r1, r2)];
  h += blocoPosts([{ id: "brr", titulo: "Brasil: placar e 1º → 2º turno", sub: `${f1(a2.pst)}% das seções`, texto: textoLugar("Brasil", "🇧🇷", v1, v2, w2, a2.pst, a1 && a1.ex, a2.ex) },
    { id: "br", titulo: "Brasil: 1º → 2º turno e 2022", texto: textoDeAnos(anos, "Brasil", "🇧🇷", { parcial: a2.pst < 100 ? `parcial: ${f2(a2.pst)}% das seções` : "", fonte: "Fonte: TSE" }) }]);
  return h + fim;
}

/* ---------- urnas de um país, uma por linha ---------- */
function blocoUrnas(P, nums) {
  const mus = new Map(P.cidades.map(c => [c.mu, c.nm]));
  const linhas = (BU.secoes || []).filter(s => mus.has(s.mu)).map(s => ({ s, l: BU.lidos[`${s.mu}-${s.z}-${s.ns}`] || {} }))
    .sort((a, b) => (b.l.votos ? 1 : 0) - (a.l.votos ? 1 : 0) || a.s.mu.localeCompare(b.s.mu) || a.s.ns.localeCompare(b.s.ns));
  const [A, B] = nums, lim = 400;
  let h = `<div class="bloco"><h3>Urnas de ${esc(P.nome)}</h3><p class="exp">${linhas.length} urnas. Cada linha é uma seção eleitoral.</p>
    <div style="overflow-x:auto;max-height:520px;overflow-y:auto"><table style="min-width:640px"><thead><tr><th>Cidade · seção</th><th>Aptos</th><th>Votaram</th>
    <th>${esc(curto(nomeDe(ATUAL.ano, A)))}</th><th>${esc(curto(nomeDe(ATUAL.ano, B)))}</th><th>Brancos e nulos</th><th>vs 1º turno</th></tr></thead><tbody>`;
  linhas.slice(0, lim).forEach(({ s, l }) => {
    const e = l.extra || {};
    let d = "";
    if (l.votos && l.v1) { const a = entreDois(l.v1, nums), b = entreDois(l.votos, nums); if (a && b) { const x = b[A] - a[A]; d = `<span class="${x >= 0 ? "up" : "down"}">${x >= 0 ? "▲" : "▼"} ${f1(Math.abs(x))}</span>`; } }
    h += `<tr><td>${esc(mus.get(s.mu))} <small>${s.z}/${s.ns}</small></td>` + (l.votos
      ? `<td>${fInt(e.aptos || 0)}</td><td>${fInt(e.comp || 0)}</td><td>${fInt(l.votos[A] || 0)}</td><td>${fInt(l.votos[B] || 0)}</td><td>${fInt((e.brancos || 0) + (e.nulos || 0))}</td><td>${d}</td>`
      : `<td colspan="6" style="text-align:left;color:var(--mut)">sem boletim ainda</td>`) + `</tr>`;
  });
  if (linhas.length > lim) h += `<tr><td colspan="7" style="color:var(--mut)">…e mais ${linhas.length - lim} urnas</td></tr>`;
  return h + `</tbody></table></div></div>`;
}

/* ---------- resultado sem esperar: devolve o que já tem e busca o resto em segundo plano ---------- */
const buscando = new Set();
let tRen = null;
const renderLogo = () => { clearTimeout(tRen); tRen = setTimeout(render, 1200); };
function resJa(ano, cd, abr, mu = "") {
  if (!cd) return null;
  const k = [ano, cd, abr, mu].join("|"), c = cacheRes[k];
  const vivo = ano == ATUAL.ano && cd == ATUAL.t2;
  if (!c || (vivo && Date.now() - c.t > 30000)) {
    if (!buscando.has(k)) { buscando.add(k); res(ano, cd, abr, mu).finally(() => { buscando.delete(k); renderLogo(); }); }
  }
  return c ? c.v : null;
}

/* ---------- mapas (mundo e Brasil) ---------- */
const MAPAS = {}, mapaCarregando = {};
function mapa(nome) {
  if (MAPAS[nome]) return MAPAS[nome];
  if (!mapaCarregando[nome]) {
    mapaCarregando[nome] = true;
    fetch(`mapa-${nome}.json`).then(r => r.json()).then(j => { MAPAS[nome] = j; renderLogo(); }).catch(() => { mapaCarregando[nome] = false; });
  }
  return null;
}
// itens: { id (minúsculo), chave, nome, pA (fatia do candidato A), st }
function blocoMapa(nome, titulo, itens, attr, A, B, selecionado) {
  const M = mapa(nome);
  const porId = Object.fromEntries(itens.map(x => [x.id, x]));
  let corpo;
  if (!M) corpo = `<p class="exp">Carregando o mapa…</p>`;
  else {
    const paths = M.locations.map(l => {
      const x = porId[l.id];
      if (!x || x.pA == null) return `<path d="${l.path}" class="m-vazio"><title>${esc(l.name)}</title></path>`;
      const lado = x.pA >= 50 ? A : B, forca = Math.min(100, Math.round(Math.abs(x.pA - 50) / 25 * 100));
      const cor = `color-mix(in srgb, ${corDe(lado)} ${20 + forca * 0.8}%, var(--soft))`;
      const dica = `${x.nome}: ${curto(nomeDe(ATUAL.ano, A))} ${f1(x.pA)}% × ${curto(nomeDe(ATUAL.ano, B))} ${f1(100 - x.pA)}%${x.st ? ` · ${x.st}` : ""}`;
      return `<path d="${l.path}" style="fill:${cor}" class="m-sim${x.chave === selecionado ? " m-sel" : ""}" data-mapa="${attr}" data-chave="${esc(x.chave)}" data-dica="${esc(dica)}"/>`;
    }).join("");
    corpo = `<svg viewBox="${M.viewBox}" class="mapa" role="img" aria-label="${esc(titulo)}">${paths}</svg>
      <div class="leg-mapa"><span>${esc(curto(nomeDe(ATUAL.ano, B)))} à frente</span><i style="background:linear-gradient(90deg, ${corDe(B)}, var(--soft), ${corDe(A)})"></i><span>${esc(curto(nomeDe(ATUAL.ano, A)))} à frente</span></div>
      <p class="nota">Cor mais forte = vantagem maior. Cinza = ainda sem votos. Toque num lugar para abrir.</p>`;
  }
  return `<details class="bloco dobra" data-dobra="mapa" ${dobras.mapa ? "open" : ""}><summary><h3>${titulo}</h3><span class="abre">toque para ${dobras.mapa ? "fechar" : "abrir"}</span></summary>${corpo}</details>`;
}

/* ---------- botões de grupo (região / continente) ---------- */
function chips(attr, atual, opcoes, rotTodos) {
  return `<div class="filtros" style="margin:0 0 14px">` +
    [["", rotTodos], ...opcoes.map(o => [o, o])].map(([k, t]) => `<button ${attr}="${esc(k)}" aria-pressed="${atual === k}">${esc(t)}</button>`).join("") + `</div>`;
}
// quadro de números da apuração
function quadro(itens) {
  return `<div class="bloco"><h3>Resumo da apuração</h3><div class="quadro">` +
    itens.filter(Boolean).map(([rot, val, sub]) => `<div><span>${rot}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ""}</div>`).join("") + `</div></div>`;
}

/* ---------- municípios: carregados aos poucos, guardados por 3 minutos ---------- */
const munCache = {}, munListas = {};
let munCarregando = false;
async function carregarMunicipios(uf) {
  if (munCarregando) return;
  if (!munListas[uf]) munListas[uf] = await municipios(uf);
  const velhos = munListas[uf].filter(m => { const c = munCache[uf + m.cd]; return !c || Date.now() - c.t > 180000; });
  if (!velhos.length) return;
  munCarregando = true;
  let n = 0;
  try {
    await pool(velhos, async m => {
      const k = uf.toLowerCase();
      const [t1, t2] = await Promise.all([res(ATUAL.ano, ATUAL.t1, k, m.cd), res(ATUAL.ano, ATUAL.t2, k, m.cd)]);
      munCache[uf + m.cd] = { t: Date.now(), t1, t2 };
      if (++n % 25 === 0 && estado.tela === "nacional" && estado.uf === uf) render();
    }, 4);
  } finally { munCarregando = false; if (estado.tela === "nacional" && estado.uf === uf) render(); }
}

async function telaEstados() {
  const ufs = ufsJa();
  const daReg = ufs.filter(x => !estado.reg || x.reg === estado.reg);
  const comVotos = daReg.filter(x => x.t2);
  const sel = ufs.find(x => x.u === estado.uf);
  const soma = somaUfs;
  let h = chips("data-reg", estado.reg, Object.keys(REGIOES), "Todas as regiões"), fimH = "";

  // município escolhido dentro do estado
  if (sel && estado.mun) {
    const lista = munListas[sel.u] || await municipios(sel.u);
    const m = lista.find(x => x.cd === estado.mun);
    const c = munCache[sel.u + estado.mun] || {};
    const [t1, t2, r2] = await Promise.all([c.t1 || res(ATUAL.ano, ATUAL.t1, sel.u.toLowerCase(), estado.mun), res(ATUAL.ano, ATUAL.t2, sel.u.toLowerCase(), estado.mun), res(REF.ano, REF.t2, sel.u.toLowerCase(), estado.mun)]);
    const v1 = votosDeRes(t1), v2 = votosDeRes(t2), w2 = votosDeRes(r2);
    h += placar({ titulo: `${esc(m ? m.nm : estado.mun)} <span style="font-size:.6em;color:var(--mut)">${sel.u}</span>`, voltar: `Ver todo o estado (${NOME_UF[sel.u]})`,
      atualizar: [`mun:${sel.u}:${estado.mun}`, `Atualizar ${m ? m.nm : "município"}`],
      contagem: t2 ? `<b>${f1(t2.pst)}%</b> das seções apuradas` : "aguardando o TSE", prog: t2 ? t2.pst : 0, v: v2,
      vazio: v1 ? `Ainda sem votos do 2º turno. No 1º turno: ${doisMais(v1).map(n => `${curto(nomeDe(ATUAL.ano, n))} ${pct1(entreDois(v1, doisMais(v1))[n])}%`).join(" × ")} (só entre os dois).` : "Ainda sem votos." });
    if (v2) {
      h += `<div class="duas">` + desdeNoPlacar( "Comparado ao resultado final do 1º turno, só entre os dois.", movDe(v1, v2, "1º turno", "2º turno"), extrasOficiais(t1, t2)) +
        blocoMov(`Comparado com ${REF.ano}`, `Fatia de cada número no 2º turno de ${REF.ano}.`, movDe(w2, v2, String(REF.ano), String(ATUAL.ano), REF.ano)) + `</div>`;
      h += quadroOficial(t1, t2) + blocoAbstencao(t1, t2);
      h += blocoTabela(v1, v2, w2, t2.pst < 100);
      const anos = [infoAno(ATUAL.ano, t1, t2), infoAno(REF.ano, await res(REF.ano, REF.t1, sel.u.toLowerCase(), estado.mun), r2)];
      h += blocoPosts([{ id: "mr" + estado.mun, titulo: `${m ? m.nm : ""}: placar e 1º → 2º turno`, sub: `${f1(t2.pst)}% das seções`, texto: textoLugar(`${m ? m.nm : ""} (${sel.u})`, "📍", v1, v2, w2, t2.pst, t1 && t1.ex, t2.ex) },
        { id: "m" + estado.mun, titulo: `${m ? m.nm : ""}: 1º → 2º turno e 2022`, texto: textoDeAnos(anos, `${m ? m.nm : ""} (${sel.u})`, "📍", { parcial: t2.pst < 100 ? `parcial: ${f2(t2.pst)}% das seções` : "", fonte: "Fonte: TSE" }) }]);
    } else h += postsAguardando("deste município");
    return h;
  }

  let v1, v2, w2, titulo, contagem, prog;
  if (sel) {
    v1 = votosDeRes(sel.t1); v2 = votosDeRes(sel.t2); w2 = votosDeRes(sel.r2);
    titulo = esc(NOME_UF[sel.u]); prog = sel.t2 ? sel.t2.pst : 0;
    contagem = sel.t2 ? `<b>${f1(sel.t2.pst)}%</b> das seções apuradas` : "aguardando o TSE";
  } else {
    v1 = soma(comVotos, "t1"); v2 = comVotos.length ? soma(comVotos, "t2") : null; w2 = soma(comVotos, "r2");
    titulo = estado.reg ? esc(estado.reg) : "Todos os estados"; prog = comVotos.length ? comVotos.reduce((s, x) => s + x.t2.pst, 0) / comVotos.length : 0;
    contagem = comVotos.length ? `<b>${comVotos.length}</b> de ${daReg.length} estados com votos` : "aguardando o TSE";
  }
  h += placar({ titulo, voltar: sel ? "Ver todos os estados" : "", contagem, prog, v: v2,
    atualizar: sel ? [`uf:${sel.u}`, `Atualizar ${NOME_UF[sel.u]}`] : null,
    vazio: `O TSE começa a divulgar os estados às 17h (horário de Brasília).${(sel ? sel.t1 : true) && linha1T(sel ? votosDeRes(sel.t1) : soma(daReg, "t1")) ? `<br>No 1º turno: ${linha1T(sel ? votosDeRes(sel.t1) : soma(daReg, "t1"))} (só entre os dois).` : ""}<br><button class="volta" data-tela-ir="exterior">Ver o Exterior agora</button>` });

  // resumo
  if (sel) {
    if (sel.t2 || munListas[sel.u]) {
      const ms = munListas[sel.u] || [], cm = ms.map(m => munCache[sel.u + m.cd]).filter(Boolean);
      const comV = cm.filter(c => c.t2 && c.t2.total).length, completos = cm.filter(c => c.t2 && c.t2.pst >= 100).length;
      const mq = [["Municípios", fInt(ms.length), `${fInt(comV)} com votos · ${fInt(completos)} com 100% apurado`], ["Municípios lidos aqui", `${fInt(cm.length)} de ${fInt(ms.length)}`]];
      h += sel.t2 && sel.t2.ex ? quadroOficial(sel.t1, sel.t2, mq) : quadro([["Seções apuradas", sel.t2 ? f1(sel.t2.pst) + "%" : "—"], ...mq]);
    }
  } else if (comVotos.length) {
    h += quadro([["Estados com votos", `${comVotos.length} de ${daReg.length}`], ["Estados com 100% apurado", fInt(comVotos.filter(x => x.t2.pst >= 100).length)],
      ["Média de seções apuradas", f1(prog) + "%"]]);
  }

  if (!v2) h += postsAguardando(sel ? "deste estado" : estado.reg ? `do ${esc(estado.reg)}` : "dos estados");
  if (v2) {
    const nums = doisMais(v2), sh = entreDois(v2, nums);
    registrar(sel ? sel.u : "ufs" + estado.reg, prog, sh[nums[0]], sel ? `${f1(prog)}% das seções` : `${comVotos.length} estados`);
    h += `<div class="duas">` +
      desdeNoPlacar( "Comparado ao resultado final do 1º turno, só entre os dois. Com a apuração parcial, ainda pode mudar.", movDe(v1, v2, "1º turno", "2º turno"), sel ? extrasOficiais(sel.t1, sel.t2) : null) +
      blocoMov(`Comparado com ${REF.ano}`, `Fatia de cada número no 2º turno de ${REF.ano}.`, movDe(w2, v2, String(REF.ano), String(ATUAL.ano), REF.ano)) + `</div>`;
    if (sel) h += blocoAbstencao(sel.t1, sel.t2);
    h += graficoCurva(historico(sel ? sel.u : "ufs" + estado.reg), nums, "Como a apuração evoluiu", "Fatia de cada um a cada atualização, desde que esta página foi aberta.");
    if (sel) {
      h += blocoTabela(v1, v2, w2, sel.t2.pst < 100);
      const anos = [infoAno(ATUAL.ano, sel.t1, sel.t2), infoAno(REF.ano, resJa(REF.ano, REF.t1, sel.u.toLowerCase()), sel.r2)];
      h += blocoPosts([{ id: "ufr" + sel.u, titulo: `${NOME_UF[sel.u]}: placar e 1º → 2º turno`, sub: `${f1(sel.t2.pst)}% das seções`, texto: textoLugar(NOME_UF[sel.u], "📍", v1, v2, w2, sel.t2.pst, sel.t1 && sel.t1.ex, sel.t2.ex) },
        { id: "uf" + sel.u, titulo: `${NOME_UF[sel.u]}: 1º → 2º turno e 2022`, texto: textoDeAnos(anos, NOME_UF[sel.u], "📍", { parcial: sel.t2.pst < 100 ? `parcial: ${f2(sel.t2.pst)}% das seções` : "", fonte: "Fonte: TSE" }) }]);
    } else {
      fimH += graficoHalteres(comVotos.map(x => { const n = doisMais(votosDeRes(x.t2)); const a = entreDois(votosDeRes(x.t1) || {}, n), b = entreDois(votosDeRes(x.t2), n);
        return { nome: NOME_UF[x.u], rot: x.u, p1: a && a[n[0]], p2: b && b[n[0]] }; }), nums[0],
        `${curto(nomeDe(ATUAL.ano, nums[0]))} em cada estado: 1º → 2º turno`, "Fatia entre os dois. O 1º turno é o resultado final; o 2º, a apuração até agora.");
      const local = estado.reg || "Todos os estados";
      h += blocoPosts([{ id: "rg" + (estado.reg || "todos"), titulo: `${local}: placar e 1º → 2º turno`, sub: `${comVotos.length} estados com votos`,
        texto: textoLugar(estado.reg ? `Região ${estado.reg}` : "Estados somados", "🗺️", v1, v2, w2, null).replace(" | 2º turno", ` | 2º turno (${comVotos.length} de ${daReg.length} estados com votos)`) }]);
      if (!estado.reg) h += listaRegioes(ufs);
    }
  }

  // municípios do estado
  if (sel) {
    carregarMunicipios(sel.u);
    const ms = munListas[sel.u] || [];
    if (ms.length) {
      const itens = ms.map(m => {
        const c = munCache[sel.u + m.cd] || {}, v = votosDeRes(c.t2), n = doisMais(v || votosDeRes(c.t1) || {});
        const a = c.t1 && v && entreDois(votosDeRes(c.t1), n), b = v && entreDois(v, n);
        const a1 = !v && c.t1 && entreDois(votosDeRes(c.t1), n);
        return { chave: m.cd, rot: esc(m.nm), v, nome: m.nm,
          st: c.t2 ? `${f1(c.t2.pst)}% apurado` : c.t1 ? `aguardando · 1º turno ${curto(nomeDe(ATUAL.ano, n[0] || "13"))} ${a1 ? pct1(a1[n[0]]) + "%" : "—"}` : "carregando…",
          stClasse: c.t2 ? (c.t2.pst >= 100 ? "st-ok" : "st-part") : "", d: a && b ? b[n[0]] - a[n[0]] : null, pst: c.t2 ? c.t2.pst : -1 };
      }).sort((x, y) => y.pst - x.pst || x.nome.localeCompare(y.nome, "pt-BR"));
      h += `<div class="bloco"><h3>Municípios de ${esc(NOME_UF[sel.u])}</h3>
        <input id="busca" class="busca" placeholder="Buscar município…" value="${esc(estado.busca)}" autocomplete="off">` +
        blocoLista("", itens, "data-mun", estado.mun).replace(/^<div class="bloco"><h3><\/h3>/, "").replace(/<\/div><\/div>$/, "</div>") + `</div>`;
    } else h += `<div class="bloco"><h3>Municípios</h3><p class="exp">Carregando a lista de municípios…</p></div>`;
  } else {
    if (!v2 && !estado.reg) h += listaRegioes(ufs);
    h += mapaEstados(ufs, estado.reg, estado.uf);
    h += blocoLista(estado.reg ? `Estados do ${estado.reg}` : "Estados", daReg.map(x => {
      const v = votosDeRes(x.t2), n = doisMais(v || {});
      const a = x.t1 && v && entreDois(votosDeRes(x.t1), n), b = v && entreDois(v, n);
      return { chave: x.u, rot: `${x.u} <span style="font-weight:400;color:var(--mut)">${esc(NOME_UF[x.u])}</span>`, v,
        st: x.t2 ? `${f1(x.t2.pst)}% apurado` : "aguardando", stClasse: x.t2 ? (x.t2.pst >= 100 ? "st-ok" : "st-part") : "",
        d: a && b ? b[n[0]] - a[n[0]] : null };
    }), "data-uf", estado.uf);
  }
  return h + fimH;
}

async function telaExterior() {
  let h = "";
  if (TESTE) h += `<div class="aviso"><b>Modo teste:</b> lendo os boletins do 1º turno de 2026 e conferindo com o resultado oficial do 1º turno.</div>`;
  if (BU.erro) h += `<div class="aviso">${esc(BU.erro)}</div>`;
  if (!BU.secoes) return h + placar({ titulo: "🌍 Exterior", vazio: esc(BU.status || "Carregando os boletins de urna do exterior…") +
    (BU.modoMonitor ? "<br><small>Os boletins já lidos estão guardados; aparecem assim que o TSE liberar a lista de urnas.</small>" : "") });
  const { lista: todosPaises, todos: todoExterior } = exteriorAgregado();
  const conts = Object.keys(CONTINENTES).filter(c => todosPaises.some(p => p.cont === c));
  if (todosPaises.some(p => p.cont === "Outros")) conts.push("Outros");
  const lista = estado.cont ? todosPaises.filter(p => p.cont === estado.cont) : todosPaises;
  const todos = estado.cont ? somarAgs(lista, { nome: estado.cont }) : todoExterior;
  const P = todosPaises.find(p => p.cd === estado.pais);
  const fech = lista.filter(p => p.situacao === "ok"), part = lista.filter(p => p.situacao === "part");
  const S = P || todos;
  if (!P) h += chips("data-cont", estado.cont, conts, "Todos os continentes");
  let fimH = "";
  const nums = doisMais(S.votos);
  const extra = [S.comp ? `Comparecimento ${fInt(S.comp)}${S.aptos ? ` de ${fInt(S.aptos)} eleitores` : ""}` : "", S.brancos || S.nulos ? `brancos ${fInt(S.brancos)}, nulos ${fInt(S.nulos)}` : ""].filter(Boolean).join("; ");

  h += placar({ titulo: P ? `${P.flag} ${esc(P.nome)}` : estado.cont ? `🌍 ${esc(estado.cont)}` : "🌍 Exterior", voltar: P ? (estado.cont ? `Ver ${estado.cont}` : "Ver todos os países") : "",
    atualizar: P ? [`pais:${P.cd}`, `Atualizar ${P.nome}`] : null,
    contagem: `<b>${fInt(S.com)}</b> de ${fInt(S.total)} urnas${S.ultimo ? `<br><span style="font-size:14px;color:var(--mut)">último boletim às ${horaDe(S.ultimo)}</span>` : ""}`, prog: S.total ? 100 * S.com / S.total : 0, v: S.com ? S.votos : null,
    extra: extra ? extra + "." : "", vazio: P ? "Nenhum boletim desta localidade ainda." : "Nenhum boletim do 2º turno publicado ainda." });

  if (TESTE && fech.length) {
    const ofic = {}; fech.forEach(p => ofic[p.cd] = oficial(p));
    const bate = fech.filter(p => { const r = ofic[p.cd].a2; return r && r.cands.every(c => (p.votos[c.n] || 0) === c.votos); }).length;
    h += `<div class="aviso">Conferência: a soma dos boletins bate com o resultado oficial em <b>${bate} de ${fech.length}</b> países fechados. ${bate === fech.length ? "A leitura dos boletins está funcionando." : "Se não bater, mande um print desta tela."}</div>`;
  }
  if (BU.exemploFalha) h += `<details class="bloco"><summary>Ver um boletim que não consegui ler</summary><pre style="white-space:pre-wrap;font-size:12px">${esc(BU.exemploFalha)}</pre></details>`;

  if (S.com && nums.length === 2) {
    const sh = entreDois(S.votos, nums);
    registrar(P ? "p:" + P.cd : "zz", S.com, sh[nums[0]], `${S.com} urnas`);
    // 2022: só lugares com todas as urnas (comparar total com total)
    const alvo22 = P ? (P.situacao === "ok" ? [P] : []) : fech;
    const ofic = {}; alvo22.forEach(p => ofic[p.cd] = oficial(p));
    const v22 = {}, v26 = {};
    alvo22.forEach(p => { const r = ofic[p.cd] && ofic[p.cd].r2; if (!r) return; r.cands.forEach(c => v22[c.n] = (v22[c.n] || 0) + c.votos); nums.forEach(n => v26[n] = (v26[n] || 0) + (p.votos[n] || 0)); });
    const tem22 = Object.keys(v22).length > 0;

    // resumo da apuração
    const ps = P ? [P] : lista;
    h += quadro([
      ["Urnas apuradas", `${fInt(S.com)} de ${fInt(S.total)}`, `${f1(S.total ? 100 * S.com / S.total : 0)}% · faltam ${fInt(S.total - S.com)}`],
      P ? ["Cidades", fInt(P.cidades.length), `${P.cidades.filter(c => c.com === c.total).length} com todas as urnas`]
        : ["Países", fInt(ps.length), `${fech.length} com todas as urnas · ${part.length} apurando · ${ps.length - fech.length - part.length} sem boletim`],
      !P && ps.some(p => p.votando) ? ["Ainda votando", `${ps.filter(p => p.votando).length} países`, `o último fecha às ${horaDe(Math.max(...ps.filter(p => p.votando).map(p => p.fecha)))} (Brasília)`] : null,
      P && P.votando ? ["Votação", "ainda aberta", `fecha às ${horaDe(P.fecha)} (Brasília)`] : null,
      ["Eleitores nas urnas apuradas", fInt(S.aptos), S.com ? `média de ${fInt(Math.round(S.aptos / S.com))} por urna` : ""],
      ["Votaram", fInt(S.comp), S.aptos ? `abstenção de ${f1(100 * (1 - S.comp / S.aptos))}%` : ""],
      ["Votos nos dois", fInt(nums.reduce((t, n) => t + (S.votos[n] || 0), 0)), `brancos ${fInt(S.brancos)} · nulos ${fInt(S.nulos)}`],
      S.nE && S.ap1 ? ["Comparecimento nas mesmas urnas", `${f1(100 * S.c1 / S.ap1)}% → ${f1(100 * S.c2 / S.ap2)}%`, `${fInt(S.c1)} no 1º turno → ${fInt(S.c2)} no 2º`] : null,
    ]);
    h += blocoFluxo(S, nums);
    if (S.nE && S.ap1 && S.ap2) {
      const a1 = 100 * (1 - S.c1 / S.ap1), a2 = 100 * (1 - S.c2 / S.ap2), dd = a2 - a1;
      h += `<div class="bloco"><h3>Abstenção</h3><p class="exp">Nas mesmas ${fInt(S.nE)} urnas já apuradas.</p>
        <div class="mov"><div class="nm">Não votaram</div><div class="de">1º turno <b>${f1(a1)}%</b> → 2º turno <b>${f1(a2)}%</b></div>
        <span class="delta ${dd <= 0 ? "up" : "down"}">${dd <= 0 ? "▼" : "▲"} ${f1(Math.abs(dd))} pontos</span></div>
        <p class="nota" style="font-size:16px"><b>${fInt(S.ap2 - S.c2)}</b> de ${fInt(S.ap2)} eleitores não votaram no 2º turno (no 1º, foram ${fInt(S.ap1 - S.c1)}).</p></div>`;
    } else if (S.aptos) {   // ainda sem o 1º turno dessas urnas: mostra só o 2º
      h += `<div class="bloco"><h3>Abstenção</h3><p class="exp">Nas ${fInt(S.com)} urnas já apuradas. A comparação com o 1º turno aparece assim que ele for lido.</p>
        <div class="mov"><div class="nm">Não votaram</div><div class="de">2º turno <b>${f1(100 * (1 - S.comp / S.aptos))}%</b></div><span></span></div>
        <p class="nota" style="font-size:16px"><b>${fInt(S.aptos - S.comp)}</b> de ${fInt(S.aptos)} eleitores não votaram.</p></div>`;
    }
    h += `<div class="duas">` +
      desdeNoPlacar( `Nas mesmas ${fInt(S.nM)} urnas, só entre os dois. As seções do exterior são as mesmas nos dois turnos.`, S.nM ? movDe(S.m1, S.m2, "1º turno", "2º turno") : null,
        S.nE && S.ap1 && S.ap2 && S.c1 && S.c2 ? [
          { nome: "Abstenção", de: 100 * (1 - S.c1 / S.ap1), para: 100 * (1 - S.c2 / S.ap2), sub: `${fInt(S.ap2 - S.c2)} de ${fInt(S.ap2)} não votaram` },
          { nome: "Brancos e nulos", de: 100 * (S.br1 + S.nu1) / S.c1, para: 100 * (S.br2 + S.nu2) / S.c2, sub: `${fInt(S.br2)} brancos · ${fInt(S.nu2)} nulos (dos que votaram)` }] : null) +
      (tem22 ? blocoMov(`Comparado com ${REF.ano}`, P ? `${esc(P.nome)} com todas as urnas apuradas, comparado ao 2º turno de ${REF.ano}.` : `Nos ${alvo22.length} ${alvo22.length === 1 ? "país que já fechou" : "países que já fecharam"} todas as urnas, comparado ao 2º turno de ${REF.ano}.`, movDe(v22, v26, String(REF.ano), String(ATUAL.ano), REF.ano))
        : `<div class="bloco"><h3>Comparado com ${REF.ano}</h3><p class="exp">${P ? "Aparece quando todas as urnas daqui forem apuradas." : "Aparece quando algum país fechar todas as urnas."}</p></div>`) + `</div>`;

    const mus = P ? new Set(P.cidades.map(c => c.mu)) : null;
    const curva = curvaBoletins(mus, nums);
    h += graficoUrnas(curva, nums, "Como a apuração evoluiu", "Divisão dos votos só entre os dois, conforme as urnas foram somadas.");

    if (!P && !estado.cont && conts.length > 1) {
      const porCont = conts.map(c => ({ c, A: somarAgs(todosPaises.filter(p => p.cont === c), { nome: c }) })).filter(x => x.A.com);
      h += blocoLista("Continentes", porCont.map(({ c, A }) => {
        const n = doisMais(A.votos), a = A.nM && entreDois(A.m1, n), b = A.nM && entreDois(A.m2, n);
        return { chave: c, rot: esc(c), v: A.votos, st: `${A.com} de ${A.total} urnas`, stClasse: A.com === A.total ? "st-ok" : "st-part", d: a && b ? b[n[0]] - a[n[0]] : null };
      }), "data-cont", estado.cont);
    }
    if (!P) {
      fimH += graficoHalteres(lista.filter(p => p.nM).map(p => { const a = entreDois(p.m1, nums), b = entreDois(p.m2, nums);
        return { nome: p.nome, rot: `${p.flag} ${p.nome.length > 16 ? p.nome.slice(0, 15) + "…" : p.nome}`, p1: a && a[nums[0]], p2: b && b[nums[0]] }; }),
        nums[0], `${curto(nomeDe(ATUAL.ano, nums[0]))} em cada país: 1º → 2º turno`, "Fatia entre os dois, nas mesmas urnas. Ordenado de quem mais subiu para quem mais caiu.");
    }

    // posts
    const posts = [];
    const tf = textoFluxo(S, nums);
    if (tf) posts.push({ id: P ? "f" + P.cd : "fl", titulo: `${P ? P.nome : "Exterior"}: para onde foram os votos`, sub: `${S.nE} urnas comparadas`, texto: `${P ? P.flag : "🌍"} ${(P ? P.nome : "Exterior").toUpperCase()} | 1º → 2º turno${S.com < S.total ? " (parcial)" : ""}\n\n${tf}\n\nFonte: boletins de urna publicados pelo TSE` });
    posts.push({ id: P ? "r" + P.cd : "rzz", titulo: P ? `${P.nome}: placar e 1º → 2º turno` : "Exterior: todas as urnas somadas", sub: `${S.com} de ${S.total} urnas`, texto: textoResumo(S, P ? P.nome : "Exterior", P ? P.flag : "🌍") });
    if (P) {
      const o = oficial(P);
      const t2 = deVotos(P.votos, ATUAL.ano, P.total ? 100 * P.com / P.total : 0);
      const anos = TESTE ? [] : [infoAno(ATUAL.ano, o.a1, t2), infoAno(REF.ano, o.r1, o.r2)];
      if (!TESTE) posts.push({ id: "j" + P.cd, titulo: `${P.nome}: votos 1º → 2º turno e 2022`, sub: P.situacao === "ok" ? "todas as urnas apuradas" : "parcial", texto: textoDeAnos(anos, P.nome, P.flag, { parcial: P.situacao === "ok" ? "" : `parcial: ${P.com} de ${P.total} urnas`, fonte: "Fonte: boletins de urna publicados pelo TSE" }) });
      if (P.situacao === "ok" && o.a1) h += blocoTabela(votosDeRes(o.a1), P.votos, votosDeRes(o.r2), false);
    } else if (tem22 && !TESTE) {
      const vot = (t, n) => { const c = t && t.cands.find(c => c.n === n); return c ? c.votos : null; };
      const rows = fech.map(p => ({ l: p.nome, icone: p.flag, a26: p.votos[nums[0]] || 0, b26: p.votos[nums[1]] || 0, a22: vot(ofic[p.cd].r2, nums[0]), b22: vot(ofic[p.cd].r2, nums[1]) }))
        .filter(r => r.a22 != null && r.b22 != null && r.a22 + r.b22 > 0);
      if (rows.length) posts.push({ id: "fzz", titulo: `Países fechados × ${REF.ano}`, sub: `${rows.length} ${rows.length === 1 ? "país" : "países"} com todas as urnas`, texto: textoAgregado({
        tit: "Exterior", nA26: nomeDe(ATUAL.ano, nums[0]), nA22: nomeDe(REF.ano, nums[0]), nB26: nomeDe(ATUAL.ano, nums[1]), nB22: nomeDe(REF.ano, nums[1]),
        rows, unidade: ["país", "países"], fonte: "Fonte: boletins de urna publicados pelo TSE" }) });
    }
    if (!TESTE) h += blocoPosts(posts);
    if (P) h += blocoUrnas(P, nums);
  }

  // lista de países
  const ordem = { ok: 0, part: 1, esp: 2 };
  const filtros = [["todos", "Todos", lista.length], ["ok", "Todas as urnas", fech.length], ["part", "Apurando", part.length], ["esp", "Sem boletim", lista.length - fech.length - part.length]];
  const itens = lista.filter(p => estado.filtro === "todos" || p.situacao === estado.filtro)
    .sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || b.com - a.com || a.nome.localeCompare(b.nome, "pt-BR"))
    .map(p => {
      const n = doisMais(p.votos), a = p.nM && entreDois(p.m1, n), b = p.nM && entreDois(p.m2, n);
      return { chave: p.cd, rot: `${p.flag} ${esc(p.nome)}`, v: p.com ? p.votos : null,
        st: p.situacao === "ok" ? `todas as ${p.total} urnas` : p.situacao === "part" ? `${p.com} de ${p.total} urnas`
          : p.votando ? `votando até ${horaDe(p.fecha)} (Brasília)` : `${p.total} ${p.total === 1 ? "urna" : "urnas"}, sem boletim`,
        stClasse: p.situacao === "ok" ? "st-ok" : p.situacao === "part" ? "st-part" : "", d: a && b ? b[n[0]] - a[n[0]] : null };
    });
  if (!P && nums.length === 2) h += blocoMapa("mundo", estado.cont ? `Mapa: ${estado.cont}` : "Mapa do exterior", lista.filter(p => p.com && p.cd.length === 2).map(p => {
    const sh = entreDois(p.votos, nums);
    return { id: p.cd.toLowerCase(), chave: p.cd, nome: p.nome, pA: sh ? sh[nums[0]] : null, st: p.situacao === "ok" ? "todas as urnas" : `${p.com} de ${p.total} urnas` };
  }), "pais", nums[0], nums[1], estado.pais);
  h += blocoLista(estado.cont ? `Países: ${estado.cont}` : "Países", itens, "data-pais", estado.pais, filtros);
  return h + fimH;
}

// texto do placar (todas as urnas somadas, ou um país)
function textoResumo(A, local, icone) {
  const nums = doisMais(A.votos); if (nums.length < 2) return "";
  const sh = entreDois(A.votos, nums);
  const out = [`${icone} ${local.toUpperCase()} | 2º turno${A.com < A.total ? " (parcial)" : ""}`, "", `${fInt(A.com)} de ${fInt(A.total)} urnas somadas`, ""];
  nums.forEach(n => out.push(`${EMOJI[n] || "⚪"} ${curto(nomeDe(ATUAL.ano, n))}: ${f2(sh[n])}% (${fInt(A.votos[n] || 0)} votos)`));
  if (A.nM) {
    const a = entreDois(A.m1, nums), b = entreDois(A.m2, nums);
    out.push("", `Nas mesmas ${fInt(A.nM)} urnas, comparado ao 1º turno:`);
    nums.forEach(n => { const d = b[n] - a[n]; out.push(`${d >= 0 ? "📈" : "📉"} ${curto(nomeDe(ATUAL.ano, n))}: ${f2(a[n])}% → ${f2(b[n])}% (${d >= 0 ? "+" : "−"}${f2(Math.abs(d))} pontos)`); });
  }
  const fl = textoFluxo(A, nums);
  if (fl) out.push("", fl);
  out.push("", "Fonte: boletins de urna publicados pelo TSE");
  return out.join("\n");
}

/* ---------------- render ---------------- */
let rodando = false, deNovo = false, deNovoForcado = false;
async function render(forcar) {
  if (rodando) { deNovo = true; if (forcar) deNovoForcado = true; return; }
  rodando = true;
  try {
    if (!forcar) {   // atualização automática: não atrapalha quem está selecionando texto ou digitando
      const sel = window.getSelection && String(window.getSelection());
      if (sel && sel.length > 3) return;
      if (document.activeElement && document.activeElement.id === "busca") { setTimeout(render, 4000); return; }
    }
    desdeHTML = "";
    const html = estado.tela === "exterior" ? await telaExterior() : estado.tela === "nacional" ? await telaEstados() : await telaTotal();
    $tela.innerHTML = html.replace("<!--desde-->", desdeHTML);
    desdeHTML = "";
    aplicarBusca();
    ultima = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    setStatus();
  } catch (e) {
    document.getElementById("status").innerHTML = `<i></i>erro: ${esc(e.message)}`;
  } finally {
    rodando = false; document.body.classList.remove("trocando");
    if (deNovo) { const f = deNovoForcado; deNovo = false; deNovoForcado = false; render(f); }
  }
}

/* ---------------- eventos ---------------- */
document.getElementById("nav").addEventListener("click", e => { const t = e.target.closest("[data-tela]"); if (t) ir({ tela: t.dataset.tela, filtro: "todos" }); });
// botão "Atualizar [lugar]"
async function atualizarLugar(b) {
  const [tipo, a1, a2] = b.dataset.atualizar.split(":");
  const rot = b.textContent; b.disabled = true; b.textContent = "Atualizando…";
  try {
    if (tipo === "pais") {
      let r = null;
      try { const x = await fetch(`/api/agora?pais=${encodeURIComponent(a1)}`, { cache: "no-store" }); if (x.ok) r = await x.json(); } catch {}
      if (!r || r.r !== "lido") {     // sem monitor: lê daqui mesmo
        const secs = (BU.secoes || []).filter(s => paisDe(s.nm).cd === a1);
        await lerSecoesAgora(secs);
      } else await atualizarBU();
      b.textContent = r && r.r === "lido" ? `${r.lidas} de ${r.total} urnas` : "Atualizado";
    } else if (antesDaDivulgacao()) {
      b.textContent = "Oficial só às 17h";
    } else {
      // esquece o que estava guardado deste lugar e busca de novo no TSE
      const abr = a1.toLowerCase(), mu = tipo === "mun" ? a2 : "";
      Object.keys(cacheRes).forEach(k => { const [ano, cd, ab, m] = k.split("|"); if (ab === abr && (m || "") === mu && cd == ATUAL.t2) delete cacheRes[k]; });
      if (tipo === "uf") Object.keys(munCache).forEach(k => { if (k.startsWith(a1)) delete munCache[k]; });
      await res(ATUAL.ano, ATUAL.t2, abr, mu);
      b.textContent = "Atualizado";
    }
    render(true);
  } catch { b.textContent = "Não consegui"; }
  setTimeout(() => { b.disabled = false; b.textContent = rot; }, 4000);
}
$tela.addEventListener("click", e => {
  const at = e.target.closest("[data-atualizar]"); if (at) { atualizarLugar(at); return; }
  const mp = e.target.closest("[data-mapa]");
  if (mp) { const k = mp.dataset.chave; if (mp.dataset.mapa === "pais") ir({ pais: k }, true); else ir({ tela: "nacional", uf: k, mun: "", busca: "" }, true); return; }
  const ri = e.target.closest("[data-reg-ir]"); if (ri) { ir({ tela: "nacional", reg: ri.dataset.regIr, uf: "", mun: "" }, true); return; }
  const el = e.target.closest("button"); if (!el) return;
  if (el.dataset.copia) return;
  if (el.hasAttribute("data-volta")) {
    if (estado.mun) ir({ mun: "" }, true);
    else ir({ pais: "", uf: "" }, true);
  }
  else if (el.dataset.reg != null) ir({ reg: el.dataset.reg, uf: "", mun: "" });
  else if (el.dataset.cont != null) ir({ cont: el.dataset.cont, pais: "" });
  else if (el.dataset.mun) ir({ mun: el.dataset.mun }, true);
  else if (el.dataset.telaIr) ir({ tela: el.dataset.telaIr });
  else if (el.dataset.filtro) { estado.filtro = el.dataset.filtro; render(); }
  else if (el.dataset.pais != null) ir({ pais: estado.pais === el.dataset.pais ? "" : el.dataset.pais }, true);
  else if (el.dataset.uf) ir({ uf: estado.uf === el.dataset.uf ? "" : el.dataset.uf, mun: "", busca: "" }, true);
});
// busca de município: filtra a lista sem recarregar a tela
function aplicarBusca() {
  const q = norm(estado.busca || "");
  document.querySelectorAll("[data-mun]").forEach(b => { b.style.display = !q || norm(b.textContent).includes(q) ? "" : "none"; });
}
$tela.addEventListener("input", e => { if (e.target.id === "busca") { estado.busca = e.target.value; aplicarBusca(); } });
$tela.addEventListener("toggle", e => {
  const dd = e.target; if (dd.dataset && dd.dataset.dobra) { dobras[dd.dataset.dobra] = dd.open; const a = dd.querySelector(".abre"); if (a) a.textContent = `toque para ${dd.open ? "fechar" : "abrir"}`; }
}, true);
$tela.addEventListener("toggle", e => { const d = e.target; if (d.dataset && d.dataset.id) d.open ? abertos.add(d.dataset.id) : abertos.delete(d.dataset.id); }, true);
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-copia]"); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const el = document.getElementById(b.dataset.copia); const txt = el.value != null ? el.value : el.textContent;
  try { await navigator.clipboard.writeText(txt); } catch { const t = document.createElement("textarea"); t.value = txt; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
  const o = b.textContent; b.textContent = "Copiado"; setTimeout(() => b.textContent = o, 1400);
}, true);

// botão "Atualizar agora"
document.getElementById("agora").addEventListener("click", async e => {
  const b = e.currentTarget; b.disabled = true; b.textContent = "Pedindo…";
  try {
    let r = { r: "monitor desligado" };
    try { const x = await fetch("/api/agora", { cache: "no-store" }); if (x.ok) r = await x.json(); } catch {}
    if (r.r === "monitor desligado") { await atualizarBU(); render(true); b.textContent = "Atualizado"; }
    else {
      const espera = Math.ceil((r.pausaTSE || 0) / 1000);
      b.textContent = espera > 0 ? `TSE pediu ${espera} s` : "Lendo…";
      // acompanha por um tempo, atualizando a tela
      for (let i = 0; i < 6; i++) { await new Promise(z => setTimeout(z, 5000)); await atualizarBU(); render(true); }
      b.textContent = "Atualizado";
    }
  } catch { b.textContent = "Sem resposta"; }
  setTimeout(() => { b.disabled = false; b.textContent = "Atualizar agora"; }, 4000);
});

// dicas dos gráficos (mouse e toque)
const $dica = document.getElementById("dica");
function mostrarDica(x, y, html) { $dica.innerHTML = html; $dica.style.display = "block"; const w = $dica.offsetWidth; $dica.style.left = Math.min(innerWidth - w - 8, x + 12) + "px"; $dica.style.top = (y + 14) + "px"; }
function moverDica(e) {
  const g = e.target.closest && e.target.closest("[data-dica]");
  if (g) return mostrarDica(e.clientX, e.clientY, esc(g.dataset.dica));
  const r = e.target.closest && e.target.closest("rect.alvo");
  if (r) {
    const svg = r.ownerSVGElement, pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const pts = JSON.parse(r.dataset.pts); let best = pts[0];
    pts.forEach(p => { if (Math.abs(p[0] - loc.x) < Math.abs(best[0] - loc.x)) best = p; });
    const cruz = svg.querySelector(".cruz"); cruz.style.display = ""; cruz.setAttribute("x1", best[0]); cruz.setAttribute("x2", best[0]);
    return mostrarDica(e.clientX, e.clientY, `<b>${best[1]}</b>${best[2] ? ` (${esc(best[2])})` : ""}<br>2º turno: ${esc(r.dataset.a)} ${f1(best[3])}%, ${esc(r.dataset.b)} ${f1(100 - best[3])}%` +
      (best[4] != null ? `<br>1º turno: ${esc(r.dataset.a)} ${f1(best[4])}%, ${esc(r.dataset.b)} ${f1(100 - best[4])}%` : ""));
  }
  $dica.style.display = "none";
  document.querySelectorAll(".cruz").forEach(c => c.style.display = "none");
}
document.addEventListener("pointermove", moverDica);
document.addEventListener("pointerdown", moverDica);

/* ---------------- início ---------------- */
(async function () {
  document.querySelectorAll("#nav button").forEach(b => b.setAttribute("aria-pressed", b.dataset.tela === estado.tela));
  await descobrir();
  await atualizarBU();          // com o monitor rodando, isto já traz urnas, boletins e nomes de uma vez
  render();
  // nomes oficiais em segundo plano (não trava a tela se o TSE estiver lento)
  (async () => {
    try { ler(await resultadoBruto(REF.ano, REF.t2, "br"), REF.ano, true); } catch {}
    if (ATUAL.t1) try { ler(await resultadoBruto(ATUAL.ano, ATUAL.t1, "br"), ATUAL.ano, true); } catch {}
    render();
  })();
  setInterval(render, 60000);
  // com o monitor ligado, confere a cada 8 s (é só copiar do monitor, não pede nada ao TSE)
  (function laco() { setTimeout(async () => { try { await atualizarBU(); } catch {} laco(); }, BU.modoMonitor ? 8000 : 20000); })();
})();
