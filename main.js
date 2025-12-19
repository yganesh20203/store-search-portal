// ==========================================
// 1. GLOBAL STATE
// ==========================================
let accessToken = ""; 
let pyodide = null;
let currentMonthFolderId = "";
let currentReportData = []; // Store raw data here for fast filtering

// ==========================================
// 2. AUTHENTICATION (Phase 2)
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
        
        initPyodideEngine(); // Start Python in background

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
// 3. SALES ENGINE (Phase 3 - OPTIMIZED)
// ==========================================

async function initPyodideEngine() {
    if (pyodide) return;
    try {
        pyodide = await loadPyodide();
        await pyodide.loadPackage("pandas");
        console.log("Python Ready!");
    } catch (e) {
        console.error("Pyodide Load Failed", e);
    }
}

async function loadSalesDashboard() {
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
                btn.onclick = () => selectMonth(folder.id, btn);
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

async function findAndLoadReport() {
    const storeId = document.getElementById("store-id-input").value.trim();
    if (!storeId) { alert("Enter Store ID"); return; }

    const outputDiv = document.getElementById("content-area");
    outputDiv.innerHTML = `<p>🔍 Finding ${storeId}.csv...</p>`;

    const query = `'${currentMonthFolderId}' in parents and name = '${storeId}.csv' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name)`;

    try {
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();

        if (data.files && data.files.length > 0) {
            outputDiv.innerHTML = "<p>⬇️ Downloading & Processing...</p>";
            await processCsvOptimized(data.files[0].id);
        } else {
            outputDiv.innerHTML = `<p style="color:red">File ${storeId}.csv not found.</p>`;
        }
    } catch (e) {
        outputDiv.innerHTML = "Error: " + e.message;
    }
}

// --- THE NEW OPTIMIZED PROCESSOR ---
async function processCsvOptimized(fileId) {
    if (!pyodide) { alert("Python is still loading. Wait 5s."); return; }

    try {
        // 1. Download CSV
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { "Authorization": `Bearer ${accessToken}` }
        });
        const csvText = await response.text();

        // 2. Python converts CSV -> JSON (Much lighter than HTML)
        pyodide.globals.set("csv_content", csvText);
        const pythonScript = `
import pandas as pd
import io
import json

data = io.StringIO(csv_content)
df = pd.read_csv(data)
# Convert to JSON string (records format: [{"col": val}, ...])
df.to_json(orient='records')
        `;

        const jsonString = await pyodide.runPythonAsync(pythonScript);
        
        // 3. Store Data in JS Memory
        currentReportData = JSON.parse(jsonString);

        // 4. Initialize the Filter UI
        setupFilterDropdown();

        // 5. Render Table (First 100 rows for speed)
        renderTable(currentReportData);

    } catch (e) {
        console.error(e);
        document.getElementById("content-area").innerHTML = "Processing Error: " + e.message;
    }
}

// --- JAVASCRIPT RENDERING & FILTERING (ZERO LATENCY) ---

function setupFilterDropdown() {
    const dropdown = document.getElementById("column-select");
    const filterBox = document.getElementById("filter-box");
    
    // Clear old options
    dropdown.innerHTML = '<option value="all">All Columns</option>';
    
    // Get headers from first row
    if (currentReportData.length > 0) {
        const headers = Object.keys(currentReportData[0]);
        headers.forEach(header => {
            const option = document.createElement("option");
            option.value = header;
            option.innerText = header;
            dropdown.appendChild(option);
        });
    }

    // Show Filter UI
    filterBox.classList.remove("hidden");
}

function renderTable(data) {
    if (data.length === 0) {
        document.getElementById("content-area").innerHTML = "<p>No matches found.</p>";
        return;
    }

    // Limit display to 500 rows to prevent browser freeze
    const displayData = data.slice(0, 500); 
    const headers = Object.keys(displayData[0]);

    let html = `<table><thead><tr>`;
    
    // Build Headers
    headers.forEach(h => html += `<th>${h}</th>`);
    html += `</tr></thead><tbody>`;

    // Build Rows
    displayData.forEach(row => {
        html += `<tr>`;
        headers.forEach(h => {
            html += `<td>${row[h] !== null ? row[h] : ''}</td>`;
        });
        html += `</tr>`;
    });

    html += `</tbody></table>`;
    
    if (data.length > 500) {
        html += `<p style="color:blue; font-size:12px;">*Showing first 500 rows of ${data.length}. Filter to see specific data.</p>`;
    }

    document.getElementById("content-area").innerHTML = html;
}

// Called instantly when user types
function applyTableFilter() {
    const filterText = document.getElementById("filter-input").value.toLowerCase();
    const column = document.getElementById("column-select").value;

    if (!filterText) {
        renderTable(currentReportData); // Show all if empty
        return;
    }

    const filtered = currentReportData.filter(row => {
        if (column === "all") {
            // Search ALL columns
            return Object.values(row).some(val => 
                String(val).toLowerCase().includes(filterText)
            );
        } else {
            // Search SPECIFIC column
            return String(row[column]).toLowerCase().includes(filterText);
        }
    });

    renderTable(filtered);
}

// Optional: Test connection
async function testDriveConnection() {
    // Keep your existing test logic here if you want
}
