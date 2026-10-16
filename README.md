# Euribor hoje - LiteraciaFinanceira.pt

Ferramenta "Euribor hoje" (cartões + tabela + gráfico + simulador) servida por GitHub + jsDelivr,
com atualização automática diária. O Webflow só tem um loader minúsculo, por isso as alterações de
código ou de dados fazem-se aqui, sem copiar/colar no site.

## Ficheiros

- `euribor.js` - a ferramenta (injeta CSS + HTML no `#lfc-eur` e vai buscar os dados ao JSON).
- `euribor-data.json` - os dados (data de referência, série diária, histórico mensal).
- `scripts/update-euribor.mjs` - script diário que lê o euribor-rates.eu e atualiza o JSON.
- `.github/workflows/euribor-update.yml` - o cron (GitHub Action) que corre o script.
- `webflow-loader.html` - o que colas uma vez no Webflow.

> Se usares um repo com nome diferente de `euribor-hoje`, muda o `USER/REPO` em três sítios:
> `euribor.js` (DATA_URL), `webflow-loader.html` (src) e `.github/workflows/euribor-update.yml` (purge).

## Instalação (uma vez)

1. Cria/usa um repo **público** (o jsDelivr só serve repos públicos) e mete lá estes ficheiros.
2. No Webflow, no HTML Embed principal da página "Euribor hoje", apaga o código antigo e cola o
   conteúdo de `webflow-loader.html`. Publica.
3. Ativa as Actions: separador **Actions** do repo → ativar workflows. Podes correr à mão em
   "Atualizar Euribor" → **Run workflow** para testar.

A partir daqui: o cron corre nos dias úteis, acrescenta o dia mais recente, faz commit e purga o
jsDelivr; a página apanha o novo JSON sozinha.

## Como editar

- **Dados à mão:** edita `euribor-data.json` e faz commit (o purge do jsDelivr é feito pelo cron; para
  forçar já, abre `https://purge.jsdelivr.net/gh/USER/REPO@main/euribor-data.json`).
- **Código/visual:** edita `euribor.js`. Como o jsDelivr faz cache de ~12h no `@main`, purga também o
  `euribor.js` (`https://purge.jsdelivr.net/gh/USER/REPO@main/euribor.js`) ou usa uma tag de versão.

## Estrutura do euribor-data.json

```json
{
  "dataReferencia": "1 de julho de 2026",
  "serie":     [{ "d": "01/07/2026", "m3": 2.312, "m6": 2.554, "m12": 2.727 }],
  "historico": [{ "d": "2026-07",    "m3": 2.312, "m6": 2.554, "m12": 2.727 }]
}
```

- `serie` - dias úteis (dd/mm/aaaa), do mais antigo para o mais recente. Alimenta os cartões, a tabela
  e a vista "30 dias" do gráfico.
- `historico` - médias mensais (aaaa-mm). Alimenta a vista "1 ano" do gráfico.

## ⚠️ Licenciamento (importante)

A Euribor é um benchmark do **EMMI**. Os dados do euribor-rates.eu têm 24h de desfasamento e são para
**uso não-comercial**. Como o LiteraciaFinanceira.pt é comercial, confirma o licenciamento (EMMI ou um
fornecedor licenciado) antes de manteres um feed público automático. O parser em `scripts/` está isolado
e comentado para ser fácil trocar a fonte por uma API licenciada.

## Certificados de Aforro (taxa base mensal)

- `certificados-aforro/taxa-ca.json` - taxa base da Série F: `atual`, `proxima` e `historico` (até 24 meses).
  Cada valor tem `origem`: `igcp` (lido no IGCP), `calculada` (regra da Portaria n.º 149-A/2023 aplicada à
  Euribor 3M do `euribor-data.json`) ou `noticias` (valores iniciais). O IGCP substitui sempre o calculado.
- `scripts/update-certificados-aforro.mjs` - corre no cron `certificados-aforro-update.yml` (dia 1 e 22 a 31).
- `certificados-aforro/ca-artigo.js` - bloco dinâmico do artigo /artigos/certificados-de-aforro (lê o JSON).
  O simulador /simulador-certificados-aforro lê o mesmo JSON.
