# 01. 本地 MCP 伺服器缺失 (Local MCP Server Locked in Express)

**嚴重程度:** 🔴 CRITICAL
**對標競品:** `code-review-graph` (內建本地 FastMCP)、`GitNexus` (內建 `serve` 模式)

## 殘酷現狀與對比
在 `code-review-graph` 中，MCP 伺服器是直接透過 `stdio` 執行的 (`uv run code-review-graph serve`)，這意味著 Cursor 或 Claude Desktop 可以完全在背景無縫喚起它，不需要佔用任何 Port，也不需要啟動龐大的後端伺服器。

反觀目前的 Docuvia，MCP 的實作竟然綁死在 `artifacts/api-server/src/routes/mcp.ts` 裡面！
這代表如果一個開發者想在本地用 Cursor 呼叫 Docuvia 的知識圖譜，他必須：
1. 打開終端機。
2. 進入 `artifacts/api-server`。
3. 執行 `pnpm run dev` 啟動一個帶有 Express、CORS、Rate Limiting 的笨重伺服器。
4. 設定網路 Port。
這根本不是 Local-First，這叫 **Local-Server-Required**。這會讓開發者的使用意願降到 0。

## 評估得分
*   Docuvia: 1 / 10
*   競品平均: 9 / 10

## 必須實作的修正方案
1.  **抽離 MCP 邏輯**：將 `mcp.ts` 裡面的 Tools 定義（如 `Search Knowledge`, `Get Dependencies`）從 API Server 抽離，放到一個共用的 `lib/` 或是直接搬進 `@workspace/cli` 中。
2.  **CLI 實作 `stdio` 伺服器**：在 `@workspace/cli` 新增 `docuvia mcp` 指令，使用 `@modelcontextprotocol/sdk/server/stdio` 實作。
3.  **無縫整合 Cursor/Claude**：讓 `docuvia init-agent` 產生的配置，除了 PreToolUse 攔截器外，還能自動將 `docuvia mcp` 註冊進使用者的 MCP Servers 清單中。