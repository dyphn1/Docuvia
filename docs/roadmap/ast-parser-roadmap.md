# 🗺️ Docuvia AST 解析器 — 未完成項目追蹤

> 已完成項目已合併至 [master-roadmap.md](master-roadmap.md) Phase 5。本文件只追蹤尚未完成的項目。
> 詳細的 Phase 1-4 已完成項目說明請參考 `master-roadmap.md`。

---

## 未完成項目 (Implementation Backlog)

### Phase 4: 容錯機制與效能極限測試 (Resilience & Scalability)

- [ ] **批次寫入最佳化** — 對於上萬行的 `.jsonl` 檔案，實作串流讀取與資料庫的 Chunk 批次 Insert，避免拖垮 PostgreSQL 效能。
  - 目標文件：`artifacts/api-server/src/lib/ast-ingestion-pipeline.ts`
  - 關鍵邏輯：串流讀取 `.jsonl` → 每 N 筆 batch INSERT → 避免 memory bloat

### Phase 5: AST Microkernel 進階功能

- [ ] **Incremental Fast-Path** — 使用 `git diff-tree -M` 進行 O(1) delta 偵測，只重新解析變更的檔案。
  - 目標文件：`artifacts/api-server/src/lib/ast-ingestion-pipeline.ts`
  - 關鍵邏輯：`git diff-tree -M` → 比對 `project_files` table → 只解析 changed/new files

- [ ] **Cross-Language Edges** — 跨語言依賴邊際偵測（API Contracts、Framework-specific AST tracking）。
  - 目標文件：`artifacts/ast-core/src/parser-core.ts`
  - 關鍵邏輯：OpenAPI/Swagger 作為 Bridge Nodes、tRPC/Next.js Server Actions 追蹤

- [ ] **Zero-Server Deep Traversal** — 純本地 SQLite graph queries，不依賴 API server。
  - 目標文件：`artifacts/vscode-client/src/KnowledgeStore.ts`
  - 關鍵邏輯：SQLite recursive CTE queries for graph traversal

- [ ] **Local Context Compression** — Token reduction pipeline，在送交 LLM 前壓縮 context。
  - 目標文件：`artifacts/ast-core/src/parser-core.ts`
  - 關鍵邏輯：AST Skeleton compression、symbol deduplication

- [ ] **Sub-second Incremental Watch** — 檔案儲存時的 fast-path AST 更新。
  - 目標文件：`artifacts/api-server/src/routes/ingest.ts`
  - 關鍵邏輯：`mode: "incremental"` → `detectChangedFiles()` → 只解析變更檔案
  - 狀態：部分實作（`project_files` table + `detectChangedFiles()` 已建立，待 build/test/DB migration）

---

## Cron Agent 使用說明

AST Language Implementor cron 執行時應：
1. 讀取 `docs/reports/.ast-verification-index.json` 取得未完成項目列表
2. 選擇第一個 `status: "todo"` 的項目實作
3. 實作完成後執行 build + test + DB migration
4. 更新 `docs/roadmap/roadmap_checklist.md` Phase 8 對應項目狀態
5. 更新 `.ast-verification-index.json`
6. Git commit + push
