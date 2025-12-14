# 杰哥記帳 - 後端 API

基於 Node.js 與 Google Sheets API 的記帳系統後端服務。

## 功能特色

- 🚀 **Express 伺服器**：輕量高效的 RESTful API
- 📊 **Google Sheets 資料庫**：直接使用 Google Sheets 儲存資料，方便查看與備份
- 🔐 **JWT 認證**：安全的登入與 API 保護機制
- 🌈 **CORS 支援**：允許前端跨域請求
- 🛠️ **完整 CRUD**：支援交易紀錄與類別的新增、讀取、更新、刪除

## 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 設定環境變數

請複製 `.env.example` 為 `.env`，或參考下方設定：

### 3. 啟動伺服器

```bash
# 開發模式 (使用 nodemon)
npm run dev

# 正式啟動
node app.js
```

## Google Sheets API 申請與設定教學

請依照以下步驟操作（有點繁瑣，請耐心做完）：

1. **進入 Google Cloud Console：**
   前往 [console.cloud.google.com](https://console.cloud.google.com/) 並登入你的 Google 帳號。

2. **建立新專案：**
   點擊左上角的專案選單 →「建立新專案」→ 取名為 `My-Expense-Tracker` (或其他你喜歡的名字) → 建立。

3. **啟用 Google Sheets API：**

   - 點擊左上角漢堡選單 (≡) → **API 和服務** → **已啟用的 API 和服務**。
   - 點擊上方 **「啟用 API 和服務」**。
   - 搜尋 `Google Sheets API` → 點擊進入 → 按下 **「啟用」**。

4. **建立憑證 (Credentials)：**

   - 啟用後，點擊右上角的 **「建立憑證」**。
   - **選取 API：** Google Sheets API。
   - **存取資料來源：** 應用程式資料 (Application Data)。
   - 按下「下一步」。

5. **建立服務帳號 (Service Account)：**

   - **服務帳號名稱：** 例如 `sheet-manager`。
   - 你會看到系統生成一個類似 email 的 ID：`sheet-manager@你的專案ID.iam.gserviceaccount.com` (**⚠️ 把這個 email 複製下來，等一下要用**)。
   - 按下「建立並繼續」→ 角色選「擁有者」或是略過 → 完成。

6. **下載金鑰 (JSON)：**

   - 回到「憑證」頁面，下方會看到剛剛建立的服務帳號。
   - 點擊那個 email 進入詳細頁面。
   - 切換到 **「金鑰 (Keys)」** 分頁。
   - 點擊 **「新增金鑰」** → **「建立新金鑰」**。
   - 選擇 **JSON** → 點擊 **「建立」**。
   - **電腦會自動下載一個 `.json` 檔案。這就是你的最高機密鑰匙！請妥善保存，不要傳給任何人。**

7. **設定 Google Sheet 權限（重要！）：**

   - 建立一個新的 Google Sheet。
   - 在 Google Sheet 右上角點擊「共用」。
   - 將剛剛複製的 **服務帳號 Email** 貼上。
   - 權限設為 **「編輯者」**，然後傳送。
   - 複製網址中的 ID（`d/` 和 `/edit` 中間的那串字串），填入 `.env` 的 `GOOGLE_SHEET_ID`。

8. **準備工作表（建立副本最快！）：**

   你可以直接建立此範本的副本，就不用手動建立工作表了：
   👉 [**點此建立 Google Sheet 範本副本**](https://docs.google.com/spreadsheets/d/1AjS7gAkX7C-GC1v5gD-NIFdR2NJ2SEKWdMR9oCTUVDI/copy)

## API 文件

| Method | Endpoint                | Description          | Auth |
| ------ | ----------------------- | -------------------- | ---- |
| POST   | `/auth/login`           | 管理員登入，取得 JWT | ❌   |
| GET    | `/api/transactions`     | 取得所有交易紀錄     | ❌   |
| POST   | `/api/transactions`     | 新增交易             | ✅   |
| PUT    | `/api/transactions/:id` | 修改交易             | ✅   |
| DELETE | `/api/transactions/:id` | 刪除交易             | ✅   |
| GET    | `/api/categories`       | 取得所有類別         | ❌   |
| POST   | `/api/categories`       | 新增類別             | ✅   |
| PUT    | `/api/categories/:id`   | 修改類別             | ✅   |
| DELETE | `/api/categories/:id`   | 刪除類別             | ✅   |
| GET    | `/api/budget`           | 取得預算設定         | ❌   |
| PUT    | `/api/budget`           | 更新預算             | ✅   |

## 部署建議 (Zeabur)

1. 將程式碼推送到 GitHub
2. 在 Zeabur 建立專案，連結 GitHub Repository
3. 在 Zeabur 的「環境變數」設定中，填入 `.env` 中的所有變數
   - 注意：`GOOGLE_SA_PRIVATE_KEY` 的內容如果包含換行符號，請確保正確複製（Zeabur 支援多行變數）

## License

MIT
