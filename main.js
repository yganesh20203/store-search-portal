import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm";

// ==========================================
// 1. GLOBAL STATE
// ==========================================
let accessToken = ""; 
let currentMonthFolderId = "";
let db = null; 
let conn = null; 
let currentTableName = "current_data"; 

// Attach functions to Window so HTML buttons can use them
window.unlockAndLogin = unlockAndLogin;
window.loadSalesDashboard = loadSalesDashboard;
window.loadMemberDashboard = loadMemberDashboard;
window.loadTrackerDashboard = loadTrackerDashboard; 
window.findAndLoadReport = findAndLoadReport;
window.selectMonth = selectMonth;
window.applyTableFilter = applyTableFilter;
window.closeModal = closeModal;
window.summarizeData = summarizeData; 

// ==========================================
// 2. INITIALIZE DUCKDB
// ==========================================
async function initDuckDB() {
    if (db) return; 
    console.log("Initializing DuckDB...");
    try {
        const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
        const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
        const worker = await duckdb.createWorker(bundle.mainWorker);
        const logger = new duckdb.ConsoleLogger();
        db = new duckdb.AsyncDuckDB(logger, worker);
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        conn = await db.connect();
        console.log("🦆 DuckDB Ready!");
    } catch (e) {
        console.error("DuckDB Init Failed:", e);
    }
}

// ==========================================
// 3. AUTHENTICATION
// ==========================================
async function unlockAndLogin() {
    const userPass = document.getElementById("access-key").value;
    const btn = document.querySelector("button");
    const errorMsg = document.getElementById("error-msg");

    if(!userPass) return;
    btn.innerText = "Unlocking...";

    try {
        if (typeof CONFIG === 'undefined') throw new Error("Config not loaded.");

        const bytes = CryptoJS.AES.decrypt(CONFIG.ENCRYPTED_CREDS, userPass);
        const decryptedString = bytes.toString(CryptoJS.enc.Utf8);

        if (!decryptedString) throw new Error("Incorrect Access Key");

        const creds = JSON.parse(decryptedString);
        accessToken = await generateAccessToken(creds);
        
        document.getElementById("auth-overlay").classList.add("hidden");
        document.getElementById("dashboard").classList.remove("hidden");
        
        initDuckDB();

    } catch (e) {
        console.error(e);
        if(errorMsg) {
            errorMsg.innerText = "Error: " + e.message;
            errorMsg.style.display = "block";
        }
        btn.innerText = "Unlock & Connect";
    }
}

async function generateAccessToken(creds) {
    const header = { alg: "RS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
        iss: creds.client_email,
        scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets.readonly",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now
    };

    const sHeader = JSON.stringify(header);
    const sClaim = JSON.stringify(claim);
    const sJWS = KJUR.jws.JWS.sign(null, sHeader, sClaim, creds.private_key);

    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${sJWS}`
    });
    const data = await response.json();
    return data.access_token;
}

// ==========================================
// 4. DASHBOARD SWITCHING
// ==========================================

function resetUI() {
    document.getElementById("sales-ui").classList.add("hidden");
    document.getElementById("member-ui").classList.add("hidden");
    document.getElementById("tracker-ui").classList.add("hidden");
    document.getElementById("filter-box").classList.add("hidden");
    document.getElementById("content-area").innerHTML = "";
    document.getElementById("sheet-link-container").innerHTML = "";
}

async function loadSalesDashboard() {
    resetUI();
    document.getElementById("sales-ui").classList.remove("hidden");
    const listContainer = document.getElementById("month-list");
    listContainer.innerHTML = "Loading...";

    const query = `'${CONFIG.SALES_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name)`;

    try {
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();
        listContainer.innerHTML = "";
        
        if (data.files && data.files.length > 0) {
            data.files.forEach(folder => {
                const btn = document.createElement("button");
                btn.className = "folder-btn";
                btn.innerText = "📂 " + folder.name; 
                btn.onclick = () => window.selectMonth(folder.id, btn);
                listContainer.appendChild(btn);
            });
        } else {
            listContainer.innerHTML = "No folders found.";
        }
    } catch (e) {
        listContainer.innerHTML = "Error: " + e.message;
    }
}

function selectMonth(folderId, btnElement) {
    currentMonthFolderId = folderId;
    document.querySelectorAll(".folder-btn").forEach(b => b.classList.remove("active"));
    btnElement.classList.add("active");
    document.getElementById("store-search-box").classList.remove("hidden");
    document.getElementById("content-area").innerHTML = "";
}

async function loadMemberDashboard() {
    resetUI();
    document.getElementById("member-ui").classList.remove("hidden");
    const listContainer = document.getElementById("member-file-list");
    listContainer.innerHTML = "Loading...";

    const query = `'${CONFIG.MEMBERS_FOLDER_ID}' in parents and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name)`;

    try {
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();
        listContainer.innerHTML = "";
        
        if (data.files && data.files.length > 0) {
            data.files.forEach(file => {
                const btn = document.createElement("button");
                btn.className = "folder-btn";
                btn.style.background = "#d1e7dd"; 
                btn.innerText = "📦 " + file.name; 
                btn.onclick = () => loadFileIntoDuckDB(file.id, file.name, 'parquet');
                listContainer.appendChild(btn);
            });
        } else {
            listContainer.innerHTML = "No files found.";
        }
    } catch (e) {
        listContainer.innerHTML = "Error: " + e.message;
    }
}

// --- UPDATED: TRACKER DASHBOARD WITH LAYERS ---

// 1. Level 1: Show Categories (e.g. Vehicle Dispatch)
async function loadTrackerDashboard() {
    resetUI();
    document.getElementById("tracker-ui").classList.remove("hidden");
    const listContainer = document.getElementById("tracker-file-list");
    
    // Clear list and show "Category" buttons
    listContainer.innerHTML = "";

    // Create "Vehicle Dispatch Summary" Group Button
    const btn = document.createElement("button");
    btn.className = "folder-btn";
    btn.style.background = "#ffe082"; // Gold color for folders
    btn.style.fontWeight = "bold";
    btn.innerText = "🚛 Vehicle Dispatch Summary"; 
    
    // When clicked, go to Level 2
    btn.onclick = () => renderVehicleDispatchSheets();
    
    listContainer.appendChild(btn);
}

// 2. Level 2: Show Actual Sheets
function renderVehicleDispatchSheets() {
    const listContainer = document.getElementById("tracker-file-list");
    listContainer.innerHTML = ""; // Clear the category buttons

    // Add "Back" Button
    const backBtn = document.createElement("button");
    backBtn.className = "folder-btn";
    backBtn.style.background = "#e0e0e0"; 
    backBtn.innerText = "⬅️ Back to Categories";
    backBtn.onclick = () => loadTrackerDashboard(); // Go back to Level 1
    listContainer.appendChild(backBtn);

    // List the actual sheets from Config
    if (CONFIG.TRACKER_SHEETS && CONFIG.TRACKER_SHEETS.length > 0) {
        CONFIG.TRACKER_SHEETS.forEach(sheet => {
            const btn = document.createElement("button");
            btn.className = "folder-btn";
            btn.style.background = "#fff3cd"; // Light yellow for files
            btn.innerText = "📊 " + sheet.name; 
            btn.onclick = () => loadFileIntoDuckDB(sheet.id, sheet.name, 'sheet', sheet.gid);
            listContainer.appendChild(btn);
        });
    } else {
        listContainer.innerHTML += "<p>No sheets configured.</p>";
    }
}


// ==========================================
// 5. DATA LOADING ENGINE
// ==========================================

async function findAndLoadReport() {
    alert("Sales logic separate. Use Member/Trackers.");
}

async function loadFileIntoDuckDB(fileId, fileName, type, gid) {
    const statusDiv = document.getElementById("loading-status");
    document.getElementById("filter-box").classList.remove("hidden");
    statusDiv.innerHTML = "⏳ Fetching Data...";
    document.getElementById("content-area").innerHTML = "";
    document.getElementById("sheet-link-container").innerHTML = "";

    try {
        if (type === 'sheet') {
            statusDiv.innerHTML = "⏳ Identifying Tab...";
            
            // 1. Get Sheet Metadata
            const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=sheets.properties`;
            const metaResp = await fetch(metaUrl, { headers: { "Authorization": `Bearer ${accessToken}` } });
            
            if (!metaResp.ok) throw new Error("Could not access Sheet. Check sharing permissions.");
            const metaData = await metaResp.json();
            
            // 2. Find Sheet Name by GID
            let sheetTitle = "";
            const targetGid = gid ? parseInt(gid) : 0;
            
            const foundSheet = metaData.sheets.find(s => s.properties.sheetId === targetGid);
            if (foundSheet) {
                sheetTitle = foundSheet.properties.title;
            } else {
                throw new Error("Tab not found in this sheet.");
            }

            statusDiv.innerHTML = `⏳ Downloading "${sheetTitle}"...`;

            // 3. Fetch Data Values
            const dataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${encodeURIComponent(sheetTitle)}`;
            const dataResp = await fetch(dataUrl, { headers: { "Authorization": `Bearer ${accessToken}` } });
            const dataJson = await dataResp.json();

            if (!dataJson.values || dataJson.values.length === 0) {
                throw new Error("Sheet is empty.");
            }

            // 4. Convert to CSV & Load
            const csvText = arrayToCSV(dataJson.values);
            await db.registerFileText('live_sheet.csv', csvText);
            await conn.query(`CREATE OR REPLACE TABLE ${currentTableName} AS SELECT * FROM read_csv_auto('live_sheet.csv')`);
            
            // 5. Setup Buttons
            const editUrl = `https://docs.google.com/spreadsheets/d/${fileId}/edit#gid=${targetGid}`;
            document.getElementById("sheet-link-container").innerHTML = `
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <a href="${editUrl}" target="_blank" style="text-decoration:none;">
                        <button style="background:#28a745; color:white; padding:8px 12px; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">
                            ✏️ Open in Google Sheets
                        </button>
                    </a>
                    <button onclick="window.summarizeData()" style="background:#6f42c1; color:white; padding:8px 12px; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">
                        🤖 Summarize Info (AI)
                    </button>
                </div>`;

        } else {
            // Handle Parquet/CSV
            const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
            const response = await fetch(downloadUrl, { headers: { "Authorization": `Bearer ${accessToken}` } });
            if (!response.ok) throw new Error("Download failed");

            const arrayBuffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            await db.registerFileBuffer(fileName, uint8Array);
            
            if (fileName.endsWith('.parquet')) {
                 await conn.query(`CREATE OR REPLACE TABLE ${currentTableName} AS SELECT * FROM parquet_scan('${fileName}')`);
            } else {
                 await conn.query(`CREATE OR REPLACE TABLE ${currentTableName} AS SELECT * FROM read_csv_auto('${fileName}')`);
            }
        }

        statusDiv.innerHTML = "✅ Data Loaded!";
        await setupFilterDropdown();
        await applyTableFilter(); 
        statusDiv.innerHTML = "";

    } catch (e) {
        console.error(e);
        statusDiv.innerHTML = `<span style="color:red">Error: ${e.message}</span>`;
    }
}

// Helper: JSON Array -> CSV
function arrayToCSV(data) {
    return data.map(row =>
        row.map(field => {
            if (field === null || field === undefined) return '';
            let stringField = String(field);
            if (stringField.includes('"') || stringField.includes(',') || stringField.includes('\n')) {
                stringField = '"' + stringField.replace(/"/g, '""') + '"';
            }
            return stringField;
        }).join(',')
    ).join('\n');
}

function summarizeData() {
    alert("🤖 AI Summary Module\n\nComing in Phase 5!");
}

// ==========================================
// 6. SQL FILTERING & RENDERING
// ==========================================

async function setupFilterDropdown() {
    const schema = await conn.query(`DESCRIBE ${currentTableName}`);
    const dropdown = document.getElementById("column-select");
    dropdown.innerHTML = '<option value="all">All Columns</option>';
    
    const rows = schema.toArray();
    rows.forEach(row => {
        const colName = row.column_name;
        const option = document.createElement("option");
        option.value = colName;
        option.innerText = colName;
        dropdown.appendChild(option);
    });
}

async function applyTableFilter() {
    const filterText = document.getElementById("filter-input").value.replace(/'/g, "''"); 
    const column = document.getElementById("column-select").value;
    const limit = document.getElementById("row-limit-select").value;
    
    let query = `SELECT * FROM ${currentTableName}`;
    
    if (filterText) {
        if (column === "all") {
             query += ` WHERE CAST(column0 AS VARCHAR) LIKE '%${filterText}%'`; 
        } else {
            query += ` WHERE CAST("${column}" AS VARCHAR) LIKE '%${filterText}%'`;
        }
    }
    
    if (limit !== "all") query += ` LIMIT ${limit}`;

    try {
        const result = await conn.query(query);
        renderTableFromArrow(result);
    } catch (e) {
        console.error("Query Error", e);
    }
}

let currentArrowData = null; 

function renderTableFromArrow(arrowResult) {
    const container = document.getElementById("content-area");
    const rows = arrowResult.toArray().map(r => r.toJSON());
    currentArrowData = rows; 

    if (rows.length === 0) {
        container.innerHTML = "<p>No matches found.</p>";
        return;
    }

    const headers = Object.keys(rows[0]);
    let html = `<table><thead><tr>`;
    headers.forEach(h => html += `<th>${h}</th>`);
    html += `</tr></thead><tbody>`;

    rows.forEach((row, index) => {
        html += `<tr onclick="window.showRowDetails(${index})" title="Click details">`;
        headers.forEach(h => {
             let val = row[h];
             html += `<td>${val !== null ? val : ''}</td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table>`;
    container.innerHTML = html;
}

window.showRowDetails = function(index) {
    const rowData = currentArrowData[index];
    const modalBody = document.getElementById("modal-body");
    let html = `<table class="detail-table"><tbody>`;
    Object.keys(rowData).forEach(key => {
        html += `<tr><th>${key}</th><td>${rowData[key]}</td></tr>`;
    });
    html += `</tbody></table>`;
    modalBody.innerHTML = html;
    document.getElementById("detail-modal").classList.remove("hidden");
}

function closeModal() {
    document.getElementById("detail-modal").classList.add("hidden");
}

window.onclick = function(event) {
    const modal = document.getElementById("detail-modal");
    if (event.target == modal) closeModal();
}
