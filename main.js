// ==========================================
// 1. GLOBAL STATE
// ==========================================
let accessToken = ""; 
let currentMonthFolderId = "";
let currentReportData = []; // Raw Data
let currentSortColumn = ""; // Which column is currently sorted
let currentSortOrder = "asc"; // "asc" or "desc"
let currentDisplayData = [];

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
// 3. SALES ENGINE
// ==========================================

async function loadSalesDashboard() {
    document.getElementById("sales-ui").classList.remove("hidden");
    const listContainer = document.getElementById("month-list");
    listContainer.innerHTML = "Loading...";

    const query = `'${CONFIG.SALES_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name)`;

    try {
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        if(!response.ok) throw new Error("Folder access denied.");
        
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
    currentReportData = [];
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

async function downloadAndParseCSV(fileId) {
    try {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { "Authorization": `Bearer ${accessToken}` }
        });
        const csvText = await response.text();

        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true, // Auto-detect numbers vs text
            complete: function(results) {
                currentReportData = results.data;
                setupFilterDropdown();
                renderTable(currentReportData); // Initial Render
            }
        });

    } catch (e) {
        console.error(e);
        document.getElementById("content-area").innerHTML = "Processing Error: " + e.message;
    }
}

// ==========================================
// 4. RENDERING, FILTERING & SORTING
// ==========================================

function setupFilterDropdown() {
    const dropdown = document.getElementById("column-select");
    const filterBox = document.getElementById("filter-box");
    
    dropdown.innerHTML = '<option value="all">All Columns</option>';
    
    if (currentReportData.length > 0) {
        const headers = Object.keys(currentReportData[0]);
        headers.forEach(header => {
            const option = document.createElement("option");
            option.value = header;
            option.innerText = header;
            dropdown.appendChild(option);
        });
    }
    filterBox.classList.remove("hidden");
}

function handleSort(column) {
    // Toggle sort order if clicking same column
    if (currentSortColumn === column) {
        currentSortOrder = currentSortOrder === "asc" ? "desc" : "asc";
    } else {
        currentSortColumn = column;
        currentSortOrder = "asc";
    }
    // Re-render (Apply filter & sort)
    applyTableFilter();
}

function renderTable(data) {
    const container = document.getElementById("content-area");
    if (!data || data.length === 0) {
        container.innerHTML = "<p>No matches found.</p>";
        return;
    }

    // 1. Get User Row Limit
    const limitSelect = document.getElementById("row-limit-select").value;
    const limit = limitSelect === "all" ? data.length : parseInt(limitSelect);

    // 2. Slice Data
    const displayData = data.slice(0, limit); 
    const headers = Object.keys(displayData[0]);

    // 3. Build HTML
    let html = `<table><thead><tr>`;
    headers.forEach(h => {
        // Add sorting arrow indicator
        let arrow = "";
        if (h === currentSortColumn) {
            arrow = currentSortOrder === "asc" ? " ⬆️" : " ⬇️";
        }
        // Make header clickable
        html += `<th onclick="handleSort('${h}')" style="cursor:pointer; user-select:none;">
                    ${h}${arrow}
                 </th>`;
    });
    html += `</tr></thead><tbody>`;

    displayData.forEach(row => {
        html += `<tr>`;
        headers.forEach(h => {
            html += `<td>${row[h] !== null ? row[h] : ''}</td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table>`;
    
    // 4. Footer Info
    html += `<p style="font-size:12px; margin-top:5px; color:#555;">
             Showing <b>${displayData.length}</b> of <b>${data.length}</b> matching rows.
             </p>`;

    container.innerHTML = html;
}

function applyTableFilter() {
    const filterText = document.getElementById("filter-input").value.toLowerCase();
    const column = document.getElementById("column-select").value;
    
    // 1. Filter
    let processedData = currentReportData;

    if (filterText) {
        processedData = currentReportData.filter(row => {
            if (column === "all") {
                return Object.values(row).some(val => String(val).toLowerCase().includes(filterText));
            } else {
                return String(row[column] || "").toLowerCase().includes(filterText);
            }
        });
    }

    // 2. Sort
    if (currentSortColumn) {
        processedData.sort((a, b) => {
            let valA = a[currentSortColumn];
            let valB = b[currentSortColumn];
            
            // Handle undefined/null
            if (valA == null) valA = "";
            if (valB == null) valB = "";

            // Check if numbers
            const numA = parseFloat(valA);
            const numB = parseFloat(valB);
            
            if (!isNaN(numA) && !isNaN(numB)) {
                return currentSortOrder === "asc" ? numA - numB : numB - numA;
            } else {
                // String sort
                return currentSortOrder === "asc" ? 
                       String(valA).localeCompare(String(valB)) : 
                       String(valB).localeCompare(String(valA));
            }
        });
    }

    // 3. Render
    renderTable(processedData);
}
