const path = require("path");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const { google } = require("googleapis");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SHEET_ID =
  process.env.GOOGLE_SHEET_ID || "1MeCb_ClcxP-H_e6vYid49l-ayRd0cF-TE_StXRO9dnM";
const TRANSACTION_SHEET_RANGE =
  process.env.GOOGLE_TRANSACTION_RANGE || "'transactions'!A:G"; // 範圍擴大到 G

// 調整欄位對應新的需求
const TRANSACTION_COLUMNS = [
  "id",
  "date",
  "systolic",
  "diastolic",
  "pulse",
  "category_id",
  "note",
];
// 必填欄位檢查
const REQUIRED_TRANSACTION_COLUMNS = ["id", "date", "systolic", "diastolic"];

const CATEGORY_SHEET_RANGE =
  process.env.GOOGLE_CATEGORY_RANGE || "'categories'!A:C";
const CATEGORY_COLUMNS = ["id", "name", "color_hex"];
const DEFAULT_CATEGORY = {
  id: "1",
  name: "一般測量",
  color_hex: "#9E9E9E",
};
const BUDGET_SHEET_RANGE = process.env.GOOGLE_BUDGET_RANGE || "'budgets'!A:B";
const BUDGET_COLUMNS = ["id", "amount"]; // 這裡的 amount 沿用，但意義變為「收縮壓警戒值」
const DEFAULT_BUDGET = {
  id: "1",
  amount: "130", // 預設 130
};
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{6})$/;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "gonsakon";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "!Nba1q2w3e4r";
const JWT_SECRET = process.env.JWT_SECRET || "change-me-secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "365d";

// 路由設定保持不變，這樣前端呼叫不用改
const API_ENDPOINTS = [
  { method: "POST", path: "/auth/login", description: "登入並取得 JWT" },
  { method: "GET", path: "/api/transactions", description: "取得所有資料" },
  { method: "POST", path: "/api/transactions", description: "新增資料" },
  { method: "PUT", path: "/api/transactions/:id", description: "更新資料" },
  { method: "DELETE", path: "/api/transactions/:id", description: "刪除資料" },
  { method: "GET", path: "/api/categories", description: "取得類別" },
  { method: "POST", path: "/api/categories", description: "新增類別" },
  { method: "PUT", path: "/api/categories/:id", description: "更新類別" },
  { method: "DELETE", path: "/api/categories/:id", description: "刪除類別" },
  { method: "GET", path: "/api/budget", description: "取得標準設定" },
  { method: "PUT", path: "/api/budget", description: "更新標準設定" },
];

/**
 * Reuse the Google Sheets client so we do not re-authenticate on every request.
 */
const buildCredentialsFromEnv = () => {
  const requiredKeys = [
    "GOOGLE_SA_TYPE",
    "GOOGLE_SA_PROJECT_ID",
    "GOOGLE_SA_PRIVATE_KEY_ID",
    "GOOGLE_SA_PRIVATE_KEY",
    "GOOGLE_SA_CLIENT_EMAIL",
    "GOOGLE_SA_CLIENT_ID",
  ];

  const hasAll = requiredKeys.every((key) => !!process.env[key]);
  if (!hasAll) {
    return null;
  }

  return {
    type: process.env.GOOGLE_SA_TYPE,
    project_id: process.env.GOOGLE_SA_PROJECT_ID,
    private_key_id: process.env.GOOGLE_SA_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_SA_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_SA_CLIENT_ID,
  };
};

const getSheetsClient = (() => {
  let cached;
  return () => {
    if (cached) return cached;

    const credentials = buildCredentialsFromEnv();
    const auth = new google.auth.GoogleAuth({
      ...(credentials
        ? { credentials }
        : {
            keyFile:
              process.env.GOOGLE_APPLICATION_CREDENTIALS ||
              path.join(
                __dirname,
                "sunlit-adviser-479406-r0-b5a712496697.json"
              ),
          }),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    cached = google.sheets({ version: "v4", auth });
    return cached;
  };
})();

const normalizeRows = (rows) => {
  if (!rows || rows.length === 0) {
    return [];
  }

  const [header, ...dataRows] = rows;
  return dataRows.map((row) =>
    header.reduce((acc, key, index) => {
      acc[key] = row[index] ?? "";
      return acc;
    }, {})
  );
};

const appendRow = async (sheets, range, columns, payload) => {
  const row = columns.map((key) => {
    const value = payload[key];
    return value === undefined || value === null ? "" : value;
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [row],
    },
  });
};

const findRowById = async (sheetRange, idColumn, targetId) => {
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: sheetRange,
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return null;

  const [header, ...dataRows] = rows;
  const idIndex = header.indexOf(idColumn);
  if (idIndex === -1) return null;

  const normalizedTarget = (targetId ?? "").toString().trim();
  for (let i = 0; i < dataRows.length; i++) {
    const rowId = (dataRows[i][idIndex] ?? "").toString().trim();
    if (rowId === normalizedTarget) {
      const rowData = header.reduce((acc, key, idx) => {
        acc[key] = dataRows[i][idx] ?? "";
        return acc;
      }, {});
      return { rowIndex: i + 2, rowData };
    }
  }
  return null;
};

const updateRow = async (sheetName, rowIndex, columns, payload) => {
  const sheets = getSheetsClient();
  // 為了安全起見，我們會重新建構整行資料，確保欄位順序正確
  // 但由於 Google Sheets API update 是覆蓋該 range，
  // 我們可以簡單地只更新我們知道的 columns
  
  // 這裡的邏輯是：payload 必須包含完整的 row data，或者我們必須先讀取舊資料 merge
  // 上面的 findRowById 已經給了我們 old rowData，但在 controller 層處理比較好
  // 為了簡化，這裡假設 controller 已經做好 merge
  
  const rowValues = columns.map((key) => payload[key] ?? "");

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A${rowIndex}`, // 假設從 A 欄開始
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [rowValues],
    },
  });
};

const deleteRow = async (sheetIdVal, rowIndex) => {
  const sheets = getSheetsClient();
  // rowIndex is 1-based. API expects 0-based index for deleteDimension
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetIdVal,
              dimension: "ROWS",
              startIndex: rowIndex - 1,
              endIndex: rowIndex,
            },
          },
        },
      ],
    },
  });
};

// Helper to get Sheet ID (Grid ID) by name because deleteDimension needs numeric SheetId
const getSheetIdByName = async (sheetName) => {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = res.data.sheets.find((s) => s.properties.title === sheetName);
  return sheet ? sheet.properties.sheetId : null;
};

// Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ message: "未提供 Token" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Token 無效或過期" });
    req.user = user;
    next();
  });
};

// ===== Routes =====

// 1. Auth
app.post("/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ username }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });
    return res.json({ token });
  }
  return res.status(401).json({ message: "帳號或密碼錯誤" });
});

// 2. Transactions (Blood Pressure Records)
app.get("/api/transactions", authenticateToken, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const [txnRes, catRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: TRANSACTION_SHEET_RANGE,
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: CATEGORY_SHEET_RANGE,
      }),
    ]);

    const txns = normalizeRows(txnRes.data.values);
    const cats = normalizeRows(catRes.data.values);

    // Join categories
    const joined = txns.map((t) => {
      const cat = cats.find((c) => c.id === t.category_id) || DEFAULT_CATEGORY;
      return {
        ...t,
        category_name: cat.name,
        category_color_hex: cat.color_hex,
      };
    });

    res.json({ data: joined });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "讀取資料失敗" });
  }
});

app.post("/api/transactions", authenticateToken, async (req, res) => {
  try {
    const payload = req.body;
    // Validate
    const missing = REQUIRED_TRANSACTION_COLUMNS.filter((k) => !payload[k]);
    if (missing.length > 0) {
      return res.status(400).json({ message: `缺少欄位: ${missing.join(", ")}` });
    }

    const sheets = getSheetsClient();
    await appendRow(
      sheets,
      TRANSACTION_SHEET_RANGE,
      TRANSACTION_COLUMNS,
      payload
    );
    res.json({ message: "新增成功", data: payload });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "新增失敗" });
  }
});

app.put("/api/transactions/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body;
    
    // Find existing
    const found = await findRowById(TRANSACTION_SHEET_RANGE, "id", id);
    if (!found) {
      return res.status(404).json({ message: "找不到該筆資料" });
    }

    // Merge
    const merged = { ...found.rowData, ...payload, id }; // ensure ID not changed
    const sheetName = TRANSACTION_SHEET_RANGE.split("!")[0].replace(/'/g, "");
    
    await updateRow(sheetName, found.rowIndex, TRANSACTION_COLUMNS, merged);
    res.json({ message: "更新成功" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "更新失敗" });
  }
});

app.delete("/api/transactions/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const found = await findRowById(TRANSACTION_SHEET_RANGE, "id", id);
    if (!found) {
      return res.status(404).json({ message: "找不到該筆資料" });
    }

    const sheetName = TRANSACTION_SHEET_RANGE.split("!")[0].replace(/'/g, "");
    const sheetIdVal = await getSheetIdByName(sheetName);
    
    if (sheetIdVal === null) throw new Error("Sheet not found");

    await deleteRow(sheetIdVal, found.rowIndex);
    res.json({ message: "刪除成功" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "刪除失敗" });
  }
});

// 3. Categories
app.get("/api/categories", authenticateToken, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: CATEGORY_SHEET_RANGE,
    });
    const data = normalizeRows(response.data.values);
    // Add default if empty or just return data. 
    // Usually we want at least one default category in UI, handled by frontend or here.
    if (data.length === 0) {
        // Optional: Return default if none exist
        return res.json({ data: [DEFAULT_CATEGORY] });
    }
    res.json({ data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "讀取類別失敗" });
  }
});

app.post("/api/categories", authenticateToken, async (req, res) => {
  try {
    const { name, color_hex } = req.body;
    if (!name || !color_hex) {
      return res.status(400).json({ message: "名稱與顏色為必填" });
    }
    if (!HEX_COLOR_REGEX.test(color_hex)) {
        return res.status(400).json({ message: "顏色格式錯誤 (例如 #ffffff)" });
    }

    const id = `cat-${Date.now()}`;
    const payload = { id, name, color_hex };

    const sheets = getSheetsClient();
    await appendRow(sheets, CATEGORY_SHEET_RANGE, CATEGORY_COLUMNS, payload);
    res.json({ message: "類別新增成功", data: payload });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "新增類別失敗" });
  }
});

app.put("/api/categories/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color_hex } = req.body;

    if (id === "1") {
        return res.status(400).json({ message: "預設類別無法修改" });
    }

    const found = await findRowById(CATEGORY_SHEET_RANGE, "id", id);
    if (!found) {
      return res.status(404).json({ message: "類別不存在" });
    }

    const merged = { ...found.rowData, name, color_hex, id };
    const sheetName = CATEGORY_SHEET_RANGE.split("!")[0].replace(/'/g, "");
    
    await updateRow(sheetName, found.rowIndex, CATEGORY_COLUMNS, merged);
    res.json({ message: "類別更新成功" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "更新類別失敗" });
  }
});

app.delete("/api/categories/:id", authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      if (id === "1") {
          return res.status(400).json({ message: "預設類別無法刪除" });
      }
  
      const found = await findRowById(CATEGORY_SHEET_RANGE, "id", id);
      if (!found) {
        return res.status(404).json({ message: "類別不存在" });
      }
  
      const sheetName = CATEGORY_SHEET_RANGE.split("!")[0].replace(/'/g, "");
      const sheetIdVal = await getSheetIdByName(sheetName);
      
      if (sheetIdVal === null) throw new Error("Sheet not found");
  
      await deleteRow(sheetIdVal, found.rowIndex);
      res.json({ message: "類別刪除成功" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "刪除類別失敗" });
    }
  });

// 4. Budget (Repurposed for Blood Pressure Target/Warning Limit)
// 嚴格限制 token
// app.get("/api/budget", authenticateToken, async (req, res) => {
// 不嚴格限制 token
app.get("/api/budget", async (req, res) => {
  try {
    const found = await findRowById(BUDGET_SHEET_RANGE, "id", "1");
    if (!found) {
       return res.json({ data: DEFAULT_BUDGET });
    }
    res.json({ data: found.rowData });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "讀取設定失敗" });
  }
});

app.put("/api/budget", authenticateToken, async (req, res) => {
    try {
      const { amount } = req.body; // In this context, amount = systolic limit
      
      const sheets = getSheetsClient();
      const found = await findRowById(BUDGET_SHEET_RANGE, "id", "1");
      const sheetName = BUDGET_SHEET_RANGE.split("!")[0].replace(/'/g, "");
  
      if (found) {
         const merged = { ...found.rowData, amount, id: "1" };
         await updateRow(sheetName, found.rowIndex, BUDGET_COLUMNS, merged);
      } else {
         // Create if not exists
         await appendRow(sheets, BUDGET_SHEET_RANGE, BUDGET_COLUMNS, { id: "1", amount });
      }
      res.json({ message: "設定更新成功" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "更新設定失敗" });
    }
  });

app.listen(PORT, () => {
  console.log(`Shark BP Server running on port ${PORT}`);
  console.table(API_ENDPOINTS);
});