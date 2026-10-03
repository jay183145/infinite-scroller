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
| F3. 只在按 Enter 或按鈕時才搜尋，拿掉邊打字邊搜尋 | 前端最有效的止血方式：一次搜尋只送一個 request，不受打字速度影響。改動很小，這個專案已經支援按 Enter 送出（`submitSearch()`），只要拿掉打字自動搜尋的 watch | 失去即時搜尋，使用者要多按一下才看得到結果 |

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
- 如果 F1 降得不夠，或需要立刻大幅降量，就改上 F3（只在按 Enter 時搜尋），用即時搜尋的體驗換取最大的降幅。
- 要先講清楚限制：前端修正只對更新後的頁面有效，**擋不住爬蟲**。如果查出是爬蟲，還是要回頭找後端或維運處理。

#### 止血之後

- 依 log 查到的原因做根本修正：前端 bug 就上 F1 或 F3，爬蟲就上 B3，真實成長就做 B2 和容量規劃。
- 補充：500 次/分鐘大約只有每秒 8 次。要先確認後端是真的撐不住，還是成本或異常的問題。

### 4. 真實接上後端後，PIN TO 的處理方式

- **用 id + 版本號操作，不用位置**：API 改成 `PUT /employees/:id/pin`，帶 `If-Match: <version>` 和目標位置；不再傳目前位置，省掉「先查位置、再寫入」之間的空檔。
- **樂觀鎖**：`UPDATE … WHERE id = ? AND version = ?`，更新 0 筆代表別人已經改過，回 409，避免覆蓋別人的修改。
- **PIN 位置加 unique constraint**：同一個位置只能有一筆 PIN；兩人同時 PIN 到同一個位置時，由資料庫保證只有一個成功，另一個回 409。
- **transaction**：版本號 +1 和 PIN 寫入包在同一個 transaction 裡，一起成功或一起失敗。
- **列表版本號 `revision`**：每次寫入 +1，所有回應都帶上；前端發現版本跳得比自己的寫入次數還多，代表別人改過，就放棄本地優化（範圍重抓、本地移除），改成重新載入。
- **快取**：PIN 和一般資料分開快取，PIN 寫入只清 PIN 的快取，讀取時再合併。
- **前端處理衝突**：收到 409 時顯示「資料已被他人修改，請重新載入」；送出期間停用按鈕，API 加 idempotency key，防止重複送出。

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
