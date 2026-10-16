# 2026-10-16 性能改善の公開記録

Worker version: `0793a1bb-0dfb-4196-a305-36d221fd23a7`。Smart Placement、共通検索メタデータの5分キャッシュ、検索SQLのbatch取得、詳細取得の並列化、Server-Timingを反映。応答のCache-Controlはno-storeを維持。

同じ実行環境で各3回計測した中央値（ネットワーク込み）。地域・負荷によって変動する。

| パス | 変更前 ms | 変更後 ms |
| --- | ---: | ---: |
| `/healthz` | 346 | 92 |
| `/` | 832 | 183 |
| `/?q=情報` | 968 | 329 |
| `/?q=情報科学` | 838 | 160 |
| `/?day=1,3&period=1,2&department=t,l&term=前期,後期` | 840 | 164 |
| `/?q=数学` | 985 | 361 |
| `/?page=324` | 842 | 313 |
| `/courses/course_007d46044133b3dded33fe3eb5b8bc2e` | 625 | 97 |

計測対象の講義ID・件数・ページ・詳細内容は前後一致。単体テスト19件、ブラウザテスト8件、build、deploy dry-runを通過。生データはローカルの `data/deploy/perf-before.json` と `perf-after.json`。

**未適用:** `0003_search_indexes.sql` はD1無料枠の当日書き込み上限（エラーコード7500）で拒否された。本番に4つの追加インデックスが存在しないことを確認済み。上記の本番実測はインデックスなし。アプリは追加インデックスなしでも動作する。

上限リセット後に `pnpm exec wrangler d1 migrations apply syllabus-db --remote` を実行する。料金プランは変更していない。
