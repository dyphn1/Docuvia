# 06. 增量更新與快路徑 (Incremental Delta Updates)

**嚴重程度:** 🟡 MEDIUM
**對標競品:** `GitNexus` (極速 DAG 重構)

## 殘酷現狀與對比
我們設計了 `post-commit` Git Hook 來觸發背景萃取。這解決了「Commit 時」的知識更新。
但現代 AI 輔助開發的節奏更快。開發者通常是「邊寫 Code，AI 邊在背後給建議」。如果我們只有在 `git commit` 時才更新本地 SQLite，那 AI 讀到的知識永遠是「上一個 Commit」的狀態。

`GitNexus` 和 VS Code LSP 具備「Sub-second Incremental Watch」的能力，檔案一存檔 (File Save)，甚至只是打字，記憶體內的樹就更新了。

## 評估得分
*   Docuvia: 5 / 10
*   競品平均: 8 / 10

## 必須實作的修正方案
1.  **VS Code `onDidSaveTextDocument` 整合**：VS Code Extension 必須在開發者按下 `Ctrl+S` 時，啟動極輕量的「Fast-Path AST Update」。
2.  **File Hash Delta 偵測**：只對真正修改過的 AST 節點進行 Diff 比較，即時 `UPDATE` 到本地 SQLite，確保 AI Hook 永遠拿到 0 毫秒誤差的最熱知識。