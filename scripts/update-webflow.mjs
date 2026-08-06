/*
 * Sincroniza o item "Euribor" no Webflow CMS (LiteraciaFinanceira.pt) com o
 * euribor-data.json, para que os valores fiquem no HTML estatico da pagina
 * /euribor-hoje (SEO). Corre no GitHub Actions depois do update-euribor.mjs.
 *
 * - Nao faz nada (exit 0) se WEBFLOW_API_TOKEN nao estiver definido.
 * - Falha (exit 1) se os dados forem invalidos ou a API devolver erro,
 *   sem nunca escrever dados vazios no item live.
 */

import { readFileSync } from "node:fs";

const DATA_PATH = new URL("../euribor-data.json", import.meta.url);

const COLLECTION_ID = "6a74a1f1668dc4d9cfcc02e4"; // Indicadores Euribor
const ITEM_ID = "6a74a21d3ab86f5d682f2e79";       // item "Euribor"
const CMS_LOCALE_ID = "67922c46c9da6bf5d9bfdf0c"; // locale PT

const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

function fmtPct(v) {
  return v.toFixed(3).replace(".", ",") + "%";
}

function mesAno(ym) { // "2026-06" -> "junho 2026"
  const [y, m] = ym.split("-").map((n) => parseInt(n, 10));
  return `${MESES[m - 1]} ${y}`;
}

function valido(v) {
  return Number.isFinite(v) && v > -1 && v < 8;
}

function buildTabela(historico) {
  const rows = historico
    .slice(-12)
    .reverse()
    .map((r) => `<tr><td>${mesAno(r.d)}</td><td>${fmtPct(r.m3)}</td><td>${fmtPct(r.m6)}</td><td>${fmtPct(r.m12)}</td></tr>`)
    .join("");
  return (
    "<div data-rt-embed-type='true'><div class=\"table-content\"><table>" +
    "<thead><tr><th>Mês</th><th>Euribor 3 meses</th><th>Euribor 6 meses</th><th>Euribor 12 meses</th></tr></thead>" +
    `<tbody>${rows}</tbody></table></div></div>`
  );
}

async function main() {
  const token = process.env.WEBFLOW_API_TOKEN;
  if (!token) {
    console.warn("[webflow] WEBFLOW_API_TOKEN nao definido - passo ignorado.");
    return;
  }

  const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));
  const ultimo = data.serie[data.serie.length - 1];

  if (!ultimo || !valido(ultimo.m3) || !valido(ultimo.m6) || !valido(ultimo.m12)) {
    throw new Error("Valores diarios invalidos - nao atualizo o CMS.");
  }
  if (!data.dataReferencia || !Array.isArray(data.historico) || data.historico.length < 6) {
    throw new Error("dataReferencia/historico invalidos - nao atualizo o CMS.");
  }

  const fieldData = {
    "taxa-3m": fmtPct(ultimo.m3),
    "taxa-6m": fmtPct(ultimo.m6),
    "taxa-12m": fmtPct(ultimo.m12),
    "data-fixing": data.dataReferencia,
    "frase-resumo": `A Euribor hoje (fixing de ${data.dataReferencia}) está em ${fmtPct(ultimo.m3)} a 3 meses, ${fmtPct(ultimo.m6)} a 6 meses e ${fmtPct(ultimo.m12)} a 12 meses.`,
    "tabela-mensal": buildTabela(data.historico),
  };

  const url = `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items/${ITEM_ID}/live`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cmsLocaleId: CMS_LOCALE_ID, fieldData }),
  });

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Webflow API ${r.status}: ${body.slice(0, 300)}`);
  }

  console.log(`[webflow] OK -> item Euribor atualizado com fixing de ${data.dataReferencia}`);
}

main().catch((e) => { console.error("[webflow] FALHOU:", e.message); process.exit(1); });
