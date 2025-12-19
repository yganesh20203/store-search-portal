import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm";

// ==========================================
// 1. GLOBAL STATE
// ==========================================
let accessToken = ""; 
let currentMonthFolderId = "";
let db = null; // DuckDB Instance
let conn = null; // DuckDB Connection
let currentTableName = "current_data"; // Table name in SQL

// Attach functions to window so HTML buttons can see them
window.unlockAndLogin = unlockAndLogin;
window.loadSalesDashboard = loadSalesDashboard;
window.loadMemberDashboard = loadMemberDashboard;
window.findAndLoadReport = findAndLoadReport;
window.selectMonth = selectMonth;
window.applyTableFilter = applyTableFilter;
window.closeModal = closeModal;

// ==========================================
// 2. INITIALIZE DUCKDB (The Engine)
// ==========================================
async function initDuckDB() {
    if (db) return; // Already loaded
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
        
        // Start DuckDB in background
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
        scope: "https://www.googleapis.com/auth/drive.readonly",
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
// 4. DASHBOARD LOGIC
// ==========================================

async function loadSalesDashboard() {
    document.getElementById("sales-ui").classList.remove("hidden");
    document.getElementById("member-ui").classList.add("hidden");
    document.getElementById("filter-box").classList.add("hidden");
    document.getElementById("content-area").innerHTML = "";

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
    document.getElementById("filter-box").classList.add("hidden");
}

// Load MEMBER Dashboard (Parquet Files)
async function loadMemberDashboard() {
    document.getElementById("member-ui").classList.remove("hidden");
    document.getElementById("sales-ui").classList.add("hidden");
    document.getElementById("filter-box").classList.add("hidden");
    document.getElementById("content-area").innerHTML = "";

    const listContainer = document.getElementById("member-file-list");
    listContainer.innerHTML = "Loading Files...";

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
                btn.onclick = () => loadParquetFile(file.id, file.name);
                listContainer.appendChild(btn);
            });
        } else {
            listContainer.innerHTML = "No files found in Member DB.";
        }
    } catch (e) {
        listContainer.innerHTML = "Error: " + e.message;
    }
}

// ==========================================
// 5. PARQUET & CSV LOADING (Dual Engine)
// ==========================================

async function findAndLoadReport() {
    // Logic for Sales CSV (Reuse CSV Parsing)
    // For simplicity, we can route CSVs through DuckDB too!
    alert("Please ensure Sales logic is using DuckDB or kept separate. Focus on Member DB for now.");
}

async function loadParquetFile(fileId, fileName) {
    const statusDiv = document.getElementById("loading-status");
    document.getElementById("filter-box").classList.remove("hidden");
    statusDiv.innerHTML = "⏳ Downloading file... (This may take a minute for 400MB)";
    document.getElementById("content-area").innerHTML = "";

    try {
        // 1. Download File as BLOB
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { "Authorization": `Bearer ${accessToken}` }
        });
        
        if (!response.ok) throw new Error("Download failed");

        statusDiv.innerHTML = "💾 File Downloaded. Loading into DuckDB Engine...";
        
        // 2. Load into DuckDB
        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Register file in DuckDB virtual filesystem
        await db.registerFileBuffer(fileName, uint8Array);
        
        // Create Table from Parquet
        // DuckDB automatically detects Parquet vs CSV based on content/extension usually,
        // but explicit is better. Assuming Parquet here.
        if (fileName.endsWith('.parquet')) {
             await conn.query(`CREATE OR REPLACE TABLE ${currentTableName} AS SELECT * FROM parquet_scan('${fileName}')`);
        } else {
             // Fallback for CSV
             await conn.query(`CREATE OR REPLACE TABLE ${currentTableName} AS SELECT * FROM read_csv_auto('${fileName}')`);
        }

        statusDiv.innerHTML = "✅ Data Ready! Rendering...";
        
        // 3. Setup UI
        await setupFilterDropdown();
        await applyTableFilter(); // Initial Render
        statusDiv.innerHTML = "";

    } catch (e) {
        console.error(e);
        statusDiv.innerHTML = `<span style="color:red">Error: ${e.message}</span>`;
    }
}

// ==========================================
// 6. SQL FILTERING & RENDERING
// ==========================================

async function setupFilterDropdown() {
    // Get Columns using SQL
    const schema = await conn.query(`DESCRIBE ${currentTableName}`);
    const dropdown = document.getElementById("column-select");
    dropdown.innerHTML = '<option value="all">All Columns</option>';
    
    // Convert Apache Arrow result to array
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
    const filterText = document.getElementById("filter-input").value.replace(/'/g, "''"); // Escape quotes
    const column = document.getElementById("column-select").value;
    const limit = document.getElementById("row-limit-select").value;
    
    let query = `SELECT * FROM ${currentTableName}`;
    
    // Add WHERE clause if searching
    if (filterText) {
        if (column === "all") {
            // This is harder in SQL without knowing all columns. 
            // Simplified: Force user to pick a column OR just search the first few text columns?
            // For stability, let's just warn if "All" is picked, or search a known text column.
            // Better: Iterate columns and build "OR col LIKE"
            // For now, let's stick to simple single column search or basic generic
             query += ` WHERE CAST(Store_No AS VARCHAR) LIKE '%${filterText}%' OR CAST(Article_Description AS VARCHAR) LIKE '%${filterText}%'`;
        } else {
            query += ` WHERE CAST("${column}" AS VARCHAR) LIKE '%${filterText}%'`;
        }
    }
    
    // Add Limit
    if (limit !== "all") {
        query += ` LIMIT ${limit}`;
    }

    try {
        const result = await conn.query(query);
        renderTableFromArrow(result);
    } catch (e) {
        console.error("Query Error", e);
    }
}

let currentArrowData = null; // Store for modal

function renderTableFromArrow(arrowResult) {
    const container = document.getElementById("content-area");
    
    // Arrow Objects are complex, convert to simple JSON for rendering (LIMIT is low so this is fine)
    const rows = arrowResult.toArray().map(r => r.toJSON());
    currentArrowData = rows; // Save for modal

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
             // Handle BigInt logic for arrow if needed
             let val = row[h];
             html += `<td>${val !== null ? val : ''}</td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table>`;
    
    container.innerHTML = html;
}

// Modal Logic
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

// Click outside close
window.onclick = function(event) {
    const modal = document.getElementById("detail-modal");
    if (event.target == modal) closeModal();
}
