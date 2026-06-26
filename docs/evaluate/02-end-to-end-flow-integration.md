# 02. 端到端資料流斷層 (End-to-End Flow Integration)

**嚴重程度:** 🔴 CRITICAL
**對標競品:** `headroom` (完美攔截), `tolaria` (無縫防護)

## 殘酷現狀與對比
使用者對 Docuvia 給出 3 / 10 的超低自評分，最核心的原因就是：「還沒有辦法把整個流程串起來」。
我們來檢視目前的碎片化現狀：
1.  有 `initProject` 可以建 `.docuvia/local.db`。
2.  有 `init-agent` 可以放 Hook。
3.  有 `docuvia query` 可以查資料庫。
**但是，資料庫裡面的資料從哪裡來？**

目前的 AST 解析器 (AST Microkernel) 與 `local.db` 的對接尚未自動化。如果開發者寫完 Code `git commit`，雖然會觸發 `docuvia sync local`，但實際上本地的 AST 萃取管線（把 Code 轉成 L2/L3 寫入 SQLite）還是一個斷層。沒有資料寫入，那 AI Hook 攔截後查詢到的永遠是空的 `<docuvia_context>`。

## 評估得分
*   Docuvia: 3 / 10
*   競品平均: 8 / 10

## 必須實作的修正方案
1.  **貫通 Ingestion 管線**：必須在 CLI 中實作 `docuvia ingest local` (或完成 `docuvia sync local` 的本地端邏輯)，讓它真正去呼叫 `@workspace/ast-core`，解析當前 Commit 的 Delta，並 `INSERT INTO l2_nodes/l3_nodes`。
2.  **E2E 驗證**：必須能展示一個從 `initProject` -> 寫 Code -> `git commit` -> AI Agent 查詢，一氣呵成的完美流程。