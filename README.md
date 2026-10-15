# 信大シラバス検索

React / shadcn UI / Hono / Inertia / Cloudflare D1 と、Python / Poppler による公開PDFの取り込みCLI。

- [実装設計](docs/plans/implementation-addendum.md)
- [運用手順](docs/operations.md)
- [調査・計画書](docs/plans/syllabus-plan.html)
- [進捗](docs/plans/syllabus-todo.md)
- [ローカルQA結果](docs/qa/2026-10-15/report.html)

```bash
pnpm install
python3 -m pip install -r scripts/ingest/requirements.txt
pnpm exec wrangler d1 migrations apply syllabus-db --local
pnpm dev
```

Node.js 24 以降を使用します。PDFの取り込みには Python 3 と Poppler (`pdftotext`) が必要です。詳細は運用手順を参照してください。
