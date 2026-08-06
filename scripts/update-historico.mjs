/*
 * Atualiza o array "historico" (medias mensais) do euribor-data.json de forma
 * totalmente automatica. Corre no GitHub Actions depois do update-euribor.mjs.
 *
 * Estrategia em duas camadas:
 *  1. OFICIAL: vai buscar as medias mensais ao BPstat (Banco de Portugal) via
 *     API CSV publica. Valores oficiais substituem sempre provisorios.
 *  2. PROVISORIO (fallback): se o BPstat falhar ou ainda nao tiver publicado o
 *     mes anterior, calcula a media aritmetica a partir da serie diaria local,
 *     para a tabela nunca ficar desatualizada. E substituido pelo oficial
 *     assim que este existir.
 *
 * Nunca escreve valores invalidos; se nada mudar, nao toca no ficheiro.
 */

import { readFileSync, writeFileSync } from "node:fs";

const DATA_PATH = new URL("../euribor-data.json", import.meta.url);

// Series BPstat: medias mensais da Euribor
const SERIES = { "13168436": "m3", "13168438": "m6", "13168437": "m12" };
const BPSTAT_URL =
  "https://bpstat.bportugal.pt/api/observations/csv/?series_ids=13168436,13168438,13168437&language=EN";

const MAX_MESES = 24; // meses guardados no historico

function valido(v) {
  return Number.isFinite(v) && v > -1 && v < 8;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

/* 1. Medias oficiais do BPstat -> { "2026-06": { m3, m6, m12 }, ... } */
async function fetchOficiais() {
  const r = await fetch(BPSTAT_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (LiteraciaFinanceira Euribor bot; +https://www.literaciafinanceira.pt)" },
  });
  if (!r.ok) throw new Error(`BPstat HTTP ${r.status}`);
  const csv = await r.text();

  const meses = {};
  for (const linha of csv.split(/\r?\n/)) {
    if (!linha || linha.startsWith("#")) continue;
    const c = linha.split(";");
    if (c.length < 6) continue;
    const chave = SERIES[c[0].trim()];
    if (!chave) continue;
    const data = c[4].trim(); // YYYY-MM-DD (fim do mes)
    const valor = parseFloat(c[5]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !valido(valor)) continue;
    const ym = data.slice(0, 7);
    (meses[ym] ||= {})[chave] = round3(valor);
  }

  // So meses completos (com as 3 taxas)
  const completos = {};
  for (const [ym, v] of Object.entries(meses)) {
    if (valido(v.m3) && valido(v.m6) && valido(v.m12)) completos[ym] = v;
  }
  if (Object.keys(completos).length === 0) throw new Error("BPstat sem meses completos");
  return completos;
}

/* 2. Medias provisorias a partir da serie diaria local */
function provisoriasDaSerie(serie) {
  const hoje = new Date();
  const mesAtual = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}`;

  const porMes = {};
  for (const r of serie) {
    const [dd, mm, yyyy] = r.d.split("/");
    const ym = `${yyyy}-${mm}`;
    if (ym >= mesAtual) continue; // so meses ja fechados
    if (!valido(r.m3) || !valido(r.m6) || !valido(r.m12)) continue;
    (porMes[ym] ||= []).push(r);
  }

  const out = {};
  for (const [ym, rows] of Object.entries(porMes)) {
    if (rows.length < 15) continue; // exige cobertura quase completa do mes
    const media = (k) => round3(rows.reduce((s, r) => s + r[k], 0) / rows.length);
    out[ym] = { m3: media("m3"), m6: media("m6"), m12: media("m12") };
  }
  return out;
}

async function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));
  if (!Array.isArray(data.historico)) throw new Error("historico em falta no JSON");

  const existentes = new Map(data.historico.map((h) => [h.d, h]));

  // Camada provisoria primeiro (so preenche buracos)...
  let provisorias = {};
  try {
    provisorias = provisoriasDaSerie(data.serie || []);
  } catch (e) {
    console.warn("[historico] provisorias indisponiveis:", e.message);
  }
  for (const [ym, v] of Object.entries(provisorias)) {
    if (!existentes.has(ym)) {
      existentes.set(ym, { d: ym, ...v, provisorio: true });
      console.log(`[historico] provisorio ${ym}: 3m ${v.m3} 6m ${v.m6} 12m ${v.m12}`);
    }
  }

  // ...camada oficial por cima (substitui provisorios e corrige desvios)
  try {
    const oficiais = await fetchOficiais();
    for (const [ym, v] of Object.entries(oficiais)) {
      const atual = existentes.get(ym);
      const mudou = !atual || atual.provisorio || atual.m3 !== v.m3 || atual.m6 !== v.m6 || atual.m12 !== v.m12;
      if (mudou) {
        existentes.set(ym, { d: ym, ...v });
        console.log(`[historico] oficial BPstat ${ym}: 3m ${v.m3} 6m ${v.m6} 12m ${v.m12}`);
      }
    }
  } catch (e) {
    console.warn("[historico] BPstat falhou (fica o provisorio):", e.message);
  }

  const novo = [...existentes.values()]
    .filter((h) => /^\d{4}-\d{2}$/.test(h.d) && valido(h.m3) && valido(h.m6) && valido(h.m12))
    .sort((a, b) => a.d.localeCompare(b.d))
    .slice(-MAX_MESES);

  if (novo.length === 0) throw new Error("historico ficaria vazio - abortado");

  const antes = JSON.stringify(data.historico);
  const depois = JSON.stringify(novo);
  if (antes === depois) {
    console.log("[historico] sem alteracoes.");
    return;
  }

  data.historico = novo;
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`[historico] OK -> ${novo.length} meses (ultimo: ${novo[novo.length - 1].d})`);
}

main().catch((e) => { console.error("[historico] FALHOU:", e.message); process.exit(1); });
