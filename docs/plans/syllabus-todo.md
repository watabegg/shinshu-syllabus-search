# TODO: 信大シラバス検索

> 運用契約: このファイルを再作成しない。in-place更新のみ。再開時は本ファイル全文、計画書のHard Gate・Out of scope・現在Stepを再読し、現在位置を宣言する。

- 計画書: `docs/plans/syllabus-plan.html`
- モック案: `docs/plans/syllabus-assets/mock/search-mock.html`（2026-10-15 ユーザー承認済み）
- goal prompt: なし
- 計画検証日時: 2026-10-15 JST（main・初回コミット前）
- アクティブタスク: Step 1–4のローカル検証済み。Step 5の全件PDF取得処理は終了（6,457件成功、失敗2件・衝突2件が要確認）。本番公開は未実施。差分チェック1回実施・2指摘修正済み、CRV3省略。
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

## 2026-10-16 UI調整と取得結果

- 全6,461件を処理。6,411件取得・抽出、登録コード抽出失敗47件、本文なし1件、同一キー衝突2件。strict検証は成功、全件成功ではない。サイトDBへの反映は未実施。
- UI方針: 形式不明は表示・検索で対面に補完し、抽出元データは維持。本文を項目・授業回に構造化。結果カード全体をリンク化し、一覧の情報サイドバーを削除。

- 失敗48件の再試行実行開始: 2026-10-15T16:50:17.896642+00:00。医学科別書式の抽出を修正し、取得済み正常データと衝突2件は維持。ジョブ: `syllabus-retry-20261015t165017z`。

- 再試行終了（2026-10-16 01:51 JST）: 46件回復、成功6,457件・失敗2件・衝突2件。strict検証エラー0、既存6,411件のコース内容は変更なし。失敗は画像PDF1件と登録コード空欄1件。衝突調査: `data/conflict-investigation.json`。

- 追加対応中: 衝突2件は同一PDFの別URLと登録対象別コードとして解消する。画像PDF1件は日本語OCR後に原本照合。登録コード空欄1件は推測で補完しない。再実行前データを data/jobs/20261015T165937Z-resolve に退避。

- 追加対応完了: 成功URL 6,460件（同一PDFの別URL 1件を含む）、授業6,459件、衝突0件、登録コード空欄による保留1件。画像PDFはTesseract OCRと原本全ページ照合で回復。既存6,457授業は変更なし。Pythonテスト23件成功、今回の3資料を加えた24 PDFのstrict検証エラー0。証跡: `data/jobs/20261015T165937Z-resolve/`。サイトDBへの全件反映は未実施。

- ユーザー承認により、登録コード空欄の医学部「教育学概論（高年次生向け）」をQ3002902で補完。原本空欄・関連授業との照合・承認による補完をメタデータに記録し、共通教育の授業とは別レコードを維持。全6,461 URL処理済み、重複1件を除く6,460授業、失敗・衝突・保留0件。既存6,459授業は変更なし。Pythonテスト24件成功、strict検証エラー0。サイトDBへの全件反映は未実施。

- 全件のローカルD1反映完了: 6,460授業・323ページをlocalhost:5173で確認。装飾英語ラベルと検索文字数の補足を削除し、shadcnのページ選択＋前後矢印に変更。型チェック・TSテスト10件・build・Playwright5件成功。React Doctorは71点、変更による指摘なし。スマホ・最終ページ・OCR授業詳細を確認。本番デプロイは未実施。

- push前ローカルQA: 12ケース・36スクリーンショットの検証を完了。範囲外ページ番号を最終ページへ補正し、回帰テストを追加。TS10件・Python24件・E2E5件・build・strictデータ検証成功。レポート: `docs/qa/2026-10-16/report.html`。全件原文の人手照合・本番デプロイは未実施。
