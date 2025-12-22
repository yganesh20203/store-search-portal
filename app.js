import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm";

// ==========================================
// 1. GLOBAL STATE
// ==========================================
let accessToken = ""; 
let currentMonthFolderId = "";
let db = null; 
let conn = null; 
let activePaneId = "pane-0"; 

// HOURLY CACHE (Stores fetched images to avoid re-fetching)
let hourlyFilesCache = []; 

// Attach functions to Window for HTML access
window.unlockAndLogin = unlockAndLogin;
window.loadSalesDashboard = loadSalesDashboard;
window.loadMemberDashboard = loadMemberDashboard;
window.loadTrackerDashboard = loadTrackerDashboard; 
window.loadHourlyDashboard = loadHourlyDashboard; 
window.findAndLoadReport = findAndLoadReport;
window.selectMonth = selectMonth;
window.applyTableFilter = applyTableFilter;
window.closeModal = closeModal;
window.summarizeData = summarizeData; 
window.changeLayout = changeLayout;
window.setActivePane = setActivePane;
window.filterHourlyImagesByDate = filterHourlyImagesByDate; 

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
// 4. SPLIT SCREEN LOGIC
// ==========================================

function changeLayout(numPanes) {
    const container = document.getElementById("view-container");
    container.innerHTML = ""; 
    container.className = `grid-${numPanes}`; 

    for (let i = 0; i < numPanes; i++) {
        const paneId = `pane-${i}`;
        const div = document.createElement("div");
        div.id = paneId;
        div.className = "pane";
        if (i === 0) div.classList.add("active"); // First one active by default
        
        // Add Click Listener to make it active
        div.onclick = () => window.setActivePane(paneId);

        div.innerHTML = `
            <span class="pane-label">View ${i + 1}</span>
            <div class="content-area">
                <div class="empty-msg">Select a file to load here</div>
            </div>
        `;
        container.appendChild(div);
    }
    
    // Reset active pane to first one
    activePaneId = "pane-0";
}

function setActivePane(id) {
    document.querySelectorAll(".pane").forEach(p => p.classList.remove("active"));
    const pane = document.getElementById(id);
    if(pane) pane.classList.add("active");
    activePaneId = id;
}

// ==========================================
// 5. DASHBOARD SWITCHING
// ==========================================

function resetUI() {
    document.getElementById("sales-ui").classList.add("hidden");
    document.getElementById("member-ui").classList.add("hidden");
    document.getElementById("tracker-ui").classList.add("hidden");
    document.getElementById("hourly-ui").classList.add("hidden"); 
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

// --- TRACKER DASHBOARD (Dynamic Groups) ---
async function loadTrackerDashboard() {
    resetUI();
    document.getElementById("tracker-ui").classList.remove("hidden");
    const listContainer = document.getElementById("tracker-file-list");
    
    listContainer.innerHTML = "";

    if (CONFIG.TRACKER_GROUPS) {
        Object.keys(CONFIG.TRACKER_GROUPS).forEach(groupName => {
            const btn = document.createElement("button");
            btn.className = "folder-btn";
            btn.style.background = "#ffe082"; 
            btn.style.fontWeight = "bold";
            btn.innerText = groupName; 
            btn.onclick = () => openTrackerCategory(groupName);
            listContainer.appendChild(btn);
        });
    } else {
        listContainer.innerHTML = "<p>No trackers configured in config.js</p>";
    }
}

function openTrackerCategory(groupName) {
    const listContainer = document.getElementById("tracker-file-list");
    listContainer.innerHTML = ""; 

    const backBtn = document.createElement("button");
    backBtn.className = "folder-btn";
    backBtn.style.background = "#e0e0e0"; 
    backBtn.innerText = "⬅️ Back to Categories";
    backBtn.onclick = () => loadTrackerDashboard();
    listContainer.appendChild(backBtn);

    const sheets = CONFIG.TRACKER_GROUPS[groupName];
    
    if (sheets && sheets.length > 0) {
        sheets.forEach(sheet => {
            const btn = document.createElement("button");
            btn.className = "folder-btn";
            btn.style.background = "#fff3cd"; 
            btn.innerText = "📊 " + sheet.name; 
            btn.onclick = () => loadFileIntoDuckDB(sheet.id, sheet.name, 'sheet', sheet.gid);
            listContainer.appendChild(btn);
        });
    } else {
        listContainer.innerHTML += `<p>No sheets added to "${groupName}" yet.</p>`;
    }
}

// ==========================================
// 6. HOURLY SALES DASHBOARD (IMAGES)
// ==========================================

async function loadHourlyDashboard() {
    resetUI();
    document.getElementById("hourly-ui").classList.remove("hidden");
    const dateList = document.getElementById("hourly-date-list");
    const imageList = document.getElementById("hourly-file-list");
    document.getElementById("hourly-images-container").classList.add("hidden");
    
    dateList.innerHTML = "⏳ Scanning Drive for Hourly Images...";
    imageList.innerHTML = "";

    // Query: Sort by Created Time Descending (Newest First)
    const query = `'${CONFIG.HOURLY_SALES_FOLDER_ID}' in parents and (mimeType contains 'image/') and trashed = false`;
    // We request createdTime to group them
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name, thumbnailLink, createdTime)&orderBy=createdTime desc`;

    try {
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();
        
        if (data.files && data.files.length > 0) {
            hourlyFilesCache = data.files; // Store globally
            
            // Group by Date
            const dates = {};
            data.files.forEach(file => {
                const dateObj = new Date(file.createdTime);
                const dateKey = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); // e.g., "Dec 20, 2025"
                if (!dates[dateKey]) dates[dateKey] = [];
                dates[dateKey].push(file);
            });

            // Render Date Buttons
            dateList.innerHTML = "";
            Object.keys(dates).forEach(date => {
                const count = dates[date].length;
                const btn = document.createElement("button");
                btn.className = "folder-btn";
                btn.style.background = "#e1bee7"; // Light Purple
                btn.style.width = "auto";
                btn.style.padding = "10px 20px";
                btn.innerHTML = `📅 <b>${date}</b> <br><span style="font-size:0.8em;">(${count} updates)</span>`;
                btn.onclick = () => filterHourlyImagesByDate(date);
                dateList.appendChild(btn);
            });

        } else {
            dateList.innerHTML = "No hourly images found in the configured folder.";
        }
    } catch (e) {
        dateList.innerHTML = "Error: " + e.message;
    }
}

function filterHourlyImagesByDate(dateKey) {
    const container = document.getElementById("hourly-images-container");
    const list = document.getElementById("hourly-file-list");
    container.classList.remove("hidden");
    list.innerHTML = "";

    // Filter files for selected date
    const filteredFiles = hourlyFilesCache.filter(f => new Date(f.createdTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) === dateKey);

    // Sort by Time Ascending for the day
    filteredFiles.sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));

    filteredFiles.forEach(file => {
        const timeObj = new Date(file.createdTime);
        const timeStr = timeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const btn = document.createElement("button");
        btn.className = "folder-btn";
        btn.style.background = "#ffffff"; 
        btn.style.border = "1px solid #ddd";
        btn.style.display = "flex";
        btn.style.flexDirection = "column";
        btn.style.alignItems = "center";
        btn.style.width = "160px"; 
        btn.style.height = "140px";
        btn.style.gap = "5px";
        btn.style.padding = "10px";
        
        // Thumbnail
        const img = file.thumbnailLink 
            ? `<img src="${file.thumbnailLink}" style="width:100%; height:80px; object-fit:contain; border-radius:4px;">` 
            : `<div style="font-size:30px;">🖼️</div>`;

        btn.innerHTML = `
            ${img}
            <div style="font-size:14px; font-weight:bold; color:#0056b3;">${timeStr}</div>
            <div style="font-size:10px; color:#666; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%;">${file.name}</div>
        `;
        btn.onclick = () => renderImage(file.id, file.name);
        list.appendChild(btn);
    });
}

async function renderImage(fileId, fileName) {
    const pane = document.getElementById(activePaneId);
    if (!pane) { alert("Error: No active view selected"); return; }
    
    const contentArea = pane.querySelector(".content-area");
    contentArea.innerHTML = "<p>⏳ Loading Image...</p>";
    
    try {
        const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        if (!response.ok) throw new Error("Failed to load image");
        
        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        
        contentArea.innerHTML = `
            <div style="display:flex; justify-content:center; align-items:center; height:100%; width:100%; background:#f9f9f9; padding:10px; box-sizing:border-box;">
                <img src="${imageUrl}" style="max-width:100%; max-height:100%; border-radius:8px; box-shadow:0 4px 6px rgba(0,0,0,0.1);">
            </div>
        `;
        pane.querySelector(".pane-label").innerText = `📷 ${fileName}`;
    } catch (e) {
        contentArea.innerHTML = `<p style="color:red">Error loading image: ${e.message}</p>`;
    }
}


// ==========================================
// 7. DATA LOADING ENGINE (SALES & TRACKERS)
// ==========================================

async function findAndLoadReport() {
    const storeId = document.getElementById("store-id-input").value.trim();
    const statusDiv = document.getElementById("loading-status");

    // Validation
    if (!currentMonthFolderId) { alert("⚠️ Please select a Month folder first (Step 1)."); return; }
    if (!storeId) { alert("⚠️ Please enter a Store ID."); return; }

    const pane = document.getElementById(activePaneId);
    if (!pane) { alert("Error: No active view selected"); return; }
    
    statusDiv.innerHTML = `🔍 Searching for Store ${storeId}...`;
    const contentArea = pane.querySelector(".content-area");
    contentArea.innerHTML = `<div style="text-align:center; padding:20px; color:#666;">🔍 Searching Drive for ${storeId}...</div>`;

    // Search Drive
    const query = `'${currentMonthFolderId}' in parents and name contains '${storeId}' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name)`;

    try {
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();

        if (data.files && data.files.length > 0) {
            const file = data.files[0];
            statusDiv.innerHTML = `✅ Found: ${file.name}`;
            await loadFileIntoDuckDB(file.id, file.name, 'parquet'); 
        } else {
            statusDiv.innerHTML = `❌ No report found for "${storeId}"`;
            contentArea.innerHTML = `<div style="text-align:center; padding:20px; color:red;">❌ File not found.<br>Check Store ID or try a different Month.</div>`;
        }
    } catch (e) {
        console.error(e);
        statusDiv.innerHTML = `Error: ${e.message}`;
    }
}

async function loadFileIntoDuckDB(fileId, fileName, type, gid) {
    const statusDiv = document.getElementById("loading-status");
    statusDiv.innerHTML = "⏳ Fetching Data...";
    
    const pane = document.getElementById(activePaneId);
    if (!pane) { alert("Error: No active view selected"); return; }
    
    const contentArea = pane.querySelector(".content-area");
    const tableName = `table_${activePaneId.replace('-', '_')}`;

    contentArea.innerHTML = "<p>⏳ Loading...</p>";
    document.getElementById("sheet-link-container").innerHTML = "";

    try {
        if (type === 'sheet') {
            statusDiv.innerHTML = "⏳ Identifying Tab...";
            
            // Metadata
            const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=sheets.properties`;
            const metaResp = await fetch(metaUrl, { headers: { "Authorization": `Bearer ${accessToken}` } });
            if (!metaResp.ok) throw new Error("Access Denied");
            const metaData = await metaResp.json();
            
            let sheetTitle = "";
            const targetGid = gid ? parseInt(gid) : 0;
            const foundSheet = metaData.sheets.find(s => s.properties.sheetId === targetGid);
            if (foundSheet) sheetTitle = foundSheet.properties.title;
            else throw new Error("Tab not found");

            statusDiv.innerHTML = `⏳ Downloading "${sheetTitle}"...`;

            // Data
            const dataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${encodeURIComponent(sheetTitle)}`;
            const dataResp = await fetch(dataUrl, { headers: { "Authorization": `Bearer ${accessToken}` } });
            const dataJson = await dataResp.json();

            if (!dataJson.values || dataJson.values.length === 0) throw new Error("Sheet empty");

            // --- SMART HEADER FIX (Applies to ALL Sheets) ---
            let finalValues = dataJson.values;

            // Always check for at least 2 rows to attempt merge
            if (finalValues.length >= 2) {
                console.log("🛠️ Merging Top 2 Rows for Header...");
                
                const rowDates = finalValues[0]; // Top Row
                const rowMetrics = finalValues[1]; // Bottom Row
                let newHeader = [];
                let lastDate = "";

                // Iterate using the bottom row as the count
                for (let i = 0; i < rowMetrics.length; i++) {
                    let dateVal = rowDates[i] || "";
                    let metricVal = rowMetrics[i] || `col${i}`;

                    // Handle Merged Cells logic
                    if (dateVal !== "") lastDate = dateVal;

                    if (lastDate) newHeader.push(`${lastDate} - ${metricVal}`);
                    else newHeader.push(metricVal);
                }
                
                // Replace the first 2 rows with the new header
                finalValues = [newHeader, ...finalValues.slice(2)];
            }
            // -------------------------------------------------

            // Load to DuckDB
            const csvText = arrayToCSV(finalValues);
            const csvFileName = `temp_${tableName}.csv`;
            
            await db.registerFileText(csvFileName, csvText);
            await conn.query(`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv_auto('${csvFileName}')`);
            
            pane.querySelector(".pane-label").innerText = `${sheetTitle}`;

            // Buttons
            const editUrl = `https://docs.google.com/spreadsheets/d/${fileId}/edit#gid=${targetGid}`;
            document.getElementById("sheet-link-container").innerHTML = `
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <a href="${editUrl}" target="_blank" style="text-decoration:none;">
                        <button style="background:#28a745; color:white; padding:8px 12px; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">
                            ✏️ Open Sheet
                        </button>
                    </a>
                    <button onclick="window.summarizeData()" style="background:#6f42c1; color:white; padding:8px 12px; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">
                        🤖 AI Summary
                    </button>
                </div>`;

        } else {
            // Binary (Parquet/CSV)
            const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
            const response = await fetch(downloadUrl, { headers: { "Authorization": `Bearer ${accessToken}` } });
            if (!response.ok) throw new Error("Download failed");

            const arrayBuffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            await db.registerFileBuffer(fileName, uint8Array);
            
            if (fileName.endsWith('.parquet')) {
                 await conn.query(`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM parquet_scan('${fileName}')`);
            } else {
                 await conn.query(`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv_auto('${fileName}')`);
            }
            
            pane.querySelector(".pane-label").innerText = fileName;
        }

        statusDiv.innerHTML = "✅ Data Loaded!";
        await setupFilterDropdown(tableName);
        await applyTableFilter(); 
        statusDiv.innerHTML = "";

    } catch (e) {
        console.error(e);
        statusDiv.innerHTML = `<span style="color:red">Error: ${e.message}</span>`;
        contentArea.innerHTML = `<p style="color:red">Failed to load</p>`;
    }
}

// Helper: JSON -> CSV
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

// ==========================================
// 8. AI SUMMARY ENGINE
// ==========================================

async function summarizeData() {
    const modal = document.getElementById("detail-modal");
    const modalBody = document.getElementById("modal-body");
    const tableName = `table_${activePaneId.replace('-', '_')}`;
    
    modal.classList.remove("hidden");
    modalBody.innerHTML = `<h3>🤖 Analyzing...</h3>`;

    try {
        const schemaQuery = await conn.query(`DESCRIBE ${tableName}`);
        const schema = schemaQuery.toArray().map(row => row.toJSON());

        const labelCol = schema.find(c => c.column_type.includes('VARCHAR'))?.column_name || schema[0].column_name;
        const numericCols = schema.filter(c => 
            ['BIGINT', 'INTEGER', 'DOUBLE', 'DECIMAL', 'HUGEINT'].some(type => c.column_type.includes(type))
        ).map(c => c.column_name);

        if (numericCols.length === 0) {
            modalBody.innerHTML = "<p>⚠️ No numeric data found.</p>";
            return;
        }

        // Totals
        const sumQueryParts = numericCols.map(col => `SUM("${col}") as "${col}"`).join(", ");
        const totalResult = await conn.query(`SELECT ${sumQueryParts} FROM ${tableName}`);
        const totals = totalResult.toArray()[0].toJSON();

        // Top Performer
        const mainMetric = numericCols[numericCols.length - 1]; 
        const topResult = await conn.query(`
            SELECT "${labelCol}", "${mainMetric}" 
            FROM ${tableName} 
            ORDER BY "${mainMetric}" DESC 
            LIMIT 1
        `);
        const topRow = topResult.toArray()[0]?.toJSON();

        let html = `<div style="padding: 10px;">`;
        if (topRow) {
            html += `<div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <h3 style="margin-top:0;">🏆 Leader: ${topRow[labelCol]}</h3>
                <p>Score: <strong>${Number(topRow[mainMetric]).toLocaleString()}</strong></p>
            </div>`;
        }

        html += `<h3>📊 Totals</h3><table class="detail-table" style="width:100%"><tbody>`;
        numericCols.forEach(col => {
            if (!col.toLowerCase().includes('id')) {
                html += `<tr><td>${col}</td><td style="text-align:right;">${Number(totals[col]).toLocaleString()}</td></tr>`;
            }
        });
        html += `</tbody></table></div>`;
        modalBody.innerHTML = html;

    } catch (e) {
        modalBody.innerHTML = `<p style="color:red">Error: ${e.message}</p>`;
    }
}

// ==========================================
// 9. SQL FILTERING & RENDERING
// ==========================================

async function setupFilterDropdown(tableName) {
    const schema = await conn.query(`DESCRIBE ${tableName}`);
    const dropdown = document.getElementById("column-select");
    dropdown.innerHTML = '<option value="all">All Columns</option>';
    
    const rows = schema.toArray();
    rows.forEach(row => {
        const option = document.createElement("option");
        option.value = row.column_name;
        option.innerText = row.column_name;
        dropdown.appendChild(option);
    });
}

async function applyTableFilter() {
    const filterText = document.getElementById("filter-input").value.replace(/'/g, "''"); 
    const column = document.getElementById("column-select").value;
    const limit = document.getElementById("row-limit-select").value;
    const tableName = `table_${activePaneId.replace('-', '_')}`;
    
    let query = `SELECT * FROM ${tableName}`;
    
    if (filterText) {
        if (column === "all") query += ` WHERE CAST(column0 AS VARCHAR) LIKE '%${filterText}%'`; 
        else query += ` WHERE CAST("${column}" AS VARCHAR) LIKE '%${filterText}%'`;
    }
    
    if (limit !== "all") query += ` LIMIT ${limit}`;

    try {
        const result = await conn.query(query);
        renderTableFromArrow(result);
    } catch (e) {
        console.log("Empty or Error");
    }
}

let currentArrowData = null; 

// RENDER TABLE (CSS Styled)
function renderTableFromArrow(arrowResult) {
    const pane = document.getElementById(activePaneId);
    if(!pane) return;
    const container = pane.querySelector(".content-area");
    
    const rows = arrowResult.toArray().map(r => r.toJSON());
    currentArrowData = rows; 

    if (rows.length === 0) {
        container.innerHTML = "<p style='text-align:center; padding:20px; color:#666;'>No matches found.</p>";
        return;
    }

    const headers = Object.keys(rows[0]);
    
    let html = `<table class="data-table"><thead><tr>`;
    
    headers.forEach(h => html += `<th>${h}</th>`);
    html += `</tr></thead><tbody>`;

    rows.forEach((row, index) => {
        html += `<tr onclick="window.showRowDetails(${index})" title="Click to view full details">`;
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
