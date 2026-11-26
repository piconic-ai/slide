// Text for the cost estimate: a table of items for one set of inputs, and a
// table of totals for several months' views. Markdown, so the output pastes
// into docs/dev/scale-cost.md.

const usd = (value) => `$${value.toFixed(2)}`
const quantity = (value) =>
  value >= 100
    ? Math.round(value).toLocaleString('en-US')
    : String(Number(value.toFixed(2)))

/** The items of one estimate, with what each one used and what is free. */
export function renderEstimate(inputs, result) {
  const lines = [
    `Estimate for ${quantity(inputs.views)} views a month (prices as of ${inputs.asOf})`,
    '',
    '| Item | Used | Included | Cost |',
    '| --- | ---: | ---: | ---: |',
    ...result.items.map(
      (item) =>
        `| ${item.label} | ${quantity(item.quantity)} ${item.unit} | ${quantity(item.included)} | ${usd(item.usd)} |`,
    ),
    '',
    `Total: ${usd(result.usd)} a month`,
    result.exceeding.length === 0
      ? 'Nothing exceeds its included amount.'
      : `Beyond the included amount: ${result.exceeding.join(', ')}`,
  ]
  return lines.join('\n')
}

/** One row for each monthly view count: the total and what exceeds. */
export function renderTable(rows) {
  return [
    '| Views a month | Total a month | Beyond the included amount |',
    '| ---: | ---: | --- |',
    ...rows.map(
      ({ views, result }) =>
        `| ${quantity(views)} | ${usd(result.usd)} | ${result.exceeding.join(', ') || '-'} |`,
    ),
  ].join('\n')
}

const grouped = (value) => value.toLocaleString('en-US')

/** The price table of docs/dev/scale-cost.md, one row for each price. */
export function renderPrices(prices) {
  return [
    '| 名前 | 値 | 単位 | 出典 | 確かめた日 | 注 |',
    '| --- | ---: | --- | --- | --- | --- |',
    ...Object.entries(prices).map(
      ([name, price]) =>
        `| \`${name}\` | ${grouped(price.value)} | ${price.unit} | ${price.source} | ${price.checkedOn} | ${price.note ?? ''} |`,
    ),
  ].join('\n')
}

const COUNT_NAMES = [
  'workerRequests',
  'internalRequests',
  'd1RowsRead',
  'd1RowsWritten',
  'r2ClassA',
  'r2ClassB',
  'cpuMs',
]

/** The per-use table: one row for each use, one column for each count. */
export function renderPerUse(perUse) {
  const rows = [
    ...['small', 'normal', 'large'].flatMap((size) =>
      ['view', 'revisit', 'upload'].map((use) => [
        `${use} ${size}`,
        perUse[size][use],
      ]),
    ),
    ...Object.entries(perUse.list).map(([name, use]) => [`list ${name}`, use]),
    ['cover', perUse.cover],
  ]
  return [
    `| 場面 | ${COUNT_NAMES.map((name) => `\`${name}\``).join(' | ')} |`,
    `| --- | ${COUNT_NAMES.map(() => '---:').join(' | ')} |`,
    ...rows.map(
      ([label, use]) =>
        `| ${label} | ${COUNT_NAMES.map((name) => grouped(use[name])).join(' | ')} |`,
    ),
  ].join('\n')
}
