# Apuração 2º turno (Presidente)

Arquivos: `public/index.html` (página), `public/dados.js` (busca e leitura dos dados do TSE),
`public/app.js` (tela), `api/tse.js` (função da Vercel que repassa os arquivos públicos do TSE, com cache).

## Subir
    vercel --prod
ou importe a pasta em vercel.com/new (framework "Other", sem build).

## Testar no computador
    vercel dev      # http://localhost:3000

## Links
- `/?tela=exterior` · `/?tela=nacional` · `/?tela=total`
- `/?tela=exterior&pais=KW` abre direto um país
- `/?tela=exterior&bu=1t` modo teste: lê os boletins do 1º turno de 2026 e confere com o resultado oficial
- Se os códigos de 2026 não forem achados sozinhos: `?e2026=COD1,COD2&pl2026=PLEITO2&pl1=PLEITO1`

## Receber as novidades no Telegram (rodada a cada 8 minutos)
1. No Telegram, abra o @BotFather, mande /newbot e siga os passos. Ele te dá um token (algo como 123456:ABC-xyz).
2. Abra o bot que você criou e mande "oi" para ele.
3. Na pasta do projeto: `node monitor-telegram.js SEU_TOKEN`
   (das próximas vezes basta `node monitor-telegram.js`; o token fica em telegram.json)

O monitor já liga o painel junto (não precisa rodar o servidor-local ao mesmo tempo).
Cada rodada manda: exterior (urnas, % de cada um, mudança desde a última rodada, mesmas urnas vs 1º turno,
países que fecharam nesta rodada, os que estão apurando e quantos ainda não abriram) e, a partir das 17h,
o oficial do Brasil, do exterior e de cada estado.
O que já foi visto fica gravado em monitor-estado.json; os boletins lidos, em boletins-lidos.json.
Link do painel: por padrão é o endereço do seu computador na rede (funciona no mesmo Wi-Fi).
Para um link que funcione de qualquer lugar, suba na Vercel e coloque o endereço em telegram.json:
  { "token": "...", "chat": 123, "painel": "https://seu-site.vercel.app/?tela=exterior" }
Para mudar o intervalo: CICLO_S=300 node monitor-telegram.js (em segundos).
