# 05. 本地視覺化匱乏 (Local Visualization UI)

**嚴重程度:** 🟡 MEDIUM
**對標競品:** `code-review-graph` (D3.js HTML 生成), `tolaria` (Tauri Desktop App)

## 殘酷現狀與對比
當一個開發者在本地 `git clone` 完專案並萃取出知識後，他會想「看一眼」整體的架構長怎樣。
在 `code-review-graph` 裡，只要下 `uv run code-review-graph visualize`，就能秒產出一張可以用瀏覽器打開的、具備縮放功能的 D3.js 架構關聯圖。

Docuvia 雖然有 `kg-engine` (React Dashboard) 以及 VS Code TreeView，但 TreeView 只能看單純的樹狀文字結構，而啟動 React Dashboard 需要跑 npm dev server，非常麻煩。

## 評估得分
*   Docuvia: 5 / 10
*   競品平均: 8 / 10

## 必須實作的修正方案
1.  **CLI HTML 生成器**：在 `@workspace/cli` 加入 `docuvia visualize`，讀取本地 SQLite 後，直接輸出單檔的 HTML (內含 Mermaid 或 D3.js)，讓使用者點開就能看。
2.  **VS Code 內建 Webview**：將架構視覺化直接寫死成 VS Code Webview Panel，無需啟動 React 伺服器即可在 IDE 內查看動態圖譜。