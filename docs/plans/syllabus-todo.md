# TODO: 信大シラバス検索

> 運用契約: このファイルを再作成しない。in-place更新のみ。再開時は本ファイル全文、計画書のHard Gate・Out of scope・現在Stepを再読し、現在位置を宣言する。

- 計画書: `docs/plans/syllabus-plan.html`
- モック案: `docs/plans/syllabus-assets/mock/search-mock.html`（2026-10-15 ユーザー承認済み）
- goal prompt: なし
- 計画検証日時: 2026-10-15 JST（main・初回コミット前）
- アクティブタスク: Step 1–4のローカル検証済み。Step 5の全件PDF取得をバックグラウンドで実行開始。本番公開は未実施。差分チェック1回実施・2指摘修正済み、CRV3省略。
- ステータス: `[ ]` 未着手 / `[x]` 完了 / `[!]` blocked（理由必須） / `[-]` cancelled（指示または計画改訂の理由必須）
- 完了条件: 全行を `[x]` または `[-]` にする。取消がある場合は完了報告にも明記する。
- 非冪等操作は直前に「実行開始」を追記し、再開時に副作用を確認する。
- 計画外の問題は該当タスクを `[!]` にし、計画を改訂する。

## Hard Gate 一覧

| Step | Command | Expect | 結果 |
| --- | --- | --- | --- |
| 1 | `pnpm typecheck && pnpm build && pnpm exec wrangler deploy --dry-run` | exit 0 | PASS（型・build・dry-run） |
| 2 | `python3 scripts/ingest/validate.py --manifest data/manifest.json --samples data/samples --strict` | exit 0・全source行を報告 | PASS（21 PDF・6,461 URL、未処理6,440件を明示） |
| 3 | `pnpm exec wrangler d1 migrations apply syllabus-db --local && pnpm test && python3 -m unittest discover -s tests/ingest -v` | exit 0・local migration成功 | PASS（migration・TS 6件・Python 18件） |
| 4 | `pnpm exec playwright test tests/e2e/search.spec.ts` | exit 0 | PASS（smoke 1件・詳細ブラウザQA 15件、attested） |
| 5 | `pnpm typecheck && pnpm build && pnpm test && pnpm exec playwright test` | exit 0・本番HTTP検証成功 | ローカルcheck済み。本番HTTPは未実施 |

2026-10-15のユーザー指示によりStep 1–4は共通契約を固定して並列に進める。各GateがFAILの場合は統合完了にせず修正する。台帳とUnclear Pointsを更新して再実施する。コマンドは実装時に追加する予定のもの。

## Unclear Points 要約

- 原データの利用条件: 公開前に確認。
- 全量PDFの抽出品質と同一キーの衝突: 全量取り込み時に検証。
- workers.devサブドメイン名と契約プラン: 公開前に確定。
- 更新頻度: 暫定は手動、月次・学期前。
- UIモック表示: 承認済み。追加検索条件を実装に反映。

## タスク

- [x] Step 1: `package.json`, `vite.config.ts`, `wrangler.jsonc`, `src/server.tsx` にHono・Inertia・React基盤を作る（G1）。
- [x] Step 2: `scripts/ingest/` に一覧収集・PDF取得・抽出・検証CLIを作る（G2）。
- [x] Step 3: ローカルmigration適用済み。実PDF21件のSQL取り込み・読み戻し完了（2026-10-15）。 `migrations/`, `src/lib/`, `tests/` にD1・同一性判定・日本語検索を実装する（G3）。
- [x] Step 4: `app/pages/Courses/`, `src/components/ui/`, `tests/e2e/` に検索・詳細画面を作る（G4）。
- [ ] Step 5: `docs/operations.md`, `wrangler.jsonc` と全量データを検証し、公開・復旧手順を確定する（G5）。

## 2026-10-15 実装時の追加要件

- [x] 授業名・教員名（副担当を含む）・教室・曜日・時限・授業形式の独立した検索条件を追加する。
- [x] 原文を保存し、表記揺れの検索用正規化と手動別名対応表を実装する。
- [x] 実PDFのサンプル取り込みから画面検索までをローカルで検証する。証跡: `docs/qa/2026-10-15/report.html`。
- 全6,461 PDFの本取得・本番公開は、サンプル検証と分離して進捗を記録する。未実行を完了扱いにしない。
- schema/APIの正: `migrations/` と `src/lib/contracts.ts`。詳細設計の追補: `docs/plans/implementation-addendum.md`。

## 全件取得ジョブ

- 実行開始: 2026-10-15T14:25:53.706159+00:00（ユーザー指示: 全件取得・常時監視なし）
- systemd user unit: `syllabus-fetch-20261015t142553z`
- 進捗参照: `data/jobs/latest.json` のログ・status_file、終了後は `data/manifest.json`。
- 取得間隔1秒、取得済みPDFはキャッシュ利用。終了後にstrict検証を実行。サイトDBへの反映・本番公開はこのジョブには含めない。
