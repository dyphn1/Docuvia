# Docuvia 嚴格本地化能力評估 (Strict Local-First Evaluation)

**自評分數：3 / 10 (流程破碎，尚未具備真正的端到端本地能力)**
**評估日期：2026-06-27**

在重新審視工作區內的其他頂尖開源專案（`GitNexus`, `code-review-graph`, `headroom`, `tolaria`）後，我們必須誠實面對 Docuvia 目前的技術債。儘管我們確立了「VCS 知識演化器」的定位，且完成了 CLI 的初步重構，但**整體流程尚未串連 (Disjointed Pipeline)**。

如果開發者現在 `git clone` 這個專案，他們無法順暢地在斷網環境下體驗從「初始化 -> 寫扣 -> 背景萃取 -> AI 提問 -> MCP 攔截」的端到端 (End-to-End) 流程。

為確保 Docuvia 的 Local-First 體驗能達到 8~9 分的業界頂尖水準，我們將現存的致命傷與橫向對比的不足，拆解為以下 6 份急需解決的評估文件：

| ID | 評估面向 (Evaluation Area) | 嚴重程度 | 核心問題摘要 |
| :--- | :--- | :--- | :--- |
| **01** | [本地 MCP 伺服器缺失 (Local MCP Server)](./01-local-mcp-server.md) | 🔴 **CRITICAL** | MCP 路由被鎖死在 Express API Server 中，無法透過 `stdio` 在本地零負擔運行。 |
| **02** | [端到端資料流斷層 (End-to-End Flow)](./02-end-to-end-flow-integration.md) | 🔴 **CRITICAL** | Hook 攔截與 CLI 查詢已就位，但本地 AST 背景萃取寫入 `.docuvia/local.db` 的管線尚未自動化打通。 |
| **03** | [解析引擎效能妥協 (Parsing Performance)](./03-parsing-performance-wasm.md) | 🟠 **HIGH** | 盲目尊崇 WASM 導致初次掃描大型專案過慢，缺乏 Native C++ 或 Rust 級別的效能降級/升級機制。 |
| **04** | [爆炸半徑與 Token 最佳化 (Blast Radius Optimization)](./04-blast-radius-token-optimization.md) | 🟠 **HIGH** | 僅做單層 `LIKE` 搜尋，缺乏像 `code-review-graph` 的本地 BFS 圖算法來精準限縮 Token。 |
| **05** | [本地視覺化匱乏 (Local Visualization UI)](./05-local-visualization-ui.md) | 🟡 **MEDIUM** | 缺乏本地原生的圖譜渲染能力（如 D3.js 輸出或輕量 Webview），依賴龐大的 `kg-engine` Dashboard。 |
| **06** | [增量更新與快路徑 (Incremental Delta Updates)](./06-incremental-delta-updates.md) | 🟡 **MEDIUM** | Git Hook 已掛載，但針對單一檔案儲存 (File Save) 的 Sub-second AST 快速更新機制尚未完善。 |

---
**下一步行動：** 我們將以這 6 份文件為基準，優先從 `01` 與 `02` 開始實作，確保骨幹流程完全貫通。