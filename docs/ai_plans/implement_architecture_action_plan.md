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
*   **觸發機制**：Embedded Small Agent + AST (符號指紋與輕量語意)。
*   **AST 錨點自癒機制 (Self-Healing Anchors)**：Hover Provider 保持 O(1) 查表。透過監聽 VS Code `Rename Symbol` 事件與背景非同步重新掛接任務來維護錨點，防止重構導致斷鏈。
*   **Actionable Step for Subagents**:
    *   **VS Code Developer**: Integrate AST-based extraction on the client-side for symbol mapping. Attach `workspace.onDidRenameFiles` and language server rename providers to auto-heal existing L3 anchors.
