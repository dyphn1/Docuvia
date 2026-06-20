# 🗺️ Docuvia AST 解析器 Roadmap & 實作要點

本文件定義了 Docuvia AST (Abstract Syntax Tree) 知識圖譜建置系統的後續 Roadmap 與實作要點。可作為交接文件交由其他 Agent (如 Hermes) 排程執行。

目前已完成 **AST Microkernel 基礎架構**（支援 WASM 動態載入、動態註冊表、並透過 `.jsonl` File-Based IPC 避免 OOM），且已成功完成 TypeScript 的概念驗證。接下來的工作著重於擴展語言廣度、提升語意精確度以及後端的資料庫整合。

---

## Phase 1: 擴充多語言支援 (Multi-language Support)

**目標**：將解析能力從目前的 TypeScript/JavaScript 擴充至其他主流語言，按照下列優先順序實作。

### 語言實作 Task List (按優先順序)

- [ ] **1. Python (`tree-sitter-python`)**
  - AI 領域與後端開發最常使用的語言，具備高度優先權。
  - 需處理 Python 特有的 `from module import function` 語法以準確解析 `imports`。
- [ ] **2. Rust (`tree-sitter-rust`)**
  - 系統級程式語言，本專案的相關專案（如 tolaria, headroom）皆使用 Rust。
  - 需要映射 `struct_item`, `impl_item`, `function_item` 等特有節點。
- [ ] **3. Go (`tree-sitter-go`)**
  - 常見的微服務後端語言。
  - 需要處理 Go 特有的 Package 匯入與 Struct 方法綁定。
- [ ] **4. Java (`tree-sitter-java`)**
  - 企業級後端最常見的語言。
  - 具備強烈的物件導向結構，需確保類別與介面（Interfaces）被正確擷取。
- [ ] **5. C/C++ (`tree-sitter-c`, `tree-sitter-cpp`)**
  - 處理底層系統與函式庫。
  - 注意標頭檔 (`.h`, `.hpp`) 與實作檔 (`.c`, `.cpp`) 的解析區分。
- [ ] **6. Ruby (`tree-sitter-ruby`)**
  - 用於支援傳統 Web 框架（如 Rails）。
- [ ] **7. PHP (`tree-sitter-php`)**
  - 涵蓋大量舊有與部分現代 Web 應用系統。
- [ ] **8. C# (`tree-sitter-c-sharp`)**
  - 支援 .NET 生態系。

### 實作要點：
1. **安裝依賴**：為目標語言安裝獨立的 Tree-sitter 模組（例如：`pnpm --filter @workspace/api-server add tree-sitter-python`）。
2. **更新註冊表**：在 `language-registry.ts` 中註冊新語言的副檔名與對應的 WASM 檔名。
3. **標籤映射 (Tag Mapping)**：查閱各語言的 Tree-sitter 文法定義，設定該語言在 AST 中的節點名稱。

---

## Phase 2: 強化節點萃取與精確查詢 (Query API & Accuracy)

**目標**：汰換目前暴力的子節點遍歷 (`descendantsOfType`)，改為使用 Tree-sitter 原生的 Query API，以處理複雜的語法邊界。

### 實作要點：
- [ ] **導入 Tree-sitter Query**：在 `LanguageProvider` 中加入編譯 `.scm` 語法查詢的邏輯（例如 `(class_declaration name: (identifier) @class.name)`）。
- [ ] **強化 Scope Map 與 Imports 解析**：
  - 處理具名引入 (`import { A as B }`)。
  - 處理萬用字元引入 (`import * as X`)。
- [ ] **Method vs Function 區別**：在提取 `call_expression` 時，區分是一般函數呼叫 `func()` 還是物件導向的方法呼叫 `obj.method()`，以利未來計算更準確的 FQN (Fully Qualified Name)。

---

## Phase 3: 知識圖譜寫入與資料庫整合 (Knowledge Graph Ingestion)

**目標**：將 `ast-worker.ts` 產生的 `.jsonl` 骨架檔案，正式轉換為 Docuvia 的 Graph 結構並寫入資料庫。

### 實作要點：
- [ ] **解析器與 Ingestion Pipeline 對接**：在 `ingestion-pipeline.ts` 中讀取 `.jsonl`，將資料轉換為 Drizzle ORM 的 Entity 格式。
- [ ] **階層對應 (Topology)**：
  - File 映射到 `l2_nodes` 或對應的實體。
  - Class / Function 映射為 `l3_nodes` (或細部的 Symbol Nodes)。
- [ ] **關聯建立 (Edges)**：將萃取出的 `call` 與 `import` 轉化為 `node_links` 資料表中的 `CALLS` 或 `DEPENDS_ON` 邊 (Edges)。

---

## Phase 4: 容錯機制與效能極限測試 (Resilience & Scalability)

**目標**：確保在掃描數萬個檔案的大型 Repo 時，系統具備容錯能力且不會卡死。

### 實作要點：
- [ ] **Poison Pill 隔離**：完善 `quarantine-db.ts`（SQLite），當某個檔案解析超過 500ms（或設定的 Timeout），立刻終止 Worker，並將該檔案標記為隔離，防止重啟後再次引發 OOM 或無限迴圈。
- [ ] **批次寫入最佳化**：對於上萬行的 `.jsonl` 檔案，實作串流讀取與資料庫的 Chunk 批次 Insert，避免拖垮 PostgreSQL 效能。
