# 03. 解析引擎效能妥協 (Parsing Performance: WASM vs Native)

**嚴重程度:** 🟠 HIGH
**對標競品:** `GitNexus` (C++ 極速解析), `code-review-graph` (Python C-binding)

## 殘酷現狀與對比
`GitNexus` 與 `code-review-graph` 在處理本地 AST 解析時，為了極致的掃描速度，預設使用 Native C++ 綁定 (如 Node-API 或 Python bindings)，只在編譯失敗或跨平台受限時 fallback 到 WASM。

而 Docuvia 在 `ADR-020` 中，為了解決「Split-brain (雙端 Hash 不一致)」的問題，強制所有解析（包含 VS Code Client 與 Server）都必須使用 `tree-sitter.wasm`。
在初次掃描百萬行級別的大型專案時，WASM 的效能可能比 Native 慢上數倍，這會導致開發者的電腦風扇狂轉、佔用大量記憶體，嚴重影響本地 IDE 的流暢度。

## 評估得分
*   Docuvia: 4 / 10
*   競品平均: 9 / 10

## 必須實作的修正方案
1.  **重新評估 WASM 唯一性**：研究是否能引入 Native 引擎作為 CLI 的預設選項（因為 CLI 是運行在 Node 環境而非 Browser）。
2.  **Worker Pool 最佳化**：如果堅持使用 WASM，必須實作極度強悍的 `worker_threads` Pool 來做併發處理 (Concurrency)，並嚴格限制記憶體上限，避免擠爆本機記憶體。