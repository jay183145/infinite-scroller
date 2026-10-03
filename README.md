# Data management system

kyle 的專案

## Search 流量從 5/min 暴增到 500/min

> After deployment, Search requests was 5/minute, after 1 week jumps to 500/min. You must do a quick fix now. What options do you have? And which one do you pick?

### 1. 先看 log，不要直接動手

流量暴增 100 倍，原因可能是下面三種之一，修法完全不同：

- **使用者真的變多了**：這是好事，不該擋。
- **前端 bug**：缺少 debounce、infinite scroll 一直重複觸發、失敗後無限 retry。
- **爬蟲或濫用**：少數幾個 IP 或 token 打了大部分流量。

做法：把 request 按 IP、user、User-Agent、query 分組，看是不是集中在少數來源。

### 2. 可選的方案

#### 前端

前端方案能從源頭減少 request，但共同的限制是：要重新部署才生效，使用者手上舊版頁面的 cache 不會馬上更新，也擋不住直接打 API 的爬蟲。

| 方案 | 優點 | 缺點 |
| --- | --- | --- |
| F1. 調整 debounce（300ms → 400～500ms），並加最少字數限制 | 打字造成的 request 直接變少，改動很小 | 回應感覺稍慢 |
| F2. 用 `AbortController` 取消舊請求 | 前端不會處理過期結果，畫面不會錯亂 | request 已經送到後端，後端照樣會處理，**不會減少後端負載** |

#### 後端

後端方案的共同優點：不必等使用者更新頁面，對所有來源（包含爬蟲）都有效。

| 方案 | 優點 | 缺點 |
| --- | --- | --- |
| B1. 在 API Gateway / CDN / WAF 設 rate limit（每個 IP 或 user，超過回 429） | 改設定就好，幾分鐘生效，不管原因是什麼都能保護後端，隨時可以撤掉 | 門檻設太低會擋到真人 |
| B2. 快取熱門 query 的結果（Redis / CDN） | 重複查詢的成本大幅下降 | 要改程式；query 很分散時效果有限 |
| B3. 封鎖異常來源，或要求登入才能搜尋 | 確定是爬蟲時最直接 | 要先從 log 確認來源；對方換 IP 就要再處理 |

### 3. 怎麼選：看能不能和後端配合

#### 能和後端溝通：首選 B1（rate limit）

- 要「馬上」止血，後端方案優先於前端：前端要部署，還要等使用者重新整理才生效，也擋不住爬蟲。
- B1 **不用部署程式碼**，而且不管原因是 bug、爬蟲還是使用者變多，都能保護系統，也可以隨時撤掉。
- 門檻設寬鬆，例如每個 IP 每分鐘 30～60 次。正常人有 debounce 的情況下打不到這個數字，所以只會擋到異常來源。
- 如果 log 已經確定是爬蟲，可以同時上 B3。

#### 不能和後端配合（只能動前端）：次要選擇 F1

- F1 改動最小、風險最低，可以馬上部署：加最少字數限制，視情況把 debounce 調長。
- 要先講清楚限制：前端修正只對更新後的頁面有效，**擋不住爬蟲**。如果查出是爬蟲，還是要回頭找後端或維運處理。

#### 止血之後

- 依 log 查到的原因做根本修正：前端 bug 就上 F1，爬蟲就上 B3，真實成長就做 B2 和容量規劃。
- 補充：500 次/分鐘大約只有每秒 8 次。要先確認後端是真的撐不住，還是成本或異常的問題。

### 4. 套用到這個專案：哪些地方會放大 request 數

目前搜尋由 [`mockEmployeeRepository`](src/data/mockEmployeeRepository.ts) 和 Web Worker 在瀏覽器裡完成。下面假設 `getPage()` 之後換成真的 API，所以每呼叫一次 `getPage()` 就是一次 search request。這樣看，流量暴增不一定是使用者變多，也可能是一個操作被放大成幾十次 request。

| 優先 | 位置 | 問題 | 調整 |
| --- | --- | --- | --- |
| 🔴 | [`HomeView.vue`](src/views/HomeView.vue) 的 `reloadLoadedRange()` | 編輯、刪除或 PIN 之後，從受影響的那批一路重抓到已載入的筆數。捲到第 20,000 筆時改一筆資料，就會連發 40 次 request（20,000 ÷ 500）。 | 只重抓受影響的那一頁，或在本地直接更新那一列；超出畫面的部分標記為過期，捲到時再抓。 |
| 🔴 | [`HomeView.vue`](src/views/HomeView.vue) 的 `loadMore()` 和 `continueLoadingIfNeeded()` | 搜尋時每 500 筆（`PAGE_SIZE`）就是一次搜尋 request。用 offset 分頁時，後端每次都要重新算一遍搜尋結果。 | 改用 cursor 分頁；自動接續載入設上限（連續 N 批後改成按鈕「載入更多」）；對 `loadMore` 加 throttle。 |
| 🟡 | [`HomeView.vue`](src/views/HomeView.vue) 的 `searchInput` watch | 沒有最少字數限制。只打 1 個字元就搜尋全部欄位，在 1,000 萬筆資料裡幾乎每筆都符合，是最貴的全表掃描。 | 文字欄位至少 2 個字元才送出（年齡、資料編號例外）；debounce 可從 300ms 調到 400～500ms。 |
| 🟢 | [`mockEmployeeRepository.ts`](src/data/mockEmployeeRepository.ts) 的 `runEmployeeQuery()` | 目前直接終止 Worker 來取消查詢。換成 API 後，取消只是前端不收結果，request 已經送到後端，後端照樣會處理。 | 改用 `fetch` 搭配 `AbortController`。真正能減少 request 數的是最少字數和 debounce。 |
| 🟢 | 全域 | 沒有埋點，查不出是哪個操作讓流量變多。 | 每次 request 帶上 `X-Trigger` header（`typing` / `enter` / `scroll` / `reload` / `sort`），dashboard 就能看出流量來自哪裡。 |

**已經做到的保護：**

- 打字有 300ms debounce（`SEARCH_DEBOUNCE_MS`），內容沒變不會重送。
- 用 `latestPageRequestId` 丟掉過期的回應，舊結果不會蓋掉新結果。
- `loadMore` 失敗後就停止，不會無限 retry。
- 沒有搜尋條件、而且照資料編號排序時，直接依索引分頁，不必全量掃描。

**後端（換成真 API 才需要）：**

- Gateway / WAF 依 IP 或 user rate limit：最快的止血方式。
- Redis / CDN 快取熱門 query 的結果，第一頁的效益最高。
- 搜尋全部欄位做部分比對，在 1,000 萬筆上等於全表掃描，要靠全文索引（Postgres `pg_trgm`、Elasticsearch / Meilisearch）。
- 用 cursor / keyset 分頁取代 offset，避免越往後翻越慢。

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```
