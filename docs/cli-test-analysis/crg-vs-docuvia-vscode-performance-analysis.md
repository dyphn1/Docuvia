# CRG 與 Docuvia2：VSCode TypeScript 解析效能分析

日期：2026-08-04  
對照基準：[typescript-cli-benchmark.md](./typescript-cli-benchmark.md)

## 1. 摘要

在 `microsoft/vscode` 專案上，現有 benchmark 顯示：

| 工具                     | 結果                                 | 解析／建圖輸出                                      | 時間                                   |
| ------------------------ | ------------------------------------ | --------------------------------------------------- | -------------------------------------- |
| Docuvia2                 | Exit 0（2026-08-04 re-verification） | 292,710 nodes / 379,697 edges                       | 約 1,195.6 秒；AST phase 約 1,057.8 秒 |
| CRG（Code-Review-Graph） | Exit 0                               | 231,462 nodes / 1,593,664 edges / 3,786 communities | 約 440 秒，包含 post-processing        |

表面上兩者解析的檔案數接近，但這不是等價的工作量。CRG 約快 2.4–2.7 倍，較合理的解釋是多個因素疊加：

1. CRG 使用 native Tree-sitter；Docuvia2 使用 `web-tree-sitter` WASM。
2. Docuvia2 的 AST pipeline 會執行較多額外 extraction、symbol hashing 與 parent traversal。
3. Docuvia2 將完整 source code 傳入 worker；CRG 將檔案路徑交給 worker，再於 worker 內讀檔。
4. 兩者的檔案範圍、oversize 規則與 benchmark 計時邊界並不完全一致。
5. CRG 的 per-file graph persistence 使用 SQLite transaction；Docuvia2 目前主要依靠 write lock，寫入方式較細粒度。

目前可以確認的是「架構與工作內容存在顯著差異」，但尚未有同一份 manifest 下的逐階段 profiling，因此不能把全部差距歸因於單一因素。

## 2. Benchmark 資料與可比性

### 2.1 檔案數接近，但不是相同輸入

Docuvia2 在 2026-08-04 的 re-verification 記錄：

```text
filesRequested:       12338
filesParsed:          12334
filesFailed:              4
filesSkippedOversized:    5
```

Docuvia2 的 discovery layer 對超過 512 KB 的檔案會跳過；這 5 個檔案與 log 中的 `filesSkippedOversized: 5` 一致，規則位於 [`file-discovery.service.ts`](../../lib/core/src/discovery/file-discovery.service.ts)。

CRG 的 `collect_all_files()` 使用 `git ls-files`、ignore 規則、binary 檢查與語言偵測，但目前沒有相同的 512 KB source-file 上限，見 `D:\GitHub\code-review-graph\code_review_graph\incremental.py` 的 `collect_all_files()`。因此，CRG 很可能至少包含 Docuvia2 跳過的 5 個大型檔案。

這個差異不太可能單獨解釋數倍效能差距，但代表「解析數量差不多」不能直接視為兩邊使用了相同輸入。正確比較還需要固定並保存同一份相對路徑 manifest，另外核對總 source bytes。

### 2.2 計時範圍不完全相同

Docuvia2 的約 1,195.6 秒是從 init 開始到完成的 end-to-end 時間，其中 AST phase 約 1,057.8 秒。

CRG 的約 440 秒則是完整 build 時間，包含：

- AST parsing 與 extraction
- graph storage
- signature／endpoint resolution
- FTS5 建立
- flow analysis
- Leiden communities

因此，CRG 的 440 秒不是純 parser 時間；但它已經包含完整 post-processing，仍然低於 Docuvia2 的 AST phase。另一方面，目前沒有 CRG 的 raw parse、extraction、storage、post-processing 四段獨立計時，所以不能精確知道 440 秒各自花在哪裡。

## 3. 最重要的差異：parser runtime

### 3.1 CRG 使用 native Tree-sitter

CRG 的依賴是 Python native `tree-sitter` 與 `tree-sitter-language-pack`。其 parser 在 native runtime 執行，並使用最多 8 個 parse workers。`_parse_single_file()` 傳入的是檔案路徑；worker 自己讀 bytes、計算 file hash，再呼叫 `parse_bytes()`。

相關實作：

- `D:\GitHub\code-review-graph\code_review_graph\incremental.py`：`_MAX_PARSE_WORKERS`、`_parse_single_file()`、`full_build()`
- `D:\GitHub\code-review-graph\code_review_graph\parser.py`：`CodeParser.parse()` 與 `_extract_from_tree()`

### 3.2 Docuvia2 使用 WASM Tree-sitter

Docuvia2 使用 `web-tree-sitter` 與 `tree-sitter-wasms`。每個 Node worker 會初始化 parser，再將 source code 傳入 `parseAndExtract()`；目前機器上 Docuvia2 使用約 13 個 Node workers。

相關實作：

- [`ast-worker.ts`](../../lib/core/src/ast/ast-worker.ts)：`Parser.init()`、`Language.load()`、`parseAndExtract()`
- [`ast-processing.service.ts`](../../lib/core/src/ast/ast-processing.service.ts)：worker pool 與任務派送

WASM 不代表一定慢，但在大型 TypeScript 專案上，native parser 通常具有較低的 parser invocation 與 runtime overhead。Docuvia2 還需要支付 worker-thread data transfer、WASM memory 管理與 extraction layer 的額外成本。因此，這是目前最有力的主要原因，但仍需 microbenchmark 才能量化它佔總差距的比例。

## 4. Docuvia2 的單檔工作量較重

Docuvia2 的 pipeline 不只建立 AST，還會在同一棵 tree 上執行多種語意抽取。

### 4.1 多個 provider extraction

目前 TypeScript provider 包含 classes、functions、imports、calls、implements 與 extends 等 extraction。TypeScript 的 functions 尚未使用 compiled query，而是對多個 node type 使用 fallback traversal；這可能導致同一棵 tree 被重複掃描。

此外，`extractAstData()` 還會掃描 worker spawns。這些工作都發生在 parser 完成後，不能只用「解析檔案數」描述成本。

相關實作：

- [`ast-worker.ts`](../../lib/core/src/ast/ast-worker.ts)：`extractAstData()`、`collectClassNodes()`、`collectFunctionNodes()`、`collectCallEdges()`
- [`language-provider.ts`](../../lib/ast-core/src/language-provider.ts)：query capture 與 fallback extraction
- [`typescript.ts`](../../lib/plugins-ast/src/languages/typescript.ts)：TypeScript node types 與 queries

### 4.2 per-symbol content hash

Docuvia2 對每個 class/function 的 source text 計算 SHA-256：

```ts
createHash("sha256").update(node.text).digest("hex");
```

CRG 目前主要在每個檔案層級計算一次 file hash，而不是對每個 symbol 各自計算 content hash。當 VSCode 有大量 class/function、且 symbol source text 較大時，這會形成可觀的額外 CPU 與 memory bandwidth 成本。

這個差異是程式碼中直接可見的工作量差異，但尚未被單獨計時，因此目前應視為「已確認存在的成本來源」，不能直接宣稱它佔了多少秒。

### 4.3 parent traversal

Docuvia2 在解析 function 與 call 時，會向上走 parent chain，以找出 enclosing class/function 或 callable name。CRG 的主要 generic traversal 則把 `enclosing_class` 與 `enclosing_func` 作為遞迴 context 傳遞，通常不需要對每個節點重新向上尋找。

這是兩種 traversal 設計的差異：Docuvia2 偏向多個 provider extraction，CRG 偏向單次 recursive walk 加上後續專門 pass。

## 5. Worker 邊界與平行化差異

### 5.1 傳輸的資料量不同

Docuvia2 的 task request 包含完整 `code` 字串，主程序與 worker 之間需要 structured clone。大型 TypeScript 檔案會帶來額外的 memory copy 與 serialization/deserialization 成本。

CRG 的 `_parse_single_file()` 只接收 `(relative_path, repo_root)`，檔案內容在 worker 內直接讀取，因此不需要把完整 source 從 parent process 複製到 worker。

相關實作：

- [`ast-worker-pool.ts`](../../lib/core/src/ast/ast-worker-pool.ts)：request dispatch 與 worker message
- `D:\GitHub\code-review-graph\code_review_graph\incremental.py`：`_parse_single_file()` 與 `executor.map()`

### 5.2 Worker 數量不是直接的效能答案

Docuvia2 目前約 13 個 Node workers；CRG 預設最多 8 個 workers。較多 worker 不代表一定較快，因為瓶頸可能落在 WASM、structured clone、記憶體頻寬或同時處理大型檔案造成的 contention。

另外，Docuvia2 的 language cache 是「每個 worker 一份」，不是整個 process pool 共用一份；這可避免每個檔案重新載入 grammar，但仍有多個 worker 各自初始化 grammar 的固定成本。

因此，原 benchmark §7 中「`Language.load()` 每個檔案重新載入、完全沒有 cache」的敘述已不符合目前 source；應改成「目前已有 per-worker cache，仍需要 live re-time 驗證其實際成本」。

目前 `ast-processing.service.ts` 也已改為把所有 task 提交給 pool，不再是舊報告所述的固定 50 檔 `Promise.all` batching。這一點同樣不應再作為目前效能差距的確定原因。

## 6. Graph output 也顯示兩邊不是相同抽象

此次結果為：

```text
Docuvia2: 292,710 nodes /   379,697 edges
CRG:      231,462 nodes / 1,593,664 edges
```

CRG 的 edges 約為 Docuvia2 的 4.2 倍，但整體仍較快。這表示 CRG 並不是單純因為「產出較少」而快；兩邊的 node／edge schema、deduplication、resolver 與關係語意不同，不能只用數量判斷工作量。

CRG 的 graph storage 會對每個檔案以 `BEGIN IMMEDIATE` 包住該檔案的 nodes/edges 寫入，完成後 commit。Docuvia2 的 graph persister 使用 write lock，但目前不是一個涵蓋整個 per-file persist 的 SQLite transaction，並且有較多細粒度 statement。

這可能造成 end-to-end tail 的差異，但目前 benchmark 的 Docuvia2 AST phase 已接近 1,058 秒，因此不能在沒有 stage timing 的情況下，把 persistence 當成主要 parser 慢速原因。

## 7. 目前結論的可信度

### 已由程式碼或 benchmark 直接支持

- CRG 使用 native Tree-sitter；Docuvia2 使用 WASM Tree-sitter。
- Docuvia2 的 extraction pipeline 有多個 query/fallback traversal。
- Docuvia2 對 symbol 計算 content hash；CRG 主要對 file 計算 hash。
- Docuvia2 將完整 source code 傳入 worker；CRG 傳檔案路徑並在 worker 讀檔。
- Docuvia2 跳過 5 個超過 512 KB 的檔案；CRG collector 沒有相同上限。
- CRG 的 440 秒包含 post-processing；Docuvia2 的 1,057.8 秒是主要 AST phase。
- CRG 的 output edges 明顯多於 Docuvia2。

### 尚未由實測量化

- native Tree-sitter 與 WASM Tree-sitter 各自佔多少時間。
- symbol hashing 佔 Docuvia2 AST time 的比例。
- structured clone source code 的傳輸成本。
- Docuvia2 query/fallback traversal 各自的時間。
- CRG raw parse、extraction、storage、post-processing 各自的時間。
- worker 數量、冷／暖 page cache 與相同 manifest 對結果的影響。

## 8. 建議的下一輪驗證

要把「合理解釋」變成可量化結論，建議依序做以下測試：

1. **固定輸入 manifest**：由 git commit 產生同一份相對路徑清單，兩個工具都使用相同檔案；同時記錄檔案數、總 bytes、p50/p90/p99 與 oversize 檔案。
2. **對齊計時邊界**：分別記錄 discovery、parse、extraction、worker transfer、persistence 與 post-processing；CRG 另記錄 raw parse 與 post-process。
3. **Docuvia2 單檔 instrumentation**：分開測量 `parser.parse()`、provider queries、symbol hash、worker message transfer。
4. **CRG 單檔 instrumentation**：分開測量 native parse、tree extraction、typed-call pass、result serialization 與 SQLite storage。
5. **控制 runtime 變數**：在 cold page cache、warm page cache、固定 worker 數量下各跑一次，避免把第二次 warm run 當成穩態基準。
6. **比較 extraction 模式**：以相同檔案 manifest 測試 Docuvia2 是否在停用 symbol hash 或減少 fallback traversal 後，接近 CRG 的時間。
7. **重新量測 language cache**：現有 cache 已存在，重點不是再證明「有沒有 cache」，而是確認 grammar initialization 在每個 worker 的實際一次性成本，以及它對整體時間的比例。

## 9. 最終判斷

CRG 比 Docuvia2 快近一倍以上，最可能不是單一 bug，而是以下組合：

```text
native Tree-sitter
+ 較低的 worker data-transfer 成本
+ 較少的 per-symbol 工作
+ 不同的 traversal/extraction 設計
+ per-file SQLite transaction
+ 略有不同的檔案範圍
```

其中，**native parser runtime + Docuvia2 較重的 AST extraction 工作量**是目前最可信的主因；**檔案數接近**並不足以代表兩邊的 CPU、memory 與 I/O 工作量接近。

本報告沒有修改任何 parser 或 benchmark implementation；下一步應先補齊逐階段 profiling，再決定是否值得針對 WASM、symbol hashing、query traversal 或 worker transport 做優化。
