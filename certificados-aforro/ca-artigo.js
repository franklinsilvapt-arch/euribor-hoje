/*
 * Bloco dinâmico "Taxa atual dos Certificados de Aforro" do artigo
 * literaciafinanceira.pt/artigos/certificados-de-aforro.
 *
 * O artigo tem, dentro de um embed do rich text, um <div id="lfc-ca-taxa">
 * com os valores escritos à mão (servem de fallback e para SEO). Este script
 * vai buscar o taxa-ca.json (atualizado pelo GitHub Action) e reescreve o
 * bloco com os valores mais recentes. Se o JSON falhar, fica o fallback.
 */
(function () {
  var URL_DADOS = "https://cdn.jsdelivr.net/gh/franklinsilvapt-arch/euribor-hoje@main/certificados-aforro/taxa-ca.json";
  var MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  var PREMIOS = [
    { label: "1.º ano", p: 0 },
    { label: "2.º ao 5.º ano", p: 0.25 },
    { label: "6.º ao 9.º ano", p: 0.5 },
    { label: "10.º e 11.º ano", p: 1 },
    { label: "12.º e 13.º ano", p: 1.5 },
    { label: "14.º e 15.º ano", p: 1.75 }
  ];

  function pct(v, casas) { return v.toFixed(casas).replace(".", ",") + "%"; }
  function mesDe(ym) { var p = ym.split("-"); return MESES[parseInt(p[1], 10) - 1] + " de " + p[0]; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* antepenúltimo dia útil (dias úteis da Euribor) do mês, para dizer quando sai a próxima taxa */
  function pascoa(a) {
    var b = Math.floor(a / 100), c = a % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var x = a % 19, h = (19 * x + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((x + 11 * h + 22 * l) / 451);
    return Date.UTC(a, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
  }
  function util(t) {
    var d = new Date(t), w = d.getUTCDay(), md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate(), p = pascoa(d.getUTCFullYear());
    return !(w === 0 || w === 6 || [101, 501, 1225, 1226].indexOf(md) >= 0 || t === p - 172800000 || t === p + 86400000);
  }
  function antepenultimo(ano, mes) {
    var t = Date.UTC(ano, mes, 0), n = 0;
    while (true) { if (util(t) && ++n === 3) return new Date(t); t -= 86400000; }
  }

  function render(el, d) {
    var a = d.atual, prox = d.proxima, hist = (d.historico || []).slice(-12).reverse();
    if (!a || !isFinite(a.taxa)) return;
    var h = "";
    h += '<div class="lfc-ca-card">';
    h += '<p class="lfc-ca-label">Taxa base em ' + esc(a.mes) + '</p>';
    h += '<p class="lfc-ca-valor">' + pct(a.taxa, 3) + '</p>';
    var nota = "Taxa bruta anual para novas subscrições da Série F, antes do prémio de permanência e do IRS.";
    if (a.taxa >= 2.5) nota += " Está no máximo permitido, de 2,5%.";
    if (prox && isFinite(prox.taxa)) {
      nota += " A taxa de " + esc(prox.mes.split(" de ")[0]) + " já está fixada: <strong>" + pct(prox.taxa, 3) + "</strong>.";
    } else {
      var f = antepenultimo(a.ano, a.mesNum);
      nota += " A taxa de " + MESES[a.mesNum % 12] + " é fixada a " + f.getUTCDate() + " de " + MESES[f.getUTCMonth()] + ".";
    }
    h += '<p class="lfc-ca-nota">' + nota + "</p>";
    h += "</div>";

    h += '<p><strong>Quanto rende uma subscrição feita em ' + esc(a.mes) + '</strong></p>';
    h += '<div class="table-content"><table><thead><tr><th>Ano da subscrição</th><th>Prémio</th><th>Taxa bruta</th><th>Taxa líquida de IRS (28%)</th></tr></thead><tbody>';
    PREMIOS.forEach(function (r) {
      var b = a.taxa + r.p;
      h += "<tr><td>" + r.label + "</td><td>" + (r.p ? "+" + pct(r.p, 2) : "0") + "</td><td>" + pct(b, 3) + "</td><td>" + pct(b * 0.72, 3) + "</td></tr>";
    });
    h += "</tbody></table></div>";
    h += '<p class="lfc-ca-fonte"><sup>Mantendo a taxa base de ' + esc(a.mes) + ' em todos os anos. Na prática, a taxa base muda a cada trimestre.</sup></p>';

    if (hist.length > 1) {
      h += '<p><strong>Taxa base nos últimos meses</strong></p>';
      h += '<div class="table-content"><table><thead><tr><th>Mês</th><th>Taxa base</th></tr></thead><tbody>';
      hist.forEach(function (r) { h += "<tr><td>" + cap(mesDe(r.ym)) + "</td><td>" + pct(r.taxa, 3) + "</td></tr>"; });
      h += "</tbody></table></div>";
    }
    var at = d.atualizadoEm ? new Date(d.atualizadoEm) : null;
    h += '<p class="lfc-ca-fonte"><sup>Fonte: <a href="https://www.igcp.pt/pt/aforristas/produtos-de-aforro/certificados-de-aforro" target="_blank" rel="noopener">IGCP</a>. ' +
      'Quando o IGCP ainda não atualizou a página, a taxa é calculada com a regra da <a href="https://files.dre.pt/1s/2023/06/10702/0000200003.pdf" target="_blank" rel="noopener">Portaria n.º 149-A/2023</a>.' +
      (at ? " Atualizado a " + at.getUTCDate() + " de " + MESES[at.getUTCMonth()] + " de " + at.getUTCFullYear() + "." : "") + "</sup></p>";
    el.innerHTML = h;
  }

  function css() {
    if (document.getElementById("lfc-ca-css")) return;
    var s = document.createElement("style");
    s.id = "lfc-ca-css";
    s.textContent =
      "#lfc-ca-taxa .lfc-ca-card{border:1px solid #ffd9c9;background:#fff6f2;border-radius:16px;padding:18px 24px;margin:0 0 24px}" +
      "#lfc-ca-taxa .lfc-ca-label{margin:0;font-size:14px;line-height:1.4;color:#595959}" +
      "#lfc-ca-taxa .lfc-ca-valor{margin:4px 0 8px;font-size:40px;line-height:1.1;font-weight:700;color:#ff5a1f}" +
      "#lfc-ca-taxa .lfc-ca-nota{margin:0;font-size:14px;line-height:1.5}" +
      /* legenda colada à tabela, como nas tabelas do rich text (p a seguir a um embed tem margin-top:-40px) */
      "#lfc-ca-taxa .table-content+.lfc-ca-fonte{margin-top:-40px}";
    document.head.appendChild(s);
  }

  function init() {
    var el = document.getElementById("lfc-ca-taxa");
    if (!el) return;
    css();
    fetch(URL_DADOS, { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { render(el, d); })
      .catch(function () { /* fica o fallback escrito no artigo */ });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
