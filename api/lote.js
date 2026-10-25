// Lê vários boletins de urna do exterior de uma vez e devolve só os votos (JSON pequeno).
// Uso: /api/lote?ano=2026&pl=3221&id=6258&s=29882-0001-0001,29882-0001-0002
const { lote, validar } = require("./_bu.js");

module.exports = async (req, res) => {
  const p = validar(req.query || {});
  if (!p) { res.status(400).json({ erro: "parâmetros inválidos" }); return; }
  try {
    const r = await lote(p.ano, p.pl, p.id, p.lista);
    res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=40");
    res.status(200).json({ r });
  } catch (e) {
    res.status(502).json({ erro: String(e) });
  }
};
