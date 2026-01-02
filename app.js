import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm";

// ==========================================
// 1. GLOBAL STATE
// ==========================================
let accessToken = ""; 
let currentMonthFolderId = "";
let db = null; 
let conn = null; 
let activePaneId = "pane-0"; 
let hourlyFilesCache = []; 
let walkinHistoryStack = []; 
let currentArrowData = [];
let currentChartInstance = null;
let chartState = { x: null, y: [] };
let allTasksCache = [];
// Excel & Pivot Globals
let currentExcelWorkbook = null;
let currentExcelFileName = "";
let currentPivotTableName = ""; 
let bulkCsvData = [];
let bulkCsvHeaders = [];  
let selectedGroupCol = "";
// Map Global
let mapInstance = null;
let mapLayers = {
    flipkart: null,
    metro: null,
    dmart: null
};

// ==========================================
// 2. ATTACH FUNCTIONS TO WINDOW
// ==========================================
window.unlockAndLogin = unlockAndLogin;
window.loadSalesDashboard = loadSalesDashboard;
window.loadMemberDashboard = loadMemberDashboard;
window.loadTrackerDashboard = loadTrackerDashboard; 
window.loadHourlyDashboard = loadHourlyDashboard; 
window.loadTicketDashboard = loadTicketDashboard; 
window.loadWalkinDashboard = loadWalkinDashboard; 
window.loadWalkinCategory = loadWalkinCategory;
window.loadDailyUpdateDashboard = loadDailyUpdateDashboard; 
window.loadWorkDashboard = loadWorkDashboard; 
window.handleLocalFileUpload = handleLocalFileUpload; 
window.processExcelConversion = processExcelConversion; 
window.loadRemotePivotFile = loadRemotePivotFile; 
window.fetchDailyUpdates = fetchDailyUpdates; 
window.findAndLoadReport = findAndLoadReport;
window.loadFileIntoDuckDB = loadFileIntoDuckDB; 
window.selectMonth = selectMonth;
window.applyTableFilter = applyTableFilter;
window.closeModal = closeModal;
window.summarizeData = summarizeData; 
window.changeLayout = changeLayout;
window.setActivePane = setActivePane;
window.filterHourlyImagesByDate = filterHourlyImagesByDate; 
window.openFeedbackModal = openFeedbackModal;
window.closeFeedbackModal = closeFeedbackModal;
window.submitFeedback = submitFeedback;
window.createTicket = createTicket; 
window.openResolveModal = openResolveModal; 
window.closeResolveModal = closeResolveModal; 
window.confirmResolve = confirmResolve; 
window.showRowDetails = showRowDetails;
window.loadApprovalsDashboard = loadApprovalsDashboard;
window.redirectMailSearch = redirectMailSearch;
window.loadBusinessDashboard = loadBusinessDashboard;
window.toggleMapLayer = toggleMapLayer;
window.logout = logout;
window.toggleVisualization = toggleVisualization;
window.handleBulkTaskUpload = handleBulkTaskUpload;
window.filterTasks = filterTasks;
window.openTaskActionModal = openTaskActionModal;
window.submitTaskAction = submitTaskAction;
window.toggleTaskActionUI = toggleTaskActionUI;


// ==========================================
// 3. INITIALIZE DUCKDB
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
// 4. AUTHENTICATION & SESSION LOGIC
// ==========================================

let sessionTimerInterval = null;
let activeSessionSeconds = 0;
let currentSessionRow = null; // Stores the exact Excel Row # (e.g., 15)
let sessionInteractionCount = 0; // Counts clicks & keystrokes

// 1. Start Tracking Interactions Immediately
document.addEventListener('click', () => { sessionInteractionCount++; });
document.addEventListener('keydown', () => { sessionInteractionCount++; });

async function unlockAndLogin() {
    const accessKey = document.getElementById("access-key").value;
    const username = document.getElementById("login-user").value.trim();
    const password = document.getElementById("login-pass").value.trim();
    
    const btn = document.getElementById("login-btn");
    const errorMsg = document.getElementById("error-msg");

    if(!accessKey) { showLoginError("⚠️ Missing Team Access Key"); return; }
    if(!username || !password) { showLoginError("⚠️ Enter Username & Password."); return; }

    btn.innerText = "🔄 Verifying...";
    btn.disabled = true;
    errorMsg.style.display = "none";

    try {
        if (typeof CONFIG === 'undefined') throw new Error("Config not loaded.");

        // 1. Decrypt (Gatekeeper)
        const bytes = CryptoJS.AES.decrypt(CONFIG.ENCRYPTED_CREDS, accessKey);
        const decryptedString = bytes.toString(CryptoJS.enc.Utf8);
        if (!decryptedString) throw new Error("Incorrect Access Key");

        const creds = JSON.parse(decryptedString);
        accessToken = await generateAccessToken(creds);

        // 2. Check Backend Credentials
        btn.innerText = "🔍 Checking DB...";
        const isValidUser = await checkBackendCredentials(username, password);

        // 3. Unlock Dashboard
        document.getElementById("auth-overlay").classList.add("hidden");
        document.getElementById("dashboard").classList.remove("hidden");
        localStorage.setItem("portal_user_email", username);
        document.getElementById("user-info").innerText = `● ${username}`;
        initDuckDB();

        // 4. Create Initial Log Entry (Get the Row Number)
        // We reset interaction count on new login
        sessionInteractionCount = 0; 
        
        if (isValidUser) {
            console.log("✅ Valid User. Creating Session Row...");
            // Create the row and save the Row ID
            await createSessionRow(username, "VALID_USER");
            startSilentUsageTimer(username); 
        } else {
            console.warn("⛔ Guest User.");
            // Even guests get a row so we can track their clicks/time before kickout
            await createSessionRow(username, "GUEST_INVALID");
            startGuestCountdown();
            alert(`⚠️ User not found.\n\nGranted GUEST ACCESS for 2 minutes.`);
        }

    } catch (e) {
        console.error(e);
        showLoginError("❌ " + e.message);
        btn.innerText = "Unlock & Login";
        btn.disabled = false;
    }
}

// --- HELPER: Verify Credentials ---
async function checkBackendCredentials(user, pass) {
    if (!CONFIG.USER_DB_SHEET_ID) return true; 
    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.USER_DB_SHEET_ID}/values/Sheet2!A:B`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();
        if (!data.values) return false;

        return !!data.values.find(row => 
            row[0] && row[0].toString().toLowerCase() === user.toLowerCase() && 
            row[1] && row[1].toString() === pass
        );
    } catch (e) { return false; }
}


// --- LOGGING STEP 1: CREATE THE ROW (Targeting Sheet3) ---
async function createSessionRow(user, status) {
    if (!CONFIG.LOGIN_LOG_SHEET_ID) return;
    
    const startTime = new Date().toLocaleString();
    const initialData = [[ startTime, user, status, "0", "0", startTime ]];

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.LOGIN_LOG_SHEET_ID}/values/Sheet3!A1:append?valueInputOption=USER_ENTERED`;
        
        const response = await fetch(url, {
            method: "POST",
            headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: initialData })
        });
        
        const result = await response.json();
        
        // ERROR HANDLING
        if (result.error) {
            console.error("❌ Google Sheets API Error:", result.error);
            alert(`Logging Failed: ${result.error.message}\n\nCheck console for details.`);
            return;
        }
        
        // Success: Extract Row Number
        if (result.updates && result.updates.updatedRange) {
            const rangeStr = result.updates.updatedRange;
            const match = rangeStr.match(/[A-Z]+(\d+):/);
            if (match && match[1]) {
                currentSessionRow = match[1];
                console.log(`📝 Session logged at Sheet3 Row ${currentSessionRow}`);
            }
        }
    } catch (e) { 
        console.error("Network Error during logging:", e); 
    }
}

// --- LOGGING STEP 2: UPDATE THE ROW (Targeting Sheet3) ---
async function updateSessionRow() {
    if (!CONFIG.LOGIN_LOG_SHEET_ID || !currentSessionRow) return;

    const currentTime = new Date().toLocaleString();
    const durationMins = Math.floor(activeSessionSeconds / 60);

    const range = `Sheet3!D${currentSessionRow}:F${currentSessionRow}`;
    const values = [[ durationMins, sessionInteractionCount, currentTime ]];

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.LOGIN_LOG_SHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;
        const response = await fetch(url, {
            method: "PUT",
            headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: values })
        });

        const result = await response.json();
        if (result.error) {
            console.error("❌ Update Log Error:", result.error);
        } else {
            console.log(`📡 Log Updated (Sheet3): ${durationMins}m`);
        }
    } catch (e) { console.warn("Update Log failed:", e); }
}
// --- SCENARIO A: Valid User Timer ---
function startSilentUsageTimer(username) {
    const ui = document.getElementById("session-timer-ui");
    if (ui) ui.classList.add("hidden");

    activeSessionSeconds = 0;
    if (sessionTimerInterval) clearInterval(sessionTimerInterval);

    sessionTimerInterval = setInterval(() => {
        activeSessionSeconds++;
        
        // Update the sheet every 1 minute
        if (activeSessionSeconds > 0 && activeSessionSeconds % 60 === 0) {
            updateSessionRow();
        }
    }, 1000);
}

// --- SCENARIO B: Guest Timer ---
function startGuestCountdown() {
    const ui = document.getElementById("session-timer-ui");
    const text = document.getElementById("session-text");
    
    ui.classList.remove("hidden");
    let timeLeft = 120; // 2 Minutes
    
    if (sessionTimerInterval) clearInterval(sessionTimerInterval);

    sessionTimerInterval = setInterval(() => {
        timeLeft--;
        activeSessionSeconds++; // Also track duration for logging
        
        const m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
        const s = (timeLeft % 60).toString().padStart(2, '0');
        text.innerText = `Guest: ${m}:${s}`;
        
        // Still update log every minute so we see guest activity
        if (activeSessionSeconds % 60 === 0) {
            updateSessionRow();
        }

        if (timeLeft <= 0) {
            clearInterval(sessionTimerInterval);
            // Final update before kicking them out
            updateSessionRow();
            alert("⏳ Guest Session Expired.");
            window.logout();
        }
    }, 1000);
}

function showLoginError(msg) {
    const el = document.getElementById("error-msg");
    el.innerText = msg;
    el.style.display = "block";
}
// ==========================================
// 5. UI HELPERS & FEEDBACK
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
        if (i === 0) div.classList.add("active"); 
        
        div.onclick = () => window.setActivePane(paneId);

        div.innerHTML = `
            <span class="pane-label">View ${i + 1}</span>
            <div class="content-area">
                <div class="empty-msg">Select a file to load here</div>
            </div>
        `;
        container.appendChild(div);
    }
    activePaneId = "pane-0";
}

function setActivePane(id) {
    document.querySelectorAll(".pane").forEach(p => p.classList.remove("active"));
    const pane = document.getElementById(id);
    if(pane) pane.classList.add("active");
    activePaneId = id;
}

function resetUI() {
    // Hide all Dashboard Controls
    document.getElementById("sales-ui").classList.add("hidden");
    document.getElementById("member-ui").classList.add("hidden");
    document.getElementById("tracker-ui").classList.add("hidden");
    document.getElementById("hourly-ui").classList.add("hidden"); 
    document.getElementById("ticket-ui").classList.add("hidden"); 
    document.getElementById("walkin-ui").classList.add("hidden");
    document.getElementById("daily-ui").classList.add("hidden");
    document.getElementById("work-ui").classList.add("hidden");
    document.getElementById("approvals-ui").classList.add("hidden"); 
    document.getElementById("business-ui").classList.add("hidden"); 
    
    // Reset Data View Containers
    document.getElementById("view-container").classList.remove("hidden"); // Default Grid
    document.getElementById("pivot-wrapper").classList.add("hidden");     // Hide Pivot
    document.getElementById("filter-box").classList.remove("hidden");     // Show SQL Filters
    
    document.getElementById("sheet-link-container").innerHTML = "";
}

// --- FEEDBACK ---
function openFeedbackModal() { document.getElementById("feedback-modal").classList.remove("hidden"); }
function closeFeedbackModal() { document.getElementById("feedback-modal").classList.add("hidden"); }

async function submitFeedback() {
    const text = document.getElementById("feedback-text").value;
    const storeId = document.getElementById("store-id-input")?.value || "N/A";
    
    if(!text) { alert("Please type some feedback!"); return; }
    if(!CONFIG.FEEDBACK_SHEET_ID) { alert("Feedback Sheet ID missing in config.js"); return; }

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.FEEDBACK_SHEET_ID}/values/A1:append?valueInputOption=USER_ENTERED`;
        const body = { values: [[ new Date().toLocaleString(), storeId, text ]] };

        const response = await fetch(url, {
            method: "POST",
            headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if(response.ok) {
            alert("✅ Feedback Sent!");
            document.getElementById("feedback-text").value = "";
            closeFeedbackModal();
        } else {
            const err = await response.json();
            alert("Error: " + err.error.message);
        }
    } catch(e) { alert("Network Error: " + e.message); }
}

// ==========================================
// 6. DASHBOARD LOADERS
// ==========================================

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

async function loadWalkinDashboard() {
    resetUI();
    document.getElementById("walkin-ui").classList.remove("hidden");
    const catList = document.getElementById("walkin-category-list");
    const fileContainer = document.getElementById("walkin-files-container");
    catList.innerHTML = "";
    fileContainer.classList.add("hidden");

    if (CONFIG.WALKIN_FOLDERS) {
        Object.keys(CONFIG.WALKIN_FOLDERS).forEach(groupName => {
            const btn = document.createElement("button");
            btn.className = "folder-btn";
            btn.style.background = "#b2dfdb";
            btn.style.fontWeight = "bold";
            btn.innerText = groupName;
            const folderId = CONFIG.WALKIN_FOLDERS[groupName];
            btn.onclick = () => loadWalkinCategory(groupName, folderId, 'dashboard');
            catList.appendChild(btn);
        });
    } else {
        catList.innerHTML = "<p>No Walkin folders configured.</p>";
    }
}

async function loadWalkinCategory(title, folderId, backMode = null) {
    const container = document.getElementById("walkin-files-container");
    const list = document.getElementById("walkin-file-list");
    const titleElem = document.getElementById("walkin-files-title");
    
    container.classList.remove("hidden");
    titleElem.innerText = `📂 ${title}`;
    list.innerHTML = "⏳ Loading...";

    if (backMode === 'dashboard') walkinHistoryStack = []; 

    if (!folderId || folderId.includes("PASTE")) {
        list.innerHTML = "<p style='color:red'>Folder ID not configured in config.js</p>";
        return;
    }

    if (walkinHistoryStack.length > 0) {
        const backBtn = document.createElement("button");
        backBtn.className = "folder-btn";
        backBtn.style.background = "#e0e0e0";
        backBtn.style.width = "100%";
        backBtn.style.marginBottom = "10px";
        backBtn.innerHTML = "⬅️ Back";
        backBtn.onclick = () => {
            const prev = walkinHistoryStack.pop();
            loadWalkinCategory(prev.title, prev.id, 'back');
        };
        list.innerHTML = ""; 
        list.appendChild(backBtn);
    } else {
        list.innerHTML = "";
    }

    const query = `'${folderId}' in parents and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name, mimeType, thumbnailLink, webViewLink)&orderBy=folder,name&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    try {
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();

        if (data.files && data.files.length > 0) {
            data.files.forEach(file => {
                const btn = document.createElement("button");
                btn.className = "folder-btn";
                btn.style.background = "#ffffff";
                btn.style.border = "1px solid #ddd";
                btn.style.display = "flex";
                btn.style.flexDirection = "column";
                btn.style.alignItems = "center";
                btn.style.width = "140px";
                btn.style.height = "130px";
                btn.style.padding = "10px";
                btn.style.gap = "5px";

                let icon = "";
                let isFolder = (file.mimeType === "application/vnd.google-apps.folder");

                if (isFolder) {
                    icon = `<div style="font-size:40px;">📁</div>`;
                    btn.style.background = "#fff8e1"; 
                } else if (file.mimeType.includes("image") && file.thumbnailLink) {
                    icon = `<img src="${file.thumbnailLink}" style="width:100%; height:60px; object-fit:contain;">`;
                } else if (file.mimeType.includes("spreadsheet")) {
                    icon = `<div style="font-size:30px;">📊</div>`;
                } else {
                    icon = `<div style="font-size:30px;">📄</div>`;
                }

                btn.innerHTML = `${icon}<div style="font-size:11px; overflow:hidden; text-overflow:ellipsis; width:100%; text-align:center;">${file.name}</div>`;

                btn.onclick = () => {
                    if (isFolder) {
                        walkinHistoryStack.push({ title: title, id: folderId });
                        loadWalkinCategory(file.name, file.id, 'push');
                    } else if (file.mimeType.includes("image")) {
                        renderImage(file.id, file.name);
                    } else if (file.mimeType.includes("spreadsheet")) {
                        loadFileIntoDuckDB(file.id, file.name, 'sheet', 0);
                    } else if (file.mimeType.includes("octet-stream") || file.name.endsWith(".parquet") || file.name.endsWith(".csv")) {
                        loadFileIntoDuckDB(file.id, file.name, 'parquet');
                    } else {
                        window.open(file.webViewLink, '_blank');
                    }
                };
                list.appendChild(btn);
            });
        } else {
            list.innerHTML += "<p style='width:100%; text-align:center; color:#777;'>Empty Folder</p>";
        }
    } catch (e) {
        list.innerHTML = "Error: " + e.message;
    }
}

async function loadHourlyDashboard() {
    resetUI();
    document.getElementById("hourly-ui").classList.remove("hidden");
    const dateList = document.getElementById("hourly-date-list");
    const imageList = document.getElementById("hourly-file-list");
    document.getElementById("hourly-images-container").classList.add("hidden");
    
    dateList.innerHTML = "⏳ Scanning Drive for Hourly Images...";
    imageList.innerHTML = "";

    const query = `'${CONFIG.HOURLY_SALES_FOLDER_ID}' in parents and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name, thumbnailLink, createdTime)&orderBy=createdTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    try {
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();
        
        if (data.files && data.files.length > 0) {
            hourlyFilesCache = data.files; 
            
            const dates = {};
            data.files.forEach(file => {
                const dateObj = new Date(file.createdTime);
                const dateKey = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); 
                if (!dates[dateKey]) dates[dateKey] = [];
                dates[dateKey].push(file);
            });

            dateList.innerHTML = "";
            Object.keys(dates).forEach(date => {
                const count = dates[date].length;
                const btn = document.createElement("button");
                btn.className = "folder-btn";
                btn.style.background = "#e1bee7"; 
                btn.style.width = "auto";
                btn.style.padding = "10px 20px";
                btn.innerHTML = `📅 <b>${date}</b> <br><span style="font-size:0.8em;">(${count} updates)</span>`;
                btn.onclick = () => filterHourlyImagesByDate(date);
                dateList.appendChild(btn);
            });

        } else {
            dateList.innerHTML = `<div style="color:red; text-align:center;">❌ No images found.<br><small>Checked Folder: ${CONFIG.HOURLY_SALES_FOLDER_ID}</small></div>`;
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

    const filteredFiles = hourlyFilesCache.filter(f => new Date(f.createdTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) === dateKey);
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
        
        const img = file.thumbnailLink 
            ? `<img src="${file.thumbnailLink}" style="width:100%; height:80px; object-fit:contain; border-radius:4px;">` 
            : `<div style="font-size:30px;">🖼️</div>`;

        btn.innerHTML = `
            ${img}
            <div style="font-size:16px; font-weight:bold; color:#d81b60;">${timeStr}</div>
        `;
        btn.onclick = () => renderImage(file.id, timeStr);
        list.appendChild(btn);
    });
}

async function renderImage(fileId, timeLabel) {
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
        pane.querySelector(".pane-label").innerText = `📷 Snapshot: ${timeLabel}`;
    } catch (e) {
        contentArea.innerHTML = `<p style="color:red">Error loading image: ${e.message}</p>`;
    }
}

async function loadTicketDashboard() {
    resetUI();
    document.getElementById("ticket-ui").classList.remove("hidden");
    const container = document.getElementById("ticket-list-container");
    container.innerHTML = "⏳ Fetching & Securing Data...";

    const currentUser = localStorage.getItem("portal_user_email");
    if (!currentUser) { container.innerHTML = "Please login first."; return; }

    try {
        if (!CONFIG.TICKET_SHEET_ID) { container.innerHTML = "<p>Config Missing</p>"; return; }
        
        // Fetch ALL data, then filter in memory (Client-Side RLS)
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.TICKET_SHEET_ID}/values/Sheet1`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();

        if (!data.values || data.values.length < 2) {
            container.innerHTML = "<p>No tasks found.</p>";
            return;
        }

        // Parse Headers (Row 0) to map indices dynamically
        const headers = data.values[0].map(h => h.toLowerCase());
        // Expected: id, parent_id, date, assigned_by, assigned_to, task, priority, status, visibility
        
        // Map raw array to objects for easier handling
        allTasksCache = data.values.slice(1).map((row, index) => {
            return {
                rowIndex: index + 2, // Sheet Row Number (1-based + header)
                id: row[0],
                parentId: row[1],
                date: row[2],
                by: row[3]?.toLowerCase(),
                to: row[4]?.toLowerCase(),
                task: row[5],
                priority: row[6],
                status: row[7],
                visibility: row[8]?.toLowerCase() || ""
            };
        });

        // Initial Filter: Show "My Tasks" by default
        filterTasks();

    } catch (e) {
        container.innerHTML = "Error: " + e.message;
    }
}

function filterTasks() {
    const container = document.getElementById("ticket-list-container");
    const filterType = document.getElementById("task-filter-view").value;
    const searchText = document.getElementById("task-search").value.toLowerCase();
    const currentUser = localStorage.getItem("portal_user_email").toLowerCase();

    let filtered = [];

    // --- ROW LEVEL SECURITY LOGIC ---
    if (filterType === 'my_tasks') {
        filtered = allTasksCache.filter(t => t.to === currentUser);
    } else if (filterType === 'assigned_by_me') {
        filtered = allTasksCache.filter(t => t.by === currentUser);
    } else if (filterType === 'team') {
        // Show if user is in the 'Visibility' column OR is involved
        filtered = allTasksCache.filter(t => 
            t.visibility.includes(currentUser) || t.to === currentUser || t.by === currentUser
        );
    }

    // --- SEARCH FILTER ---
    if (searchText) {
        filtered = filtered.filter(t => 
            t.task.toLowerCase().includes(searchText) || 
            t.id.toLowerCase().includes(searchText)
        );
    }

    // --- RENDER ---
    if (filtered.length === 0) {
        container.innerHTML = "<p style='padding:20px; text-align:center;'>No tasks found for this view.</p>";
        return;
    }

    let html = `<table class="data-table">
        <thead><tr>
            <th>ID</th><th>Priority</th><th>Task</th><th>Assigned To</th><th>Status</th><th>Actions</th>
        </tr></thead><tbody>`;

    filtered.forEach(t => {
        // Indent subtasks visually
        const isSubtask = t.parentId && t.parentId.length > 2;
        const indentStyle = isSubtask ? "border-left: 4px solid #1976d2; background:#f9fbff;" : "";
        const icon = isSubtask ? "↳ " : "";
        
        // Priority Color
        let priColor = t.priority === "High" ? "#ffebee" : (t.priority === "Medium" ? "#fff3e0" : "#e8f5e9");
        if(t.status === "RESOLVED") priColor = "#f0f0f0"; // Grey out done tasks

        html += `<tr style="${indentStyle} background:${priColor}">
            <td><small>${t.id}</small></td>
            <td style="font-weight:bold; font-size:11px;">${t.priority}</td>
            <td>
                ${icon} ${t.task}
                ${t.parentId ? `<br><small style='color:#888'>Parent: ${t.parentId}</small>` : ''}
            </td>
            <td>${t.to}</td>
            <td>${t.status}</td>
            <td>
                ${t.status !== 'RESOLVED' ? `
                    <button onclick="window.openTaskActionModal('${t.id}', '${t.task.replace(/'/g, "")}')" style="cursor:pointer; padding:4px; font-size:10px;">⚙️ Manage</button>
                    <button onclick="window.openResolveModal('${t.id}', ${t.rowIndex - 1})" style="cursor:pointer; padding:4px; font-size:10px; color:green;">✅ Done</button>
                ` : '✔'}
            </td>
        </tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}

// --- CREATE SINGLE TASK ---
async function createTicket() {
    const email = document.getElementById("tkt-email").value.trim();
    const task = document.getElementById("tkt-task").value;
    const priority = document.getElementById("tkt-priority").value;
    const visibility = document.getElementById("tkt-visibility").value;
    const currentUser = localStorage.getItem("portal_user_email");

    if(!email || !task) { alert("Please fill email and task."); return; }

    const tktId = "TKT-" + Math.floor(Math.random() * 100000);
    const date = new Date().toLocaleDateString();

    // Sheet Row Structure: ID | Parent | Date | By | To | Task | Priority | Status | Visibility
    const row = [[ tktId, "", date, currentUser, email, task, priority, "OPEN", visibility ]];

    await appendRowsToSheet(row);
    alert("✅ Task Assigned!");
    loadTicketDashboard();
}

// --- BULK UPLOAD CSV ---
async function handleBulkTaskUpload(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const rows = text.split("\n").map(r => r.trim()).filter(r => r);
        
        if (rows.length < 2) { alert("CSV is empty"); return; }

        // Store Headers & Data Globally
        bulkCsvHeaders = rows[0].split(",").map(h => h.trim());
        bulkCsvData = rows.slice(1).map(r => r.split(","));

        // Open Wizard - Step 1
        showColumnSelection();
    };
    reader.readAsText(file);
    input.value = ""; // Reset input
}

// 2. SHOW COLUMN OPTIONS (Step 1)
function showColumnSelection() {
    const modal = document.getElementById("bulk-wizard-modal");
    const step1 = document.getElementById("wizard-step-1");
    const step2 = document.getElementById("wizard-step-2");
    const container = document.getElementById("wizard-column-list");
    const btn = document.getElementById("wizard-next-btn");

    modal.classList.remove("hidden");
    step1.classList.remove("hidden");
    step2.classList.add("hidden");
    btn.style.display = "none";
    container.innerHTML = "";

    bulkCsvHeaders.forEach((col, index) => {
        const btn = document.createElement("button");
        btn.innerText = col;
        btn.style.padding = "10px";
        btn.style.border = "1px solid #ccc";
        btn.style.borderRadius = "4px";
        btn.style.cursor = "pointer";
        btn.style.background = "#f0f0f0";
        
        btn.onclick = () => {
            selectedGroupCol = index; // Store column INDEX, not name
            showUserMapping(index);
        };
        container.appendChild(btn);
    });
}

// 3. SHOW MAPPING INPUTS (Step 2)
function showUserMapping(colIndex) {
    const step1 = document.getElementById("wizard-step-1");
    const step2 = document.getElementById("wizard-step-2");
    const container = document.getElementById("wizard-mapping-list");
    const btn = document.getElementById("wizard-next-btn");

    step1.classList.add("hidden");
    step2.classList.remove("hidden");
    btn.style.display = "block";
    container.innerHTML = "";

    // Find unique values in the selected column
    const uniqueValues = [...new Set(bulkCsvData.map(row => row[colIndex]?.trim()))].filter(v => v);

    if(uniqueValues.length === 0) {
        container.innerHTML = "<p>No unique values found in this column.</p>";
        return;
    }

    uniqueValues.forEach(val => {
        const div = document.createElement("div");
        div.style.display = "flex";
        div.style.alignItems = "center";
        div.style.marginBottom = "10px";
        div.style.gap = "10px";

        div.innerHTML = `
            <div style="width:150px; font-weight:bold; overflow:hidden; text-overflow:ellipsis;">${val}</div>
            <span>➡️</span>
            <input type="email" class="mapping-input" data-key="${val}" placeholder="Assign to User ID..." 
                   style="flex:1; padding:8px; border:1px solid #ccc; border-radius:4px;">
        `;
        container.appendChild(div);
    });
}

// 4. PROCESS FINAL ASSIGNMENT (Execute)
async function processBulkMapping() {
    const inputs = document.querySelectorAll(".mapping-input");
    const map = {}; // Stores { "Store A": "user@test.com" }
    
    // Build the map
    inputs.forEach(input => {
        const key = input.getAttribute("data-key");
        const email = input.value.trim();
        if (email) map[key] = email;
    });

    if (Object.keys(map).length === 0) {
        alert("Please assign at least one user.");
        return;
    }

    const batchName = prompt("Name this Batch (e.g. 'Oct Sales'):", "Upload_" + Date.now());
    const currentUser = localStorage.getItem("portal_user_email");
    const newRows = [];

    // Loop through ALL rows in CSV
    bulkCsvData.forEach(row => {
        const groupValue = row[selectedGroupCol]?.trim();
        const assignedUser = map[groupValue]; // Check if we mapped this value

        if (assignedUser) {
            // Build Task Description from ALL columns
            let rowDesc = "";
            bulkCsvHeaders.forEach((h, i) => {
                if (row[i]) rowDesc += `${h}: ${row[i]} | `;
            });

            const tktId = "DAT-" + Math.floor(Math.random() * 1000000);
            
            // Push to Google Sheet
            // ID | Parent | Date | By | To | Task | Priority | Status | Visibility | Batch
            newRows.push([
                tktId, 
                "", 
                new Date().toLocaleDateString(), 
                currentUser, 
                assignedUser, // <--- The mapped user!
                rowDesc, 
                "Medium", 
                "OPEN", 
                "", 
                batchName
            ]);
        }
    });

    if (newRows.length > 0) {
        document.getElementById("wizard-next-btn").innerText = "⏳ Uploading...";
        await appendRowsToSheet(newRows);
        alert(`✅ Success! ${newRows.length} tasks assigned based on your mapping.`);
        document.getElementById("bulk-wizard-modal").classList.add("hidden");
        loadTicketDashboard();
    } else {
        alert("No rows matched your assigned users.");
    }
}

// --- SUBTASKS / REASSIGN LOGIC ---
function openTaskActionModal(id, desc) {
    document.getElementById("action-parent-id").value = id;
    document.getElementById("action-task-desc").innerText = "Selected: " + desc;
    document.getElementById("task-action-modal").classList.remove("hidden");
    toggleTaskActionUI();
}

function toggleTaskActionUI() {
    const type = document.getElementById("task-action-type").value;
    const subContainer = document.getElementById("subtask-desc-container");
    // If dividing, we need a new description. If reassigning, we assume same task description.
    subContainer.style.display = (type === "subtask") ? "block" : "none";
}

async function submitTaskAction() {
    const type = document.getElementById("task-action-type").value;
    const parentId = document.getElementById("action-parent-id").value;
    const newOwner = document.getElementById("action-assign-to").value;
    const currentUser = localStorage.getItem("portal_user_email");
    const date = new Date().toLocaleDateString();

    if (!newOwner) { alert("Enter an email"); return; }

    if (type === "subtask") {
        // Create NEW ROW with Parent ID linked
        const newDesc = document.getElementById("action-details").value;
        const subId = parentId + "-SUB-" + Math.floor(Math.random()*100);
        
        const row = [[ subId, parentId, date, currentUser, newOwner, newDesc, "Medium", "OPEN", "" ]];
        await appendRowsToSheet(row);
        alert("✅ Subtask Created!");

    } else if (type === "reassign") {
        // Create NEW ROW but mark as transferred (or you could edit the old row, but appending is safer for logs)
        // We create a new ticket that references the old one as parent for tracking
        const transferId = "TRF-" + Math.floor(Math.random()*1000);
        const taskDesc = "Reassigned: " + document.getElementById("action-task-desc").innerText;
        
        const row = [[ transferId, parentId, date, currentUser, newOwner, taskDesc, "High", "OPEN", "" ]];
        await appendRowsToSheet(row);
        alert("✅ Task Reassigned!");
    }
    
    document.getElementById("task-action-modal").classList.add("hidden");
    loadTicketDashboard();
}

// --- HELPER: WRITE TO SHEET ---
async function appendRowsToSheet(values) {
    if (!CONFIG.TICKET_SHEET_ID) return;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.TICKET_SHEET_ID}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`;
    
    await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: values })
    });
}



let currentResolveId = "";
let currentResolveRowIndex = 0;

function openResolveModal(id, rowIndex) {
    currentResolveId = id;
    currentResolveRowIndex = rowIndex; 
    document.getElementById("resolve-tkt-id").innerText = "Closing Ticket: " + id;
    document.getElementById("resolve-modal").classList.remove("hidden");
}

function closeResolveModal() {
    document.getElementById("resolve-modal").classList.add("hidden");
}

async function confirmResolve() {
    const notes = document.getElementById("resolve-notes").value;
    const btn = document.querySelector("#resolve-modal button");
    btn.innerText = "⏳ Updating DB...";
    
    try {
        const sheetRow = currentResolveRowIndex + 1; 
        const range = `Sheet1!F${sheetRow}:G${sheetRow}`; 
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.TICKET_SHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;

        const response = await fetch(url, {
            method: "PUT",
            headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: [[ "RESOLVED", notes ]] })
        });

        if(response.ok) {
            alert("✅ Ticket Resolved!");
            closeResolveModal();
            loadTicketDashboard(); 
        } else {
            throw new Error("Update Failed");
        }

    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.innerText = "Mark as Resolved";
    }
}

function loadApprovalsDashboard() {
    resetUI();
    document.getElementById("approvals-ui").classList.remove("hidden");
}

function redirectMailSearch() {
    const target = document.getElementById("mail-target").value.trim();
    const fromDate = document.getElementById("mail-from-date").value;
    const toDate = document.getElementById("mail-to-date").value;
    const keywords = document.getElementById("mail-keywords").value.trim();

    let queryParts = [];

    if (target) {
        queryParts.push(`(from:${target} OR to:${target})`);
    }
    if (fromDate) {
        queryParts.push(`after:${fromDate.replace(/-/g, '/')}`);
    }
    if (toDate) {
        queryParts.push(`before:${toDate.replace(/-/g, '/')}`);
    }
    if (keywords) {
        queryParts.push(keywords);
    }

    if (queryParts.length === 0) {
        alert("Please enter at least one search criteria.");
        return;
    }

    const queryString = encodeURIComponent(queryParts.join(" "));
    const gmailUrl = `https://mail.google.com/mail/u/0/#search/${queryString}`;
    
    window.open(gmailUrl, '_blank');
}

async function loadDailyUpdateDashboard() {
    resetUI();
    document.getElementById("daily-ui").classList.remove("hidden");
    
    const savedEmail = localStorage.getItem("portal_user_email");
    if (savedEmail) {
        document.getElementById("user-identity-email").value = savedEmail;
        fetchDailyUpdates();
    }
}

async function fetchDailyUpdates() {
    const emailInput = document.getElementById("user-identity-email");
    const container = document.getElementById("daily-list-container");
    const userEmail = emailInput.value.trim().toLowerCase();

    if (!userEmail) { alert("Please enter your email to verify identity."); return; }
    if (!CONFIG.DAILY_DISPATCH_SHEET_ID) { container.innerHTML = "<p>Dispatch Sheet ID missing.</p>"; return; }

    localStorage.setItem("portal_user_email", userEmail);
    container.innerHTML = "⏳ Checking Inbox...";

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.DAILY_DISPATCH_SHEET_ID}/values/Sheet1`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();

        if (!data.values || data.values.length < 2) {
            container.innerHTML = "<p>No records found in dispatch sheet.</p>";
            return;
        }

        let foundCount = 0;
        let html = "";

        data.values.slice(1).forEach(row => {
            const rEmail = row[0]?.toString().trim().toLowerCase();
            const rSubject = row[1];
            const rLink = row[2] || "";

            if (rEmail === userEmail) {
                foundCount++;
                
                let fileId = "";
                let fileType = "parquet"; 
                let gid = "0";

                if (rLink.includes("spreadsheets")) {
                    fileType = "sheet";
                    const idMatch = rLink.match(/\/d\/([a-zA-Z0-9-_]+)/);
                    if (idMatch) fileId = idMatch[1];
                    if (rLink.includes("gid=")) {
                        gid = rLink.split("gid=")[1].split("&")[0];
                    }
                } 
                else {
                    if (rLink.includes("id=")) fileId = rLink.split("id=")[1].split("&")[0];
                    else if (rLink.includes("/d/")) fileId = rLink.split("/d/")[1].split("/")[0];
                }

                html += `
                    <button onclick="window.loadFileIntoDuckDB('${fileId}', '${rSubject}', '${fileType}', '${gid}')" 
                            class="folder-btn" style="background:#ffccbc; display:flex; flex-direction:column; align-items:center; gap:5px; width:160px; height:auto; padding:15px;">
                        <div style="font-size:30px;">📊</div>
                        <div style="font-weight:bold; font-size:12px; text-align:center;">${rSubject}</div>
                        <div style="font-size:10px; color:#555;">Open Report</div>
                    </button>
                `;
            }
        });

        if (foundCount === 0) {
            container.innerHTML = `<div style="width:100%; text-align:center; padding:20px;">
                <h3>📭 Inbox Empty</h3>
                <p>No reports mapped to <b>${userEmail}</b></p>
            </div>`;
        } else {
            container.innerHTML = html;
        }

    } catch (e) {
        container.innerHTML = "Error: " + e.message;
    }
}

async function loadWorkDashboard() {
    resetUI();
    document.getElementById("work-ui").classList.remove("hidden");
    const list = document.getElementById("work-file-list");
    list.innerHTML = "⏳ Scanning Drive...";

    const uploadInput = document.getElementById("local-file-upload");
    if(uploadInput) uploadInput.value = "";

    if (!CONFIG.WORK_REPORTS_FOLDER_ID) { list.innerHTML = "<p>Config Missing</p>"; return; }

    const query = `'${CONFIG.WORK_REPORTS_FOLDER_ID}' in parents and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name, mimeType)`;

    try {
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();

        list.innerHTML = "";
        if (data.files && data.files.length > 0) {
            data.files.forEach(file => {
                const btn = document.createElement("button");
                btn.className = "folder-btn";
                btn.style.background = "#e0f7fa";
                btn.style.width = "150px";
                btn.style.display = "flex";
                btn.style.flexDirection = "column";
                btn.style.alignItems = "center";
                btn.style.padding = "10px";
                
                let icon = "📄";
                if(file.name.endsWith(".parquet")) icon = "📦";
                if(file.name.endsWith(".csv")) icon = "📝";
                if(file.name.endsWith(".xlsx")) icon = "📊";

                btn.innerHTML = `<div style="font-size:30px;">${icon}</div><div style="font-size:11px;">${file.name}</div>`;
                
                if (file.name.endsWith(".xlsx")) {
                     btn.onclick = () => loadRemotePivotFile(file.id, file.name);
                } else {
                     btn.onclick = () => loadRemotePivotFile(file.id, file.name);
                }
                
                list.appendChild(btn);
            });
        } else {
            list.innerHTML = "No reports found.";
        }
    } catch (e) {
        list.innerHTML = "Error: " + e.message;
    }
}

async function loadRemotePivotFile(fileId, fileName) {
    const statusDiv = document.getElementById("loading-status");
    statusDiv.innerHTML = "⏳ Downloading Pivot Data...";
    
    document.getElementById("view-container").classList.add("hidden");
    document.getElementById("filter-box").classList.add("hidden");
    document.getElementById("pivot-wrapper").classList.remove("hidden");
    document.getElementById("pivot-output").innerHTML = "<h3>⏳ Processing large file in DuckDB...</h3>";

    try {
        const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const arrayBuffer = await response.arrayBuffer();
        
        await processAndRenderPivot(new Uint8Array(arrayBuffer), fileName);
        statusDiv.innerHTML = "✅ Pivot Ready!";

    } catch (e) {
        console.error(e);
        document.getElementById("pivot-output").innerHTML = `<p style="color:red">Error: ${e.message}</p>`;
        statusDiv.innerHTML = "Error";
    }
}

async function handleLocalFileUpload(input) {
    const file = input.files[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
        const statusDiv = document.getElementById("loading-status");
        statusDiv.innerHTML = "⏳ Reading Excel File...";
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            currentExcelWorkbook = XLSX.read(data, { type: 'array' });
            currentExcelFileName = file.name.split('.')[0];
            
            const modal = document.getElementById("convert-modal");
            const select = document.getElementById("sheet-selector");
            select.innerHTML = "";
            
            currentExcelWorkbook.SheetNames.forEach(name => {
                const opt = document.createElement("option");
                opt.value = name;
                opt.innerText = name;
                select.appendChild(opt);
            });

            modal.classList.remove("hidden");
            statusDiv.innerHTML = "";
        };
        reader.readAsArrayBuffer(file);
        return; 
    }

    loadDirectToPivot(file);
}

async function processExcelConversion() {
    const modal = document.getElementById("convert-modal");
    const sheetName = document.getElementById("sheet-selector").value;
    const format = document.querySelector('input[name="convert-fmt"]:checked').value;
    const saveFile = document.getElementById("save-converted").checked;
    const statusDiv = document.getElementById("loading-status");

    modal.classList.add("hidden");
    statusDiv.innerHTML = `⏳ Converting '${sheetName}' to ${format.toUpperCase()}...`;

    const worksheet = currentExcelWorkbook.Sheets[sheetName];
    const csvOutput = XLSX.utils.sheet_to_csv(worksheet);

    if (!csvOutput || csvOutput.trim().length === 0) {
        alert("Selected sheet is empty.");
        return;
    }

    let finalFileName = `${currentExcelFileName}_${sheetName}.${format}`;
    let fileBlob = null;
    let fileDataForDuck = null;

    if (format === 'csv') {
        fileBlob = new Blob([csvOutput], { type: 'text/csv' });
        fileDataForDuck = new Uint8Array(await fileBlob.arrayBuffer()); 
    } 
    else if (format === 'parquet') {
        const tempCsvName = "temp_convert.csv";
        await db.registerFileText(tempCsvName, csvOutput);
        
        await conn.query(`CREATE OR REPLACE TABLE temp_table AS SELECT * FROM read_csv_auto('${tempCsvName}', ignore_errors=true)`);
        
        const parquetName = `${currentExcelFileName}.parquet`;
        await conn.query(`COPY temp_table TO '${parquetName}' (FORMAT PARQUET)`);
        
        const parquetBuffer = await db.copyFileToBuffer(parquetName);
        fileDataForDuck = parquetBuffer;
        fileBlob = new Blob([parquetBuffer], { type: 'application/octet-stream' });
        
        await db.dropFile(tempCsvName);
        await db.dropFile(parquetName); 
        await conn.query("DROP TABLE temp_table");
    }

    if (saveFile && fileBlob) {
        const url = URL.createObjectURL(fileBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = finalFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    statusDiv.innerHTML = "⏳ Loading into Pivot...";
    await processAndRenderPivot(fileDataForDuck, finalFileName);
    statusDiv.innerHTML = "✅ Loaded & Ready!";
};

async function loadDirectToPivot(file) {
    const statusDiv = document.getElementById("loading-status");
    statusDiv.innerHTML = "⏳ Loading Local File...";

    document.getElementById("view-container").classList.add("hidden");
    document.getElementById("filter-box").classList.add("hidden");
    document.getElementById("pivot-wrapper").classList.remove("hidden");
    document.getElementById("pivot-output").innerHTML = "<h3>⏳ Processing local file...</h3>";

    try {
        const arrayBuffer = await file.arrayBuffer();
        await processAndRenderPivot(new Uint8Array(arrayBuffer), file.name);
        statusDiv.innerHTML = "✅ Local Pivot Ready!";
    } catch (e) {
        console.error(e);
        document.getElementById("pivot-output").innerHTML = `<p style="color:red">Error: ${e.message}</p>`;
    }
}

async function processAndRenderPivot(uint8Array, fileName) {
    const tableName = `pivot_table_${Date.now()}`;
    currentPivotTableName = tableName; 
    
    await db.registerFileBuffer(fileName, uint8Array);

    try {
        if (fileName.endsWith(".parquet")) {
            await conn.query(`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM parquet_scan('${fileName}')`);
        } else {
            await conn.query(`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv_auto('${fileName}', ignore_errors=true)`);
        }
    } catch(e) {
        console.error("DuckDB Loading Error:", e);
        document.getElementById("pivot-output").innerHTML = `<p style="color:red">SQL Error: ${e.message}</p>`;
        return;
    }

    await setupFilterDropdown(tableName); 
    document.getElementById("filter-box").classList.remove("hidden"); 
    document.getElementById("filter-input").value = ""; 

    await runPivotQueryAndRender(`SELECT * FROM ${tableName} LIMIT 500000`);
}

async function runPivotQueryAndRender(query) {
    try {
        const result = await conn.query(query);
        const rows = result.toArray().map(r => r.toJSON());

        if (typeof $ !== 'undefined' && $.pivotUtilities) {
            $("#pivot-output").pivotUI(rows, {
                renderers: $.pivotUtilities.renderers,
                rendererName: "Table"
            });
        }
    } catch (e) {
        console.error("Pivot Render Error:", e);
    }
}

async function findAndLoadReport() {
    const storeId = document.getElementById("store-id-input").value.trim();
    const statusDiv = document.getElementById("loading-status");

    if (!currentMonthFolderId) { alert("⚠️ Please select a Month folder first (Step 1)."); return; }
    if (!storeId) { alert("⚠️ Please enter a Store ID."); return; }

    const pane = document.getElementById(activePaneId);
    if (!pane) { alert("Error: No active view selected"); return; }
    
    statusDiv.innerHTML = `🔍 Searching for Store ${storeId}...`;
    const contentArea = pane.querySelector(".content-area");
    contentArea.innerHTML = `<div style="text-align:center; padding:20px; color:#666;">🔍 Searching Drive for ${storeId}...</div>`;

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
            const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=sheets.properties`;
            const metaResp = await fetch(metaUrl, { headers: { "Authorization": `Bearer ${accessToken}` } });
            if (!metaResp.ok) throw new Error("Access Denied");
            const metaData = await metaResp.json();
            
            let sheetTitle = "";
            const targetGid = gid ? parseInt(gid) : 0;
            const foundSheet = metaData.sheets.find(s => s.properties.sheetId === targetGid);
            if (foundSheet) sheetTitle = foundSheet.properties.title;
            else throw new Error("Tab not found");

            const dataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${encodeURIComponent(sheetTitle)}`;
            const dataResp = await fetch(dataUrl, { headers: { "Authorization": `Bearer ${accessToken}` } });
            const dataJson = await dataResp.json();

            if (!dataJson.values || dataJson.values.length === 0) throw new Error("Sheet empty");

            let finalValues = dataJson.values;

            // --- IGNORE FIRST ROW (Start from Row 2) ---
            if (finalValues.length > 1) {
                finalValues = finalValues.slice(1); 
            }
            
            // --- ENSURE UNIQUE HEADERS ---
            let headers = finalValues[0];
            let uniqueHeaders = [];
            let headerCounts = {};

            if (headers) {
                headers.forEach((h) => {
                    let cleanH = (h || "Column").toString().trim().replace(/"/g, ''); 
                    if(!cleanH) cleanH = "Column";
                    if (headerCounts[cleanH]) {
                        headerCounts[cleanH]++;
                        uniqueHeaders.push(`${cleanH}_${headerCounts[cleanH]}`);
                    } else {
                        headerCounts[cleanH] = 1;
                        uniqueHeaders.push(cleanH);
                    }
                });
                finalValues[0] = uniqueHeaders;
            }

            const csvText = arrayToCSV(finalValues);
            const csvFileName = `temp_${tableName}.csv`;
            
            await db.registerFileText(csvFileName, csvText);
            await conn.query(`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv('${csvFileName}', header=true, auto_detect=true, ignore_errors=true)`);
            
            pane.querySelector(".pane-label").innerText = `${sheetTitle}`;

            // --- UI INJECTION START (UPDATED FOR BUILDER) ---
            const editUrl = `https://docs.google.com/spreadsheets/d/${fileId}/edit#gid=${targetGid}`;
            
            document.getElementById("sheet-link-container").innerHTML = `
                <div style="display:flex; gap:10px; margin-top:10px; align-items:center;">
                    <a href="${editUrl}" target="_blank" style="text-decoration:none;">
                        <button style="background:#28a745; color:white; padding:8px 12px; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">✏️ Open Sheet</button>
                    </a>
                    <button onclick="window.summarizeData()" style="background:#6f42c1; color:white; padding:8px 12px; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">🤖 AI Summary</button>
                    <button id="viz-toggle-btn" onclick="window.toggleVisualization()" style="background:#607d8b; color:white; padding:8px 12px; border:none; border-radius:4px; cursor:pointer; font-weight:bold; margin-left:auto;">📈 Show Graph</button>
                </div>`;

            // We now create a container for the TABLE and a container for the BUILDER
            contentArea.innerHTML = `
                <div class="data-table-wrapper" style="height:100%; overflow:auto;"></div>
                <div id="chart-builder-root" class="chart-builder-container hidden"></div>
            `;
            
            // Reset Chart State
            if (typeof currentChartInstance !== 'undefined' && currentChartInstance) {
                currentChartInstance.destroy();
                currentChartInstance = null;
            }
            // --- UI INJECTION END ---

        } else {
            // Parquet Logic
            const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
            const response = await fetch(downloadUrl, { headers: { "Authorization": `Bearer ${accessToken}` } });
            if (!response.ok) throw new Error("Download failed");
            const arrayBuffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            await db.registerFileBuffer(fileName, uint8Array);
            if (fileName.endsWith('.parquet')) {
                 await conn.query(`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM parquet_scan('${fileName}')`);
            } else {
                 await conn.query(`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv_auto('${fileName}', ignore_errors=true)`);
            }
            pane.querySelector(".pane-label").innerText = fileName;
             contentArea.innerHTML = `
                <div class="data-table-wrapper" style="height:100%; overflow:auto;"></div>
                <div id="chart-builder-root" class="chart-builder-container hidden"></div>
            `;
        }

        statusDiv.innerHTML = "✅ Data Loaded!";
        await setupFilterDropdown(tableName);
        await applyTableFilter();
        statusDiv.innerHTML = "";

    } catch (e) {
        console.error(e);
        statusDiv.innerHTML = `<span style="color:red">Error: ${e.message}</span>`;
        contentArea.innerHTML = `<p style="color:red; text-align:center; padding:20px;">Failed to load:<br>${e.message}</p>`;
    }
}

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

        const sumQueryParts = numericCols.map(col => `SUM("${col}") as "${col}"`).join(", ");
        const totalResult = await conn.query(`SELECT ${sumQueryParts} FROM ${tableName}`);
        const totals = totalResult.toArray()[0].toJSON();

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
    
    const isPivotMode = !document.getElementById("pivot-wrapper").classList.contains("hidden");

    let tableName = "";
    if (isPivotMode) {
        tableName = currentPivotTableName;
        if (!tableName) return;
    } else {
        tableName = `table_${activePaneId.replace('-', '_')}`;
    }
    
    let query = `SELECT * FROM ${tableName}`;
    
    if (filterText) {
        if (column === "all") {
             query += ` WHERE CAST(column0 AS VARCHAR) LIKE '%${filterText}%'`; 
        }
        else {
             query += ` WHERE CAST("${column}" AS VARCHAR) LIKE '%${filterText}%'`;
        }
    }
    
    if (limit !== "all") query += ` LIMIT ${limit}`;

    try {
        if (isPivotMode) {
            await runPivotQueryAndRender(query); 
        } else {
            const result = await conn.query(query); 
            renderTableFromArrow(result);
        }
    } catch (e) {
        // --- CHANGE IS HERE: Print the actual error ---
        console.error("❌ SQL/Filter Error Details:", e);
        console.log("Filter Error or Empty Query");
    }
}

function renderTableFromArrow(arrowResult) {
    const pane = document.getElementById(activePaneId);
    if(!pane) return;
    
    // --- UPDATED SELECTOR ---
    // Try to find the specific table wrapper first (used in Sheet/Parquet views)
    // If not found, fall back to the main content area (legacy support)
    let container = pane.querySelector(".data-table-wrapper");
    if (!container) container = pane.querySelector(".content-area");
    
    const rows = arrowResult.toArray().map(r => r.toJSON());
    currentArrowData = rows; // CRITICAL: Updates global data for Chart.js

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

function showRowDetails(index) {
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

async function loadBusinessDashboard() {
    resetUI();
    document.getElementById("business-ui").classList.remove("hidden");
    
    if (!mapInstance) {
        const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' });
        const terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '© OpenTopoMap' });
        const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri' });

        mapInstance = L.map('business-map', {
            center: [20.5937, 78.9629],
            zoom: 5,
            layers: [streets]
        });

        const baseMaps = { "🗺️ Streets": streets, "🏔️ Terrain": terrain, "🛰️ Satellite": satellite };
        L.control.layers(baseMaps).addTo(mapInstance);

        const blueIcon = new L.Icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });
        const redIcon = new L.Icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });
        const greenIcon = new L.Icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });

        mapLayers.flipkart = L.layerGroup().addTo(mapInstance);
        mapLayers.metro = L.layerGroup().addTo(mapInstance);
        mapLayers.dmart = L.layerGroup().addTo(mapInstance);

        if (CONFIG.WAREHOUSE_GROUPS && CONFIG.WAREHOUSE_GROUPS["Flipkart Wholesale"]) {
            CONFIG.WAREHOUSE_GROUPS["Flipkart Wholesale"].forEach(wh => {
                L.marker([wh.lat, wh.lng], { icon: blueIcon }).bindPopup(`<b>🏢 Flipkart Wholesale</b><br>${wh.name}`).addTo(mapLayers.flipkart);
            });
        }

        if (CONFIG.WAREHOUSE_GROUPS && CONFIG.WAREHOUSE_GROUPS["Metro Stores"]) {
            CONFIG.WAREHOUSE_GROUPS["Metro Stores"].forEach(wh => {
                L.marker([wh.lat, wh.lng], { icon: redIcon }).bindPopup(`<b>🏬 Metro Store</b><br>${wh.name}`).addTo(mapLayers.metro);
            });
        }

        if (CONFIG.WAREHOUSE_GROUPS && CONFIG.WAREHOUSE_GROUPS["DMart Stores"]) {
            CONFIG.WAREHOUSE_GROUPS["DMart Stores"].forEach(wh => {
                L.marker([wh.lat, wh.lng], { icon: greenIcon }).bindPopup(`<b>🛒 DMart</b><br>${wh.name}`).addTo(mapLayers.dmart);
            });
        }
    }
    
    setTimeout(() => {
        mapInstance.invalidateSize();
    }, 200);

    const tableName = currentPivotTableName || `table_${activePaneId.replace('-', '_')}`;
    const container = document.getElementById("pincode-table-container");

    try {
        const check = await conn.query(`SHOW TABLES`);
        const tables = check.toArray().map(r => r.name);
        if (!tables.includes(tableName)) {
            container.innerHTML = "<p>⚠️ No sales data loaded. Please load a Sales Report in 'Work on Reports' first.</p>";
            return;
        }

        const schema = await conn.query(`DESCRIBE ${tableName}`);
        const cols = schema.toArray().map(r => r.column_name.toLowerCase());
        
        const pinCol = cols.find(c => c.includes("pin") || c.includes("zip")) || cols[0];
        const salesCol = cols.find(c => c.includes("amount") || c.includes("price") || c.includes("value") || c.includes("sales"));
        const statusCol = cols.find(c => c.includes("status") || c.includes("delivery"));

        if (!salesCol) {
            container.innerHTML = "<p>⚠️ Could not identify Sales/Amount column for aggregation.</p>";
            return;
        }

        const query = `
            SELECT 
                "${pinCol}" as Pincode,
                COUNT(*) as Total_Orders,
                SUM("${salesCol}") as Total_Sales,
                ${statusCol ? `ROUND(COUNT(CASE WHEN "${statusCol}" ILIKE '%Delivered%' THEN 1 END) * 100.0 / COUNT(*), 1)` : '0'} as Delivery_Percent
            FROM ${tableName}
            GROUP BY 1
            ORDER BY Total_Sales DESC
            LIMIT 50
        `;

        const result = await conn.query(query);
        const rows = result.toArray().map(r => r.toJSON());

        const totalSales = rows.reduce((acc, r) => acc + (r.Total_Sales || 0), 0);
        const totalCust = rows.reduce((acc, r) => acc + (r.Total_Orders || 0), 0);
        const avgDel = rows.length > 0 ? (rows.reduce((acc, r) => acc + (r.Delivery_Percent || 0), 0) / rows.length) : 0;

        document.getElementById("kyb-total-cust").innerText = totalCust.toLocaleString();
        document.getElementById("kyb-total-sales").innerText = "₹" + Math.floor(totalSales).toLocaleString();
        document.getElementById("kyb-avg-del").innerText = Math.floor(avgDel) + "%";

        let html = `<table class="data-table">
            <thead><tr><th>Pincode</th><th>Orders/Cust</th><th>Sales (₹)</th><th>Delivery %</th></tr></thead>
            <tbody>`;
        
        rows.forEach(r => {
            html += `<tr>
                <td>📍 ${r.Pincode}</td>
                <td>${r.Total_Orders}</td>
                <td>${Math.floor(r.Total_Sales).toLocaleString()}</td>
                <td>
                    <div style="background:#eee; border-radius:4px; width:100%; height:10px;">
                        <div style="background:${r.Delivery_Percent > 80 ? 'green' : 'orange'}; width:${r.Delivery_Percent}%; height:100%; border-radius:4px;"></div>
                    </div>
                    <div style="font-size:10px; text-align:center;">${r.Delivery_Percent}%</div>
                </td>
            </tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;

    } catch (e) {
        console.error(e);
        container.innerHTML = `<p style="color:red">Error aggregating data: ${e.message}<br>Ensure a file is loaded in 'Work on Reports' view.</p>`;
    }
}

function toggleMapLayer(layerKey) {
    if (!mapInstance) return;
    
    const checkbox = document.getElementById(`chk-${layerKey}`);
    const layer = mapLayers[layerKey];
    
    if (checkbox && layer) {
        if (checkbox.checked) {
            mapInstance.addLayer(layer);
        } else {
            mapInstance.removeLayer(layer);
        }
    }
}


function toggleVisualization() {
    const pane = document.getElementById(activePaneId);
    const tableWrapper = pane.querySelector(".data-table-wrapper");
    const builderRoot = pane.querySelector("#chart-builder-root");
    const toggleBtn = document.getElementById("viz-toggle-btn");

    if (!builderRoot || !tableWrapper) return;

    const isGraphMode = tableWrapper.classList.contains("hidden");

    if (isGraphMode) {
        // Show Table
        tableWrapper.classList.remove("hidden");
        builderRoot.classList.add("hidden");
        toggleBtn.innerText = "📈 Show Graph";
        toggleBtn.style.background = "#607d8b";
    } else {
        // Show Graph Builder
        tableWrapper.classList.add("hidden");
        builderRoot.classList.remove("hidden");
        toggleBtn.innerText = "📋 Show Table";
        toggleBtn.style.background = "#e91e63";
        
        // Initialize the drag-and-drop builder if empty
        if (builderRoot.innerHTML.trim() === "") {
            initChartBuilder(builderRoot);
        }
    }
}

function renderVisualization(canvasCtx) {
    if (!currentArrowData || currentArrowData.length === 0) {
        alert("No data to visualize!");
        return;
    }

    // 1. Identify Columns
    const keys = Object.keys(currentArrowData[0]);
    let labelKey = keys[0]; // Default to first column for X-axis labels
    let dataKeys = [];

    // Simple heuristic: Try to find the first String column for labels, and all Number columns for data
    keys.forEach(key => {
        const val = currentArrowData[0][key];
        if (typeof val === 'number') {
            dataKeys.push(key);
        } else if (!dataKeys.length && typeof val === 'string') {
            labelKey = key;
        }
    });

    if (dataKeys.length === 0) {
        // Fallback: If everything looks like a string but might be a number (common in CSVs)
        // Check the second column
        if (keys.length > 1) dataKeys.push(keys[1]);
    }

    // 2. Prepare Data for Chart.js
    const labels = currentArrowData.map(row => row[labelKey]);
    const datasets = dataKeys.map((key, index) => {
        // Generate a random color for each dataset
        const color = `hsl(${Math.random() * 360}, 70%, 50%)`;
        return {
            label: key,
            data: currentArrowData.map(row => {
                // Handle messy data (remove commas, currency symbols)
                let val = row[key];
                if (typeof val === 'string') {
                    val = parseFloat(val.replace(/,/g, '').replace(/[^\d.-]/g, ''));
                }
                return val || 0;
            }),
            backgroundColor: color,
            borderColor: color,
            borderWidth: 1,
            tension: 0.3 // Makes lines slightly curved
        };
    });

    // 3. Destroy old chart if exists
    if (currentChartInstance) {
        currentChartInstance.destroy();
    }

    // 4. Create New Chart
    // If we have many datasets (columns), use a Line chart. If just 1 or 2, use Bar.
    const chartType = datasets.length > 3 ? 'line' : 'bar';

    currentChartInstance = new Chart(canvasCtx, {
        type: chartType,
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                title: { display: true, text: `Analysis by ${labelKey}` },
                tooltip: { enabled: true }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}


function initChartBuilder(container) {
    if (!currentArrowData || currentArrowData.length === 0) {
        container.innerHTML = "<p style='padding:20px;'>No data available.</p>";
        return;
    }

    const columns = Object.keys(currentArrowData[0]);

    // 1. Build HTML Structure (With Reset Button)
    container.innerHTML = `
        <div class="chart-sidebar">
            <h4 style="margin:0 0 10px 0; color:#444;">Columns</h4>
            <div id="col-list-container" style="display:flex; flex-direction:column; gap:8px;"></div>
        </div>
        <div class="chart-main">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <h4 style="margin:0; color:#555;">Drag & Drop Chart Builder</h4>
                <button onclick="window.resetChartBuilder()" style="background:#ff9800; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:12px; font-weight:bold; display:flex; align-items:center; gap:5px;">
                    🔄 Reset Graph
                </button>
            </div>
            <div class="drop-zone-container">
                <div id="drop-x" class="drop-zone" ondragover="allowDrop(event)" ondrop="handleDrop(event, 'x')">
                    <span style="color:#888; pointer-events:none;">📍 X-Axis (Label)</span>
                    <span style="font-size:10px; color:#aaa; pointer-events:none;">Drag 1 column here</span>
                </div>
                <div id="drop-y" class="drop-zone" ondragover="allowDrop(event)" ondrop="handleDrop(event, 'y')">
                    <span style="color:#888; pointer-events:none;">📊 Y-Axis (Values)</span>
                    <span style="font-size:10px; color:#aaa; pointer-events:none;">Drag columns here</span>
                </div>
            </div>
            <div class="chart-canvas-container">
                <canvas id="viz-canvas"></canvas>
            </div>
        </div>
    `;

    // 2. Populate Column List (Draggable Items)
    const listContainer = container.querySelector("#col-list-container");
    columns.forEach(col => {
        const div = document.createElement("div");
        div.className = "draggable-col";
        div.draggable = true;
        div.innerText = col;
        div.ondragstart = (e) => {
            e.dataTransfer.setData("text/plain", col);
            e.dataTransfer.effectAllowed = "copy";
        };
        listContainer.appendChild(div);
    });
}

// Global Drag & Drop Handlers
window.allowDrop = (ev) => {
    ev.preventDefault();
    ev.currentTarget.classList.add("drag-over");
};

window.handleDrop = (ev, axis) => {
    ev.preventDefault();
    ev.currentTarget.classList.remove("drag-over");
    const colName = ev.dataTransfer.getData("text/plain");

    if (axis === 'x') {
        // X Axis: Only 1 Allowed
        chartState.x = colName;
        renderPill(document.getElementById("drop-x"), colName, true);
    } else {
        // Y Axis: Multiple Allowed (Check duplicates)
        if (!chartState.y.includes(colName)) {
            chartState.y.push(colName);
            renderPill(document.getElementById("drop-y"), colName, false);
        }
    }
    updateUserChart();
};

function renderPill(container, text, isSingle) {
    if (isSingle) {
        // Clear existing if X axis
        const existing = container.querySelector(".pill");
        if(existing) existing.remove();
    }
    
    const pill = document.createElement("div");
    pill.className = "pill";
    pill.innerHTML = `${text} <span class="remove" onclick="removeChartCol(this, '${text}', '${isSingle ? 'x' : 'y'}')">×</span>`;
    container.appendChild(pill);
}

window.removeChartCol = (el, colName, axis) => {
    el.parentElement.remove();
    if (axis === 'x') {
        chartState.x = null;
    } else {
        chartState.y = chartState.y.filter(c => c !== colName);
    }
    updateUserChart();
};

function updateUserChart() {
    const canvas = document.getElementById("viz-canvas");
    if (!canvas) return;

    // Destroy old chart
    if (currentChartInstance) {
        currentChartInstance.destroy();
        currentChartInstance = null;
    }

    // Validation
    if (!chartState.x || chartState.y.length === 0) return;

    // Prepare Data
    const labels = currentArrowData.map(row => row[chartState.x]);
    const datasets = chartState.y.map((colKey, index) => {
        const color = `hsl(${(index * 60) + 200}, 70%, 50%)`; // Blue-ish hues
        return {
            label: colKey,
            data: currentArrowData.map(row => {
                let val = row[colKey];
                if (typeof val === 'string') {
                    // Try to convert "$1,200.50" -> 1200.50
                    val = parseFloat(val.replace(/,/g, '').replace(/[^\d.-]/g, ''));
                }
                return val || 0;
            }),
            backgroundColor: color,
            borderColor: color,
            borderWidth: 1,
            tension: 0.1
        };
    });

    // Render Chart
    currentChartInstance = new Chart(canvas, {
        type: datasets.length > 2 ? 'line' : 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                title: { display: true, text: `Analysis: ${chartState.y.join(' vs ')} by ${chartState.x}` }
            },
            scales: { y: { beginAtZero: true } }
        }
    });
}

window.resetChartBuilder = function() {
    // 1. Reset Internal Data State
    chartState = { x: null, y: [] };

    // 2. Clear HTML Pills (Remove existing selections from the drop zones)
    const xZone = document.getElementById("drop-x");
    const yZone = document.getElementById("drop-y");
    
    // Remove only elements with class 'pill', keep the instruction text
    if (xZone) {
        xZone.querySelectorAll(".pill").forEach(el => el.remove());
    }
    if (yZone) {
        yZone.querySelectorAll(".pill").forEach(el => el.remove());
    }

    // 3. Destroy the Chart Instance
    if (currentChartInstance) {
        currentChartInstance.destroy();
        currentChartInstance = null;
    }
    
    // 4. Visually Clear the Canvas
    const canvas = document.getElementById("viz-canvas");
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    
    console.log("Graph builder reset.");
};


async function generateAccessToken(creds) {
    const header = { alg: "RS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
        iss: creds.client_email,
        scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now
    };

    const sHeader = JSON.stringify(header);
    const sClaim = JSON.stringify(claim);
    // Signs the JWT using the private key
    const sJWS = KJUR.jws.JWS.sign(null, sHeader, sClaim, creds.private_key);

    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${sJWS}`
    });
    const data = await response.json();
    return data.access_token;
}
function logout() {
    if(!confirm("Are you sure you want to logout?")) return;
    
    // Clear any active timers
    if (typeof sessionTimerInterval !== 'undefined' && sessionTimerInterval) {
        clearInterval(sessionTimerInterval);
    }
    
    localStorage.removeItem("portal_user_email");
    window.location.reload(); // Reloads page to lock it again
}

function highlightSidebar(btnText) {
    // Remove active class from all
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.remove('active');
        // Add active class if text matches
        if(btn.innerText.includes(btnText)) {
            btn.classList.add('active');
        }
    });
    
    // Update Top Title
    const title = document.getElementById("page-title");
    if(title) title.innerText = btnText;
}
