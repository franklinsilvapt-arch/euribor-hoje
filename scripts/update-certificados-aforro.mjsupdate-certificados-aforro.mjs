/*
 * Atualiza certificados-aforro/taxa-ca.json com a taxa base bruta dos
 * Certificados de Aforro (Série F) publicada pelo IGCP.
 *
 * - O IGCP fixa a taxa do mês seguinte no antepenúltimo dia útil de cada mês.
 * - Guarda "atual" (mês em curso) e "proxima" (mês seguinte, quando já publicada).
 * - No dia 1, "proxima" passa automaticamente a "atual".
 * - Falha (exit 1) se não conseguir ler a taxa, sem nunca escrever dados inválidos.
 *
 * Lido pelo simulador em literaciafinanceira.pt/simulador-certificados-aforro via jsDelivr.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DATA_PATH = new URL("../certificados-aforro/taxa-ca.json", import.meta.url);

const FONTES = [
  "https://www.igcp.pt/pt/aforristas/produtos-de-aforro/certificados-de-aforro",
  "https://www.igcp.pt/en/aforristas/produtos-de-aforro/certificados-de-aforro",
];

const MESES_PT = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const MESES_EN = ["january","february","march","april","may","june","july","august","september","october","november","december"];

function limpar(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|\u00a0/g, " ").replace(/\s+/g, " ");
}

/* Devolve { mesNum, ano, taxa } ou null. Aceita a página PT e a EN. */
export function extrair(texto) {
  const t = texto.toLowerCase();
  const padroes = [
    // PT: "... Série F, em setembro de 2026, foi fixada em 2,5%"
    new RegExp("s[ée]rie f.{0,120}?\\bem\\s+(" + MESES_PT.join("|") + ")\\s+de\\s+(\\d{4}).{0,80}?(\\d{1,2}[.,]\\d{1,3})\\s*%", "s"),
    // EN: "... Series F, in September 2026 was set at 2.5%"
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
    if (mesNum > 0 && Number.isFinite(taxa) && taxa >= 0 && taxa <= 2.5) return { mesNum, ano, taxa };
  }
  return null;
}

function registo({ mesNum, ano, taxa }) {
  return { taxa, mes: `${MESES_PT[mesNum - 1]} de ${ano}`, ano, mesNum };
}
const chave = (r) => (r ? r.ano * 100 + r.mesNum : null);
const igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function calcular(dados, publicado, hoje = new Date()) {
  const chaveHoje = hoje.getUTCFullYear() * 100 + (hoje.getUTCMonth() + 1);
  const novo = registo(publicado);
  const porChave = new Map();
  for (const c of [dados.atual, dados.proxima, novo]) if (c) porChave.set(chave(c), c);
  const passados = [...porChave.values()].filter((c) => chave(c) <= chaveHoje);
  const futuros = [...porChave.values()].filter((c) => chave(c) > chaveHoje);
  let atual = passados.length ? passados.reduce((a, b) => (chave(a) > chave(b) ? a : b)) : null;
  let proxima = futuros.length ? futuros.reduce((a, b) => (chave(a) < chave(b) ? a : b)) : null;
  if (!atual) { atual = novo; proxima = null; }
  return { atual, proxima };
}

async function obter(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (LiteraciaFinanceira taxa-ca bot)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function main() {
  const dados = existsSync(DATA_PATH) ? JSON.parse(readFileSync(DATA_PATH, "utf8")) : { atual: null, proxima: null };

  let publicado = null, fonte = null;
  const erros = [];
  for (const url of FONTES) {
    try {
      publicado = extrair(limpar(await obter(url)));
      if (publicado) { fonte = url; break; }
      erros.push(`${url}: padrão não encontrado`);
    } catch (e) { erros.push(`${url}: ${e.message}`); }
  }
  if (!publicado) throw new Error("Não foi possível ler a taxa no IGCP.\n" + erros.join("\n"));

  console.log(`[ca] IGCP publica: ${MESES_PT[publicado.mesNum - 1]} de ${publicado.ano} -> ${publicado.taxa}% (${fonte})`);

  const { atual, proxima } = calcular(dados, publicado);
  if (igual(dados.atual, atual) && igual(dados.proxima, proxima)) { console.log("[ca] Sem alterações."); return; }

  const resultado = { atual, proxima, atualizadoEm: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), fonte };
  writeFileSync(DATA_PATH, JSON.stringify(resultado, null, 2) + "\n");
  console.log("[ca] taxa-ca.json atualizado:", JSON.stringify(resultado));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().catch((e) => { console.error("[ca] FALHOU:", e.message); process.exit(1); });
}
