/*
 * Atualiza certificados-aforro/taxa-ca.json com a taxa base bruta dos
 * Certificados de Aforro (Série F).
 *
 * Regra oficial (Portaria n.º 149-A/2023): a taxa base de cada mês é a média
 * da Euribor a 3 meses dos 10 dias úteis anteriores ao antepenúltimo dia útil
 * do mês anterior, arredondada a 3 casas decimais, com máximo de 2,5% e
 * mínimo de 0%.
 *
 * Duas fontes, por esta ordem de prioridade:
 *   1. O valor publicado pelo IGCP (frase na página dos Certificados de Aforro).
 *   2. O valor calculado com a regra acima a partir do euribor-data.json deste
 *      repositório. Serve quando o IGCP ainda não atualizou a frase, o que
 *      acontece com frequência (em meados de outubro de 2026 a página ainda
 *      mostrava a taxa de setembro).
 * Um valor do IGCP substitui sempre um valor calculado para o mesmo mês.
 *
 * Saída (compatível com o simulador, que lê "atual" e "proxima"):
 *   atual, proxima: { taxa, mes, ano, mesNum, origem }
 *   historico: [{ ym: "2026-10", taxa, origem }]  (até 24 meses, do mais antigo ao mais recente)
 *   origem: "igcp" | "calculada" | "noticias" (valores iniciais retirados de notícias que citam o IGCP)
 *
 * Nunca escreve dados inválidos. Só falha (exit 1) se não houver nenhuma fonte.
 *
 * Lido via jsDelivr pelo simulador (/simulador-certificados-aforro) e pelo
 * bloco dinâmico do artigo /artigos/certificados-de-aforro.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DATA_PATH = new URL("../certificados-aforro/taxa-ca.json", import.meta.url);
const EURIBOR_PATH = new URL("../euribor-data.json", import.meta.url);

const FONTES = [
  "https://www.igcp.pt/pt/aforristas/produtos-de-aforro/certificados-de-aforro",
  "https://www.igcp.pt/en/aforristas/produtos-de-aforro/certificados-de-aforro",
];
const FONTE_REGRA = "https://files.dre.pt/1s/2023/06/10702/0000200003.pdf";

const TAXA_MAX = 2.5;
const MAX_HIST = 24;

const MESES_PT = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const MESES_EN = ["january","february","march","april","may","june","july","august","september","october","november","december"];

const ym = (ano, mesNum) => `${ano}-${String(mesNum).padStart(2, "0")}`;
const r3 = (v) => Math.round(v * 1000) / 1000;

function limpar(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
}

/* Devolve { mesNum, ano, taxa } ou null. Aceita a página PT e a EN. */
export function extrair(texto) {
  const t = texto.toLowerCase();
  const padroes = [
    new RegExp("s[ée]rie f.{0,120}?\\bem\\s+(" + MESES_PT.join("|") + ")\\s+de\\s+(\\d{4}).{0,80}?(\\d{1,2}[.,]\\d{1,3})\\s*%", "s"),
    new RegExp("series f.{0,120}?\\bin\\s+(" + MESES_EN.join("|") + ")\\s+(\\d{4}).{0,80}?(\\d{1,2}[.,]\\d{1,3})\\s*%", "s"),
  ];
  for (const p of padroes) {
    const m = t.match(p);
    if (!m) continue;
    let mes = m[1];
    const idxEn = MESES_EN.indexOf(mes);
    if (idxEn >= 0) mes = MESES_PT[idxEn];
    const mesNum = MESES_PT.indexOf(mes) + 1;
    const ano = parseInt(m[2], 10);
    const taxa = parseFloat(m[3].replace(",", "."));
    if (mesNum > 0 && Number.isFinite(taxa) && taxa >= 0 && taxa <= TAXA_MAX) return { mesNum, ano, taxa };
  }
  return null;
}

/* ---------- Calendário TARGET (dias úteis da Euribor) ---------- */
function pascoa(ano) { // domingo de Páscoa (algoritmo de Meeus)
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(ano, mes - 1, dia);
}
function diaUtil(t) {
  const d = new Date(t), dow = d.getUTCDay(), ano = d.getUTCFullYear(), md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  if (dow === 0 || dow === 6) return false;
  if ([101, 501, 1225, 1226].includes(md)) return false;
  const p = pascoa(ano), dia = 86400000;
  if (t === p - 2 * dia || t === p + dia) return false; // Sexta-feira Santa e Segunda-feira de Páscoa
  return true;
}
/* Antepenúltimo dia útil do mês (timestamp UTC). */
export function antepenultimoDiaUtil(ano, mesNum) {
  let t = Date.UTC(ano, mesNum, 0); // último dia do mês
  let n = 0;
  while (true) { if (diaUtil(t)) { n++; if (n === 3) return t; } t -= 86400000; }
}

/* Calcula a taxa base do mês (ano, mesNum) a partir da série diária da Euribor 3M.
   Devolve a taxa ou null se a série não cobrir a janela de 10 dias úteis. */
export function calcularTaxa(serie, ano, mesNum) {
  const ant = mesNum === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mesNum - 1 };
  const fixacao = antepenultimoDiaUtil(ant.ano, ant.mes);
  // os 10 dias úteis anteriores à data de fixação
  const janela = [];
  for (let t = fixacao - 86400000; janela.length < 10; t -= 86400000) if (diaUtil(t)) janela.push(t);
  const porData = new Map();
  for (const r of serie) {
    const [dd, mm, aaaa] = r.d.split("/").map((n) => parseInt(n, 10));
    if (Number.isFinite(r.m3)) porData.set(Date.UTC(aaaa, mm - 1, dd), r.m3);
  }
  const valores = janela.map((t) => porData.get(t));
  const faltam = valores.filter((v) => v === undefined).length;
  // aceita no máximo 1 dia em falta na série (o bot falha raramente); a média usa os restantes
  if (faltam > 1) return null;
  const ok = valores.filter((v) => v !== undefined);
  const media = r3(ok.reduce((a, b) => a + b, 0) / ok.length);
  // se faltar um dia e a média estiver perto do teto, o resultado pode mudar: só aceita se for claro
  if (faltam === 1 && Math.abs(media - TAXA_MAX) < 0.02) return null;
  return Math.min(TAXA_MAX, Math.max(0, media));
}

async function obter(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (LiteraciaFinanceira taxa-ca bot)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

const PESO = { noticias: 1, calculada: 2, igcp: 3 };

/* Junta um valor novo ao histórico, respeitando a prioridade das fontes. */
export function juntar(historico, novo) {
  const i = historico.findIndex((h) => h.ym === novo.ym);
  if (i < 0) historico.push(novo);
  else if (PESO[novo.origem] >= PESO[historico[i].origem]) historico[i] = novo;
  historico.sort((a, b) => a.ym.localeCompare(b.ym));
  return historico.slice(-MAX_HIST);
}

function registo(h) {
  const [ano, mesNum] = h.ym.split("-").map((n) => parseInt(n, 10));
  return { taxa: h.taxa, mes: `${MESES_PT[mesNum - 1]} de ${ano}`, ano, mesNum, origem: h.origem };
}

export function montar(historico, hoje = new Date()) {
  const chaveHoje = ym(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1);
  const passados = historico.filter((h) => h.ym <= chaveHoje);
  const futuros = historico.filter((h) => h.ym > chaveHoje);
  return {
    atual: passados.length ? registo(passados[passados.length - 1]) : null,
    proxima: futuros.length ? registo(futuros[0]) : null,
  };
}

async function main() {
  const dados = existsSync(DATA_PATH) ? JSON.parse(readFileSync(DATA_PATH, "utf8")) : {};
  let historico = Array.isArray(dados.historico) ? dados.historico.slice() : [];
  // migra o formato antigo (só atual/proxima)
  for (const c of [dados.atual, dados.proxima]) {
    if (c && c.ano && c.mesNum) historico = juntar(historico, { ym: ym(c.ano, c.mesNum), taxa: c.taxa, origem: c.origem || "igcp" });
  }

  const hoje = new Date();
  let houveFonte = false;

  // 1. IGCP
  const erros = [];
  for (const url of FONTES) {
    try {
      const pub = extrair(limpar(await obter(url)));
      if (pub) {
        console.log(`[ca] IGCP publica: ${MESES_PT[pub.mesNum - 1]} de ${pub.ano} -> ${pub.taxa}%`);
        historico = juntar(historico, { ym: ym(pub.ano, pub.mesNum), taxa: pub.taxa, origem: "igcp" });
        houveFonte = true;
        break;
      }
      erros.push(`${url}: padrão não encontrado`);
    } catch (e) { erros.push(`${url}: ${e.message}`); }
  }
  if (erros.length) console.warn("[ca] IGCP:", erros.join(" | "));

  // 2. Cálculo pela regra, para o mês atual e o seguinte
  try {
    const eur = JSON.parse(readFileSync(EURIBOR_PATH, "utf8"));
    const alvo = [[hoje.getUTCFullYear(), hoje.getUTCMonth() + 1]];
    alvo.push(alvo[0][1] === 12 ? [alvo[0][0] + 1, 1] : [alvo[0][0], alvo[0][1] + 1]);
    for (const [ano, mesNum] of alvo) {
      const taxa = calcularTaxa(eur.serie || [], ano, mesNum);
      if (taxa === null) { console.log(`[ca] ${ym(ano, mesNum)}: série insuficiente ou mês ainda por fixar.`); continue; }
      console.log(`[ca] ${ym(ano, mesNum)} calculada: ${taxa}%`);
      historico = juntar(historico, { ym: ym(ano, mesNum), taxa, origem: "calculada" });
      houveFonte = true;
    }
  } catch (e) { console.warn("[ca] cálculo falhou:", e.message); }

  if (!houveFonte && !historico.length) throw new Error("Sem nenhuma fonte para a taxa.");

  const { atual, proxima } = montar(historico, hoje);
  const resultado = {
    atual,
    proxima,
    historico,
    atualizadoEm: dados.atualizadoEm || null,
    fonte: FONTES[0],
    regra: FONTE_REGRA,
  };
  const antes = JSON.stringify({ a: dados.atual, p: dados.proxima, h: dados.historico });
  const depois = JSON.stringify({ a: atual, p: proxima, h: historico });
  if (antes === depois) { console.log("[ca] Sem alterações."); return; }
  resultado.atualizadoEm = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  writeFileSync(DATA_PATH, JSON.stringify(resultado, null, 2) + "\n");
  console.log("[ca] taxa-ca.json atualizado:", JSON.stringify({ atual, proxima }));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().catch((e) => { console.error("[ca] FALHOU:", e.message); process.exit(1); });
}
