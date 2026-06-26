# 04. 爆炸半徑與 Token 最佳化 (Blast Radius & Token Optimization)

**嚴重程度:** 🟠 HIGH
**對標競品:** `code-review-graph` (BFS 圖算法), `headroom` (RTK 極致攔截)

## 殘酷現狀與對比
`code-review-graph` 的核心競爭力在於其「Blast Radius (爆炸半徑)」算法。當你修改了一個函數，它能透過本地 SQLite 裡的 Graph Edges (`node_links`) 執行廣度優先搜尋 (BFS)，只把真正受影響的呼叫者 (Callers) 餵給 AI，藉此省下 80% 的 Token。

目前的 Docuvia `query.ts` 實作非常粗糙：它只是用語意去 `LIKE` 搜尋 L2 Module，然後把底下的 Top 5 L3 決策撈出來。這叫「分類過濾」，不叫「拓樸圖譜追蹤」。如果 A 模組依賴 B 模組的底層介面，我們目前的查詢演算法根本抓不出這種跨模組的爆炸半徑。

## 評估得分
*   Docuvia: 4 / 10
*   競品平均: 9 / 10

## 必須實作的修正方案
1.  **實作 Local Graph Traversal**：在 `@workspace/cli` 的 query 邏輯中，必須加入對 `node_links` 表的查詢。
2.  **精準的 AST 依賴解析**：當 AST 解析出 Import/Call Expression 時，必須在本地 SQLite 建立明確的有向邊 (Directed Edges)。當 AI 查詢時，系統應回傳「修改此檔案可能連帶影響的 N 個模組清單」。