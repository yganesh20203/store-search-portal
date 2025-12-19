// ==========================================
// 1. GLOBAL STATE
// ==========================================
let accessToken = ""; 
let currentMonthFolderId = "";
let currentReportData = []; // Stores the raw data for filtering

// ==========================================
// 2. AUTHENTICATION
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
// 3. SALES ENGINE (Pure JS - Ultra Fast)
// ==========================================

async function loadSalesDashboard() {
    document.getElementById("sales-ui").classList.remove("hidden");
    const listContainer = document.getElementById("month-list");
    listContainer.innerHTML = "Loading...";

    const query = `'${CONFIG.SALES_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name)`;

    try {
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        
        if(!response.ok) throw new Error("Folder access denied. Check ID/Permissions.");
        
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
        listContainer.innerHTML = `<span style="color:red">Error: ${e.message}</span>`;
    }
}

function selectMonth(folderId, btnElement) {
    currentMonthFolderId = folderId;
    document.querySelectorAll(".folder-btn").forEach(b => b.classList.remove("active"));
    btnElement.classList.add("active");
    document.getElementById("store-search-box").classList.remove("hidden");
    
    // Reset Data view
    document.getElementById("content-area").innerHTML = "";
    document.getElementById("filter-box").classList.add("hidden");
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
            await downloadAndParseCSV(data.files[0].id);
        } else {
            outputDiv.innerHTML = `<p style="color:red">File ${storeId}.csv not found.</p>`;
        }
    } catch (e) {
        outputDiv.innerHTML = "Error: " + e.message;
    }
}

// --- NEW: PapaParse Logic (Instant) ---
async function downloadAndParseCSV(fileId) {
    try {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { "Authorization": `Bearer ${accessToken}` }
        });
        const csvText = await response.text();

        // Parse CSV using PapaParse (No Python needed!)
        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                currentReportData = results.data;
                setupFilterDropdown();
                renderTable(currentReportData);
            }
        });

    } catch (e) {
        console.error(e);
        document.getElementById("content-area").innerHTML = "Processing Error: " + e.message;
    }
}

// ==========================================
// 4. RENDERING & FILTERING
// ==========================================

function setupFilterDropdown() {
    const dropdown = document.getElementById("column-select");
    const filterBox = document.getElementById("filter-box");
    
    // Clear old options
    dropdown.innerHTML = '<option value="all">All Columns</option>';
    
    // Get headers from first row of data
    if (currentReportData.length > 0) {
        const headers = Object.keys(currentReportData[0]);
        headers.forEach(header => {
            const option = document.createElement("option");
            option.value = header;
            option.innerText = header;
            dropdown.appendChild(option);
        });
    }

    // Unhide the Filter UI
    filterBox.classList.remove("hidden");
}

function renderTable(data) {
    const container = document.getElementById("content-area");
    if (!data || data.length === 0) {
        container.innerHTML = "<p>No matches found.</p>";
        return;
    }

    // Limit to 500 rows for performance
    const displayData = data.slice(0, 500); 
    const headers = Object.keys(displayData[0]);

    let html = `<table><thead><tr>`;
    headers.forEach(h => html += `<th>${h}</th>`);
    html += `</tr></thead><tbody>`;

    displayData.forEach(row => {
        html += `<tr>`;
        headers.forEach(h => {
            html += `<td>${row[h] || ''}</td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table>`;
    
    if (data.length > 500) {
        html += `<p style="color:blue; font-size:12px; margin-top:5px;">*Displaying first 500 rows. Use filter to narrow down results.</p>`;
    }

    container.innerHTML = html;
}

function applyTableFilter() {
    const filterText = document.getElementById("filter-input").value.toLowerCase();
    const column = document.getElementById("column-select").value;

    if (!filterText) {
        renderTable(currentReportData);
        return;
    }

    const filtered = currentReportData.filter(row => {
        if (column === "all") {
            return Object.values(row).some(val => String(val).toLowerCase().includes(filterText));
        } else {
            return String(row[column] || "").toLowerCase().includes(filterText);
        }
    });

    renderTable(filtered);
}
