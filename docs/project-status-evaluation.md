# Docuvia 專案狀態深度評估報告 (2026-07-06)

> **評估視角：最嚴厲的架構審計與實作落差對比**
> 本報告從專案 Master Roadmap（6 個階段）與 26 個 ADR（架構決策紀錄）出發，深度分析 Docuvia 目前的程式碼實作、功能落差、設計缺陷，並給出具體的評價、優缺點及重構建議。

---

## 1. 整體評價 (Evaluation & Critique)

專案自評分數為 **3 / 10**（見 `docs/gitbook/analysis/README.md`），這是一個坦誠但極具警示性的分數。經過對代碼庫的深度分析，這個分數是準確且合理的。雖然 Docuvia 在「Git 同構知識庫」與「本地優先 (Local-First)」的願記上架構宏大，但在**核心功能實作上存在嚴重的「偷工減料」與設計背離**。

核心問題如下：

### A. 虛假的符號級關係鏈結 (Shallow Entity Linkage)

- **設計承諾 (ADR-004 / ADR-020)**：宣稱能透過 AST 微核心解析 TypeScript `implements`/`extends` 與函數 `calls` 關係，建立細粒度的 L2/L3 符號知識圖譜，從而精準計算變更的 Blast Radius（影響範圍）。
- **實作落差**：
  - 在 [ast-worker.ts](file:///d:/GitHub/Docuvia/lib/core/src/workers/ast-worker.ts) 中，雖然成功提取了 implements、extends 以及 calls 的符號名稱。
  - 但在 [sqlite-graph.repository.ts](file:///d:/GitHub/Docuvia/lib/core/src/services/sqlite-graph.repository.ts) 的 `persistAstGraph` 中，這些關係在寫入資料庫時**被全數扁平化為「檔案對檔案 (File -> File)」的關聯**！
  - 程式碼中呼叫的 `processLink` 解析出符號所屬的 `targetFileId` 與 `sourceFileId`，隨後將 `node_links` 的 `sourceNodeId` 與 `targetNodeId` 設為這兩個**檔案節點的 ID**。
  - **致命後果**：同一檔案內部的繼承與呼叫關係被直接忽略；跨檔案的關係退化為檔案依賴關係。這導致 [ImpactAnalysisService](file:///d:/GitHub/Docuvia/lib/core/src/services/impact-analysis-service.ts) 計算出的 Blast Radius 只能精確到**檔案級別**，無法提供符號級別的精密分析。

### B. 徒有其名的多模型抽象層 (Pseudo-LLM Abstraction)

- **設計承諾 (ADR-026)**：要求實作 Thin Transport 模式，將執行循環與 Payload 隔離，以支援多個 LLM 供應商（OpenAI, Anthropic, Gemini）。
- **實作落差**：
  - [client.ts](file:///d:/GitHub/Docuvia/lib/integrations-openai-ai-server/src/client.ts) 實際上只是對官方 `OpenAI` SDK 的簡單包裝。當 provider 設為 `ollama` 或 `local` 時，僅僅是修改了 `baseURL`，其回傳型別依然是 raw `OpenAI` client。
  - 沒有任何 Anthropic 或 Gemini 的專屬 Adapter 或 API 轉譯邏輯。
  - **致命後果**：系統實際上被強烈綁定在 OpenAI API 協定上。若要接入不支援 OpenAI 格式的模型，必須重寫該抽象層。

### C. 漏洞百出且不一致的 VCS 匯入管道 (VCS Ingestion Inconsistencies)

- **設計承諾**：Git 與 SVN 管道應具有對等的數據解析度，將版本變更與 Diff 完整投影至資料庫。
- **實作落差**：
  - 在 [ingestion-pipeline.ts](file:///d:/GitHub/Docuvia/lib/core/src/services/ingestion-pipeline.ts) 的 `processIngestion` 中，對於 `git` 類型，會將 `diff` 寫入 commits 資料表的 `diff` 欄位。
  - 對於 `svn` 類型，程式碼**完全沒有寫入 `diff` 欄位**，而是將 `diff` 與 `message` 強行拼接成 `fullMessage` 存入 `message` 欄位，並直接進行 `slice(0, 4000)` 截斷。
  - **致命後果**：SVN 專案的 Diff 資訊因為被強行截斷在 message 欄位中而遺失，且無法透過標準的 `diff` 欄位進行 AST 差異分析，導致 SVN 的智慧影響範圍分析徹底失效。

### D. 嚴重的類型安全漏洞 (Bypassed Type Safety)

- **實作落差**：
  - 核心介面 [analyzer.interfaces.ts](file:///d:/GitHub/Docuvia/lib/core/src/interfaces/analyzer.interfaces.ts) 中，大量的核心數據結構（如 `parsedResults`、`filesToParse`）均被宣告為 `any[]`。
  - **致命後果**：TypeScript 的編譯期類型檢查形同虛設，為後續的大規模重構埋下了嚴重的執行期崩潰隱患。

---

## 2. 優缺點分析 (Pros & Cons)

### 👍 優點 (Pros)

1. **本地優先架構設計 (Local-First Design)**:
   - [AstWorkerPool](file:///d:/GitHub/Docuvia/lib/core/src/services/ast-worker-pool.ts) 與 Web-tree-sitter WASM 深度整合，成功繞過了對 Node 編譯器（C++ 綁定）的平台依賴，具備強大的瀏覽器與 IDE 延伸套件跨平台執行能力。
2. **優秀的併發與記憶體管理 (Worker Pool Management)**:
   - `AstWorkerPool` 實作了基於 CPU 核心數量的執行緒限制，並且配備了超時重啟機制（30秒自動重灌），能有效防止惡意或超大源碼檔案導致的 WASM 記憶體洩漏與 CPU 堵塞。
3. **時間衰減評分實作落實 (Temporal Decay)**:
   - [decay.ts](file:///d:/GitHub/Docuvia/lib/core/src/services/decay.ts) 的指數時間衰減算法與資料庫搜尋（pgvector 及 SQLite）深度結合，確保了過期知識會自動在推薦中沈底，這個部分的程式碼實作與設計高度吻合。

### 👎 缺點與隱患 (Cons & Architectural Debt)

1. **核心功能多處停留在 TODO/WARN 階段**：
   - **Phase 2 (TS `implements`/`extends` 符號關係)**：雖有 Parser 支持，但圖譜未鏈結。
   - **Phase 3 (語意去重 Semantic Deduplication)**：未實作，`intent-router` 仍存在重複 LLM 查詢成本。
   - **Phase 4 (分層存儲與墓碑機制 Tiered Storage & Tombstone GC)**：`l2_nodes`/`l3_nodes` 未設計 `is_active` 或 tombstone 欄位，無 GC 機制。
   - **Phase 4 (範本繼承 Template Inheritance)**：[prompt-service.ts](file:///d:/GitHub/Docuvia/lib/core/src/services/prompt-service.ts) 僅有單純的項目-全局 Fallback，不支援繼承與擴展。
   - **Phase 5/6 (拓撲圖、自動 Tool Maker、平行審查)**：完全尚未動工。
2. **測試環境破碎與路徑解析 Bug**：
   - `vitest.config.ts` 在專案根目錄定義，但當開發者在子模組（如 `lib/core`）執行測試時，相對路徑 glob 會解析錯誤，導致 Vitest 回報 `No test files found`。
   - 整合測試強制綁定 Docker PostgreSQL & pgvector，若本地 Docker Daemon 未啟動，整個測試管道將直接癱瘓，缺乏單元測試與模擬資料庫的快速驗證手段。

---

## 3. 建議與重構路線圖 (Recommendations)

### 建議 1：重構 `SqliteGraphRepository` 與 `node_links` 表（解決關係扁平化問題）

- **行動**：
  1. 修改 `node_links` 的寫入邏輯，允許 `sourceNodeId` 與 `targetNodeId` 鏈結至 `nodeType = 'function'` 或 `'class'` 的符號節點，而非僅限於 `file` 節點。
  2. 新增符號間的詳細關聯（例如：`ClassA contains MethodA` -> `MethodA calls FunctionB`）。
  3. 保留檔案與檔案之間的 `imports` 依賴關係，但應與符號級關係（`calls`、`implements`、`extends`）在欄位或類型上做嚴格區分。

### 建議 2：落實 `integrations-openai-ai-server` 供應商抽象化

- **行動**：
  1. 重構 `createLlmClient`，定義一個統一的 `LlmClientAdapter` 介面。
  2. 針對 OpenAI、Anthropic、Gemini 分別實作特定的 SDK 調用轉譯器，而非讓所有供應商都去強行適應 OpenAI SDK。

### 建議 3：修正 SVN Ingestion 的 Diff 存儲問題

- **行動**：
  1. 修正 `processIngestion` 中的 SVN 處理分支，將 `c.diff` 寫入資料表的 `diff` 欄位（比照 Git），並移除將整個 diff 強行塞入並截斷 `message` 的臨時做法。

### 建議 4：重構核心介面的類型定義（消除 `any`）

- **行動**：
  1. 在 `analyzer.interfaces.ts` 中，定義強類型的 `ParsedAstFile`、`DiscoveryResult` 等結構體，廢除所有核心方法簽名中的 `any[]` 與 `any`。

### 建議 5：優化測試配置與路徑

- **行動**：
  1. 修正 `vitest.config.ts` 中的 `include` 與 `exclude` 設定，改用絕對路徑或基於專案根目錄的動態路徑解析，防止在子目錄中執行 `vitest` 時路徑匹配失效。
  2. 引入 SQLite In-Memory 模式或 Drizzle Mock 機制，讓不依賴 pgvector 的單元測試能夠在無 Docker 環境下流暢運行。

---

## 4. Local-First 優先修復清單（2026-07-06）

> 交叉比對 [capabilities-matrix.md](gitbook/analysis/capabilities-matrix.md)、本報告第 1-3 節、以及 [roadmap Phase 2](gitbook/roadmap/phase-2-ast-microkernel-semantic-diffing.md) / [Phase 5](gitbook/roadmap/phase-5-local-first-vs-code-client-web-ui.md) 後得出的結論：**roadmap 上標記「✅ Done」的多項 local-first 功能，實際上是表面完成、內裡是空殼**（尤其是符號級關係鏈結被扁平化）。以下依優先級排序，先修地基、再補真缺口。

### 🔴 P0 — 地基造假，必須先修（否則後續功能都建立在假資料上）

- [x] **符號級關係鏈結（node_links 扁平化）** — ✅ 2026-07-06 已修復。[sqlite-graph.repository.ts](../lib/core/src/services/sqlite-graph.repository.ts) 的 `persistAstGraph` 新增 `symbolIdMap`（逐檔案記錄 function/class 名稱 → node id），`processLink` 現在優先解析呼叫端/目標端的實際 symbol node，只有在對方不是被追蹤的 function/class 時才退回檔案節點；並保留了增量分析情境下的 DB fallback 查詢。已擴充 [sqlite-graph.repository.unit.test.ts](../lib/core/src/services/sqlite-graph.repository.unit.test.ts) 斷言 `implements`/`extends` 邊指向的是 symbol node id 而非檔案 node id，作為回歸守門。
- [x] **TypeScript `implements`/`extends` Parser**（[roadmap TODO](gitbook/roadmap/features/typescript-implements-extends-parser.md)）— ✅ 2026-07-06 查證：roadmap 這條 TODO 是**過時資訊**，[ast-worker.ts](../lib/core/src/workers/ast-worker.ts) 早就用 tree-sitter query 提取了 `sourceFunction`/`sourceClass`/`targetSymbol` 等符號級資料，且 `ScopeResolver.resolveCall` 也已回傳 `targetSymbol`。真正遺失資料的是持久層（見上一項），parser 端不需要額外開發。建議之後順手把 roadmap 該項目狀態改成 Done 並更新 evidence 欄位。
- [x] **核心介面 `any[]` 類型安全洞**（[analyzer.interfaces.ts](../lib/core/src/interfaces/analyzer.interfaces.ts)）— ✅ 2026-07-06 已修復。新增 `DiscoveredFile`、`ParsedAstFileResult`、`ParsedAstFileData`（重用 `ast-worker.ts` 的 `AstParseResponse["data"]`），移除 `IFileDiscovery`/`IGraphDatabaseRepository`/`IAstProcessor`/`IL3ExtractionJob` 四個介面方法簽名上的 `any[]`，並同步更新 3 個實作類別。`tsc --noEmit`（lib/core、api-server）與 `detect_changes` 皆已核實範圍符合預期。

### 🟠 P1 — Local-first 核心體驗的真缺口

- [ ] **Interactive Topology Maps**（[roadmap Planned](gitbook/roadmap/features/interactive-topology-maps.md)，Phase 5 唯一未完成項目）— 📝 2026-07-06 已定義實作方案（仿 graphify 的三層匯出模式：機器可讀 `topology.json` + 自包含離線 `topology.html` + kg-engine Dashboard 頁），完整計畫見 [implement_interactive-topology-maps.md](ai_plans/implement_interactive-topology-maps.md)。L3 決策節點作為獨立節點型別呈現（人機可讀決策圖），blast radius 高亮直接受惠於已修復的 symbol-level node_links。尚未動工。
- [x] **降低 LSP 冷啟動脆弱性** — ✅ 2026-07-06 已修復。查證後發現實際情況跟原本假設不完全一樣：真正掛在生產路徑上的「Progressive Enrichment」（[query-service.ts](../lib/core/src/services/query-service.ts) 的 `getImpact` → [lsp-enrichment-service.ts](../lib/core/src/services/lsp-enrichment-service.ts)）用的是**進程內**的 `ts.createLanguageService`，不是外部 `typescript-language-server` 子行程（那份會 spawn 子行程的 `LspClientManager`/`LspClient` 完全沒有任何呼叫端，是孤兒程式碼）。真正的脆弱點有兩個：(1) `getImpact` 每次呼叫都 `new LspEnrichmentService(...)`，VS Code hover provider **每次 hover 都重新 cold-start** 一次完整 TS 專案圖；(2) 找不到/解析失敗 tsconfig.json 時會直接 `throw`，把整個 blast radius 查詢一起打掛，而非只跳過 LSP 加強部分。已修：新增以 workspace root 為 key 的模組級 LanguageService 快取（同時把 `getScriptVersion` 從恆定 `"0"` 改成用檔案 mtime，避免快取重用後吃到過期 AST）；`initLanguageService`/`findReferences` 內部全面 try/catch 改為記錄 log 並回傳 `[]`，`query-service.ts` 呼叫端再加一層防禦性 try/catch。新增 [lsp-enrichment-service.unit.test.ts](../lib/core/src/services/lsp-enrichment-service.unit.test.ts) 驗證「無 tsconfig 時優雅降級」與「同一 workspace 兩個實例共用同一份 LanguageService」皆成立。`detect_changes` 核實只影響 `ProvideHover`/CLI MCP `Handler` 這兩條真正呼叫鏈。
- [x] **Token Optimization & Compression 覆核** — ✅ 2026-07-06 已修復，矛盾原因找到了：專案裡其實存在**兩份重複實作**。[lib/ast-core/src/compression.ts](../lib/ast-core/src/compression.ts) 有完整的 dedup → confidence 排序 → budget-aware assembly 管線，但從未被匯出到 `@workspace/ast-core` 的公開入口，完全是孤兒程式碼；真正掛在生產路徑（`knowledge-generation-pipeline.ts`）上的是 [lib/core/src/utils/compression.ts](../lib/core/src/utils/compression.ts) 裡那份陽春的「依序截斷」版本——沒有去重、沒有信心分數排序，這才是矩陣評 15 分的真正原因。已將 ast-core 版本加入其 `index.ts` 匯出，並讓 lib/core 那份改為委派呼叫（保留原本對外的型別名稱與預設值，避免破壞 `@workspace/core` 的公開 API），新增 [compression.unit.test.ts](../lib/core/src/utils/compression.unit.test.ts) 驗證去重與信心優先截斷確實生效。`detect_changes` 核實只多影響了 `ExecuteKnowledgeGeneration → CompressAstContext` 這一條流程，符合預期。

### 🟡 P2 — 補強但非阻塞

- [x] **`@workspace/core` dist 型別聲明過期（已知錯誤）** — ✅ 2026-07-06 已修復。做完 P0 型別安全修復後重跑 `artifacts/cli` typecheck，發現 `sync.ts` 匯入 `LocalOrphanBranchWriter` 失敗；查證後這不是真的漏匯出（`lib/core/src/index.ts` 本來就有 `export * from "./services/local-orphan-branch-writer.js"`），而是 `lib/core/dist/index.d.ts` 是舊的建置產物、沒跟上 src 變動。重跑 `tsc --build --force` 後，浮現另一個被 `any[]` 長期掩蓋的**真實型別錯誤**：[ast-event-mapper.ts](../lib/core/src/utils/ast-event-mapper.ts) 的 `mapAstToEvents` 型別簽名寫成 `data: AstParseResponse`（完整封包），但函式內部其實是用 `data as any` 直接存取 `.classes`/`.functions`/`.imports`/`.calls`——本來就應該是 `AstParseResponse["data"]`（也就是這次 P0 新增的 `ParsedAstFileData`）。已修正型別簽名並移除 `as any`，純型別修正、執行期行為不變（`sync.ts` 呼叫路徑本來存取的欄位就對，只是型別標錯）。`lib/core`、`artifacts/cli`、`vscode-client`、`api-server` 四邊 `tsc --noEmit` 全過，`detect_changes` 核實只多影響 `mapAstToEvents` 一個符號。
- [ ] **測試環境路徑解析 bug** + **整合測試強依賴 Docker Postgres/pgvector** — 不影響功能本身，但會拖慢驗證 P0/P1 修復的速度，建議先修好以形成快速驗證迴圈（見建議 5）。
- [ ] **Cross-Repo & Group Analysis**（矩陣評 0 分）— 偏「多專案知識圖譜」而非嚴格的 local-first UI/UX，待 P0/P1 穩定後再評估。

**建議執行順序**：P0 三項合併成一個 PR（先補型別 → 改 parser → 改 node_links 寫入邏輯），讓 impact 分析與 blast radius UI 有真資料可用；接著做 Interactive Topology Maps 讓真資料「看得見」；最後處理 LSP 脆弱性與 token 優化，補齊 local-first 的離線可靠性。
