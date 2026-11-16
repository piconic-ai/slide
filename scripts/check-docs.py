"""文書リンク・機能の利用場面・ストーリーマップの対応を確認する。"""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'
errors = []
features = sorted((DOCS / 'features').glob('*.md'))
required = ['利用場面', '得られる結果', '体験の流れ', '作る範囲', '作らないこと', '受け入れ条件', '未決事項']
for path in features:
    body = path.read_text()
    for heading in required:
        if f'## {heading}' not in body:
            errors.append(f'{path.relative_to(ROOT)}: 見出しがありません: {heading}')
    # Each acceptance criterion carries a permanent ID, such as F17-AC3, that
    # issues, pull requests and tests refer to.
    number = int(re.match(r'f(\d+)-', path.name).group(1))
    plain = re.sub(r'```.*?```', '', body, flags=re.S)
    criteria = re.search(r'^## 受け入れ条件\n(.*?)(?=^## |\Z)', plain, re.S | re.M)
    seen = set()
    for line in (criteria.group(1) if criteria else '').splitlines():
        if re.match(r'\s+([-*+] |\d+[.)] )', line):
            errors.append(f'{path.relative_to(ROOT)}: 受け入れ条件は字下げせず、1 行に 1 つ書いてください: {line[:40]}')
            continue
        if re.match(r'(\* |\+ |\d+[.)] )', line):
            errors.append(f'{path.relative_to(ROOT)}: 受け入れ条件は「- 」で始めてください: {line[:40]}')
            continue
        if not line.startswith('- '):
            continue
        tagged = re.match(r'- \*\*F(\d+)-AC(\d+)\*\* \S', line)
        if not tagged:
            errors.append(f'{path.relative_to(ROOT)}: 受け入れ条件に ID がありません: {line[:40]}')
        elif not re.match(r'- \*\*F\d{2}-AC[1-9]\d*\*\* ', line):
            errors.append(f'{path.relative_to(ROOT)}: ID は F17-AC3 の形で書いてください: {line[:40]}')
        elif int(tagged.group(1)) != number:
            errors.append(f'{path.relative_to(ROOT)}: ID の機能番号がファイルと違います: {line[:40]}')
        elif tagged.group(2) in seen:
            errors.append(f'{path.relative_to(ROOT)}: ID が重複しています: F{number:02d}-AC{tagged.group(2)}')
        else:
            seen.add(tagged.group(2))
    if not seen:
        errors.append(f'{path.relative_to(ROOT)}: 受け入れ条件がありません')
    if not re.search(r'[\u3040-\u30ff\u4e00-\u9fff]', body):
        errors.append(f'{path}: 日本語の説明がありません')

for path in [ROOT / 'README.md', *DOCS.rglob('*.md')]:
    body = path.read_text()
    if re.search(r'\[F\d+\]\(', body):
        errors.append(f'{path.relative_to(ROOT)}: 番号だけでなく機能名をリンクに使ってください')
    if body.count('```') % 2:
        errors.append(f'{path}: コードブロックが閉じていません')
    for block in re.findall(r'```json\n(.*?)\n```', body, re.S):
        json.loads(block)
    for target in re.findall(r'\]\(([^)]+)\)', body):
        if re.match(r'^[a-z]+:|^#', target):
            continue
        if not (path.parent / target.split('#')[0]).exists():
            errors.append(f'{path.relative_to(ROOT)}: リンク先がありません: {target}')

canvas = json.loads((DOCS / 'story-mapping.canvas').read_text())
node_ids = [node['id'] for node in canvas['nodes']]
if len(node_ids) != len(set(node_ids)):
    errors.append('canvas: node ID が重複しています')
for edge in canvas['edges']:
    if edge['fromNode'] not in node_ids or edge['toNode'] not in node_ids:
        errors.append(f'canvas: 接続先がありません: {edge["id"]}')
for node in canvas['nodes']:
    for target in re.findall(r'\]\(([^)]+)\)', node.get('text', '')):
        if not (DOCS / target).exists():
            errors.append(f'canvas: リンク先がありません: {target}')
details = {node['id']: node for node in canvas['nodes'] if node['id'].startswith('detail-')}
for path in features:
    feature_id = re.match(r'f(\d+)-', path.name).group(1)
    row_nodes = [node for node in canvas['nodes'] if re.match(rf'story-\d+-{feature_id}$', node['id'])]
    if not row_nodes:
        errors.append(f'F{feature_id}: ストーリーマップに対応がありません')
    for node in row_nodes:
        row = node['id'].split('-')[1]
        detail = details.get(f'detail-{row}')
        if not detail or f'features/{path.name}' not in detail['text']:
            errors.append(f'F{feature_id}: 同じ行の対象機能に記載がありません')
for row in range(7):
    detail = details.get(f'detail-{row}')
    if not detail:
        errors.append(f'行{row}: 範囲の説明がありません')
    elif row < 6 and '完了条件' not in detail['text']:
        errors.append(f'行{row}: 完了条件がありません')
if errors:
    raise SystemExit('\n'.join(errors))
print(f'機能 {len(features)} 件、Markdown リンク、JSON、ストーリーマップの対応を確認しました。')
