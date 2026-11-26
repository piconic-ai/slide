import { html } from 'hono/html'
import { SERVICE_NAME } from '../site/service'
import { designTokensCssRaw } from '../site/design-tokens'

/**
 * The document around every operator page: the head, the one inline style
 * (the operator pages' CSP allows nothing else) and the page's body. `title`
 * is the page's own name; the service name follows it.
 */
export const operatorDocument = (
  title: string,
  body: ReturnType<typeof html>,
) =>
  html`<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>${title} - ${SERVICE_NAME}</title>
        <style>
          ${designTokensCssRaw} body {
            max-width: 960px;
            margin: 4vh auto;
            padding: 0 16px;
            color: var(--foreground);
            background: var(--background);
            font-family: var(--font-sans);
            font-size: 16px;
            font-weight: 400;
            line-height: 1.8;
            overflow-wrap: anywhere;
          }
          h1 {
            font-size: 32px;
            font-weight: 700;
            line-height: 1.35;
          }
          h2 {
            font-size: 24px;
            font-weight: 700;
            line-height: 1.4;
          }
          a {
            color: var(--foreground);
          }
          label {
            display: block;
            margin-bottom: 4px;
            font-size: 14px;
            font-weight: 600;
            line-height: 1.7;
          }
          .text-input {
            box-sizing: border-box;
            width: 100%;
            padding: 10px 12px;
            border: 1px solid var(--input);
            border-radius: var(--radius);
            background: var(--background);
            color: var(--foreground);
            font: 16px/1.8 var(--font-sans);
          }
          .text-input:focus {
            border: 2px solid var(--foreground);
            outline: none;
          }
          .button-secondary {
            display: inline-block;
            box-sizing: border-box;
            min-height: 40px;
            padding: 9px 19px;
            border: 1px solid var(--input);
            border-radius: var(--radius-full);
            background: var(--background);
            color: var(--foreground);
            font: 600 15px/1.2 var(--font-sans);
            text-align: center;
            cursor: pointer;
          }
          .button-secondary:hover {
            background: var(--secondary);
          }
          .data-table {
            width: 100%;
            border-collapse: collapse;
            background: var(--background);
          }
          .data-table th,
          .data-table td {
            padding: 8px 8px 8px 0;
            border-bottom: 1px solid var(--border);
            text-align: left;
            vertical-align: top;
            overflow-wrap: anywhere;
          }
          .data-table th {
            color: var(--muted-foreground);
            font-size: 13px;
            font-weight: 600;
            line-height: 1.6;
          }
          code {
            font-family: var(--font-mono);
            font-size: 13px;
            line-height: 1.6;
          }
          .cell-label {
            display: none;
          }
          .notice-success,
          .notice-warning,
          .notice-danger {
            border: 1px solid;
            border-radius: var(--radius);
            padding: 12px 16px;
            font-size: 14px;
            font-weight: 400;
            line-height: 1.7;
          }
          .notice-success {
            border-color: var(--success);
            background: var(--success-soft);
            color: var(--success);
          }
          .notice-warning {
            border-color: var(--warning);
            background: var(--warning-soft);
            color: var(--warning);
          }
          .notice-danger {
            border-color: var(--destructive);
            background: var(--destructive-soft);
            color: var(--destructive);
          }
          .operator-nav ul {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin: 0;
            padding: 0;
            list-style: none;
          }
          .operator-nav a {
            display: inline-flex;
            align-items: center;
            box-sizing: border-box;
            min-height: 44px;
            padding: 0 20px;
            border: 1px solid var(--input);
            border-radius: var(--radius-full);
            color: var(--foreground);
            font: 600 15px/1.2 var(--font-sans);
            text-decoration: none;
          }
          .operator-nav a[aria-current='page'] {
            border-color: var(--foreground);
            background: var(--foreground);
            color: var(--background);
          }
          .not-configured {
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 12px 16px;
            font-size: 14px;
            line-height: 1.7;
          }
          .pending-note {
            color: var(--muted-foreground);
          }
          .table-scroll {
            overflow-x: auto;
          }
          .metrics-table {
            width: 100%;
            border-collapse: collapse;
            background: var(--background);
          }
          .metrics-table th,
          .metrics-table td {
            padding: 6px 12px 6px 0;
            border-bottom: 1px solid var(--border);
            font-size: 14px;
            line-height: 1.6;
            vertical-align: top;
          }
          .metrics-table thead th {
            color: var(--muted-foreground);
            font-size: 13px;
            font-weight: 600;
            text-align: right;
            white-space: nowrap;
          }
          .metrics-table thead th:first-child,
          .metrics-table tbody th[scope='row'] {
            min-width: 16em;
            text-align: left;
          }
          .metrics-table tbody th[scope='row'] {
            font-weight: 400;
          }
          .metrics-table td {
            text-align: right;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
          }
          .metrics-table .group-row th {
            padding-top: 20px;
            border-bottom: 1px solid var(--foreground);
            font-size: 15px;
            font-weight: 700;
            text-align: left;
          }
          :focus-visible {
            outline: 2px solid var(--ring);
            outline-offset: 2px;
          }
          @media (max-width: 599px) {
            .data-table th {
              position: absolute;
              width: 1px;
              height: 1px;
              padding: 0;
              overflow: hidden;
              clip: rect(0, 0, 0, 0);
              white-space: nowrap;
              border: 0;
            }
            .data-table,
            .data-table tbody,
            .data-table tr,
            .data-table td {
              display: block;
              width: auto;
            }
            .data-table tr {
              padding: 8px 0 12px;
              border-bottom: 1px solid var(--border);
            }
            .data-table td {
              border: 0;
              padding: 4px 0;
            }
            .cell-label {
              display: block;
              color: var(--muted-foreground);
              font-size: 13px;
              font-weight: 600;
              line-height: 1.6;
            }
          }
        </style>
      </head>
      <body>
        ${body}
      </body>
    </html>`
