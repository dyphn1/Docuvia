# Architecture Review Action Plan

**Date:** 2026-06-07  
**Author:** Architect / System  
**Scope:** Whole system architecture, specifically focusing on `vscode-client` and Knowledge Flow

Based on the ChatGPT 5.4 architecture review and rigorous self-reflection, we have identified three critical areas that require immediate closure to transition Docuvia from a prototype to a trustworthy system.

## 核心痛點總結 (Core Pain Points Summary)
1.  **架構願景與驗證落差 (Verification Debt)**：系統擁有極佳的架構意圖，但底層實作的驗證證據嚴重不足。
2.  **VS Code Client 的 Multi-root 語意破壞**：過度依賴 `workspaceFolders[0]`，破壞了多工作區邊界的隔離。
3.  **知識流未閉環 (Broken Knowledge Flow)**：Extraction 流程會產生孤兒節點（缺少 L2 Module 關聯）；Local Search 過於依賴字面比對，導致編輯器喚醒機制（Hover/CodeLens）薄弱。

## 執行計畫 (Execution Plan)

### 階段一：根除單一工作區偏見 (Eradicate Single-Root Bias)
*   **目標**：徹底移除 VS Code Client 中對 `workspaceFolders[0]` 和全域 `store.snapshot` 的過度依賴。
*   **介面呈現策略 (UI State Strategy)**：採用樹狀/動態節點擴充 (Tree-Node Expansion)，遵循 VS Code 原生 Workspace 排列順序實現視覺與狀態隔離。
*   **Actionable Step for Subagents**: 
    *   **Frontend / VS Code Developer**: Update `KnowledgeStore` and Tree Providers to map by `WorkspaceFolder` URI. Remove all hardcoded `workspaceFolders[0]` accesses.

### 階段二：閉環知識流與杜絕孤兒節點 (Close the Knowledge Flow)
*   **雙軌抽取機制與自我適應分類**：
    *   大規模抽取：Track B (寬容模式)，寫入 `sys-uncategorized` 收容所。
    *   單一片段抽取：Track A (嚴格模式)，當下決定歸屬，配置化降級鏈 (A2>A1>A3)，並回顧 `git log` 歷史。
*   **實體化 Inbox (取代空值)**：資料庫與 Schema 嚴格禁止 `l2_module_id` 為空。
*   **多層次過篩器與權重計分降解 (Multi-stage Sieve Model)**：利用 `(Git歷史 W1 + AST依賴 W2 + 目錄結構 W3 + 語意向量 W4)` 綜合計分，尋找 Inbox 檔案的規律並自動推導 L2。
*   **Actionable Step for Subagents**: 
    *   **Database Schema Expert**: Alter DB schema to ensure `l2_module_id` is non-nullable. Create a systemic default `sys-uncategorized` module.
    *   **Backend Developer**: Implement Track A & Track B extraction logic and the multi-stage sieve scoring system in `@workspace/api-server`.

### 階段三：深化程式碼上下文喚醒機制 (Deepen Editor Context Awakening)
*   **快取區間樹與語言無關錨點 (Interval Tree Caching)**：放棄低效的字串比對，建立背景 AST 區間樹快取。Hover 觸發時只做 `(Line, Col)` 的 O(log N) 座標查詢，依賴標準 LSP `SymbolKind` 確保跨語言支援。
*   **禁止 Hover 內推論 (No-LLM-in-Hover Rule)**：Hover 必須是絕對純粹的記憶體讀取（無延遲）。Small Agent 的語意泛化推論全部移至背景 Indexer，提前計算「模糊錨點」供 Hover 讀取，避免榨乾本機 CPU 或觸發 Rate Limit。
*   **基於狀態同步的自癒 (State-Sync Self-Healing)**：不依賴不可靠的 VS Code Rename UI 事件。自癒任務綁定 File System Watcher 或 Git Sync，當發現 Hash 改變時，利用差異分析 (Diff Analysis) 找回因重構或外部 `git pull` 而斷鏈的 AST 錨點。
