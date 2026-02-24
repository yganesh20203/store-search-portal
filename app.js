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
let activeTvCategory = "";
let tvDataCache = [];
let pendingPhotoBlob = null;
let kybMapLayer = null;
let kybRadiusLayer = null;
let activeSessionCreds = null;
let poCategoryMap = {}; 
let tokenExpirationTime = 0;
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
//window.handleBulkTaskUpload = handleBulkTaskUpload;
window.filterTasks = filterTasks;
window.openTaskActionModal = openTaskActionModal;
window.submitTaskAction = submitTaskAction;
window.toggleTaskActionUI = toggleTaskActionUI;
window.loadTvStats = loadTvStats;
window.populateKybColumns = populateKybColumns;
window.runKybAnalysis = runKybAnalysis;

// ==========================================
// 🛡️ SECURITY FAIL-SAFE (Runs Immediately)
// ==========================================
(function forceSessionCheck() {
    // If the page has loaded but we don't have the session credentials in memory...
    if (!activeSessionCreds && document.getElementById("dashboard")) {
        console.warn("⛔ No active session keys found. Forcing Relogin.");
        
        // 1. Force Dashboard Hidden
        document.getElementById("dashboard").classList.add("hidden");
        
        // 2. Force Login Screen Visible
        const authScreen = document.getElementById("auth-overlay");
        if (authScreen) authScreen.classList.remove("hidden");
        
        // 3. Pre-fill email if available (Convenience)
        const savedUser = localStorage.getItem("portal_user_email");
        const userField = document.getElementById("login-user");
        if (savedUser && userField) userField.value = savedUser;
    }
})();
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

// ==========================================
// 🔐 AUTHENTICATION LOGIC (UPDATED)
// ==========================================

// 1. MAIN LOGIN FUNCTION
async function unlockAndLogin() {
    const accessKey = document.getElementById("access-key").value;
    const username = document.getElementById("login-user").value.trim().toLowerCase(); 
    const password = document.getElementById("login-pass").value.trim();
    
    const btn = document.getElementById("login-btn");
    const errorMsg = document.getElementById("error-msg");

    if(!accessKey) { showLoginError("⚠️ Missing Team Access Key"); return; }
    if(!username) { showLoginError("⚠️ Enter Username"); return; }

    btn.innerText = "🔄 Verifying...";
    btn.disabled = true;
    errorMsg.style.display = "none";

    try {
        if (typeof CONFIG === 'undefined') throw new Error("Config not loaded.");

        // 1. Decrypt Team Key
        const bytes = CryptoJS.AES.decrypt(CONFIG.ENCRYPTED_CREDS, accessKey);
        const decryptedString = bytes.toString(CryptoJS.enc.Utf8);
        if (!decryptedString) throw new Error("Incorrect Access Key");

        const creds = JSON.parse(decryptedString);
        activeSessionCreds = creds;
        accessToken = await generateAccessToken(creds);
        startTokenMonitor();

        // 2. CHECK USER DB
        btn.innerText = "🔍 Checking User DB...";
        
        // This function now returns an OBJECT, not just boolean
        const userStatus = await checkBackendCredentials(username, password);

        if (userStatus.found) {
            // SCENARIO A: First Time User
            if (userStatus.isNewUser || password === "123456") {
                document.getElementById("sp-username").value = username;
                document.getElementById("sp-row-index").value = userStatus.rowIndex;
                document.getElementById("auth-overlay").classList.add("hidden");
                document.getElementById("set-password-modal").classList.remove("hidden");
            } 
            // SCENARIO B: Valid Login
            else if (userStatus.validPass) {
                // ✅ PASS PERMISSIONS TO COMPLETE LOGIN
                completeLogin(username, userStatus.permissions);
            } 
            else {
                throw new Error("Invalid Password");
            }
        } else {
            // SCENARIO D: User Not Found (Guest Mode)
            console.warn("⛔ Guest User.");
            await createSessionRow(username, "GUEST_INVALID");
            startGuestCountdown();
            alert(`⚠️ User not found.\n\nGranted GUEST ACCESS for 2 minutes.`);
            completeLogin(username); // Allow guest entry
        }

    } catch (e) {
        console.error(e);
        showLoginError("❌ " + e.message);
        btn.innerText = "Unlock & Login";
        btn.disabled = false;
    }
}

// 2. CHECK CREDENTIALS HELPER
// 2. CHECK CREDENTIALS HELPER
async function checkBackendCredentials(user, pass) {
    if (!CONFIG.USER_DB_SHEET_ID) return { found: false };
    
    try {
        // ✅ CHANGE: Fetch Columns A, B, AND C (A=User, B=Pass, C=Permissions)
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.USER_DB_SHEET_ID}/values/Sheet2!A:C`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();
        
        if (!data.values) return { found: false };

        // Find row index (1-based for Sheets API)
        const rowIndex = data.values.findIndex(row => row[0] && row[0].toString().toLowerCase() === user);
        
        if (rowIndex !== -1) {
            const storedPass = data.values[rowIndex][1] ? data.values[rowIndex][1].toString() : "";
            const rawPermissions = data.values[rowIndex][2] || ""; // ✅ Capture Col C
            
            // Check if password is "Empty" (New User)
            if (storedPass === "" || storedPass === "123456") {
                return { found: true, validPass: true, isNewUser: true, rowIndex: rowIndex + 1, permissions: rawPermissions };
            }
            
            // Check if password matches
            if (storedPass === pass) {
                return { found: true, validPass: true, isNewUser: false, rowIndex: rowIndex + 1, permissions: rawPermissions };
            }
            
            return { found: true, validPass: false }; // User exists, wrong pass
        }
        
        return { found: false };

    } catch (e) { return { found: false }; }
}

// 3. SUCCESSFUL LOGIN ROUTINE
// 3. SUCCESSFUL LOGIN ROUTINE
function completeLogin(username, rawPermissions = "") {
    // 1. Hide Login / Show Dashboard (Using Correct IDs from your HTML)
    document.getElementById("auth-overlay").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");
    
    // 2. Save Session Data
    localStorage.setItem("portal_user_email", username);
    
    // 3. Process Permissions
    // If cell is empty, default to nothing or specific tabs? 
    // Here we ensure it's an array.
    if (!rawPermissions) rawPermissions = ""; 
    currentUserAccess = rawPermissions.split(",").map(p => p.trim()).filter(p => p !== "");

    // Save to storage so refreshing the page doesn't lose access
    localStorage.setItem("portal_user_access", JSON.stringify(currentUserAccess));

    document.getElementById("user-info").innerText = `● ${username}`;
    
    // 4. Render Sidebar & Load DBs
    renderDynamicSidebar(); // <--- DRAW BUTTONS
    initDuckDB();
    
    // 5. Log the session
    createSessionRow(username, "VALID_USER");
    startSilentUsageTimer(username);

    // 6. Load First Allowed Tab Automatically
    const firstTab = document.querySelector("#sidebar-menu li");
    if(firstTab) firstTab.click();
}

// 4. SAVE NEW PASSWORD (User sets their own)
window.saveNewPassword = async function() {
    const newPass = document.getElementById("sp-new-pass").value;
    const confirmPass = document.getElementById("sp-confirm-pass").value;
    const rowIndex = document.getElementById("sp-row-index").value;
    const username = document.getElementById("sp-username").value;
    const btn = document.querySelector("#set-password-modal button");

    if (newPass.length < 4) { alert("Password too short!"); return; }
    if (newPass !== confirmPass) { alert("Passwords do not match!"); return; }

    btn.innerText = "⏳ Saving...";
    btn.disabled = true;

    try {
        // Write to Column B (Password) at specific Row
        const range = `Sheet2!B${rowIndex}`;
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.USER_DB_SHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;
        
        await fetch(url, {
            method: "PUT",
            headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: [[ newPass ]] })
        });

        alert("✅ Password Set Successfully! Logging you in...");
        document.getElementById("set-password-modal").classList.add("hidden");
        
        // Finalize Login
        completeLogin(username);

    } catch (e) {
        alert("Error saving password: " + e.message);
        btn.innerText = "💾 Save & Login";
        btn.disabled = false;
    }
};

// 5. FORGOT PASSWORD HANDLER
window.openForgotPassword = function() {
    document.getElementById("forgot-password-modal").classList.remove("hidden");
};


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
    highlightSidebar("Sales Reports");
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
    highlightSidebar("Member DB");
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
    highlightSidebar("Google Sheets");
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
    highlightSidebar("Walkin Data");
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
    highlightSidebar("Hourly Sales");
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
    highlightSidebar("Task Manager");
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
        rowIndex: index + 2,
        id: row[0],
        parentId: row[1],
        date: row[2],
        by: row[3]?.toLowerCase(),
        to: row[4]?.toLowerCase(),
        task: row[5],
        priority: row[6],
        status: row[7], 
        visibility: row[8]?.toLowerCase() || "",
        batch: row[9] || ""
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
    const currentUser = localStorage.getItem("portal_user_email")?.toLowerCase();

    if (!currentUser) return;

    let filtered = [];

    // --- 1. FILTER LOGIC ---
    if (filterType === 'my_tasks') {
        // Show ALL tasks assigned to me
        filtered = allTasksCache.filter(t => t.to === currentUser);
    } 
    else if (filterType === 'my_pending') { 
        // Show only OPEN tasks assigned to me
        filtered = allTasksCache.filter(t => t.to === currentUser && t.status !== "RESOLVED");
    } 
    else if (filterType === 'assigned_by_me') {
        filtered = allTasksCache.filter(t => t.by === currentUser);
    } 
    else if (filterType === 'all_batches') {
        filtered = allTasksCache.filter(t => t.visibility.includes(currentUser) || t.to === currentUser || t.by === currentUser);
    }

    // --- 2. SEARCH FILTER ---
    if (searchText) {
        filtered = filtered.filter(t => 
            t.task.toLowerCase().includes(searchText) || 
            t.id.toLowerCase().includes(searchText) ||
            (t.batch && t.batch.toLowerCase().includes(searchText))
        );
    }

    // --- 3. RENDER ---
    if (filtered.length === 0) {
        container.innerHTML = "<p style='padding:20px; text-align:center; color:#666;'>No tasks found.</p>";
        return;
    }

    let html = `<table class="data-table" style="width:100%;">
        <thead><tr>
            <th>ID</th><th>Date</th><th>Task</th><th>Assignee</th><th>Status</th><th>Action</th>
        </tr></thead><tbody>`;

    filtered.forEach(t => {
        // Indent subtasks
        const isSubtask = t.parentId && t.parentId.length > 2;
        const indentStyle = isSubtask ? "border-left: 4px solid #1976d2; background:#f9fbff;" : "";
        const icon = isSubtask ? "↳ " : "";
        
        // Status Color
        let statusColor = t.status === "RESOLVED" ? "#e0e0e0" : "#fff";
        let statusText = t.status === "RESOLVED" ? "✅ DONE" : "🔥 OPEN";
        let statusBadge = t.status === "RESOLVED" 
            ? `<span style="color:green; font-weight:bold;">${statusText}</span>` 
            : `<span style="color:#d32f2f; font-weight:bold;">${statusText}</span>`;

        html += `<tr style="${indentStyle} background:${statusColor}">
            <td><small>${t.id}</small></td>
            <td><small>${t.date}</small></td>
            <td>
                ${icon} <b>${t.task}</b>
                ${t.batch ? `<br><span style="font-size:10px; background:#e3f2fd; padding:2px 5px; border-radius:4px; color:#1565c0;">📦 ${t.batch}</span>` : ''}
            </td>
            <td>${t.to}</td>
            <td>${statusBadge}</td>
            <td>
                ${t.status !== 'RESOLVED' ? `
                    <button onclick="window.openTaskActionModal('${t.id}', '${t.task.replace(/'/g, "")}')" 
                        style="cursor:pointer; background:#ff9800; color:white; border:none; padding:5px 8px; border-radius:4px; font-size:11px; margin-right:5px;">
                        ⚙️ Manage
                    </button>

                    <button onclick="window.openResolveModal('${t.id}', ${t.rowIndex - 1})" 
                        style="cursor:pointer; background:#4caf50; color:white; border:none; padding:5px 8px; border-radius:4px; font-size:11px;">
                        ✅ Close
                    </button>
                ` : '<span style="color:#aaa;">-</span>'}
            </td>
        </tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}

// --- CREATE SINGLE TASK ---
async function createTicket() {
    // 1. Get Values safely (Handle missing inputs gracefully)
    const emailInput = document.getElementById("tkt-email");
    const taskInput = document.getElementById("tkt-task");
    const batchInput = document.getElementById("tkt-batch");
    
    // Safety Check: If elements don't exist in HTML, stop
    if (!emailInput || !taskInput) { alert("Error: Input fields missing in HTML."); return; }

    const email = emailInput.value.trim();
    const task = taskInput.value.trim();
    const batch = batchInput ? batchInput.value.trim() : ""; // Optional Batch
    
    // Default values since inputs were removed from HTML
    const priority = "Medium"; 
    const visibility = ""; 

    const currentUser = localStorage.getItem("portal_user_email");

    if(!email || !task) { alert("Please fill email and task."); return; }

    const btn = document.querySelector("button[onclick='window.createTicket()']");
    if(btn) { btn.innerText = "⏳ Assigning..."; btn.disabled = true; }

    const tktId = "TKT-" + Math.floor(Math.random() * 100000);
    const date = new Date().toLocaleDateString();

    // 2. Align Schema with Bulk Upload:
    // ID | Parent | Date | By | To | Task | Priority | Status | Visibility | Batch
    const row = [[ 
        tktId, 
        "", 
        date, 
        currentUser, 
        email, 
        task, 
        priority, 
        "OPEN", 
        visibility,
        batch // ✅ Now saving the batch name!
    ]];

    try {
        await appendRowsToSheet(row);
        alert("✅ Task Assigned!");
        
        // Clear Inputs
        emailInput.value = "";
        taskInput.value = "";
        if(batchInput) batchInput.value = "";
        
        loadTicketDashboard();
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        if(btn) { btn.innerText = "🚀 Assign"; btn.disabled = false; }
    }
}

// --- BULK UPLOAD CSV ---
window.handleBulkTaskUpload = function(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        const text = e.target.result;
        const rows = text.split("\n").map(r => r.trim()).filter(r => r);
        
        if (rows.length < 2) { alert("CSV is empty"); return; }

        // 1. Parse Headers
        const headers = rows[0].split(",").map(h => h.trim().toLowerCase());
        bulkCsvData = rows.slice(1).map(r => r.split(",")); // Store data globally
        bulkCsvHeaders = headers;

        // 2. CHECK FOR STANDARD IMPEX (Auto-Process)
        // We check if the first column is 'assign_to_email' and second is 'task_description'
        if (headers[0] === "assign_to_email" && headers[1] === "task_description") {
            if(confirm("⚡ Standard Impex Detected!\n\nAuto-create tasks without mapping?")) {
                await processStandardTaskImpex(); // <--- New Function
            } else {
                showColumnSelection(); // Fallback to wizard if they say No
            }
        } 
        // 3. Unknown Format -> Go to Wizard
        else {
            showColumnSelection(); 
        }
    };
    reader.readAsText(file);
    input.value = ""; 
};

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
    btn.disabled = true;
    
    try {
        // The row index from the button click is 0-based. Sheets are 1-based.
        const sheetRow = currentResolveRowIndex + 1; 
        
        // ---------------------------------------------------------
        // ✅ FIX 1: Target Column H (Status) for "RESOLVED"
        // ---------------------------------------------------------
        const statusRange = `Sheet1!H${sheetRow}`;
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.TICKET_SHEET_ID}/values/${statusRange}?valueInputOption=USER_ENTERED`, {
            method: "PUT",
            headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: [[ "RESOLVED" ]] })
        });

        // ---------------------------------------------------------
        // ✅ FIX 2: Write Remarks to Column K (New Column)
        // ---------------------------------------------------------
        // This ensures we don't overwrite Priority or Visibility
        if(notes) {
            const remarksRange = `Sheet1!K${sheetRow}`;
            await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.TICKET_SHEET_ID}/values/${remarksRange}?valueInputOption=USER_ENTERED`, {
                method: "PUT",
                headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ values: [[ notes ]] })
            });
        }

        alert("✅ Ticket Closed Successfully!");
        closeResolveModal();
        
        // Refresh to remove from "Live Pending" view
        loadTicketDashboard(); 

    } catch (e) {
        alert("Error: " + e.message);
        console.error(e);
    } finally {
        btn.innerText = "✅ Mark as Resolved";
        btn.disabled = false;
    }
}

function loadApprovalsDashboard() {
    resetUI();
    highlightSidebar("Mail Search");
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
    highlightSidebar("My Inbox");
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
    highlightSidebar("Work on Reports");
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
// ==========================================
// 🌍 KYB MAP ANALYTICS (Latest Version)
// ==========================================



// 1. MAIN DASHBOARD LOADER
; 

async function loadBusinessDashboard() {
    resetUI();
    highlightSidebar("KYB Map");
    document.getElementById("business-ui").classList.remove("hidden");

    // 1. Initialize Map
    if (!mapInstance) {
        const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' });
        const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri' });

        mapInstance = L.map('business-map', {
            center: [20.5937, 78.9629], 
            zoom: 5,
            layers: [streets]
        });

        // Create Layer Groups
        mapLayers.flipkart = L.layerGroup().addTo(mapInstance);
        kybRadiusLayer = L.layerGroup().addTo(mapInstance);
        mapLayers.metro = L.layerGroup(); // Hidden by default
        mapLayers.dmart = L.layerGroup(); // Hidden by default
        mapLayers.serviceable = L.layerGroup().addTo(mapInstance); // New Serviceable Layer

        // Icons
        const redIcon = new L.Icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });
        const greenIcon = new L.Icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });

        // Load Static Stores
        if (CONFIG.WAREHOUSE_GROUPS) {
            if (CONFIG.WAREHOUSE_GROUPS["Metro Stores"]) CONFIG.WAREHOUSE_GROUPS["Metro Stores"].forEach(wh => L.marker([wh.lat, wh.lng], { icon: redIcon }).bindPopup(`<b>🏬 Metro</b><br>${wh.name}`).addTo(mapLayers.metro));
            if (CONFIG.WAREHOUSE_GROUPS["DMart Stores"]) CONFIG.WAREHOUSE_GROUPS["DMart Stores"].forEach(wh => L.marker([wh.lat, wh.lng], { icon: greenIcon }).bindPopup(`<b>🛒 DMart</b><br>${wh.name}`).addTo(mapLayers.dmart));
        }

        // Layer Control
        L.control.layers(
            { "🗺️ Streets": streets, "🛰️ Satellite": satellite }, 
            { 
                "🟦 Flipkart Stores": mapLayers.flipkart, 
                "⭕ Radius Rings": kybRadiusLayer, 
                "🛡️ Serviceable Areas": mapLayers.serviceable, // NEW
                "🟥 Metro": mapLayers.metro, 
                "🟩 DMart": mapLayers.dmart 
            }
        ).addTo(mapInstance);
    }
    
    // 2. Inject Controls
    const mapContainer = document.getElementById("business-ui");
    let controls = document.getElementById("kyb-controls");
    
    if (!controls) {
        controls = document.createElement("div");
        controls.id = "kyb-controls";
        controls.style.cssText = "background:white; padding:15px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.2); margin-bottom:15px;";
        
        controls.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid #eee; padding-bottom:10px;">
                <h3 style="margin:0;">🗺️ Pincode Sales & Store Map</h3>
                <div style="display:flex; gap:10px;">
                    <select id="kyb-store-filter" onchange="filterKybStores()" style="padding:5px 10px; border:1px solid #ccc; border-radius:4px; font-weight:bold;">
                        <option value="ALL">🏢 All Flipkart Stores</option>
                    </select>
                    <button onclick="toggleKybFullscreen()" style="background:#424242; color:white; border:none; padding:5px 15px; border-radius:4px; cursor:pointer;">⛶ Big Screen</button>
                </div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:15px; align-items:end;">
                <div>
                    <label style="font-size:12px; font-weight:bold;">1. Sales Data (CSV):</label>
                    <select id="kyb-table-select" onchange="window.populateKybColumns()" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px;">
                        <option value="">-- Load CSV first --</option>
                    </select>
                </div>
                <div>
                    <label style="font-size:12px; font-weight:bold;">2. Boundaries (GeoJSON):</label>
                    <input type="file" id="kyb-geojson-file" accept=".json,.geojson" style="font-size:11px; width:100%;">
                </div>
                <div>
                    <label style="font-size:12px; font-weight:bold;">3. Period A:</label>
                    <div style="display:flex; gap:5px;">
                        <select id="kyb-col-start1" style="width:50%; padding:5px; border:1px solid #ccc; border-radius:4px;"></select>
                        <select id="kyb-col-end1" style="width:50%; padding:5px; border:1px solid #ccc; border-radius:4px;"></select>
                    </div>
                </div>
                <div>
                    <label style="font-size:12px; font-weight:bold;">4. Period B:</label>
                    <div style="display:flex; gap:5px;">
                        <select id="kyb-col-start2" style="width:50%; padding:5px; border:1px solid #ccc; border-radius:4px;"></select>
                        <select id="kyb-col-end2" style="width:50%; padding:5px; border:1px solid #ccc; border-radius:4px;"></select>
                    </div>
                </div>
            </div>

            <div style="margin-top:10px; padding-top:10px; border-top:1px dashed #eee; display:flex; gap:15px; align-items:center;">
                <label style="font-size:12px; font-weight:bold; white-space:nowrap;">Optional Reference:</label>
                <input type="file" id="kyb-serviceable-csv" accept=".csv" style="font-size:11px;">
                <button onclick="loadServiceableLayer()" style="padding:4px 10px; background:#666; color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px;">
                    Load Serviceable Pincodes
                </button>
            </div>

            <div style="margin-top:15px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <label style="font-size:12px;">Mode:</label>
                    <select id="kyb-viz-mode" style="padding:5px; border:1px solid #ccc; border-radius:4px;">
                        <option value="sales_a">Show Period A Sales</option>
                        <option value="growth">Show Growth (A vs B)</option>
                    </select>
                </div>
                <button onclick="window.runKybAnalysis()" style="background:#1e88e5; color:white; border:none; padding:10px 20px; border-radius:4px; font-weight:bold; cursor:pointer;">
                    🚀 Plot Analysis
                </button>
            </div>
            <div id="kyb-status" style="margin-top:10px; font-size:12px; color:#666;"></div>
        `;
        mapContainer.insertBefore(controls, mapContainer.firstChild);
    }

    // Populate Initial Data
    filterKybStores();
    await window.populateKybColumns();
    
    // Refresh Table List
    try {
        const tableSelect = document.getElementById("kyb-table-select");
        const result = await conn.query("SHOW TABLES");
        tableSelect.innerHTML = '<option value="">-- Select Table --</option>';
        result.toArray().forEach(r => tableSelect.innerHTML += `<option value="${r.name}">${r.name}</option>`);
    } catch (e) {}
}

// ==========================================
// 🛡️ HELPER: LOAD SERVICEABLE LAYER
// ==========================================
window.loadServiceableLayer = async function() {
    const csvInput = document.getElementById("kyb-serviceable-csv");
    const geoInput = document.getElementById("kyb-geojson-file");
    const status = document.getElementById("kyb-status");

    if (csvInput.files.length === 0 || geoInput.files.length === 0) {
        alert("⚠️ To load this layer, please upload BOTH:\n1. Boundaries (GeoJSON)\n2. Serviceable Pincodes (CSV)");
        return;
    }

    status.innerHTML = "⏳ Generating Serviceable Layer...";
    
    // 1. Read Serviceable CSV
    const csvFile = csvInput.files[0];
    const csvText = await csvFile.text();
    
    // Simple CSV Parse (Expects Pincode in first column)
    const serviceableSet = new Set();
    const lines = csvText.split(/\r?\n/);
    lines.forEach(line => {
        const pin = line.split(',')[0].trim();
        if (pin && !isNaN(pin)) serviceableSet.add(pin);
    });

    console.log(`Found ${serviceableSet.size} serviceable pincodes in CSV.`);

    // 2. Read GeoJSON
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const geoJson = JSON.parse(e.target.result);
            
            // 3. Filter GeoJSON matches
            const matchedFeatures = geoJson.features.filter(f => {
                const p = f.properties;
                const rawPin = p.pincode || p.PINCODE || p.pin || p.zip || "";
                const cleanPin = String(rawPin).replace(/[^0-9]/g, '');
                return serviceableSet.has(cleanPin);
            });

            if (matchedFeatures.length === 0) {
                alert("❌ No matches found between Serviceable CSV and GeoJSON boundaries.");
                status.innerHTML = "";
                return;
            }

            // 4. Draw Layer (Blue Outline, Transparent Fill)
            mapLayers.serviceable.clearLayers();
            L.geoJSON({ type: "FeatureCollection", features: matchedFeatures }, {
                style: {
                    color: "#3388ff",       // Blue Border
                    weight: 1,
                    dashArray: '4, 4',      // Dashed Line
                    fillColor: "#3388ff", 
                    fillOpacity: 0.1        // Very faint blue fill
                },
                onEachFeature: function(f, l) {
                    l.bindPopup(`<b>🛡️ Serviceable Area</b><br>Pincode: ${f.properties.pincode || "Unknown"}`);
                }
            }).addTo(mapLayers.serviceable);

            status.innerHTML = `✅ Added ${matchedFeatures.length} serviceable zones.`;
            
        } catch (err) {
            console.error(err);
            alert("Error reading GeoJSON.");
        }
    };
    reader.readAsText(geoInput.files[0]);
};

// ==========================================
// 🎯 HELPER: FILTER STORES & DRAW RADIUS
// ==========================================
window.filterKybStores = function() {
    const selectedStore = document.getElementById("kyb-store-filter").value;
    
    // Clear existing layers
    mapLayers.flipkart.clearLayers();
    kybRadiusLayer.clearLayers();
    
    const blueIcon = new L.Icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });

    if (CONFIG.WAREHOUSE_GROUPS && CONFIG.WAREHOUSE_GROUPS["Flipkart Wholesale"]) {
        let storesToPlot = CONFIG.WAREHOUSE_GROUPS["Flipkart Wholesale"];

        // If specific store selected, filter the list
        if (selectedStore !== "ALL") {
            storesToPlot = storesToPlot.filter(wh => wh.name === selectedStore);
        }

        storesToPlot.forEach(wh => {
            // 1. Draw Marker
            const marker = L.marker([wh.lat, wh.lng], { icon: blueIcon })
                .bindPopup(`<b>🏢 ${wh.name}</b><br>Lat: ${wh.lat}<br>Lng: ${wh.lng}`)
                .addTo(mapLayers.flipkart);

            // 2. Draw Radius Circles (10km, 30km, 60km)
            // 10km (Green Dashed)
            L.circle([wh.lat, wh.lng], { radius: 10000, color: 'green', dashArray: '5, 5', fill: false, weight: 2 }).addTo(kybRadiusLayer);
            
            // 30km (Orange Dashed)
            L.circle([wh.lat, wh.lng], { radius: 30000, color: 'orange', dashArray: '10, 10', fill: false, weight: 2 }).addTo(kybRadiusLayer);
            
            // 60km (Red Dashed)
            L.circle([wh.lat, wh.lng], { radius: 60000, color: 'red', dashArray: '20, 20', fill: false, weight: 2 }).addTo(kybRadiusLayer);

            // If single store, zoom to it
            if (selectedStore !== "ALL") {
                mapInstance.setView([wh.lat, wh.lng], 9);
                marker.openPopup();
            }
        });

        // If "ALL", fit bounds to show all stores
        if (selectedStore === "ALL" && storesToPlot.length > 0) {
            // Optional: Recenter map to India or fit bounds of all markers
             mapInstance.setView([20.5937, 78.9629], 5);
        }
    }
};

// ==========================================
// ⛶ HELPER: TOGGLE FULLSCREEN
// ==========================================
window.toggleKybFullscreen = function() {
    const mapDiv = document.getElementById("business-map");
    const container = document.getElementById("business-ui"); // The parent container

    if (!document.fullscreenElement) {
        // Enter Fullscreen
        if (mapDiv.requestFullscreen) {
            mapDiv.requestFullscreen();
        } else if (mapDiv.webkitRequestFullscreen) { /* Safari */
            mapDiv.webkitRequestFullscreen();
        } else if (mapDiv.msRequestFullscreen) { /* IE11 */
            mapDiv.msRequestFullscreen();
        }
        
        // Add a specialized class for styling if needed, though native fullscreen handles most
        mapDiv.style.height = "100vh";
        mapDiv.style.width = "100vw";
    } else {
        // Exit Fullscreen
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) { /* Safari */
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) { /* IE11 */
            document.msExitFullscreen();
        }
        
        // Reset styles (Assuming original height was 600px or defined in CSS)
        mapDiv.style.height = "600px"; 
        mapDiv.style.width = "100%";
    }

    // Crucial: Leaflet needs to know the size changed to render tiles correctly
    setTimeout(() => { mapInstance.invalidateSize(); }, 200);
};

// Listen for ESC key to reset styles if user exits via keyboard
document.addEventListener('fullscreenchange', (event) => {
    const mapDiv = document.getElementById("business-map");
    if (!document.fullscreenElement) {
        mapDiv.style.height = "600px"; // Restore original height
        mapDiv.style.width = "100%";
        setTimeout(() => { mapInstance.invalidateSize(); }, 200);
    }
});

// 2. HELPER: POPULATE COLUMNS (JAN_2025, etc.)



// 4. MAP RENDERER
function renderKybMapLayers(data, mode) {
    if (kybMapLayer) mapInstance.removeLayer(kybMapLayer);
    
    const geoJsonData = { "type": "FeatureCollection", "features": [] };
    let maxVal = 0;
    
    data.forEach(row => {
        let val = (mode === 'sales_a') ? row.Sales_A : 0;
        let tooltip = `Sales: ₹${Math.floor(val).toLocaleString()}`;

        if (mode === 'growth') {
            const growth = row.Sales_A > 0 ? ((row.Sales_B - row.Sales_A) / row.Sales_A) * 100 : 0;
            val = growth; 
            tooltip = `Growth: ${growth.toFixed(1)}% <br>(A: ${Math.floor(row.Sales_A)} ⮕ B: ${Math.floor(row.Sales_B)})`;
        }

        if (Math.abs(val) > maxVal) maxVal = Math.abs(val);

        geoJsonData.features.push({
            "type": "Feature",
            "properties": { "pincode": row.Pincode, "value": val, "tooltip": tooltip },
            "geometry": { "type": "Point", "coordinates": [row.Lng, row.Lat] }
        });
    });

    kybMapLayer = L.geoJSON(geoJsonData, {
        pointToLayer: function (feature, latlng) {
            const val = feature.properties.value;
            let color = "blue";
            let radius = 5;

            if (mode === 'sales_a') {
                const intensity = maxVal > 0 ? val / maxVal : 0;
                color = intensity > 0.7 ? '#d32f2f' : (intensity > 0.3 ? '#fbc02d' : '#388e3c'); // Red-Yellow-Green (Heat)
                radius = 5 + (intensity * 15);
            } else {
                color = val >= 0 ? '#4caf50' : '#f44336'; // Green (Growth), Red (Decline)
                radius = 8;
            }

            return L.circleMarker(latlng, {
                radius: radius,
                fillColor: color,
                color: "#000",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.7
            });
        },
        onEachFeature: function (feature, layer) {
            layer.bindPopup(`<b>📍 Pincode: ${feature.properties.pincode}</b><br>${feature.properties.tooltip}`);
        }
    }).addTo(mapInstance);

    if (data.length > 0) mapInstance.fitBounds(kybMapLayer.getBounds());
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



function logout() {
    if(!confirm("Are you sure you want to logout?")) return;
    
    // Clear any active timers
    if (typeof sessionTimerInterval !== 'undefined' && sessionTimerInterval) {
        clearInterval(sessionTimerInterval);
    }
    
    localStorage.removeItem("portal_user_email");
    window.location.reload(); // Reloads page to lock it again
}

// --- SIDEBAR HIGHLIGHT HELPER ---
function highlightSidebar(menuName) {
    // 1. Remove 'active' class from all sidebar buttons
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    
    // 2. Find the button with the matching text and make it active
    const buttons = document.querySelectorAll('.nav-item');
    for (const btn of buttons) {
        if (btn.innerText.includes(menuName)) {
            btn.classList.add('active');
            break; // Stop looking after finding the match
        }
    }

    // 3. Update the Top Header Title
    const pageTitle = document.getElementById("page-title");
    if (pageTitle) pageTitle.innerText = menuName;
}


// ==========================================
// 👁️ TRUEVIEW CONFIGURATION (UPDATED)
// ==========================================
// ==========================================
// 👁️ TRUEVIEW CONFIGURATION (UPDATED)
// ==========================================
const TV_CONFIG_MAP = {
    "Offer Board": {
        sheetId: "1oE7xB9egfdRumclW-l5BzLXJZm5feddA0x3USe3pBUc", 
        tabName: "Sheet1", 
        type: "offer_board" 
    },
    "OFR Audit": { 
        sheetId: "1Zg01KzKUefdKvONNmed7PRL7WU95BpAuvouo-nKk1kw", 
        tabName: "Sheet1", 
        type: "ofr_audit" 
    },
    "Planogram": { 
        sheetId: "1FVguVJAG4oLiBRhbdPoBa680AD6S39bnTB1jg2M7R9c", 
        tabName: "Sheet1", 
        type: "planogram",
        folderId: "19w8KEeWjTL0vNZUe5gekTkP2FaA52rAv" 
    },
    "Feature Space": { 
        sheetId: "1ixbA7XH5710A80JoI6fbtoYVdzEWQvkjqyw-M4WAvIM", 
        tabName: "Sheet1", 
        type: "feature_space",
        folderId: "1988SPp9okK71Ab_2w2rXDH_d-QwugWnZ"
    },
    "Events": { 
        sheetId: "1yR38ofRtblES3GI4A4tijGBkF3tspukBz-17C5aWSbo", 
        tabName: "Sheet1", 
        type: "events" ,
        folderId: "1sP-RfLzcQDgfJ6LeB5TqVLJGnMR5FSH3"
    },
    // Placeholders
    "Back to basics": { sheetId: CONFIG.TRUEVIEW_SHEET_ID, tabName: "TV_Back to basics", type: "standard" }
};

// 1. INITIALIZE DASHBOARD
window.loadTrueViewDashboard = function() {
    resetUI();
    highlightSidebar("TrueView");
    document.getElementById("trueview-ui").classList.remove("hidden");
    document.getElementById("tv-category-menu").classList.remove("hidden");
    document.getElementById("tv-action-container").classList.add("hidden");
};

// 2. OPEN CATEGORY
window.openTrueViewCategory = function(category) {
    activeTvCategory = category;
    document.getElementById("tv-category-menu").classList.add("hidden");
    document.getElementById("tv-action-container").classList.remove("hidden");
    document.getElementById("tv-current-category").innerText = "📂 " + category;
    
    // Switch to tasks view by default
    window.switchTvTab('tasks');
};

// ==========================================
// FIX FOR TRUEVIEW TAB SWITCHER
// ==========================================

window.switchTvTab = function(tabName) {
    // 1. Highlight the Active Tab Button
    document.querySelectorAll(".tv-tab").forEach(b => b.classList.remove("active"));
    const activeBtn = document.getElementById(`tab-btn-${tabName}`);
    if (activeBtn) activeBtn.classList.add("active");
    
    // 2. Hide all View Containers
    ["tasks", "upload", "dashboard", "download"].forEach(v => {
        const el = document.getElementById(`tv-view-${v}`);
        if(el) el.classList.add("hidden");
    });
    
    // 3. Show the Selected View
    const targetView = document.getElementById(`tv-view-${tabName}`);
    if (targetView) targetView.classList.remove("hidden");

    // 4. Trigger Specific Logic
    if (tabName === 'tasks') {
        loadTvTasks(); 
    } 
    else if (tabName === 'dashboard') {
        loadTvStats();
    }
    else if (tabName === 'download') {
        renderDownloadOptions(); // <--- NEW CALL HERE
    }
};
// 4. DOWNLOAD TEMPLATE (Dynamic Headers)
window.downloadTvTemplate = function() {
    let headers = [];
    let filename = "";

    if (activeTvCategory === "Offer Board") {
        headers = ["Store No.", "Store Name", "Start Date (mm-dd-yyyy)", "End Date (mm-dd-yyyy)", "Approver LoginId", "Escalation L1", "Escalation L2", "Article Name"];
        filename = "OfferBoard_Template.csv";
    } 
    else if (activeTvCategory === "OFR Audit") {
        headers = ["Store No.", "Store Name", "Invoice Date", "Manager Due Date","TL Due Date", "Article Number", "Article Description", "Short Orders", "Short Qty", "Merchandising Manager mail id", "Audit TL mail id"];
        filename = "OFR_Audit_Template.csv";
    }
    else if (activeTvCategory === "Planogram") {
        headers = ["Store No.", "Store Name", "Start Date", "End Date", "Sub Division", "Category Number", "Category Name", "Brand", "Approver LoginId"];
        filename = "Planogram_Template.csv";
    }
    else if (activeTvCategory === "Feature Space") {
        headers = ["Store No.", "Store Name", "Start Date", "End Date", "Approver LoginId", "Category Number", "Division", "Sub-Divison", "Category name", "Item No", "Item Description", "Display Location", "Execution Type"];
        filename = "FeatureSpace_Template.csv";
    }
    else if (activeTvCategory === "Events") {
        // 9 Input Columns
        headers = [
            "Store No.", "Store Name", "Start date", "End date", "Approver LoginId", 
            "Sub Division", "Category Number", "Category Name", "Special Offers"
        ];
        filename = "Events_Template.csv";
    }
    else {
        headers = ["Store_ID", "Assigned_To_Email", "Question_Type", "Task_Details"];
        filename = "TrueView_Standard_Template.csv";
    }

    const csvContent = "data:text/csv;charset=utf-8," + headers.join(",");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
};

// 5. UPLOAD IMPEX (Create Tasks)
window.handleTvImpexUpload = function(input) {
    const file = input.files[0];
    if (!file) return;

    const pass = prompt("🔒 Enter Admin Password to Upload Impex:");
    if (pass !== "admin123") { alert("❌ Incorrect Password!"); input.value = ""; return; }

    const config = TV_CONFIG_MAP[activeTvCategory];
    if (!config) { alert("❌ Configuration Error"); return; }

    const reader = new FileReader();
    reader.onload = async function(e) {
        const rows = e.target.result.split("\n").slice(1);
        const newRows = [];

        rows.forEach(rowStr => {
            const cols = rowStr.split(",").map(c => c.trim());
            if (cols.length < 2) return; 

            const id = "EV-" + Math.floor(Math.random() * 1000000);

            if (activeTvCategory === "Events") {
                // Events Schema: 9 Inputs
                if(cols.length >= 9) {
                    newRows.push([
                        id, 
                        cols[0], cols[1], cols[2], cols[3], cols[4], // Store -> Approver
                        cols[5], cols[6], cols[7], cols[8],          // Sub Div -> Special Offers
                        "", "", "" // Empty Output Columns (K, L, M)
                    ]);
                }
            }
            else if (activeTvCategory === "Feature Space") {
                if(cols.length >= 13) {
                    newRows.push([id, cols[0], cols[1], cols[2], cols[3], cols[4], cols[5], cols[6], cols[7], cols[8], cols[9], cols[10], cols[11], cols[12], "", "", ""]);
                }
            }
            else if (activeTvCategory === "Planogram") {
                if(cols.length >= 9) {
                    newRows.push([id, cols[0], cols[1], cols[2], cols[3], cols[4], cols[5], cols[6], cols[7], cols[8], "", "", ""]);
                }
            }
            else if (activeTvCategory === "Offer Board") {
                if(cols.length >= 8) newRows.push([id, cols[0], cols[1], cols[2], cols[3], cols[4], cols[5], cols[6], cols[7], "", "", "", "", ""]);
            } 
            else if (activeTvCategory === "OFR Audit") {
                if(cols.length >= 11) {
                    newRows.push([
                        id, 
                        cols[0], cols[1], cols[2], 
                        cols[3], cols[4], // Col E (Mgr Due), Col F (TL Due)
                        cols[5], cols[6], cols[7], cols[8], cols[9], cols[10], 
                        "", "", "", "" // Empty Output Columns for Inputs & Times
                    ]);
                }
            }
        }); // <--- THIS WAS MISSING: Closes the forEach loop properl

        // Now 'await' works because it's inside the async onload, but outside the synchronous forEach
        if (newRows.length > 0) {
            if(confirm(`Create ${newRows.length} tasks in ${activeTvCategory}?`)) {
                const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values/${config.tabName}!A1:append?valueInputOption=USER_ENTERED`;
                await fetch(url, {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ values: newRows })
                });
                alert("✅ Upload Success!");
                window.switchTvTab('dashboard');
            }
        }
    };
    reader.readAsText(file);
    input.value = ""; 
};

// 6. LOAD TASKS (With Escalation Logic)
// 6. LOAD TASKS (Robust Matching Fix)
// 6. LOAD TASKS (Updated for Multi-User Assignment in Events)
async function loadTvTasks() {
    const container = document.getElementById("tv-task-list");
    container.innerHTML = "⏳ Fetching tasks...";
    
    const config = TV_CONFIG_MAP[activeTvCategory];
    // Get logged-in user details
    const rawUser = localStorage.getItem("portal_user_email")?.toLowerCase().trim() || "";
    const currentUsername = rawUser.split('@')[0]; 

    if (!config) { container.innerHTML = "Config Error."; return; }
    if (!rawUser) { container.innerHTML = "Please log in first."; return; }

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values/${config.tabName}`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();

        if (!data.values || data.values.length < 2) {
            container.innerHTML = "No tasks found in sheet.";
            return;
        }

        let myPendingTasks = [];

        // --- EVENTS LOGIC (With Multi-User Support) ---
        if (activeTvCategory === "Events") {
            myPendingTasks = data.values.slice(1).map((r, i) => {
                // 1. Get the raw string (e.g. "user1@fk.com; user2@fk.com")
                const rawApproverStr = (r[5] || "").toLowerCase();
                
                // 2. Convert to an array of usernames (["user1", "user2"])
                // We split by ';', trim spaces, and remove the @domain part
                const approverList = rawApproverStr.split(';').map(email => email.trim().split('@')[0]);

               return {
                    rowIndex: i + 2,
                    id: r[0],           // Col A: Task Id
                    storeNo: r[1],      // Col B: Store No
                    storeName: r[2],    // Col C: Store Name (Ensure this is Text, not Date)
                    startDate: r[3],    // Col D: Start Date
                    endDate: r[4],      // Col E: End Date
                    approverList: approverList,
                    subDiv: r[6],       // Col G
                    catName: r[8],      // Col I
                    specialOffer: r[9], // Col J
                    status: r[10]       // Col K
                };
            }).filter(t => {
                // 3. Check Status (Shared by all)
                const isPending = !t.status || t.status.trim() === "";
                if (!isPending) return false; // If done by anyone, it's done for all.

                // 4. Check if CURRENT USER is in the list
                if (t.approverList.includes(currentUsername)) return true;
                
                return false;
            });
        }

        // --- OFFER BOARD LOGIC (Existing) ---
       // --- OFFER BOARD LOGIC (Multi-User Update) ---
        else if (activeTvCategory === "Offer Board") {
            const today = new Date(); today.setHours(0,0,0,0);
            
            myPendingTasks = data.values.slice(1).map((r, i) => {
                // 1. Parse Assignee List (Col F / Index 5)
                const rawAssignee = (r[5] || "").toLowerCase();
                const assigneeList = rawAssignee.split(';').map(e => e.trim().split('@')[0]);

                // 2. Parse Escalation L1 List (Col G / Index 6)
                const rawEscL1 = (r[6] || "").toLowerCase();
                const escL1List = rawEscL1.split(';').map(e => e.trim().split('@')[0]);

                return {
                    rowIndex: i + 2, 
                    id: r[0], 
                    storeNo: r[1], 
                    storeName: r[2], 
                    endDateStr: r[4], 
                    endDateObj: new Date(r[4]),
                    
                    assigneeList: assigneeList, // Store list instead of single string
                    escL1List: escL1List,
                    
                    articleName: r[8],
                    completedDate: r[13]
                };
            }).filter(t => {
                const isPending = !t.completedDate || t.completedDate.trim() === "";
                if (!isPending) return false;

                // 3. Check if Current User is in the Assignee List
                const isMyTask = t.assigneeList.includes(currentUsername);
                if (isMyTask) return true;

                // 4. Check if Current User is in the Escalation List
                const isMyEscalation = t.escL1List.includes(currentUsername);
                if (isMyEscalation && t.endDateObj < today) { 
                    t.isEscalated = true; 
                    return true; 
                }
                
                return false;
            });
        }
        // --- OFR AUDIT LOGIC (Existing) ---
       // --- OFR AUDIT LOGIC (Multi-User Update) ---
        else if (activeTvCategory === "OFR Audit") {
            myPendingTasks = data.values.slice(1).map((r, i) => {
                // 1. Parse Manager List (Col K / Index 10)
                const rawMgr = (r[10] || "").toLowerCase();
                const mgrList = rawMgr.split(';').map(e => e.trim().split('@')[0]);

                // 2. Parse TL List (Col L / Index 11)
                const rawTL = (r[11] || "").toLowerCase();
                const tlList = rawTL.split(';').map(e => e.trim().split('@')[0]);

                return {
                    rowIndex: i + 2, 
                    id: r[0], 
                    storeNo: r[1], 
                    storeName: r[2], 
                    invoiceDate: r[3], 
                    mgrDueDate: r[4], 
                    tlDueDate: r[5],
                    articleNo: r[6],
                    articleDesc: r[7], 
                    shortQty: r[9],
                    
                    mgrList: mgrList, // Store lists
                    tlList: tlList,
                    
                    managerInput: r[12], 
                    tlInput: r[13]
                };
            }).filter(t => {
                // 3. Check if Current User is in Manager List
                const isManager = t.mgrList.includes(currentUsername);

                // 4. Check if Current User is in TL List
                const isTL = t.tlList.includes(currentUsername);
                
                if (isManager && (!t.managerInput || t.managerInput === "")) { 
                    t.role = "Manager"; 
                    t.dueDate = t.mgrDueDate; 
                    return true; 
                }
                if (isTL && (!t.tlInput || t.tlInput === "")) { 
                    t.role = "TL"; 
                    t.dueDate = t.tlDueDate; 
                    return true; 
                }
                return false;
            });
        }

        // --- PLANOGRAM & FEATURE SPACE (Existing) ---
      // --- PLANOGRAM & FEATURE SPACE (Corrected Indices) ---
        else if (activeTvCategory === "Planogram" || activeTvCategory === "Feature Space") {
            const isPlano = activeTvCategory === "Planogram";
            let color = isPlano ? "#673ab7" : "#2196f3";
            let btnTxt = "📸 Execute";
            
            // ✅ APPROVER INDEX (Planogram usually 8, Feature Space is 5)
            const approverIdx = isPlano ? 8 : 5; 
            
            // ✅ STATUS INDEX (Planogram 12, Feature Space is 14 based on your headers)
            const statusIdx = isPlano ? 12 : 14; 

            myPendingTasks = data.values.slice(1).map((r, i) => {
                const rawAppr = (r[approverIdx] || "").toLowerCase().trim();
                
                // ✅ EXACT MAPPING FOR FEATURE SPACE
                const itemDescVal = !isPlano ? r[11] : ""; // Col L
                const dispLocVal = !isPlano ? r[12] : "";  // Col M
                const execTypeVal = !isPlano ? r[13] : ""; // Col N
                const itemNoVal = !isPlano ? r[10] : "";   // Col K
                const subDivVal = !isPlano ? r[8] : r[5];  // FS: Col I (8), Plano: Col F (5)
                const catNameVal = !isPlano ? r[9] : r[6]; // FS: Col J (9), Plano: Col G (6)

                return {
                    rowIndex: i + 2, 
                    id: r[0], 
                    storeNo: r[1], 
                    storeName: r[2], 
                    endDate: r[4], 
                    
                    subDiv: subDivVal, 
                    category: catNameVal, 
                    brand: isPlano ? r[7] : "",
                    
                    // Mapped Values
                    itemDesc: itemDescVal,
                    itemNo: itemNoVal, 
                    dispLoc: dispLocVal,  
                    execType: execTypeVal, 
                    
                    approverEmail: rawAppr, 
                    approverUser: rawAppr.split('@')[0], 
                    status: r[statusIdx]
                };
            }).filter(t => {
                const isPending = !t.status || t.status.trim() === "";
                if (!isPending) return false;
                return t.approverEmail.includes(rawUser);
                //return (t.approverEmail === rawUser) || (t.approverUser === currentUsername);
            });

            // ✅ RENDER CARDS
            container.innerHTML = myPendingTasks.map(t => `
                <div class="tv-task-card" style="border-left: 5px solid ${color};">
                    <div>
                        <div style="font-size:11px; color:#666; display:flex; justify-content:space-between;">
                            <span>${t.storeName} (${t.storeNo})</span>
                            <span style="color:#d32f2f; font-weight:bold;">Due: ${t.endDate}</span>
                        </div>
                        
                        <h4 style="margin:5px 0; color:${color}; line-height:1.4;">
                            ${t.itemDesc || t.brand + " (" + t.category + ")"}
                            ${t.itemNo ? `<div style="color:#777; font-size:11px; font-weight:normal; margin-top:2px;">Item: #${t.itemNo}</div>` : ''}
                        </h4>

                        <div style="display:flex; flex-wrap:wrap; gap:5px; margin-bottom:8px;">
                            ${t.dispLoc ? `
                                <span style="background:#e3f2fd; color:#1565c0; padding:4px 6px; border-radius:4px; font-size:11px; font-weight:bold; border:1px solid #bbdefb;">
                                    📍 ${t.dispLoc}
                                </span>` : ''
                            }
                            
                            ${t.execType ? `
                                <span style="background:#fff3e0; color:#e65100; padding:4px 6px; border-radius:4px; font-size:11px; font-weight:bold; border:1px solid #ffe0b2;">
                                    ${t.execType}
                                </span>` : ''
                            }
                        </div>

                        ${t.subDiv ? `<div style="font-size:12px; color:#666;">📂 ${t.subDiv}</div>` : ''}
                    </div>
                    
                    <button onclick="window.openTvExecuteModal('${t.id}', '${(t.itemDesc || t.brand).replace(/'/g, "")}')" style="margin-top:10px; width:100%; background:${color}; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">${btnTxt}</button>
                </div>
            `).join("");
        }

        // --- RENDER ---
        if (myPendingTasks.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:20px; color:#666;">✅ No pending tasks found for <b>${currentUsername}</b></div>`;
            return;
        }

        tvDataCache = myPendingTasks;

        // Render Cards
        if (activeTvCategory === "Events") {
            container.innerHTML = myPendingTasks.map(t => `
                <div class="tv-task-card" style="border-left: 5px solid #e91e63;">
                    <div>
                        <div style="font-size:11px; color:#666; display:flex; justify-content:space-between;">
                            <span>${t.storeName} (${t.storeNo})</span>
                            <span style="color:#d32f2f; font-weight:bold;">Due: ${t.endDate}</span>
                        </div>
                        <h4 style="margin:5px 0; color:#c2185b;">${t.specialOffer}</h4>
                        <div style="font-size:12px;">Category: <b>${t.catName}</b></div>
                        <div style="font-size:11px; background:#fce4ec; padding:4px 8px; border-radius:4px; display:inline-block; margin-top:5px;">${t.subDiv}</div>
                    </div>
                    <button onclick="window.openTvExecuteModal('${t.id}', 'Verify: ${t.specialOffer}')" style="margin-top:15px; width:100%; background:#e91e63; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">📸 Execute</button>
                </div>
            `).join("");
        }
        else if (activeTvCategory === "Offer Board") {
            container.innerHTML = myPendingTasks.map(t => `
        <div class="tv-task-card" style="${t.isEscalated ? 'border-left: 5px solid #d32f2f; background:#ffebee;' : ''}">
            <div>
                <div style="font-size:11px; color:#666; display:flex; justify-content:space-between;">
                    <span>Store: ${t.storeNo}</span>
                    <span style="color:${t.isEscalated ? '#d32f2f' : '#e65100'}; font-weight:bold;">${t.endDateStr}</span>
                </div>
                
                <h4 style="margin:8px 0; color:#1e3c72;">${t.storeName}</h4>
                
                <div style="font-size:13px; background:#e3f2fd; color:#1565c0; padding:6px; border-radius:4px; font-weight:bold; border:1px solid #bbdefb;">
                    📦 ${t.articleName || "Unknown Article"}
                </div>
            </div>
            <button onclick="window.openTvExecuteModal('${t.id}', '${t.storeName} - ${t.articleName}')" style="margin-top:15px; width:100%; background:#ff9800; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">▶️ Audit</button>
        </div>
    `).join("");
        }
      

else if (activeTvCategory === "OFR Audit") {
    container.innerHTML = myPendingTasks.map(t => {
        
        // 1. LOGIC: Determine what the TL should see regarding Manager's Input
        let merchRcaHtml = "";
        
        if (t.role === "TL") {
            // Check if Manager has given input (Col M / Index 12)
            const hasManagerResponse = t.managerInput && t.managerInput.trim() !== "";
            
            const rcaText = hasManagerResponse 
                ? `<span style="color:#2e7d32; font-weight:bold;">${t.managerInput}</span>` 
                : `<span style="color:#e65100; font-style:italic;">⏳ No RCA by Merch yet</span>`;

            merchRcaHtml = `
                <div style="margin-top:8px; padding:6px; background:#fff3e0; border-radius:4px; font-size:11px; border-left:3px solid #ff9800;">
                    <strong>Merch Manager Response:</strong><br>
                    ${rcaText}
                </div>
            `;
        }

        // 2. RENDER CARD
        return `
        <div class="tv-task-card" style="border-left: 5px solid #009688;">
            <div>
                <div style="font-size:11px; color:#666; display:flex; justify-content:space-between;">
                    <span>Invoice: ${t.invoiceDate}</span>
                    <span style="color:#d32f2f; font-weight:bold;">Due: ${t.dueDate}</span>
                </div>
                <h4 style="margin:5px 0; color:#00695c;">${t.storeName} (${t.storeNo})</h4>
                
                <div style="font-size:12px; margin-bottom:5px;">
                    <span style="background:#e0f2f1; color:#00695c; padding:2px 6px; border-radius:4px; font-weight:bold; font-family:monospace;">
                        #${t.articleNo}
                    </span>
                    <span style="font-weight:bold; margin-left:5px;">${t.articleDesc}</span>
                </div>

                <div style="display:flex; gap:10px;">
                    <span style="background:#ffebee; padding:4px 8px; border-radius:4px; font-size:11px; color:#c62828;">Short Qty: ${t.shortQty}</span>
                </div>

                ${merchRcaHtml}

                <div style="margin-top:8px; font-size:11px; color:#555;"> Role: <b>${t.role}</b></div>
            </div>
            <button onclick="window.openTvExecuteModal('${t.id}', 'Short Qty: ${t.shortQty}')" style="margin-top:15px; width:100%; background:#009688; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer;">✏️ Input</button>
        </div>
        `;
    }).join("");
}
        

    } catch (e) { container.innerHTML = "Error: " + e.message; }
}

// 5. EXECUTE MODAL (Standardized Yes/No Logic)


// 5. EXECUTE MODAL (Fixed: No null error + Dropdowns for OFR Audit)
window.openTvExecuteModal = function(id, desc) {
    document.getElementById("tv-execute-modal").classList.remove("hidden");
    const body = document.querySelector("#tv-execute-modal .modal-body");
    const footer = document.querySelector("#tv-execute-modal .modal-footer");
    
    pendingPhotoBlob = null; 

    // --- A. OFR AUDIT (Input Only) ---
    if (activeTvCategory === "OFR Audit") {
        // ... (Keep your existing OFR Audit logic here exactly as it is) ...
        // If you need the OFR code again, let me know, otherwise keep existing block.
        // For brevity, I am focusing on the Feature Space change below.
        
        // (Paste your existing OFR Audit IF block here)
        const task = tvDataCache.find(t => t.id === id);
        const role = task ? task.role : "Unknown"; 
        let dropdownOptions = "";
        if (role === "Manager") {
             dropdownOptions = `<option value="Overbooking">Overbooking</option>
             <option value="MRP mismatch">MRP mismatch</option>
             <option value= "Item not found at store">Item not found at store</option>
             <option value= "Item damaged">Item damaged</option>
             <option value= "Near expiry">Near expiry</option>
             <option value= "Picker or operation miss">Picker or operation miss</option>
             <option value= "Nego">Nego</option>
             <option value= "Customer order cancellation">Customer order cancellation</option>
             <option value= "BDA-ordered by mistake">BDA-ordered by mistake</option>
             <option value= "Freebie Issue">Freebie Issue</option>

             
             `; // (Shortened for brevity, keep your full list)
        } else {
             dropdownOptions = `<option value="Found item">Found item</option>
             <option value="Item damaged">Item damaged</option>
             <option value="Overbooking Confirmed - System checked">Overbooking Confirmed - System checked</option>
             <option value="Item not found at store">Item not found at store</option>
             <option value="Near expiry">Near expiry</option>
             <option value="Shrink booked">Shrink booked</option>
             <option value="Nego">Nego</option>
             `;
        }
        body.innerHTML = `
            <input type="hidden" id="tv-exec-id" value="${id}">
            <p style="background:#e0f2f1; padding:10px; border-radius:4px; font-weight:bold; border-left:4px solid #009688;">${desc}</p>
            <div style="font-size:11px; margin-bottom:10px; color:#555;">Logged in as: <b>${role}</b></div>
            <label style="font-size:12px; font-weight:bold;">Select Status:</label>
            <select id="tv-exec-input" style="width:100%; padding:10px; margin-bottom:15px; border:1px solid #ccc; border-radius:4px;">${dropdownOptions}</select>
        `;
        footer.innerHTML = `<button onclick="window.submitTvTask()" style="background:#009688; color:white; padding:10px; border:none; border-radius:4px; width:100%;">💾 Save ${role} Input</button>`;
    }
    
   
    else if (activeTvCategory === "Feature Space") {
        body.innerHTML = `
            <input type="hidden" id="tv-exec-id" value="${id}">
            <p style="background:#e3f2fd; padding:10px; border-radius:4px; font-weight:bold; border-left:4px solid #2196f3;">
                ${desc}
            </p>
            
            <label style="font-size:12px; font-weight:bold;">Execution Status:</label>
            <select id="tv-exec-response" onchange="window.toggleReasonInput(this.value)" style="width:100%; padding:10px; margin-bottom:15px; border:1px solid #ccc; border-radius:4px;">
                <option value="">-- Select Status --</option>
                <option value="Executed">Executed</option>
                <option value="Executed with Alternate Item Number">Executed with Alternate Item Number</option>
                <option value="Not Executed (Dual MRP Issues)">Not Executed (Dual MRP Issues)</option>
                <option value="Not Executed (Required quantity not available)">Not Executed (Required quantity not available)</option>
            </select>
            
            <div id="tv-reason-container" class="hidden">
                <label style="font-size:12px; font-weight:bold; color:#555;">Additional Remarks (Optional):</label>
                <input type="text" id="tv-exec-reason" placeholder="Enter alternate item number or other details..." style="width:100%; padding:10px; margin-bottom:15px; border:1px solid #ccc; border-radius:4px;">
            </div>

            <div id="tv-camera-container" class="hidden">
                <label style="font-size:12px; font-weight:bold;">Visual Proof (Required):</label>
                <div id="tv-photo-status" style="margin-bottom:10px; font-size:12px; color:#555;">📸 Photo required for all status options.</div>
                <button onclick="window.openCameraModal()" style="width:100%; padding:10px; background:#2196f3; color:white; border:none; border-radius:4px; cursor:pointer;">📸 Open Camera</button>
            </div>
        `;
        footer.innerHTML = `<button onclick="window.submitTvTask()" style="background:#2196f3; color:white; padding:10px; border:none; border-radius:4px;">✅ Submit Feature Space</button>`;
    }

    // --- C. STANDARD LOGIC (Planogram, Events, etc.) ---
    else {
        let color = activeTvCategory === "Planogram" ? "#673ab7" : "#e91e63";
        body.innerHTML = `
            <input type="hidden" id="tv-exec-id" value="${id}">
            <p style="background:#f5f5f5; padding:10px; border-radius:4px; font-weight:bold; border-left:4px solid ${color};">${desc}</p>
            
            <label style="font-size:12px; font-weight:bold;">Task Completed?</label>
            <select id="tv-exec-response" onchange="window.toggleReasonInput(this.value)" style="width:100%; padding:10px; margin-bottom:15px; border:1px solid #ccc; border-radius:4px;">
                <option value="">-- Select --</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
            </select>
            
            <div id="tv-reason-container" class="hidden">
                <label style="font-size:12px; font-weight:bold; color:#d32f2f;">Reason for Non-Completion:</label>
                <input type="text" id="tv-exec-reason" placeholder="Explain why..." style="width:100%; padding:10px; margin-bottom:15px; border:1px solid #ccc; border-radius:4px;">
            </div>

            <div id="tv-camera-container" class="hidden">
                <label style="font-size:12px; font-weight:bold;">Visual Proof:</label>
                <div id="tv-photo-status" style="margin-bottom:10px; font-size:12px; color:#555;">📸 Photo required for verification.</div>
                <button onclick="window.openCameraModal()" style="width:100%; padding:10px; background:${color}; color:white; border:none; border-radius:4px; cursor:pointer;">📸 Open Camera</button>
            </div>
        `;
        footer.innerHTML = `<button onclick="window.submitTvTask()" style="background:${color}; color:white; padding:10px; border:none; border-radius:4px;">✅ Submit</button>`;
    }
};
// --- THE CRITICAL HELPER FUNCTION ---
// This function MUST exist for the dropdown to work
window.toggleReasonInput = function(val) {
    const reasonDiv = document.getElementById("tv-reason-container");
    const cameraDiv = document.getElementById("tv-camera-container");
    
    if (!reasonDiv || !cameraDiv) return;

    // --- FEATURE SPACE LOGIC (Image Required for ALL options) ---
    if (activeTvCategory === "Feature Space") {
        if (val && val !== "") {
            cameraDiv.classList.remove("hidden"); 
            reasonDiv.classList.remove("hidden");
        } else {
            cameraDiv.classList.add("hidden");
            reasonDiv.classList.add("hidden");
        }
        return; // Exit here, do not run standard logic below
    }

    // --- STANDARD LOGIC (Original Yes/No) ---
    if (val === "Yes") {
        reasonDiv.classList.add("hidden");
        cameraDiv.classList.remove("hidden");
    } else if (val === "No") {
        reasonDiv.classList.remove("hidden");
        cameraDiv.classList.add("hidden");
    } else {
        reasonDiv.classList.add("hidden");
        cameraDiv.classList.add("hidden");
    }
};




// 8. SUBMIT TASK (Write to specific col
// ==========================================
// 📝 SUBMIT TASK LOGIC (FIXED & COMPLETE)
// ==========================================
window.submitTvTask = async function() {
    const taskId = document.getElementById("tv-exec-id").value;
    const btn = document.querySelector("#tv-execute-modal .modal-footer button");
    const config = TV_CONFIG_MAP[activeTvCategory];
    const timestamp = new Date().toLocaleString();
    const user = localStorage.getItem("portal_user_email");

    btn.innerText = "⏳ Saving...";
    btn.disabled = true;

    try {
        const task = tvDataCache.find(t => t.id === taskId);
        if (!task) throw new Error("Task not found.");
        const row = task.rowIndex;
        let values = [];
        let range = "";

        // --- 1. OFR AUDIT (Input Only) ---
        if (activeTvCategory === "OFR Audit") {
            // ... (Keep existing OFR Audit logic) ...
            const inputVal = document.getElementById("tv-exec-input").value;
            if (!inputVal) throw new Error("Please select a status.");
            
            if (task.role === "Manager") {
                await updateCell(config.sheetId, `${config.tabName}!M${row}`, [[inputVal]]);
                await updateCell(config.sheetId, `${config.tabName}!O${row}`, [[timestamp]]);
            } else {
                await updateCell(config.sheetId, `${config.tabName}!N${row}`, [[inputVal]]);
                await updateCell(config.sheetId, `${config.tabName}!P${row}`, [[timestamp]]);
            }
            alert("✅ Input Saved!");
            closeAndRefresh();
            return;
        }

        // --- 2. GET INPUTS (Feature Space & Others) ---
        // ... inside submitTvTask ...

        // --- 2. GET INPUTS ---
        const responseVal = document.getElementById("tv-exec-response").value;
        const reasonVal = document.getElementById("tv-exec-reason")?.value || ""; 

        if (!responseVal) throw new Error("Please select a status.");

        let statusCell = responseVal; 
        let photoLink = "-";

        // --- 3. HANDLE PHOTO & STATUS ---
        
        // CASE A: FEATURE SPACE (Photo Mandatory for ALL statuses)
        if (activeTvCategory === "Feature Space") {
            if (!pendingPhotoBlob) throw new Error("📸 Photo is required for ALL Feature Space statuses.");
            
            const fileName = `FS_${taskId}_${Date.now()}.jpg`; 
            const targetFolder = config.folderId || CONFIG.TRUEVIEW_FOLDER_ID;
            
            // Upload Photo
            photoLink = await uploadBlobToDrive(pendingPhotoBlob, fileName, targetFolder);
            
            // Append optional notes to status cell
            if (reasonVal) statusCell += ` | Note: ${reasonVal}`;
        }
        
        // CASE B: STANDARD LOGIC (Yes = Photo, No = Reason)
        else {
            if (responseVal === "Yes") {
                if (!pendingPhotoBlob) throw new Error("📸 Photo is required.");
                const fileName = `${activeTvCategory.substring(0,3)}_${taskId}_${Date.now()}.jpg`;
                const targetFolder = config.folderId || CONFIG.TRUEVIEW_FOLDER_ID;
                photoLink = await uploadBlobToDrive(pendingPhotoBlob, fileName, targetFolder);
            } else {
                // For No, reason is mandatory (except Offer Board which has specific logic)
                if (!reasonVal && activeTvCategory !== "Offer Board") throw new Error("Reason required.");
                
                if (activeTvCategory !== "Offer Board") {
                    statusCell = `${responseVal}: ${reasonVal}`;
                }
            }
        }

        // --- 4. MAP RANGES ---
        // ... (Rest of your range mapping code remains the same) ...

        // --- 4. MAP RANGES ---
        if (activeTvCategory === "Offer Board") {
            range = `${config.tabName}!J${row}:N${row}`;
            const reasonCell = (responseVal === "No" ? reasonVal : "-");
            const statusSimple = (responseVal === "Yes") ? "Yes" : "No";
            values = [[ statusSimple, reasonCell, photoLink, user, timestamp ]];
        } 
        else if (activeTvCategory === "Planogram") {
            range = `${config.tabName}!K${row}:M${row}`;
            values = [[ statusCell, photoLink, timestamp ]];
        } 
        else if (activeTvCategory === "Events") {
            range = `${config.tabName}!K${row}:M${row}`;
            values = [[ statusCell, photoLink, timestamp ]];
        }
        else if (activeTvCategory === "Feature Space") {
            // Col O: Status, P: Photo, Q: Date
            range = `${config.tabName}!O${row}:Q${row}`;
            values = [[ statusCell, photoLink, timestamp ]];
        }

        if (!range) throw new Error("Range config missing.");

        const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values/${range}?valueInputOption=USER_ENTERED`;
        await fetch(url, {
            method: "PUT",
            headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: values })
        });

        alert("✅ Submitted!");
        closeAndRefresh();

    } catch (e) { 
        console.error(e); 
        alert("Error: " + e.message); 
    } finally { 
        btn.innerText = "✅ Submit"; 
        btn.disabled = false; 
    }
};

// Helper to close modal and reload


// Helper for single cell updates (Used by OFR Audit)
async function updateCell(sheetId, range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=USER_ENTERED`;
    await fetch(url, {
        method: "PUT",
        headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: values })
    });
}

function closeAndRefresh() {
    document.getElementById("tv-execute-modal").classList.add("hidden");
    loadTvTasks();
}

// Helper for non-contiguous updates


// ==========================================
// 📸 CORE CAMERA FUNCTIONS (Required for TrueView)
// ==========================================

let videoStream = null;

// 1. OPEN CAMERA (Forces Back Camera on Mobile)
window.openCameraModal = async function() {
    // Check if the modal exists before trying to open it
    const modal = document.getElementById("camera-modal");
    if (!modal) {
        // If the generic camera modal is missing, we might be in TrueView mode.
        // TrueView uses the same logic, but we need to ensure the HTML exists.
        // For TrueView, we actually trigger the camera inside the specific modal 
        // OR we use the generic modal we added earlier.
        // Let's assume you added the <div id="camera-modal"> from a previous step.
        console.error("Error: <div id='camera-modal'> is missing from index.html");
        return;
    }

    const video = document.getElementById("camera-stream");
    const status = document.getElementById("camera-status");
    
    modal.classList.remove("hidden");
    window.resetCamera(); // Ensure UI is fresh

    try {
        // Request Camera (facingMode: 'environment' forces back camera)
        videoStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false 
        });
        
        video.srcObject = videoStream;
        if(status) status.innerText = "Point at warehouse item.";
        
    } catch (err) {
        console.error("Camera Error:", err);
        if(status) status.innerHTML = `<span style="color:red">❌ Camera Access Denied. Check permissions.</span>`;
        alert("Camera permission is required for verification.");
    }
};

// 2. CLOSE CAMERA
window.closeCameraModal = function() {
    const modal = document.getElementById("camera-modal");
    if(modal) modal.classList.add("hidden");
    
    // Stop the camera hardware light
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
};

// 3. CAPTURE & STAMP
window.capturePhoto = function() {
    const video = document.getElementById("camera-stream");
    const canvas = document.getElementById("camera-canvas");
    const context = canvas.getContext("2d");

    // Match canvas size to video resolution
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // A. Draw the Video Frame
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // B. Create Timestamp Data
    const now = new Date();
    const dateStr = now.toLocaleDateString() + " " + now.toLocaleTimeString();
    const user = localStorage.getItem("portal_user_email") || "Unknown User";
    const locText = `User: ${user} | Time: ${dateStr}`;

    // C. Draw Black Background Bar for Text (Bottom)
    context.fillStyle = "rgba(0, 0, 0, 0.6)";
    context.fillRect(0, canvas.height - 50, canvas.width, 50);

    // D. Draw White Timestamp Text
    context.fillStyle = "white";
    context.font = "bold 24px sans-serif";
    context.fillText(locText, 20, canvas.height - 18);

    // Toggle UI
    video.classList.add("hidden");
    canvas.classList.remove("hidden");
    
    // Show/Hide buttons if they exist
    const btnCapture = document.getElementById("btn-capture");
    const btnRetake = document.getElementById("btn-retake");
    const btnUpload = document.getElementById("btn-upload-photo");
    
    if(btnCapture) btnCapture.classList.add("hidden");
    if(btnRetake) btnRetake.classList.remove("hidden");
    if(btnUpload) btnUpload.classList.remove("hidden");
    
    const status = document.getElementById("camera-status");
    if(status) status.innerText = "Timestamp applied automatically.";
};

// 4. RETAKE
window.resetCamera = function() {
    const video = document.getElementById("camera-stream");
    const canvas = document.getElementById("camera-canvas");
    
    if(video) video.classList.remove("hidden");
    if(canvas) canvas.classList.add("hidden");
    
    const btnCapture = document.getElementById("btn-capture");
    const btnRetake = document.getElementById("btn-retake");
    const btnUpload = document.getElementById("btn-upload-photo");

    if(btnCapture) btnCapture.classList.remove("hidden");
    if(btnRetake) btnRetake.classList.add("hidden");
    if(btnUpload) btnUpload.classList.add("hidden");
    
    const status = document.getElementById("camera-status");
    if(status) status.innerText = "Point at warehouse item.";
};


// 8. DASHBOARD STATS (Fixed for Offer Board)

// ==========================================
// 8. DASHBOARD STATS (Unified: Fixed Events Column Mapping)
// ==========================================
async function loadTvStats() {
    const container = document.getElementById("tv-stats-table");
    const config = TV_CONFIG_MAP[activeTvCategory];
    
    if (!config) { console.error("Config missing"); return; }

    // --- 1. FILTER INJECTION ---
    const filterContainer = document.getElementById("tv-dash-filters");
    if (!filterContainer) {
        const filterDiv = document.createElement("div");
        filterDiv.id = "tv-dash-filters";
        filterDiv.style.marginBottom = "15px";
        filterDiv.style.padding = "15px";
        filterDiv.style.background = "#e0f2f1";
        filterDiv.style.borderRadius = "8px";
        
        const subDivDisplay = activeTvCategory === "Feature Space" ? "inline-block" : "none";
        
        filterDiv.innerHTML = `
            <div style="display:flex; gap:10px; align-items:center; flex-wrap: wrap;">
                <strong>📅 Date:</strong>
                <input type="date" id="dash-from" style="padding:5px; border-radius:4px; border:1px solid #ccc;">
                <span>to</span>
                <input type="date" id="dash-to" style="padding:5px; border-radius:4px; border:1px solid #ccc;">
                <input type="text" id="dash-subdiv" placeholder="Filter Sub-Div..." style="display:${subDivDisplay}; padding:5px; border-radius:4px; border:1px solid #ccc; width:120px;">
                <button onclick="window.loadTvStats()" style="background:#009688; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer;">🔄 Refresh</button>
                <button onclick="window.resetDashFilters()" style="background:#78909c; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer;">❌ Clear</button>
            </div>`;
        container.parentNode.insertBefore(filterDiv, container);
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        document.getElementById("dash-from").valueAsDate = firstDay;
        document.getElementById("dash-to").valueAsDate = today;
    }

    container.innerHTML = "⏳ Calculating analytics...";

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values/${config.tabName}`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();

        if (!data.values || data.values.length < 2) {
            resetStatsToZero();
            container.innerHTML = `<div style="padding:20px; text-align:center;">No data found.</div>`;
            return;
        }

        const rows = data.values.slice(1);
        const now = new Date();

        // --- Date Helpers ---
        function parseDueDate(dateStr) {
            if (!dateStr) return null;
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return null;
            d.setHours(23, 59, 59, 999);
            return d;
        }
        function getPossibleDoneDates(dateStr) {
            if (!dateStr || dateStr.trim() === "") return [];
            const cleanStr = dateStr.split(",")[0].trim();
            const parts = cleanStr.split(/[-/]/); 
            if (parts.length === 3) {
                const p0 = parseInt(parts[0]), p1 = parseInt(parts[1]), p2 = parseInt(parts[2]); 
                // Handle DD/MM vs MM/DD ambiguity
                if (p1 > 12) return [new Date(p2, p1 - 1, p0)];
                else if (p0 > 12) return [new Date(p2, p0 - 1, p1)];
                else return [new Date(p2, p1 - 1, p0), new Date(p2, p0 - 1, p1)];
            }
            return [new Date(dateStr)];
        }

        // ============================================================
        // 🅰️ MAIN LOGIC
        // ============================================================
        
        let fromDate = null; let toDate = null;
        const fVal = document.getElementById("dash-from")?.value;
        const tVal = document.getElementById("dash-to")?.value;
        const subDivFilter = document.getElementById("dash-subdiv")?.value.toLowerCase().trim();

        if (fVal) { fromDate = new Date(fVal); fromDate.setHours(0,0,0,0); }
        if (tVal) { toDate = new Date(tVal); toDate.setHours(23,59,59,999); }

        // --- 🔍 CORRECTED COLUMN MAPPINGS ---
        let colMap = {};
        
        if (activeTvCategory === "Events") {
            // Store(2), Start(3), End(4), StatusCheck(11-Link), Timestamp(12)
            colMap = { store: 2, start: 3, due: 4, statusIdx: 11, timestamp: 12 };
        } 
        else if (activeTvCategory === "Planogram") {
            // Adjust if Planogram structure is similar to Events
            colMap = { store: 2, start: 3, due: 4, statusIdx: 11, timestamp: 12 };
        }
        else if (activeTvCategory === "Offer Board") {
            colMap = { store: 2, start: 3, due: 4, statusIdx: 11, timestamp: 13 };
        } 
        else if (activeTvCategory === "Feature Space") {
            colMap = { store: 2, start: 3, due: 4, statusIdx: 15, timestamp: 16, subdiv: 8 };
        } 
        else { 
            colMap = { store: 2, start: 3 }; // OFR Audit
        }

        let gTotal = 0, gDone = 0, gLateDone = 0, gOverdue = 0;
        const storeStats = {}; 

        rows.forEach(r => {
            // 1. Filter by Date
            const filterDateObj = parseDueDate(r[colMap.start]); 
            if (fromDate && toDate) {
                if (!filterDateObj) return; 
                const checkDate = new Date(filterDateObj); checkDate.setHours(0,0,0,0);
                if (checkDate < fromDate || checkDate > toDate) return;
            }

            // 2. Filter by SubDiv
            if (activeTvCategory === "Feature Space" && subDivFilter) {
                const rowSubDiv = r[colMap.subdiv] ? String(r[colMap.subdiv]).toLowerCase() : "";
                if (!rowSubDiv.includes(subDivFilter)) return; 
            }

            // 3. Init Store
            const storeName = r[colMap.store] ? String(r[colMap.store]).trim() : "Unknown";
            if (!storeStats[storeName]) {
                if (activeTvCategory === "OFR Audit") storeStats[storeName] = { mgr: { t:0, d:0, ld:0, lp:0 }, tl: { t:0, d:0, ld:0, lp:0 } };
                else storeStats[storeName] = { t:0, d:0, ld:0, lp:0 };
            }

            // 4. OFR AUDIT LOGIC
            if (activeTvCategory === "OFR Audit") {
                const mgrEmail = r[10];
                if (mgrEmail && mgrEmail.trim() !== "") {
                    gTotal++; storeStats[storeName].mgr.t++;
                    const mgrDone = (r[12] && r[12].trim() !== "");
                    const mgrDue = parseDueDate(r[4]);
                    const mgrTimeStr = r[14];
                    if (mgrDone) {
                        gDone++; storeStats[storeName].mgr.d++;
                        if (mgrDue && mgrTimeStr) {
                            const candidates = getPossibleDoneDates(mgrTimeStr);
                            if (!candidates.some(d => d <= mgrDue)) { gLateDone++; storeStats[storeName].mgr.ld++; }
                        }
                    } else if (mgrDue && now > mgrDue) { gOverdue++; storeStats[storeName].mgr.lp++; }
                }
                const tlEmail = r[11];
                if (tlEmail && tlEmail.trim() !== "") {
                    gTotal++; storeStats[storeName].tl.t++;
                    const tlDone = (r[13] && r[13].trim() !== "");
                    const tlDue = parseDueDate(r[5]);
                    const tlTimeStr = r[15];
                    if (tlDone) {
                        gDone++; storeStats[storeName].tl.d++;
                        if (tlDue && tlTimeStr) {
                            const candidates = getPossibleDoneDates(tlTimeStr);
                            if (!candidates.some(d => d <= tlDue)) { gLateDone++; storeStats[storeName].tl.ld++; }
                        }
                    } else if (tlDue && now > tlDue) { gOverdue++; storeStats[storeName].tl.lp++; }
                }
            }
            
            // 5. GENERIC LOGIC (Events, Planogram, etc.)
            else {
                if (storeName !== "Unknown") {
                    gTotal++; storeStats[storeName].t++;

                    // Check Status Column (Must be Link or >5 chars)
                    const statusVal = r[colMap.statusIdx];
                    const isDone = (statusVal && statusVal.trim().length > 5); 
                    
                    const doneTimeStr = r[colMap.timestamp]; 
                    const dueDate = parseDueDate(r[colMap.due]); 

                    if (isDone) {
                        gDone++; storeStats[storeName].d++;
                        
                        // Calculate Late Done
                        if (dueDate && doneTimeStr) {
                            const candidates = getPossibleDoneDates(doneTimeStr);
                            const potentiallyOnTime = candidates.some(d => d <= dueDate);
                            if (!potentiallyOnTime) { 
                                gLateDone++; 
                                storeStats[storeName].ld++; 
                            }
                        }
                    } else {
                        // Calculate Overdue
                        if (dueDate && now > dueDate) {
                            gOverdue++; 
                            storeStats[storeName].lp++; 
                        }
                    }
                }
            }
        });

        // --- RENDER UI ---
        const pct = gTotal > 0 ? Math.round((gDone/gTotal)*100) : 0;
        document.getElementById("tv-stat-total").innerText = gTotal;
        document.getElementById("tv-stat-pending").innerText = gTotal - gDone;
        document.getElementById("tv-stat-completed").innerText = gDone;
        document.getElementById("tv-stat-percent").innerHTML = `${pct}% <div style="font-size:9px; margin-top:2px;"><span style="color:#f57c00;">⚠️ Done: ${gLateDone}</span> | <span style="color:#d32f2f;">⏳ Due: ${gOverdue}</span></div>`;

        // Table Render
        let tableHeader = "";
        let tableRows = "";
        const sortedStores = Object.keys(storeStats).sort();

        if (activeTvCategory === "OFR Audit") {
             tableHeader = `<tr style="background:#f5f5f5;"><th rowspan="2" style="text-align:left;">Store</th><th colspan="4" style="text-align:center;">Manager</th><th colspan="4" style="text-align:center;">TL</th></tr><tr style="background:#f5f5f5;"><th>T</th><th>✅</th><th>⚠️</th><th>⏳</th><th>T</th><th>✅</th><th>⚠️</th><th>⏳</th></tr>`;
             sortedStores.forEach(s => {
                const d = storeStats[s];
                if(!d.mgr) d.mgr={t:0,d:0,ld:0,lp:0}; if(!d.tl) d.tl={t:0,d:0,ld:0,lp:0};
                const mc = d.mgr.t>0 && d.mgr.t===d.mgr.d ? '#e8f5e9' : '';
                const tc = d.tl.t>0 && d.tl.t===d.tl.d ? '#e8f5e9' : '';
                tableRows += `<tr><td style="font-weight:500;">${s}</td><td style="background:${mc}">${d.mgr.t}</td><td style="background:${mc}">${d.mgr.d}</td><td>${d.mgr.ld||'-'}</td><td>${d.mgr.lp||'-'}</td><td style="background:${tc}">${d.tl.t}</td><td style="background:${tc}">${d.tl.d}</td><td>${d.tl.ld||'-'}</td><td>${d.tl.lp||'-'}</td></tr>`;
             });
        } else {
            tableHeader = `<tr style="background:#f5f5f5;"><th style="text-align:left;">Store Name</th><th>Total</th><th>Done</th><th>Late Done ⚠️</th><th>Overdue ⏳</th><th>Progress</th></tr>`;
            sortedStores.forEach(s => {
                const d = storeStats[s];
                const p = d.t > 0 ? Math.round((d.d / d.t) * 100) : 0;
                const barColor = p === 100 ? '#4caf50' : (p > 50 ? '#ff9800' : '#f44336');
                tableRows += `<tr><td style="font-weight:500;">${s}</td><td>${d.t}</td><td style="font-weight:bold; color:${d.t===d.d ? 'green' : 'black'}">${d.d}</td><td style="color:${d.ld > 0 ? '#f57c00' : '#ccc'}">${d.ld || '-'}</td><td style="color:${d.lp > 0 ? '#d32f2f' : '#ccc'}">${d.lp || '-'}</td><td style="width:100px;"><div style="width:100%; background:#eee; height:6px; border-radius:10px; overflow:hidden;"><div style="width:${p}%; background:${barColor}; height:100%;"></div></div><div style="font-size:10px; text-align:right;">${p}%</div></td></tr>`;
            });
        }

        container.innerHTML = `<div style="max-height: 500px; overflow-y: auto; border: 1px solid #ccc;"><table class="data-table" style="font-size:12px; width:100%;"><thead>${tableHeader}</thead><tbody>${tableRows}</tbody></table></div>`;

    } catch (e) { console.error(e); container.innerHTML = "Error: " + e.message; }
}
// Ensure filter reset works
window.resetDashFilters = function() {
    document.getElementById("dash-from").value = "";
    document.getElementById("dash-to").value = "";
    window.loadTvStats();
};

// Helper to reset filter inputs
window.resetDashFilters = function() {
    document.getElementById("dash-from").value = "";
    document.getElementById("dash-to").value = "";
    window.loadTvStats();
};

// ==========================================
// 📸 CAMERA HELPER: SAVE PHOTO TO MEMORY
// ==========================================
window.uploadCapturedPhoto = function() {
    const canvas = document.getElementById("camera-canvas");
    
    if (!canvas) {
        alert("Error: Camera canvas not found.");
        return;
    }

    // Convert the canvas image to a Blob (file-like object)
    canvas.toBlob((blob) => {
        if (!blob) {
            alert("Failed to capture image.");
            return;
        }

        // 1. Store the blob in the global variable defined at the top of app.js
        pendingPhotoBlob = blob; 

        // 2. Update the TrueView UI to show success
        const statusText = document.getElementById("tv-photo-status");
        if (statusText) {
            statusText.innerHTML = "✅ <b>Photo Captured & Ready.</b>";
            statusText.style.color = "green";
        }

        // 3. Close the Camera Modal
        window.closeCameraModal();
        
        console.log("📸 Photo stored in memory (Size: " + blob.size + " bytes)");

    }, 'image/jpeg', 0.7); // 0.7 = 70% Quality (Reduces upload size)
};

// ==========================================
// ☁️ DRIVE HELPER: UPLOAD BLOB
// ==========================================


async function uploadBlobToDrive(blob, fileName, targetFolderId = null) {
    // 1. Priority: Function argument
    // 2. Fallback: TrueView global folder
    // 3. Fallback: Work Reports global folder
    const folderId = targetFolderId || CONFIG.TRUEVIEW_FOLDER_ID || CONFIG.WORK_REPORTS_FOLDER_ID;

    if (!folderId) {
        throw new Error("No Target Folder ID configured");
    }

    const metadata = {
        name: fileName,
        mimeType: 'image/jpeg',
        parents: [folderId]
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { "Authorization": `Bearer ${accessToken}` },
        body: form
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error("Upload Failed: " + (err.error?.message || response.statusText));
    }

    const data = await response.json();
    return data.webViewLink;
}


// ==========================================
// ⬇️ DOWNLOAD REPORT LOGIC (COMPLETE)
// ==========================================
window.generateTvReport = async function() {
    const fromInput = document.getElementById("tv-rep-from").value;
    const toInput = document.getElementById("tv-rep-to").value;
    const statusEl = document.getElementById("tv-download-status");
    const btn = document.getElementById("btn-download-report");
    const config = TV_CONFIG_MAP[activeTvCategory];

    if (!fromInput || !toInput) { alert("Select Dates"); return; }

    btn.disabled = true;
    btn.innerText = "⏳ Downloading...";
    statusEl.innerText = "";
    
    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values/${config.tabName}`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();
        
        if (!data.values || data.values.length < 2) throw new Error("No data found.");
        
        const rows = data.values.slice(1);
        const fromDate = new Date(fromInput); fromDate.setHours(0,0,0,0);
        const toDate = new Date(toInput); toDate.setHours(23,59,59,999);

        let filteredData = [];
        let headers = [];

        // --- 1. EVENTS LOGIC (NEW) ---
        // --- 1. EVENTS LOGIC (NEW) ---
        if (activeTvCategory === "Events") {
            headers = ["ID", "Store No", "Store Name", "Start Date", "End Date", "Approver", "Sub Div", "Cat No", "Cat Name", "Special Offer", "Status", "Picture", "Date"];
            
            const fStore = document.getElementById("filter-store")?.value.trim().toLowerCase();
            const fCat = document.getElementById("filter-cat")?.value.trim().toLowerCase();
            const fOffer = document.getElementById("filter-offer")?.value.trim().toLowerCase();

            filteredData = rows.filter(r => {
                // 🔴 OLD LINE (Causing Issue): 
                // const d = new Date(r[3]); 

                // 🟢 NEW FIX: Append Current Year if missing
                let dateStr = r[3]; 
                if (dateStr && !dateStr.match(/\d{4}/)) {
                    dateStr += "-" + new Date().getFullYear(); // Turns "Jan-10" into "Jan-10-2026"
                }
                const d = new Date(dateStr); 

                // Date Range Check
                if (isNaN(d.getTime())) return false; // Safety check for invalid dates
                if (!(d >= fromDate && d <= toDate)) return false;

                // Other Filters
                if (fStore && String(r[1]).toLowerCase() !== fStore) return false;
                if (fCat && !String(r[8]).toLowerCase().includes(fCat)) return false;
                if (fOffer && !String(r[9]).toLowerCase().includes(fOffer)) return false;

                return true;
            });
        }
        // --- 2. PLANOGRAM LOGIC ---
        else if (activeTvCategory === "Planogram") {
            headers = ["ID", "Store No", "Store Name", "Start Date", "End Date", "Sub Div", "Cat No", "Cat Name", "Brand", "Approver", "Executed/Reason", "Photo", "Date"];
            
            const fStore = document.getElementById("filter-store")?.value.trim().toLowerCase();
            const fSubDiv = document.getElementById("filter-subdiv")?.value.trim().toLowerCase();
            const fCat = document.getElementById("filter-cat")?.value.trim().toLowerCase();
            const fBrand = document.getElementById("filter-brand")?.value.trim().toLowerCase();

            filteredData = rows.filter(r => {
                const d = new Date(r[3]); // Start Date
                if (!(d >= fromDate && d <= toDate)) return false;

                if (fStore && String(r[1]).toLowerCase() !== fStore) return false;
                if (fSubDiv && String(r[4]).toLowerCase() !== fSubDiv) return false;
                if (fCat && !String(r[6]).toLowerCase().includes(fCat)) return false;
                if (fBrand && !String(r[7]).toLowerCase().includes(fBrand)) return false;

                return true;
            });
        }
        // --- 3. FEATURE SPACE LOGIC ---
        else if (activeTvCategory === "Feature Space") {
            headers = ["ID", "Store No", "Store Name", "Start", "End", "Approver", "Cat No", "Div", "SubDiv", "Cat Name", "Item No", "Item Desc", "Loc", "Type", "Status", "Image", "Time"];
            
            const fStore = document.getElementById("filter-store")?.value.trim().toLowerCase();
            const fCat = document.getElementById("filter-cat")?.value.trim().toLowerCase();
            const fItem = document.getElementById("filter-item")?.value.trim().toLowerCase();

            filteredData = rows.filter(r => {
                const d = new Date(r[3]); // Start Date
                if (!(d >= fromDate && d <= toDate)) return false;
                
                if (fStore && String(r[1]).toLowerCase() !== fStore) return false;
                if (fCat && !String(r[9]).toLowerCase().includes(fCat)) return false;
                if (fItem && !String(r[11]).toLowerCase().includes(fItem)) return false;
                
                return true;
            });
        }
        // --- 4. OFFER BOARD LOGIC ---
        else if (activeTvCategory === "Offer Board") {
            headers = ["ID", "Store No", "Store Name", "Start Date", "End Date", "Approver", "Esc L1", "Esc L2", "Posters", "Executed", "Reason", "Photo", "By", "Time"];
            filteredData = rows.filter(r => {
                const d = new Date(r[3]); // Start Date
                return d >= fromDate && d <= toDate;
            });
        } 
        // --- 5. OFR AUDIT LOGIC ---
        else if (activeTvCategory === "OFR Audit") {
            headers = ["ID", "Store No", "Store Name", "Invoice Date", "Manager Due Date","TL Due Date", "Art No", "Desc", "Short Orders", "Short Qty", "Manager Mail", "TL Mail", "Manager Input", "TL Input", "Manager Time", "TL Time"];
            filteredData = rows.filter(r => {
                const d = new Date(r[3]); // Invoice Date
                return d >= fromDate && d <= toDate;
            });
        }

        if (filteredData.length === 0) throw new Error("No records found matching filters.");

        let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\r\n";
        filteredData.forEach(row => {
            const safeRow = row.map(cell => `"${(cell || "").toString().replace(/"/g, '""')}"`);
            csvContent += safeRow.join(",") + "\r\n";
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `${activeTvCategory}_Report.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        statusEl.innerText = `✅ Downloaded ${filteredData.length} records!`;

    } catch (e) {
        statusEl.innerText = "Error: " + e.message;
        console.error(e);
    } finally {
        btn.disabled = false;
        btn.innerText = "⬇️ Generate & Download CSV";
    }
};

// ==========================================
// 🧹 HELPER: RESET STATS TO ZERO
// ==========================================
function resetStatsToZero() {
    // Check if elements exist before setting text to avoid errors
    const totalEl = document.getElementById("tv-stat-total");
    if (totalEl) {
        document.getElementById("tv-stat-total").innerText = "0";
        document.getElementById("tv-stat-pending").innerText = "0";
        document.getElementById("tv-stat-completed").innerText = "0";
        document.getElementById("tv-stat-percent").innerText = "0%";
        document.getElementById("tv-stats-table").innerHTML = "<p style='text-align:center; padding:20px; color:#aaa;'>No Data</p>";
    }
}

// ==========================================
// 🎛️ DYNAMIC DOWNLOAD VIEW RENDERER
// ==========================================

window.renderDownloadOptions = function() {
    const container = document.getElementById("tv-view-download");
    if (!container) return;

    let extraFilters = "";
    let pptButton = "";

    // --- A. EVENTS ---
    if (activeTvCategory === "Events") {
        extraFilters = `
            <div style="margin-bottom: 15px; border-top: 1px solid #ccc; padding-top: 15px;">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                    <input type="text" id="filter-store" placeholder="Store No." style="padding:8px; border:1px solid #ddd; border-radius:4px;">
                    <input type="text" id="filter-cat" placeholder="Category Name" style="padding:8px; border:1px solid #ddd; border-radius:4px;">
                    <input type="text" id="filter-offer" placeholder="Special Offer" style="padding:8px; border:1px solid #ddd; border-radius:4px;">
                </div>
            </div>`;
        pptButton = `<button id="btn-ppt-gen" onclick="window.generateTvPPT()" style="width:100%; background:#e65100; color:white; padding:12px; border:none; border-radius:4px; font-weight:bold; cursor:pointer; margin-top:10px;">📊 Generate & Download PPT</button>`;
    }

    // --- B. FEATURE SPACE (UPDATED: Category Dropdown) ---
    else if (activeTvCategory === "Feature Space") {
        
        // 1. Define Categories
        const categories = [
            "Flours", "Olive Oil", "Health Oil", "Hair Care/Hair Oil & Treatment", "Personal Wash",
            "Hair Care/Skin Emerging/Hair Oil & Treatment", "HAIR CARE", "Skin/Hair/Personal wash",
            "Skin Emerging", "Skin core", "Personal Wash/Skin Emerging", "PC Multiple Cats",
            "Colgate-Oral Care & Shaving", "Oral Care & Shaving Needs/Skin Emerging", "Baby Care",
            "Fem Hygiene", "Hair oil", "Oral Care & Shaving Needs", "Hair Oil & Treatment",
            "Skin Core/Personal Wash/Skin Emerging", "Hair Oil & Treatment/Hair care",
            "Skin Core/Skin Emerging", "Personal Wash/Skin Core/Skin Emerging", "Cleaning",
            "Air Care", "Home care", "Pharmacy OTC", "Laundry & Det", "Luggage & Bags",
            "Home Textiles", "SAVORY", "Juice & Water", "CSD & Sport Drink", "Dry Fruits",
            "Ingredients", "Culinary", "Paper Goods and Disposables", "Biscuits", "Hot Beverages",
            "Health Food Drinks", "Houseware", "Tableware", "Confectionery", "Chocolates",
            "Spices", "Large and Seasonal Appliances", "Dry Foods", "Bakery", "SKIN CARE",
            "Detergent Bars & Liquid", "Laundry", "Juices & Water", "Ambient Dairy",
            "Noodles & Pasta", "Rice", "Dry Fruit & Spices", "Cashtill-Processed Food",
            "Cartrail-FMCG FOOD", "Cartrail-Staples", "Cartrail-GM", "Cartrail-FMCG NON FOOD",
            "PB NON FOOD POD", "Aircare", "Pharmacy-OTC", "Dry Fruits & Indredients", "CSD",
            "Chocolate", "Confectionary", "Health Food Drink"
        ];

        // 2. Generate Options
        const catOptions = categories.map(c => `<option value="${c}">${c}</option>`).join("");

        extraFilters = `
            <div style="margin-bottom: 15px; border-top: 1px solid #ccc; padding-top: 15px;">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                    <input type="text" id="filter-store" placeholder="Store No." style="padding:8px; border:1px solid #ddd; border-radius:4px;">
                    <input type="text" id="filter-subdiv" placeholder="Sub-Division" style="padding:8px; border:1px solid #ddd; border-radius:4px;">
                    
                    <select id="filter-category" style="padding:8px; border:1px solid #ddd; border-radius:4px; background:white;">
                        <option value="">-- All Categories --</option>
                        ${catOptions}
                    </select>
                </div>
            </div>`;
        pptButton = `<button id="btn-ppt-gen" onclick="window.generateTvPPT()" style="width:100%; background:#2196f3; color:white; padding:12px; border:none; border-radius:4px; font-weight:bold; cursor:pointer; margin-top:10px;">📊 Generate & Download PPT</button>`;
    }

    // --- C. PLANOGRAM ---
    else if (activeTvCategory === "Planogram") {
        extraFilters = `
            <div style="margin-bottom: 15px; border-top: 1px solid #ccc; padding-top: 15px;">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                    <input type="text" id="filter-store" placeholder="Store No." style="padding:8px; border:1px solid #ddd; border-radius:4px;">
                    <input type="text" id="filter-cat" placeholder="Category" style="padding:8px; border:1px solid #ddd; border-radius:4px;">
                    <input type="text" id="filter-brand" placeholder="Brand" style="padding:8px; border:1px solid #ddd; border-radius:4px;">
                </div>
            </div>`;
        pptButton = `<button id="btn-ppt-gen" onclick="window.generateTvPPT()" style="width:100%; background:#673ab7; color:white; padding:12px; border:none; border-radius:4px; font-weight:bold; cursor:pointer; margin-top:10px;">📊 Generate & Download PPT</button>`;
    }

    // --- D. OFFER BOARD ---
    else if (activeTvCategory === "Offer Board") {
        extraFilters = `
            <div style="margin-bottom: 15px; border-top: 1px solid #ccc; padding-top: 15px;">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                    <input type="text" id="filter-store" placeholder="Store No." style="padding:8px; border:1px solid #ddd; border-radius:4px;">
                </div>
            </div>`;
        pptButton = `<button id="btn-ppt-gen" onclick="window.generateTvPPT()" style="width:100%; background:#ff9800; color:white; padding:12px; border:none; border-radius:4px; font-weight:bold; cursor:pointer; margin-top:10px;">📊 Generate & Download PPT</button>`;
    }

    // --- RENDER VIEW ---
    container.innerHTML = `
        <div style="background:#e8eaf6; padding:20px; border-radius:8px; border:1px solid #c5cae9; max-width:500px;">
            <h3 style="margin-top:0;">📅 Export ${activeTvCategory} Report</h3>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:15px;">
                <div><label>From:</label><input type="date" id="tv-rep-from" style="width:100%; padding:10px;"></div>
                <div><label>To:</label><input type="date" id="tv-rep-to" style="width:100%; padding:10px;"></div>
            </div>
            ${extraFilters}
            
            <button id="btn-download-report" onclick="window.generateTvReport()" style="width:100%; background:#3f51b5; color:white; padding:12px; border:none; border-radius:4px; cursor:pointer;">⬇️ Download CSV</button>
            ${pptButton}

            <div id="ppt-progress-container" class="hidden" style="margin-top:15px;">
                <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:5px; font-weight:bold;">
                    <span id="ppt-status-text">Initializing...</span>
                    <span id="ppt-timer-text">Est. Time: --</span>
                </div>
                <div style="width:100%; background:#cfd8dc; height:8px; border-radius:4px; overflow:hidden;">
                    <div id="ppt-progress-bar" style="width:0%; height:100%; background:#4caf50; transition:width 0.3s;"></div>
                </div>
            </div>

            <p id="tv-download-status" style="margin-top:10px; font-size:12px; text-align:center; color:#d32f2f;"></p>
        </div>
    `;
};

// ==========================================
// 📊 PPT GENERATION LOGIC

// ==========================================
// 📊 PPT GENERATION LOGIC (Fixed Feature Space Category Filter)
// ==========================================
window.generateTvPPT = async function() {
    const fromInput = document.getElementById("tv-rep-from").value;
    const toInput = document.getElementById("tv-rep-to").value;
    const statusEl = document.getElementById("tv-download-status");
    const btn = document.getElementById("btn-ppt-gen");
    const config = TV_CONFIG_MAP[activeTvCategory];

    // Progress Elements
    const progressContainer = document.getElementById("ppt-progress-container");
    const progressBar = document.getElementById("ppt-progress-bar");
    const statusText = document.getElementById("ppt-status-text");
    const timerText = document.getElementById("ppt-timer-text");

    if (!fromInput || !toInput) { alert("Select Dates"); return; }

    btn.disabled = true;
    btn.style.opacity = "0.6";
    statusEl.innerText = "";
    
    if(progressContainer) progressContainer.classList.remove("hidden");
    if(progressBar) progressBar.style.width = "0%";
    if(timerText) timerText.innerText = "Calculating...";

    try {
        // 1. Fetch Data
        if(statusText) statusText.innerText = "Fetching Sheet Data...";
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values/${config.tabName}`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();
        
        if (!data.values || data.values.length < 2) throw new Error("No data found.");
        
        const rows = data.values.slice(1);
        const fromDate = new Date(fromInput); fromDate.setHours(0,0,0,0);
        const toDate = new Date(toInput); toDate.setHours(23,59,59,999);

        let filteredData = [];
        let imageColIndex = -1; 

        // --- FILTER LOGIC ---
        
        // A. PLANOGRAM
        if (activeTvCategory === "Planogram") {
            imageColIndex = 11;
            const fStore = document.getElementById("filter-store")?.value.trim().toLowerCase() || "";
            const fCat = document.getElementById("filter-cat")?.value.trim().toLowerCase() || "";
            const fBrand = document.getElementById("filter-brand")?.value.trim().toLowerCase() || "";

            filteredData = rows.filter(r => {
                const d = new Date(r[3]); 
                if (!(d >= fromDate && d <= toDate)) return false;
                if (fStore && String(r[1]).toLowerCase() !== fStore) return false;
                if (fCat && !String(r[7]).toLowerCase().includes(fCat)) return false; 
                if (fBrand && !String(r[8]).toLowerCase().includes(fBrand)) return false;
                if (!r[11] || r[11].trim() === "") return false; 
                return true;
            });
        }
        
        // B. FEATURE SPACE (UPDATED)
        else if (activeTvCategory === "Feature Space") {
            imageColIndex = 15;
            
            const fStore = document.getElementById("filter-store")?.value.trim().toLowerCase() || "";
            const fSubDiv = document.getElementById("filter-subdiv")?.value.trim().toLowerCase() || "";
            
            // 🆕 New Category Filter Logic (Dropdown)
            const fCategory = document.getElementById("filter-category")?.value.trim().toLowerCase() || "";

            filteredData = rows.filter(r => {
                const d = new Date(r[3]); 
                if (!(d >= fromDate && d <= toDate)) return false;
                if (fStore && String(r[1]).toLowerCase() !== fStore) return false;
                
                // Filter Sub-Division (Index 8)
                if (fSubDiv && !String(r[8]).toLowerCase().includes(fSubDiv)) return false;
                
                // 🆕 Filter Category (Col J = Index 9)
                if (fCategory && !String(r[9]).toLowerCase().includes(fCategory)) return false;

                if (!r[15] || r[15].trim() === "" || r[15] === "N/A") return false;
                return true;
            });
        }
        
        // C. EVENTS
        else if (activeTvCategory === "Events") {
            imageColIndex = 11;
            const fStore = document.getElementById("filter-store")?.value.trim().toLowerCase() || "";
            const fCat = document.getElementById("filter-cat")?.value.trim().toLowerCase() || "";
            const fOffer = document.getElementById("filter-offer")?.value.trim().toLowerCase() || "";

            filteredData = rows.filter(r => {
                let dateStr = r[3]; 
                if (dateStr && !dateStr.match(/\d{4}/)) dateStr += "-" + new Date().getFullYear();
                const d = new Date(dateStr); 
                
                if (isNaN(d.getTime())) return false;
                if (!(d >= fromDate && d <= toDate)) return false;
                if (fStore && String(r[1]).toLowerCase() !== fStore) return false;
                if (fCat && !String(r[8]).toLowerCase().includes(fCat)) return false;
                if (fOffer && !String(r[9]).toLowerCase().includes(fOffer)) return false;
                if (!r[11] || r[11].trim() === "") return false;
                return true;
            });
        }
        
        // D. OFFER BOARD
        else if (activeTvCategory === "Offer Board") {
            imageColIndex = 11; 
            const fStore = document.getElementById("filter-store")?.value.trim().toLowerCase() || "";

            filteredData = rows.filter(r => {
                const d = new Date(r[3]); 
                if (!(d >= fromDate && d <= toDate)) return false;
                if (fStore && String(r[1]).toLowerCase() !== fStore) return false;
                if (!r[11] || r[11].trim() === "") return false; 
                return true;
            });
        }

        if (filteredData.length === 0) throw new Error("No records with images found matching filters.");

        // 2. Initialize PPT
        let pres = new PptxGenJS();
        pres.layout = "LAYOUT_16x9";

        // 3. Process Rows & Fetch Images
        const totalSlides = filteredData.length;
        const startTime = Date.now();
        
        for (let i = 0; i < totalSlides; i++) {
            const row = filteredData[i];
            const driveLink = row[imageColIndex];
            
            // Timer Logic
            const elapsed = (Date.now() - startTime) / 1000;
            const avgTime = i > 0 ? (elapsed / i) : 0; 
            const estSecondsLeft = avgTime > 0 ? Math.ceil(avgTime * (totalSlides - i)) : "Calculating...";
            
            // UI Updates
            const pct = Math.round(((i) / totalSlides) * 100);
            if(progressBar) progressBar.style.width = `${pct}%`;
            if(statusText) statusText.innerText = `Processing Slide ${i+1} of ${totalSlides}`;
            if(timerText) timerText.innerText = typeof estSecondsLeft === 'number' ? `Est. Wait: ${estSecondsLeft} sec` : `Est. Wait: ...`;

            let fileId = null;
            if (driveLink.includes("id=")) fileId = driveLink.split("id=")[1].split("&")[0];
            else if (driveLink.includes("/d/")) fileId = driveLink.split("/d/")[1].split("/")[0];

            if (fileId) {
                try {
                    const base64Img = await fetchImageAsBase64(fileId);
                    
                    let slide = pres.addSlide();
                    let tableRows = [];

                    // --- SLIDE CONTENT MAPPING ---
                    if (activeTvCategory === "Planogram") {
                        tableRows = [
                            ["Store", row[1] + " - " + row[2]],
                            ["Date Range", row[3] + " to " + row[4]],
                            ["Sub Division", row[5]],
                            ["Category", row[7]], 
                            ["Brand", row[8]],
                            ["Status", row[10]]
                        ];
                    } else if (activeTvCategory === "Feature Space") {
                        tableRows = [
                            ["Store", row[1] + " - " + row[2]],
                            ["Approver", row[5]],
                            ["Sub-Div", row[8]], 
                            ["Category", row[9]],  // Added Category to Slide for visibility
                            ["Item", row[11]],
                            ["Status", row[14]]
                        ];
                    } else if (activeTvCategory === "Events") {
                        tableRows = [
                            ["Store", row[1] + " - " + row[2]],
                            ["Date Range", row[3] + " to " + row[4]],
                            ["Approver", row[5]],
                            ["Category", row[8]],
                            ["Offer", row[9]],
                            ["Status", row[10]]
                        ];
                    } else if (activeTvCategory === "Offer Board") {
                        tableRows = [
                            ["Store", row[1] + " - " + row[2]],
                            ["Date Range", row[3] + " to " + row[4]],
                            ["Posters", row[8]],
                            ["Status", row[9]], 
                            ["Reason", row[10]], 
                            ["Audit By", row[12]]
                        ];
                    }

                    // Add Table (Left Half)
                    slide.addTable(tableRows, {
                        x: 0.5, y: 0.5, w: 4.5, h: 4.5,
                        colW: [1.5, 3.0],
                        fontSize: 14, border: { pt: 1, color: "E0E0E0" },
                        fill: { color: "F9F9F9" }
                    });

                    // Add Image (Right Half)
                    if (base64Img) {
                        slide.addImage({ 
                            data: base64Img, 
                            x: 5.2, y: 0.5, w: 4.5, h: 4.5, 
                            sizing: { type: "contain", w: 4.5, h: 4.5 } 
                        });
                    }

                } catch (err) {
                    console.error("Failed to add image for slide " + i, err);
                }
            }
        }

        // Final UI Update
        if(progressBar) progressBar.style.width = "100%";
        if(statusText) statusText.innerText = "Finalizing File...";
        if(timerText) timerText.innerText = "Almost done!";

        await pres.writeFile({ fileName: `${activeTvCategory}_Report.pptx` });
        
        statusEl.innerText = "";
        if(statusText) statusText.innerText = "✅ Download Complete!";
        if(timerText) timerText.innerText = "";
        setTimeout(() => { if(progressContainer) progressContainer.classList.add("hidden"); }, 5000);

    } catch (e) {
        statusEl.innerText = "Error: " + e.message;
        console.error(e);
        if(progressContainer) progressContainer.classList.add("hidden");
    } finally {
        btn.disabled = false;
        btn.style.opacity = "1";
    }
};

// HELPER: Fetch Drive Image as Base64 string
async function fetchImageAsBase64(fileId) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
    if (!response.ok) return null;
    
    const blob = await response.blob();
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result); // This includes 'data:image/jpeg;base64,...'
        reader.readAsDataURL(blob);
    });
}

// ==========================================
// 👁️ UI HELPER: TOGGLE PASSWORD VISIBILITY
// ==========================================
window.toggleInput = function(inputId, icon) {
    const input = document.getElementById(inputId);
    if (!input) return;

    if (input.type === "password") {
        input.type = "text"; // Show
        icon.innerText = "🙈"; // Change icon to 'Hide'
    } else {
        input.type = "password"; // Hide
        icon.innerText = "👁️"; // Change icon back to 'Show'
    }
};



// 1. POPULATE COLUMNS


// 2. RUN ANALYSIS (With Explicit Double Casting)
// ==========================================
// 🛠️ KYB ANALYTICS (Deep Debug Fix)
// ==========================================

// ==========================================
// 🛠️ KYB ANALYTICS (Safe Mode: No BigInts)
// ==========================================
// ==========================================
// 🛠️ KYB ANALYTICS (Nuclear Safe Mode)
// ==========================================

async function runKybAnalysis() {
    const tableName = document.getElementById("kyb-table-select").value;
    const geoInput = document.getElementById("kyb-geojson-file");
    const start1 = document.getElementById("kyb-col-start1").value;
    const end1 = document.getElementById("kyb-col-end1").value;
    const start2 = document.getElementById("kyb-col-start2").value;
    const end2 = document.getElementById("kyb-col-end2").value;
    const mode = document.getElementById("kyb-viz-mode").value;
    const status = document.getElementById("kyb-status");

    if (!tableName || !start1 || !end1) { alert("Please select a table and columns."); return; }

    status.innerHTML = "⏳ Processing Data (Nuclear Mode)...";
    console.clear();
    console.log("🚀 STARTING ANALYSIS (Nuclear Mode)...");

    try {
        // 1. GET SCHEMA (To find columns)
        const schema = await conn.query(`DESCRIBE ${tableName}`);
        const allCols = schema.toArray().map(r => r.column_name);
        console.log("Found Columns:", allCols);
        
        function getColsInRange(s, e) {
            const i1 = allCols.indexOf(s);
            const i2 = allCols.indexOf(e);
            return (i1 > i2) ? allCols.slice(i2, i1 + 1) : allCols.slice(i1, i2 + 1);
        }

        // 2. CONSTRUCT SUM EXPRESSIONS
        const colsA = getColsInRange(start1, end1);
        const sumExpA = colsA.map(c => `COALESCE(TRY_CAST("${c}" AS DOUBLE), 0.0)`).join(" + ");

        let sumExpB = "0.0";
        if (start2 && end2) {
            const colsB = getColsInRange(start2, end2);
            if (colsB.length > 0) sumExpB = colsB.map(c => `COALESCE(TRY_CAST("${c}" AS DOUBLE), 0.0)`).join(" + ");
        }

        const pinCol = allCols.find(c => c.match(/pin|zip/i)) || "Pincode";
        const latCol = allCols.find(c => c.match(/lat/i));
        const lngCol = allCols.find(c => c.match(/long|lng/i));

        if (!latCol || !lngCol) {
            alert("❌ Missing 'Lat' or 'Long' columns in your CSV.");
            return;
        }
        
        // 3. NUCLEAR QUERY
        // - CAST Pincode to VARCHAR immediately (Prevents BigInt crash)
        // - GROUP BY 1 (The Pincode String)
        // - MAX(Lat) (Gets valid coordinate without grouping by it)
        const query = `
            SELECT 
                CAST("${pinCol}" AS VARCHAR) as Pincode, 
                MAX(TRY_CAST("${latCol}" AS DOUBLE)) as Lat, 
                MAX(TRY_CAST("${lngCol}" AS DOUBLE)) as Lng,
                CAST(SUM(${sumExpA}) AS DOUBLE) as Sales_A, 
                CAST(SUM(${sumExpB}) AS DOUBLE) as Sales_B
            FROM ${tableName} 
            GROUP BY 1
            HAVING Sales_A > 0 OR Sales_B > 0
        `;

        console.log("Generated SQL:", query);

        const result = await conn.query(query);
        const salesData = result.toArray().map(r => r.toJSON());

        // 4. PROCESS RESULT
        const salesMap = {};
        let maxVal = 0;
        let validRows = 0;

        salesData.forEach(row => {
            // Values
            let val = (mode === 'sales_a') ? (row.Sales_A || 0) : 0;
            if (mode === 'growth') {
                const sA = row.Sales_A || 0;
                const sB = row.Sales_B || 0;
                val = sA > 0 ? ((sB - sA) / sA) * 100 : 0;
            }
            if (Math.abs(val) > maxVal) maxVal = Math.abs(val);

            // Clean Pincode (Trim whitespace/decimals)
            let cleanPin = "Unknown";
            if (row.Pincode) {
                cleanPin = String(row.Pincode).split('.')[0].trim();
            }

            salesMap[cleanPin] = {
                val: val,
                salesA: row.Sales_A || 0,
                salesB: row.Sales_B || 0,
                lat: row.Lat || 0,
                lng: row.Lng || 0
            };
            validRows++;
        });

        console.log(`✅ Successfully Processed ${validRows} Pincodes.`);
        console.log("Sample Data:", Object.keys(salesMap).slice(0, 3));

        if (validRows === 0) {
            alert("❌ Database returned 0 rows.\nCheck if your selected columns actually contain numbers.");
            return;
        }

        // 5. RENDER
        if (geoInput.files.length > 0) {
            status.innerHTML = "⏳ Reading Boundary File...";
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const geoJson = JSON.parse(e.target.result);
                    renderKybPolygons(geoJson, salesMap, mode, maxVal);
                    status.innerHTML = `✅ Drawn ${Object.keys(salesMap).length} regions.`;
                } catch (err) { alert("Invalid GeoJSON file"); console.error(err); }
            };
            reader.readAsText(geoInput.files[0]);
        } 
        else {
            renderKybCircles(salesData, mode, maxVal);
            status.innerHTML = `✅ Drawn circles (${validRows} locations).`;
        }

    } catch (e) {
        console.error(e);
        status.innerHTML = `<span style="color:red">Error: ${e.message}</span>`;
    }
}

function renderKybPolygons(geoJson, salesMap, mode, maxVal) {
    if (kybMapLayer) mapInstance.removeLayer(kybMapLayer);
    console.log("--- MATCHING DEBUG ---");

    let matchCount = 0;
    let foundSpecificPinInGeo = false;

    const filteredFeatures = geoJson.features.filter((f) => {
        const p = f.properties;
        const rawGeoPin = p.pincode || p.PINCODE || p.Pincode || p.pin || p.PIN || p.zip || p.ZIP || p.Name || p.name || "";
        
        // ⚠️ SAME AGGRESSIVE CLEANING
        const cleanGeoPin = String(rawGeoPin).replace(/[^0-9]/g, '');

        if (cleanGeoPin === "313003") foundSpecificPinInGeo = true;

        if (salesMap[cleanGeoPin]) {
            f.properties._salesData = salesMap[cleanGeoPin];
            matchCount++;
            return true;
        }
        return false;
    });

    if (foundSpecificPinInGeo) {
        console.log("✅ SUCCESS: Found '313003' in your GeoJSON File!");
    } else {
        console.error("❌ ERROR: '313003' was NOT found in your GeoJSON file.");
    }

    if (matchCount === 0) {
        const statusEl = document.getElementById("kyb-status");
        statusEl.innerHTML = "❌ 0 Matches found.";
        
        // Detailed Alert
        let msg = "Still 0 Matches.\n\n";
        if (!foundSpecificPinInGeo) msg += "👉 Your GeoJSON does NOT contain 313003.\n";
        if (foundSpecificPinInGeo && !salesMap["313003"]) msg += "👉 Your CSV does NOT contain 313003 (or sales are hidden).\n";
        if (foundSpecificPinInGeo && salesMap["313003"]) msg += "👉 Both files have 313003! (This error shouldn't happen). Check Console (F12).";
        
        alert(msg);
        return;
    }

    // Success - Draw
    document.getElementById("kyb-status").innerHTML = `✅ Successfully plotted ${matchCount} regions.`;

    kybMapLayer = L.geoJSON({ type: "FeatureCollection", features: filteredFeatures }, {
        style: function(feature) {
            const data = feature.properties._salesData;
            const val = data.val;
            let color = "#ccc";
            let opacity = 0.6;

            if (mode === 'sales_a') {
                const intensity = maxVal > 0 ? val / maxVal : 0;
                color = intensity > 0.7 ? '#800026' : (intensity > 0.5 ? '#BD0026' : (intensity > 0.3 ? '#FEB24C' : '#FFEDA0'));
            } else {
                color = val >= 0 ? '#1a9850' : '#d73027'; 
                opacity = 0.7;
            }
            return { fillColor: color, weight: 1, opacity: 1, color: 'white', fillOpacity: opacity };
        },
        onEachFeature: function(feature, layer) {
            const d = feature.properties._salesData;
            const p = feature.properties;
            const pin = p.pincode || p.PINCODE || p.pin || "Unknown";
            let tooltip = (mode === 'sales_a') ? `Sales: ₹${Math.floor(d.salesA).toLocaleString()}` : `Growth: ${d.val.toFixed(1)}%`;
            layer.bindPopup(`<div style="text-align:center;"><b>📍 ${pin}</b><br>${tooltip}</div>`);
        }
    }).addTo(mapInstance);

    mapInstance.fitBounds(kybMapLayer.getBounds());
}

function renderKybCircles(data, mode, maxVal) {
    if (kybMapLayer) mapInstance.removeLayer(kybMapLayer);
    
    console.log("--- CIRCLE RENDER DEBUG ---");
    let validPoints = 0;
    
    const geoJsonData = { "type": "FeatureCollection", "features": [] };

    data.forEach((row, idx) => {
        // 1. Force Number Conversion
        const lat = parseFloat(row.Lat);
        const lng = parseFloat(row.Lng);

        // 2. Value Calculation
        let val = (mode === 'sales_a') ? row.Sales_A : 0;
        if (mode === 'growth') {
            val = row.Sales_A > 0 ? ((row.Sales_B - row.Sales_A) / row.Sales_A) * 100 : 0;
        }

        // 3. Validate Coordinates
        if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
            validPoints++;
            
            // Debug first 3 valid points
            if (validPoints <= 3) console.log(`Plotting Point ${validPoints}: [${lat}, ${lng}] Val: ${val}`);

            geoJsonData.features.push({
                "type": "Feature",
                "properties": { "pincode": row.Pincode, "value": val },
                "geometry": { "type": "Point", "coordinates": [lng, lat] }
            });
        }
    });

    console.log(`Total Valid Points to Draw: ${validPoints} / ${data.length}`);

    if (validPoints === 0) {
        alert("❌ No valid coordinates found!\n\nYour CSV rows have Lat/Long as 0, empty, or text.\nCheck the Console (F12) for details.");
        return;
    }

    // 4. Draw Layer
    kybMapLayer = L.geoJSON(geoJsonData, {
        pointToLayer: function (feature, latlng) {
            const val = feature.properties.value;
            // Sales Mode: Green (Low) -> Red (High)
            // Growth Mode: Red (Negative) -> Green (Positive)
            let color = "blue";
            if (mode === 'sales_a') {
                color = (maxVal > 0 && val/maxVal > 0.5) ? '#d32f2f' : '#388e3c';
            } else {
                color = val >= 0 ? '#388e3c' : '#d32f2f';
            }
            
            return L.circleMarker(latlng, { 
                radius: 6, 
                fillColor: color, 
                color: "#fff", 
                weight: 1, 
                fillOpacity: 0.9 
            });
        },
        onEachFeature: function (f, l) { 
            l.bindPopup(`<b>📍 ${f.properties.pincode}</b><br>Value: ${Math.floor(f.properties.value).toLocaleString()}`); 
        }
    }).addTo(mapInstance);

    // 5. Force Zoom to Data
    const bounds = kybMapLayer.getBounds();
    if (bounds.isValid()) {
        mapInstance.fitBounds(bounds, { padding: [50, 50] });
        console.log("Zooming to bounds:", bounds);
    } else {
        console.warn("Bounds are invalid, cannot auto-zoom.");
    }
}




async function populateKybColumns() {
    const tableName = document.getElementById("kyb-table-select").value;
    if(!tableName) return;
    try {
        const schema = await conn.query(`DESCRIBE ${tableName}`);
        const cols = schema.toArray().map(r => r.column_name).filter(c => c.match(/JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|202/i));
        ["kyb-col-start1", "kyb-col-end1", "kyb-col-start2", "kyb-col-end2"].forEach(id => {
            const sel = document.getElementById(id);
            if(sel) {
                sel.innerHTML = '<option value="">- Select -</option>';
                cols.forEach(c => sel.innerHTML += `<option value="${c}">${c}</option>`);
            }
        });
    } catch(e) {}
}

// ATTACH TO WINDOW
window.populateKybColumns = populateKybColumns;
window.runKybAnalysis = runKybAnalysis;

// ==========================================
// 🔄 AUTO-TOKEN REFRESHER
// ==========================================

function startTokenMonitor() {
    // Check every 60 seconds
    setInterval(async () => {
        if (!activeSessionCreds || !tokenExpirationTime) return;

        // Calculate time remaining (in milliseconds)
        const timeLeft = tokenExpirationTime - Date.now();
        const fiveMinutes = 5 * 60 * 1000;

        // If less than 5 minutes remaining, Refresh!
        if (timeLeft < fiveMinutes) {
            console.log("🔄 Token expiring soon. Auto-refreshing...");
            try {
                // Generate new token using stored creds
                const newToken = await generateAccessToken(activeSessionCreds);
                if (newToken) {
                    accessToken = newToken;
                    console.log("✅ Access Token Refreshed Silently!");
                }
            } catch (e) {
                console.error("❌ Auto-Refresh Failed:", e);
            }
        }
    }, 60000); // Run check every 1 minute
}

// ==========================================
// 🔐 UPDATE: generateAccessToken
// ==========================================
// Replace your existing generateAccessToken with this updated version
async function generateAccessToken(creds) {
    const header = { alg: "RS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    
    // ✅ UPDATE GLOBAL EXPIRATION (1 Hour from now)
    tokenExpirationTime = (now + 3600) * 1000; 

    const claim = {
        iss: creds.client_email,
        scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets",
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

window.downloadTaskTemplate = function() {
    // 1. Define Standard Headers
    const headers = [
        "Assign_To_Email",  // Col A: User email (Required)
        "Task_Description", // Col B: What to do (Required)
        "Priority",         // Col C: High, Medium, Low (Default: Medium)
        "Due_Date",         // Col D: yyyy-mm-dd (Optional)
        "Visibility"        // Col E: cc emails (Optional)
    ];

    // 2. Create Dummy Data Row (Example)
    const exampleRow = [
        "user@flipkart.com", 
        "Verify stock for Item #123", 
        "High", 
        "2025-10-30", 
        "manager@flipkart.com"
    ];

    // 3. Generate CSV
    const csvContent = "data:text/csv;charset=utf-8," 
        + headers.join(",") + "\n" 
        + exampleRow.join(",");

    // 4. Trigger Download
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "Task_Manager_Impex.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

async function processStandardTaskImpex() {
    const currentUser = localStorage.getItem("portal_user_email");
    const date = new Date().toLocaleDateString();
    const newRows = [];
    const batchName = "IMPEX_" + Date.now();

    // Loop through standard data
    // Expected Order: [0]Email, [1]Task, [2]Priority, [3]Due, [4]Visibility
    
    bulkCsvData.forEach(row => {
        const assignedUser = row[0]?.trim();
        const taskDesc = row[1]?.trim();
        
        if (assignedUser && taskDesc) {
            const tktId = "IMP-" + Math.floor(Math.random() * 1000000);
            
            // Handle Optional Fields
            const priority = row[2]?.trim() || "Medium";
            const dueDate = row[3]?.trim() || date; // Use today if missing
            const visibility = row[4]?.trim() || "";

            // Push to Sheet Schema: 
            // ID | Parent | Date | By | To | Task | Priority | Status | Visibility | Batch
            newRows.push([
                tktId, 
                "", 
                dueDate,        // Date Column
                currentUser,    // Assigned By
                assignedUser,   // Assigned To
                taskDesc, 
                priority, 
                "OPEN", 
                visibility, 
                batchName
            ]);
        }
    });

    if (newRows.length > 0) {
        // Reuse your existing append helper
        await appendRowsToSheet(newRows);
        alert(`✅ Success! ${newRows.length} tasks created via Impex.`);
        loadTicketDashboard();
    } else {
        alert("❌ No valid rows found. Check Email/Task columns.");
    }
}

// Global variable to store access rights
let currentUserAccess = [];

async function handleLogin() {
    const emailInput = document.getElementById("login-email").value.trim().toLowerCase();
    const passInput = document.getElementById("login-password").value.trim();
    const loginBtn = document.getElementById("login-btn"); // Assuming you have an ID for the button

    if (!emailInput || !passInput) { alert("Please enter email and password"); return; }

    // UI Feedback
    if(loginBtn) { loginBtn.innerText = "⏳ Verifying..."; loginBtn.disabled = true; }

    try {
        // 1. Fetch the Users Sheet (Credentials + Permissions)
        // Make sure CONFIG.CREDENTIALS_SHEET_ID points to your login sheet
        // Make sure 'Users' is the correct tab name
        const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.CREDENTIALS_SHEET_ID}/values/Users?key=${apiKey}`);
        const data = await response.json();

        if (!data.values) { alert("User database empty."); return; }

        // 2. Find User and Check Password
        // Row Structure: [0]Email, [1]Password, [2]Permissions
        const userRow = data.values.find(row => 
            row[0] && row[0].toLowerCase().trim() === emailInput && 
            row[1] && row[1].toString().trim() === passInput
        );

        if (userRow) {
            // ✅ LOGIN SUCCESS
            
            // 3. Capture Permissions from Column C (Index 2)
            const rawPerms = userRow[2] || ""; 
            currentUserAccess = rawPerms.split(",").map(p => p.trim());

            // 4. Save Session
            localStorage.setItem("portal_user_email", emailInput);
            // Optional: Save permissions to storage so they persist on refresh
            localStorage.setItem("portal_user_access", JSON.stringify(currentUserAccess));

            // 5. Switch UI
            document.getElementById("login-screen").classList.add("hidden");
            document.getElementById("app-screen").classList.remove("hidden");
            
            // 6. Render Sidebar based on access
            renderDynamicSidebar();
            
            // 7. Load first allowed tab
            if(currentUserAccess.length > 0) {
                 // Check if the tab name maps to a real function before loading
                 // (Reuse the sidebar logic to click the first item)
                 const firstModule = document.querySelector("#sidebar-menu li");
                 if(firstModule) firstModule.click();
            }

        } else {
            alert("❌ Invalid Email or Password.");
        }

    } catch (error) {
        console.error("Login Error:", error);
        alert("System Error during login.");
    } finally {
        if(loginBtn) { loginBtn.innerText = "Login"; loginBtn.disabled = false; }
    }
}

function renderDynamicSidebar() {
    const menuContainer = document.getElementById("sidebar-menu");
    if (!menuContainer) return;

    menuContainer.innerHTML = ""; // Clear existing menu

    // 1. DEFINE ALL MAPPINGS
    // The "Key" (Left side) must match EXACTLY what is in your Google Sheet Column C
    const allModules = {
        "Sales Reports":   { icon: "📊", func: "loadSalesDashboard" },
        "Hourly Sales":    { icon: "🕒", func: "loadHourlyDashboard" },
        "KYB Map":         { icon: "🇮🇳", func: "loadBusinessDashboard" },
        "Task Manager":    { icon: "🎫", func: "loadTicketDashboard" },
        "My Inbox":        { icon: "📅", func: "loadDailyUpdateDashboard" },
        "Mail Search":     { icon: "📧", func: "loadApprovalsDashboard" },
        "TrueView":        { icon: "👁️", func: "loadTrueViewDashboard" },
        "Work on Reports": { icon: "🛠️", func: "loadWorkDashboard" },
        "Member DB":       { icon: "👥", func: "loadMemberDashboard" },
        "Google Sheets":   { icon: "📈", func: "loadTrackerDashboard" },
        "Walkin Data":     { icon: "🚶", func: "loadWalkinDashboard" },
        "PO Issues": { icon: "🚨", func: "loadPoIssuesDashboard" },
        "Store Metrics": { icon: "📊", func: "loadStoreMetrics" },
        "Task Entry": { icon: "📝", func: "loadTaskEntry" }
    };

    // 2. Retrieve Permissions
    if (currentUserAccess.length === 0) {
        const stored = localStorage.getItem("portal_user_access");
        if (stored) currentUserAccess = JSON.parse(stored);
    }

    // Debugging: Check console to see what the app thinks you have
    console.log("Rendering Sidebar for:", currentUserAccess);

    // 3. Generate Buttons
    currentUserAccess.forEach(tabName => {
        // Clean up string (remove accidental spaces)
        const cleanName = tabName.trim();
        const module = allModules[cleanName];

        if (module) {
            const li = document.createElement("li");
            
            // Sidebar Item Styling
            li.style.padding = "12px 15px";
            li.style.cursor = "pointer";
            li.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
            li.style.color = "white";
            li.style.display = "flex";
            li.style.alignItems = "center";
            li.style.gap = "10px";
            li.style.transition = "background 0.2s";

            li.innerHTML = `<span style="font-size:18px;">${module.icon}</span> <span>${cleanName}</span>`;

            // Hover Effect
            li.onmouseover = () => { li.style.background = "rgba(255,255,255,0.1)"; };
            li.onmouseout = () => { if(!li.classList.contains('active')) li.style.background = "transparent"; };

            li.onclick = () => {
                // UI Active State
                document.querySelectorAll("#sidebar-menu li").forEach(i => {
                    i.classList.remove("active");
                    i.style.background = "transparent";
                    i.style.borderLeft = "none";
                });
                li.classList.add("active");
                li.style.background = "rgba(255,255,255,0.2)";
                li.style.borderLeft = "4px solid #fff";

                // Hide all UI sections
                document.querySelectorAll("#content-wrapper > div").forEach(el => {
                    if(!el.id.includes("pivot")) el.classList.add("hidden");
                });

                // Close Mobile Menu if open
                const sidebar = document.querySelector('.sidebar');
                if(sidebar) sidebar.classList.remove('show-mobile');

                // Execute Function
                if (typeof window[module.func] === "function") {
                    window[module.func]();
                } else {
                    console.error(`Function ${module.func} not found for ${cleanName}`);
                    alert(`Error: Module ${cleanName} is not linked correctly.`);
                }
            };
            menuContainer.appendChild(li);
        } else {
            console.warn(`⚠️ Warning: Permission '${cleanName}' found in Sheet but not defined in app.js code.`);
        }
    });
}



function checkLoginStatus() {
    // 1. Check if we remember the user's email
    const user = localStorage.getItem("portal_user_email");
    
    // 2. If found, just pre-fill the username box
    if (user) {
        const emailInput = document.getElementById("login-user");
        if (emailInput) emailInput.value = user;
    }


    document.getElementById("auth-overlay").classList.remove("hidden");
    document.getElementById("dashboard").classList.add("hidden");
    
    // Optional: Clear any old access permissions to prevent UI glitches
    currentUserAccess = [];
    localStorage.removeItem("portal_user_access");
}

// Ensure you call checkLoginStatus() when the window loads!
window.onload = checkLoginStatus;

// Ensure you call checkLoginStatus() when the window loads!
window.onload = checkLoginStatus;

// ==========================================
// 📦 PO ISSUES MODULE
// ==========================================

// 1. Sidebar Loader
window.loadPoIssuesDashboard = async function() {
    resetUI();
    highlightSidebar("PO Issues");
    document.getElementById("po-issues-ui").classList.remove("hidden");
    document.getElementById("po-role-select").classList.remove("hidden");
    ["po-store-container", "po-central-dash", "po-manager-dash"].forEach(id => document.getElementById(id).classList.add("hidden"));
    await fetchPoRoutingRules();
};

window.switchStoreTab = function(tab) {
    document.querySelectorAll(".po-tab").forEach(b => {
        b.classList.remove("active");
        b.style.background = "#eee";
        b.style.color = "#333";
    });
    const activeBtn = document.getElementById(`tab-${tab}`);
    if(activeBtn) {
        activeBtn.classList.add("active");
        activeBtn.style.background = "#4caf50";
        activeBtn.style.color = "white";
    }
    document.querySelectorAll(".store-view").forEach(d => d.classList.add("hidden"));
    document.getElementById(`view-${tab}`).classList.remove("hidden");

    if (tab === 'history') loadStoreHistory();
    if (tab === 'stats') renderPoAnalytics('store', 'po-store-stats-content');
};

// 2. Role Switcher
window.selectPoRole = function(role) {
    ["po-role-select", "po-store-container", "po-central-dash", "po-manager-dash"].forEach(id => document.getElementById(id).classList.add("hidden"));

    if (role === 'store') {
        document.getElementById("po-store-container").classList.remove("hidden");
        window.switchStoreTab('raise');
    } 
    else if (role === 'central') {
        document.getElementById("po-central-dash").classList.remove("hidden");
        loadCentralPoTasks();
    } 
    else if (role === 'manager') {
        document.getElementById("po-manager-dash").classList.remove("hidden");
        loadManagerApprovals();
    } 
    else document.getElementById("po-role-select").classList.remove("hidden");
};
// 3. Submit Issue (Store Side)
window.submitPoIssue = async function() {
    const storeId = document.getElementById("po-store-id").value.trim(); // 🆕
    const poNum = document.getElementById("po-num").value.trim();
    const catNo = document.getElementById("po-cat-no").value.trim();
    const catName = document.getElementById("po-cat-name").value;
    const issueType = document.getElementById("po-issue-type").value;
    const fileInput = document.getElementById("po-proof-file");
    
    if (!storeId || !poNum || !catNo || !issueType) { alert("Please fill all required fields, including Store ID."); return; }
    if (fileInput.files.length === 0) { alert("Upload proof."); return; }

    const btn = document.querySelector("#view-raise button"); 
    btn.innerText = "⏳ Uploading..."; btn.disabled = true;

    try {
        if (Object.keys(poCategoryMap).length === 0) await fetchPoRoutingRules();

        const exactKey = `${catNo}_${issueType}`;
        const catDefKey = `${catNo}_DEFAULT`;
        const globalDef = "DEFAULT_DEFAULT";
        let assignedTo = poCategoryMap[exactKey] || poCategoryMap[catDefKey] || poCategoryMap[globalDef] || "central.team@flipkart.com";

        const file = fileInput.files[0];
        const fileName = `PO_${storeId}_${poNum}_${Date.now()}.${file.name.split('.').pop()}`;
        const proofLink = await uploadBlobToDrive(file, fileName);

        const issueId = "PO-" + Math.floor(Math.random() * 100000);
        const user = localStorage.getItem("portal_user_email");
        const timestamp = new Date().toLocaleString();

        // 🆕 NEW ROW SCHEMA: Store_ID at Index 2
        // ID, Time, StoreID, PO, CatNo, CatName, Issue, Proof, By, Status, Assignee
        const row = [[ issueId, timestamp, storeId, poNum, catNo, catName, issueType, proofLink, user, "OPEN", assignedTo ]];

        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.PO_ISSUES_SHEET_ID}/values/PO_Data!A1:append?valueInputOption=USER_ENTERED`;
        await fetch(url, { method: "POST", headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ values: row }) });

        alert(`✅ Issue Raised!\nAssigned to: ${assignedTo}`);
        document.getElementById("po-num").value = "";
        window.switchStoreTab('history');

    } catch (e) { alert("Error: " + e.message); } 
    finally { btn.innerText = "🚀 Submit Ticket"; btn.disabled = false; }
};

// 5. Store History (My Status)
async function loadStoreHistory() {
    const container = document.getElementById("po-store-list");
    container.innerHTML = "⏳ Loading...";
    const currentUser = localStorage.getItem("portal_user_email").toLowerCase().trim();

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.PO_ISSUES_SHEET_ID}/values/PO_Data`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();

        if (!data.values || data.values.length < 2) { container.innerHTML = "No history."; return; }
        const rows = data.values.slice(1).reverse();
        let html = "";

        rows.forEach(r => {
            if (r[8].toLowerCase().trim() !== currentUser) return; // Col I = Raised By

            const status = r[9]; // Col J
            let statusColor = "#1976d2";
            if (status === "RESOLVED") statusColor = "green";
            if (status === "PENDING_APPROVAL") statusColor = "#e65100";

            html += `
            <div style="background:#f9f9f9; padding:15px; border-radius:4px; border-left:5px solid ${statusColor}; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; font-weight:bold;">
                    <span>Store: ${r[2]} | PO: ${r[3]}</span>
                    <span style="color:${statusColor}">${status}</span>
                </div>
                <div style="font-size:12px; color:#555; margin-top:5px;">
                    Issue: ${r[6]} <br>
                    Date: ${r[1]}
                </div>
                ${status === 'RESOLVED' ? `<div style="margin-top:8px; font-size:11px; background:#e8f5e9; padding:5px;"><b>✅ Resolution:</b> ${r[13]}</div>` : ''}
            </div>`;
        });
        container.innerHTML = html || "<p>You haven't raised any issues yet.</p>";
    } catch (e) { container.innerHTML = "Error: " + e.message; }
}

// 6. Central Actions (With Gmail Fix)


// 7. ANALYTICS (Store & Central)
window.toggleCentralView = function(view) {
    if(view === 'work') {
        document.getElementById("po-central-work-view").classList.remove("hidden");
        document.getElementById("po-central-stats-view").classList.add("hidden");
        loadCentralPoTasks();
    } else {
        document.getElementById("po-central-work-view").classList.add("hidden");
        document.getElementById("po-central-stats-view").classList.remove("hidden");
        renderPoAnalytics('central', 'po-central-stats-content');
    }
};

async function renderPoAnalytics(scope, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = "⏳ Calculating SLA stats...";
    const currentUser = localStorage.getItem("portal_user_email").toLowerCase().trim();

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.PO_ISSUES_SHEET_ID}/values/PO_Data`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();

        if (!data.values) { container.innerHTML = "No data."; return; }

        let total = 0, open = 0, resolved = 0, pendingMgr = 0, breached = 0;
        const now = new Date();
        
        data.values.slice(1).forEach(r => {
            if (scope === 'store' && r[8].toLowerCase().trim() !== currentUser) return;

            total++;
            const status = r[9]; // Col J
            const created = new Date(r[1]); // Col B

            // SLA Check (Only for non-resolved items, or check all if you want historical)
            if (status !== "RESOLVED") {
                const diffHrs = (now - created) / (1000 * 60 * 60);
                if (diffHrs > 12) breached++;
            }

            if (status === "OPEN") open++;
            else if (status === "RESOLVED") resolved++;
            else if (status === "PENDING_APPROVAL") pendingMgr++;
        });

        container.innerHTML = `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <div style="background:#e3f2fd; padding:10px; border-radius:8px; text-align:center;">
                    <div style="font-size:20px; font-weight:bold; color:#1565c0;">${total}</div>
                    <div style="font-size:11px; color:#555;">Total</div>
                </div>
                <div style="background:#e8f5e9; padding:10px; border-radius:8px; text-align:center;">
                    <div style="font-size:20px; font-weight:bold; color:#2e7d32;">${resolved}</div>
                    <div style="font-size:11px; color:#555;">Resolved</div>
                </div>
                <div style="background:#ffebee; padding:10px; border-radius:8px; text-align:center; border:1px solid #ffcdd2;">
                    <div style="font-size:20px; font-weight:bold; color:#c62828;">${breached}</div>
                    <div style="font-size:11px; color:#c62828;">🔥 SLA Breached</div>
                </div>
                <div style="background:#fff3e0; padding:10px; border-radius:8px; text-align:center;">
                    <div style="font-size:20px; font-weight:bold; color:#e65100;">${open + pendingMgr}</div>
                    <div style="font-size:11px; color:#555;">Pending</div>
                </div>
            </div>`;
    } catch (e) { container.innerHTML = "Error: " + e.message; }
}

// 4. Load Tasks (Central Side)
async function loadCentralPoTasks() {
    const container = document.getElementById("po-central-list");
    container.innerHTML = "⏳ Loading tasks & calculating SLAs...";
    const currentUser = localStorage.getItem("portal_user_email");

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.PO_ISSUES_SHEET_ID}/values/PO_Data`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();

        if (!data.values || data.values.length < 2) { container.innerHTML = "No tasks."; return; }

        const rows = data.values.slice(1);
        let html = "";

        rows.forEach((r, i) => {
            const status = r[9]; // Col J
            if (status === "RESOLVED") return; // Hide resolved

            let actionBtn = "";
            let statusBadge = "";
            const slaBadge = getSlaBadge(r[1], status); // r[1] is Timestamp

            // Status Logic
            if (status === "OPEN") {
                statusBadge = `<span style="background:#e3f2fd; color:#1976d2; padding:2px 6px; border-radius:4px; font-size:10px;">🆕 OPEN</span>`;
                actionBtn = `<button onclick="window.openRequestModal('${r[0]}', ${i+2}, '${r[3]}')" style="flex:1; padding:8px; background:#1976d2; color:white; border:none; border-radius:4px; cursor:pointer;">📨 Request Approval</button>`;
            } else if (status === "PENDING_APPROVAL") {
                statusBadge = `<span style="background:#fff3e0; color:#e65100; padding:2px 6px; border-radius:4px; font-size:10px;">⏳ PENDING MANAGER</span>`;
                actionBtn = `<button disabled style="flex:1; padding:8px; background:#ccc; color:#666; border:none; border-radius:4px;">⏳ Waiting...</button>`;
            } else if (status === "APPROVED") {
                statusBadge = `<span style="background:#e8f5e9; color:#2e7d32; padding:2px 6px; border-radius:4px; font-size:10px;">✅ APPROVED</span>`;
                actionBtn = `<button onclick="window.openFinalResolveModal('${r[0]}', ${i+2})" style="flex:1; padding:8px; background:#2e7d32; color:white; border:none; border-radius:4px; cursor:pointer;">💾 Final Resolve</button>`;
            }

            // Display Store ID (r[2])
            html += `
            <div style="background:white; border:1px solid #ddd; padding:15px; border-radius:4px; margin-bottom:10px; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <div>
                        <span style="font-weight:bold; font-size:14px;">Store: ${r[2]} | PO: ${r[3]}</span>
                        <div style="font-size:10px; color:#666;">${r[1]}</div>
                    </div>
                    <div style="text-align:right;">
                        ${statusBadge}
                        <div style="margin-top:5px;">${slaBadge}</div>
                    </div>
                </div>
                
                <div style="font-size:12px; color:#444; margin-bottom:10px; background:#f9f9f9; padding:8px; border-radius:4px;">
                    <b>Issue:</b> ${r[6]} <br>
                    <b>Cat:</b> ${r[4]} - ${r[5]} <br>
                    <b>Raised by:</b> ${r[8]}
                </div>
                
                <div style="display:flex; gap:10px;">
                    <a href="${r[7]}" target="_blank" style="flex:1;"><button style="width:100%; padding:8px; background:#fff; border:1px solid #ccc; border-radius:4px; color:#333; cursor:pointer;">📄 Proof</button></a>
                    ${actionBtn}
                </div>
            </div>`;
        });

        container.innerHTML = html || "<p>No active tasks.</p>";
    } catch (e) { container.innerHTML = "Error: " + e.message; }
}

window.openRequestModal = function(id, row, poNum) {
    document.getElementById("req-id").value = id;
    document.getElementById("req-row").value = row;
    document.getElementById("req-po-num").value = poNum;
    document.getElementById("po-request-modal").classList.remove("hidden");
};
// 5. Open Resolve Modal
window.openPoResolveModal = function(id, rowIndex) {
    document.getElementById("po-resolve-id").value = id;
    document.getElementById("po-resolve-row").value = rowIndex;
    document.getElementById("po-resolve-desc").innerText = `Resolving Ticket: ${id}`;
    document.getElementById("po-resolve-modal").classList.remove("hidden");
};

window.submitApprovalRequest = async function() {
    const row = document.getElementById("req-row").value;
    const poNum = document.getElementById("req-po-num").value;
    const mgrEmail = document.getElementById("req-mgr-email").value.trim();
    const btn = document.querySelector("#po-request-modal button");

    if (!mgrEmail) { alert("Enter manager email."); return; }
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    try {
        // Status -> J (Index 9), Manager -> L (Index 11)
        await updateSheetCell(CONFIG.PO_ISSUES_SHEET_ID, `PO_Data!J${row}`, "PENDING_APPROVAL");
        await updateSheetCell(CONFIG.PO_ISSUES_SHEET_ID, `PO_Data!L${row}`, mgrEmail);

        const subject = `Action Required: Approval for PO ${poNum}`;
        const body = `Hi,\n\nPlease approve the issue for PO ${poNum}.\n\nLogin to Portal > PO Issues > Manager Approvals.\n\nThanks.`;
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${mgrEmail}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        
        window.open(gmailUrl, '_blank');
        alert("✅ Status Updated! Gmail opened.");
        document.getElementById("po-request-modal").classList.add("hidden");
        loadCentralPoTasks();
    } catch (e) { alert("Error: " + e.message); } 
    finally { btn.innerText = "🚀 Open Gmail"; btn.disabled = false; }
};
// 4. MANAGER: Load Approvals
window.loadManagerApprovals = async function() {
    const container = document.getElementById("po-manager-list");
    container.innerHTML = "⏳ Loading...";
    const currentUser = localStorage.getItem("portal_user_email");

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.PO_ISSUES_SHEET_ID}/values/PO_Data`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();

        if (!data.values) { container.innerHTML = "No data."; return; }
        const rows = data.values.slice(1);
        let html = "";

        rows.forEach((r, i) => {
            const status = r[9]; // Col J
            const mgrEmail = r[11] ? r[11].toLowerCase().trim() : ""; // Col L
            
            if (status === "PENDING_APPROVAL" && mgrEmail === currentUser.toLowerCase()) {
                html += `
                <div style="background:white; border-left:5px solid #e65100; padding:15px; border-radius:4px; margin-bottom:10px;">
                    <h4 style="margin:0 0 5px 0;">Store: ${r[2]} | PO: ${r[3]}</h4>
                    <p style="font-size:12px; color:#555; margin-bottom:10px;">
                        <b>Issue:</b> ${r[6]} <br>
                        <b>Raised By:</b> ${r[8]} <br>
                        <a href="${r[7]}" target="_blank" style="color:#1976d2;">📄 View Proof</a>
                    </p>
                    <button onclick="window.managerApprove('${r[0]}', ${i+2})" style="width:100%; padding:10px; background:#e65100; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">✅ Approve Issue</button>
                </div>`;
            }
        });
        container.innerHTML = html || `<div style="text-align:center; padding:20px;">No pending approvals.</div>`;
    } catch (e) { container.innerHTML = "Error: " + e.message; }
}

// 5. MANAGER: Approve Action
window.managerApprove = async function(id, row) {
    if(!confirm("Confirm approval?")) return;
    try {
        const timestamp = new Date().toLocaleString();
        // Status -> APPROVED (Col J), ApprovalTime -> (Col M)
        await updateSheetCell(CONFIG.PO_ISSUES_SHEET_ID, `PO_Data!J${row}`, "APPROVED");
        await updateSheetCell(CONFIG.PO_ISSUES_SHEET_ID, `PO_Data!M${row}`, timestamp);
        alert("✅ Approved!");
        loadManagerApprovals();
    } catch (e) { alert("Error: " + e.message); }
};

// 6. CENTRAL: Final Resolve (Only after Approval)
window.openFinalResolveModal = function(id, row) {
    document.getElementById("res-id").value = id;
    document.getElementById("res-row").value = row;
    document.getElementById("po-final-resolve-modal").classList.remove("hidden");
};

window.submitFinalResolution = async function() {
    const row = document.getElementById("res-row").value;
    const notes = document.getElementById("res-notes").value;
    const btn = document.querySelector("#po-final-resolve-modal button");

    if (!notes) { alert("Resolution notes required."); return; }
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    try {
        const timestamp = new Date().toLocaleString();
        // Status -> RESOLVED (Col J)
        await updateSheetCell(CONFIG.PO_ISSUES_SHEET_ID, `PO_Data!J${row}`, "RESOLVED");
        // Notes (Col N), Time (Col O)
        const range = `PO_Data!N${row}:O${row}`;
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.PO_ISSUES_SHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;
        await fetch(url, {
            method: "PUT",
            headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: [[ notes, timestamp ]] })
        });

        alert("✅ Ticket Closed!");
        document.getElementById("po-final-resolve-modal").classList.add("hidden");
        loadCentralPoTasks();
    } catch (e) { alert("Error: " + e.message); }
    finally { btn.innerText = "💾 Mark Resolved"; btn.disabled = false; }
};

// 6. Confirm Resolution
window.confirmPoResolution = async function() {
    const rowIndex = document.getElementById("po-resolve-row").value;
    const mgrEmail = document.getElementById("po-manager-email").value;
    const notes = document.getElementById("po-resolve-notes").value;
    const btn = document.querySelector("#po-resolve-modal button");

    if (!mgrEmail || !notes) { alert("Manager Email and Notes are required."); return; }

    btn.innerText = "⏳ Updating...";
    btn.disabled = true;

    try {
        const timestamp = new Date().toLocaleString();
        
        // 1. Update Status to RESOLVED (Col I is Index 8 -> Column I)
        // Note: Sheet columns are 1-based letters. I is the 9th column.
        await updateSheetCell(CONFIG.PO_ISSUES_SHEET_ID, `PO_Data!I${rowIndex}`, "RESOLVED");
        
        // 2. Update Details (Col K, L, M) -> Manager, Notes, Time
        const detailsRange = `PO_Data!K${rowIndex}:M${rowIndex}`;
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.PO_ISSUES_SHEET_ID}/values/${detailsRange}?valueInputOption=USER_ENTERED`;
        
        await fetch(url, {
            method: "PUT",
            headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: [[ mgrEmail, notes, timestamp ]] })
        });

        alert("✅ Ticket Resolved!");
        document.getElementById("po-resolve-modal").classList.add("hidden");
        loadCentralPoTasks(); // Refresh list

    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.innerText = "✅ Mark Resolved";
        btn.disabled = false;
    }
};

// Helper for single cell update
async function updateSheetCell(sheetId, range, value) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=USER_ENTERED`;
    await fetch(url, {
        method: "PUT",
        headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [[ value ]] })
    });
}


async function fetchPoRoutingRules() {
    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.PO_ISSUES_SHEET_ID}/values/PO_Mapping!A:C`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();
        if (data.values && data.values.length > 1) {
            poCategoryMap = {};
            data.values.slice(1).forEach(row => {
                const catNo = row[0] ? row[0].toString().trim() : "DEFAULT";
                const issueType = row[1] ? row[1].toString().trim() : "DEFAULT";
                const email = row[2] ? row[2].toString().trim() : "";
                if (email) poCategoryMap[`${catNo}_${issueType}`] = email;
            });
        }
    } catch (e) { console.warn("Mapping fetch failed", e); }
}

// ==========================================
// 📊 STORE METRICS MODULE (Complete)
// ==========================================

let activeStoreId = null;
let metricsMetadata = {};

// 1. Sidebar Loader (Entry Point)
window.loadStoreMetrics = async function() {
    // Basic UI Reset
    const content = document.getElementById("content-wrapper");
    Array.from(content.children).forEach(div => div.classList.add("hidden"));
    
    // Highlight Sidebar (if function exists)
    if (typeof highlightSidebar === "function") highlightSidebar("Store Metrics");

    // Show Metrics UI
    document.getElementById("store-metrics-ui").classList.remove("hidden");
    
    // Check Session
    const sessionStore = sessionStorage.getItem("metrics_store_id");
    if (sessionStore) {
        activeStoreId = sessionStore;
        showMetricsDashboard();
    } else {
        document.getElementById("metrics-login-screen").classList.remove("hidden");
        document.getElementById("metrics-dashboard-screen").classList.add("hidden");
        document.getElementById("btn-metrics-logout").classList.add("hidden");
        loadStoreDropdown(); // Load list
    }
};

// 2. Load Store Dropdown (From 'Store_Auth' tab)
async function loadStoreDropdown() {
    const select = document.getElementById("metrics-store-select");
    
    // Check Config
    if (!CONFIG.METRICS_SHEET_ID) {
        select.innerHTML = `<option>⚠️ Error: Sheet ID Missing in Config</option>`;
        return;
    }

    select.innerHTML = `<option>Loading stores...</option>`;
    
    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.METRICS_SHEET_ID}/values/Store_Auth!A:A`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();
        
        if (data.values && data.values.length > 1) {
            select.innerHTML = `<option value="">-- Select Store --</option>`;
            // Skip Header (Row 0)
            data.values.slice(1).forEach(r => {
                const store = r[0]; // Col A is Store ID
                if(store) select.innerHTML += `<option value="${store}">${store}</option>`;
            });
        } else {
            select.innerHTML = `<option>No stores found in Sheet</option>`;
        }
    } catch (e) {
        select.innerHTML = `<option>Connection Error</option>`;
        console.error("Store Load Error:", e);
    }
}

// 3. Verify Password
window.verifyStoreMetricsLogin = async function() {
    const store = document.getElementById("metrics-store-select").value;
    const pass = document.getElementById("metrics-store-pass").value;
    const err = document.getElementById("metrics-login-error");
    
    if (!store || !pass) { err.innerText = "Please select store and enter password"; return; }
    err.innerText = "Verifying...";

    try {
        // Fetch Auth Data (Col A: Store, Col B: Password)
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.METRICS_SHEET_ID}/values/Store_Auth!A:B`;
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();
        
        // Find Match
        const authRow = data.values.find(r => String(r[0]).trim() === String(store) && String(r[1]).trim() === String(pass));
        
        if (authRow) {
            activeStoreId = store;
            sessionStorage.setItem("metrics_store_id", store); // Save Session
            err.innerText = "";
            document.getElementById("metrics-store-pass").value = ""; // Clear Input
            showMetricsDashboard();
        } else {
            err.innerText = "❌ Invalid Password. Try again.";
        }
    } catch (e) {
        err.innerText = "⚠️ Network Error. Check Sheet ID.";
        console.error(e);
    }
};

// 4. Show Dashboard (Main Render Logic)
async function showMetricsDashboard() {
    // Toggle Screens
    document.getElementById("metrics-login-screen").classList.add("hidden");
    document.getElementById("metrics-dashboard-screen").classList.remove("hidden");
    document.getElementById("btn-metrics-logout").classList.remove("hidden");
    document.getElementById("metrics-store-badge").innerText = `🏪 Store: ${activeStoreId}`;
    
    const tbody = document.getElementById("metrics-table-body");
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:40px; color:#666;">⏳ Fetching latest performance data...</td></tr>`;

    try {
        // A. Fetch Definitions (Metric Name, Tooltip, Raw Tab)
        const defUrl = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.METRICS_SHEET_ID}/values/Metric_Definitions!A:C`;
        const defResp = await fetch(defUrl, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const defData = await defResp.json();
        
        metricsMetadata = {};
        if (defData.values) {
            defData.values.slice(1).forEach(r => {
                // Key: Metric Name -> { desc: Col B, rawTab: Col C }
                metricsMetadata[r[0]] = { desc: r[1] || "No description", rawTab: r[2] || null };
            });
        }

        // B. Fetch Store Data
        const dataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.METRICS_SHEET_ID}/values/Store_Data!A:E`;
        const dataResp = await fetch(dataUrl, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const storeData = await dataResp.json();

        // C. Render Table
        tbody.innerHTML = "";
        if (!storeData.values || storeData.values.length < 2) { 
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px;">No data found in 'Store_Data' tab.</td></tr>`; 
            return; 
        }

        let count = 0;
        storeData.values.slice(1).forEach(r => {
            // Filter by Active Store ID (Col A)
            if (String(r[0]) !== String(activeStoreId)) return;

            const metricName = r[1];
            const meta = metricsMetadata[metricName] || { desc: "No details available", rawTab: null };
            
            // Sanitize description for HTML attribute
            const safeDesc = meta.desc.replace(/'/g, "&apos;").replace(/"/g, "&quot;");

            const rowHtml = `
            <tr>
                <td>
                    <div style="display:flex; align-items:center;">
                        <span style="font-weight:600; color:#333;">${metricName}</span>
                        <span class="info-icon" 
                              onmouseenter="showGlobalTooltip(event, '${safeDesc}')" 
                              onmouseleave="hideGlobalTooltip()">
                              &#9432;
                        </span>
                    </div>
                </td>
                <td style="text-align:center; font-weight:700; color:#2e7d32; font-size:15px;">${r[2] || '-'}</td>
                <td style="text-align:center; font-weight:700; color:#1565c0; font-size:15px;">${r[3] || '-'}</td>
                <td style="text-align:right; color:#888; font-size:12px;">${r[4] || ''}</td>
                <td style="text-align:center;">
                    ${meta.rawTab ? 
                        `<button onclick="window.downloadSpecificRawData('${meta.rawTab}', '${metricName}')" 
                            style="background:white; color:#333; border:1px solid #ccc; border-radius:4px; padding:4px 8px; cursor:pointer; font-size:11px; transition:0.2s;"
                            onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                            ⬇️ Data
                        </button>` 
                        : '<span style="color:#ddd; font-size:20px;">•</span>'}
                </td>
            </tr>`;
            tbody.innerHTML += rowHtml;
            count++;
        });

        if(count === 0) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px;">No metrics found for Store ${activeStoreId}</td></tr>`;

    } catch (e) {
        console.error(e);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:red; padding:20px;">Error loading data: ${e.message}</td></tr>`;
    }
}

// 5. Tooltip Helpers
window.showGlobalTooltip = function(e, text) {
    const tooltip = document.getElementById("global-tooltip");
    if(tooltip) {
        tooltip.innerText = text;
        tooltip.style.opacity = "1";
        tooltip.style.left = `${e.clientX + 15}px`;
        tooltip.style.top = `${e.clientY + 15}px`;
    }
};

window.hideGlobalTooltip = function() {
    const tooltip = document.getElementById("global-tooltip");
    if(tooltip) {
        tooltip.style.opacity = "0";
        tooltip.style.left = "-9999px"; 
    }
};


// 6. Raw Data Download (Direct Link Opener)
window.downloadSpecificRawData = function(fileUrl, metricName) {
    if (!fileUrl || fileUrl.trim() === "") {
        alert("⚠️ No link configured for this metric.");
        return;
    }

    // Quick check to ensure it's formatted as a web link
    let finalUrl = fileUrl.trim();
    if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
        finalUrl = "https://" + finalUrl;
    }

    if (confirm(`Open data file for ${metricName}?`)) {
        // Opens the link in a new tab. 
        // If it's a direct download link, the browser will automatically download it.
        // If it's a Google Drive link, it will open the Google Drive preview.
        window.open(finalUrl, '_blank');
    }
};
// 7. Search Filter
window.filterMetricsTable = function() {
    const filter = document.getElementById("metrics-search").value.toLowerCase();
    const rows = document.querySelectorAll("#metrics-table-body tr");
    rows.forEach(row => {
        const text = row.cells[0].innerText.toLowerCase();
        row.style.display = text.includes(filter) ? "" : "none";
    });
};

// 8. Logout
window.logoutStoreMetrics = function() {
    activeStoreId = null;
    sessionStorage.removeItem("metrics_store_id");
    document.getElementById("metrics-dashboard-screen").classList.add("hidden");
    document.getElementById("btn-metrics-logout").classList.add("hidden");
    document.getElementById("metrics-login-screen").classList.remove("hidden");
};

// ==========================================
// 📦 PO ISSUES MODULE (v5: With SLA Timer)
// ==========================================

function getSlaBadge(dateStr, status) {
    if (!dateStr) return "";
    
    const created = new Date(dateStr);
    const now = new Date();
    const diffMs = now - created;
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    // If Resolved, we don't show a running timer (optional)
    if (status === "RESOLVED") return `<span style="color:#666; font-size:11px;">(Closed)</span>`;

    let color = "#2e7d32"; // Green (Safe)
    let icon = "⏱️";
    let text = `${diffHrs}h ${diffMins}m`;

    if (diffHrs >= 12) {
        color = "#d32f2f"; // Red (Breach)
        icon = "🔥";
        text = `BREACH: ${diffHrs}h ${diffMins}m`;
    } else if (diffHrs >= 8) {
        color = "#ef6c00"; // Orange (Warning)
        icon = "⚠️";
    }

    return `<span style="background:${color}; color:white; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:bold;">${icon} ${text}</span>`;
}

// ==========================================
// 📝 TASK ENTRY MODULE (Distributed Sheets)
// ==========================================

let activeReports = [];
let currentReportConfig = null;
let currentReportData = []; // Stores { rowData: [], originalIndex: 5 }
let currentUserEmail = "";

// 1. Sidebar Entry Point
window.loadTaskEntry = async function() {
    resetUI();
    // highlightSidebar("Task Entry"); // Ensure sidebar item exists
    document.getElementById("task-entry-ui").classList.remove("hidden");
    currentUserEmail = localStorage.getItem("portal_user_email").toLowerCase().trim();
    
    await fetchActiveReports();
};

// 2. Fetch Available Reports from Registry
// 2. Fetch Available Reports (Fixed Sheet ID)
// 2. Fetch Available Reports (Now reads Dropdown Rules)
async function fetchActiveReports() {
    const select = document.getElementById("task-report-select");
    select.innerHTML = `<option>Loading...</option>`;

    if (!CONFIG.TASK_REGISTRY_SHEET_ID) { alert("Missing TASK_REGISTRY_SHEET_ID"); return; }

    try {
        // 👇 CHANGED: Fetch A:F to get Dropdown Rules
        const regUrl = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.TASK_REGISTRY_SHEET_ID}/values/Report_Registry!A:F`;
        const regResp = await fetch(regUrl, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const regData = await regResp.json();

        const assignUrl = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.TASK_REGISTRY_SHEET_ID}/values/Report_Assignments!A:C`;
        const assignResp = await fetch(assignUrl, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const assignData = await assignResp.json();

        if (!regData.values || !assignData.values) { select.innerHTML = `<option>No tasks.</option>`; return; }

        const validAssignments = assignData.values.filter(r => r[2] && r[2].toString().toLowerCase().includes(currentUserEmail));
        
        activeReports = [];
        const colLetterToIndex = (letter) => {
            let column = 0, length = letter.length;
            for (let i = 0; i < length; i++) column += (letter.charCodeAt(i) - 64) * Math.pow(26, length - i - 1);
            return column - 1;
        };

        regData.values.slice(1).forEach(regRow => {
            const regId = regRow[0] ? regRow[0].toString().trim().toLowerCase() : "";
            const userStores = validAssignments.filter(a => a[0].toString().trim().toLowerCase() === regId).map(a => a[1]);

            if (userStores.length > 0) {
                // 👇 PARSE DROPDOWNS: "H:Yes,No; I:A,B" -> { 7: ['Yes','No'], 8: ['A','B'] }
                let dropdownMap = {};
                if (regRow[5]) { // Column F
                    const rules = regRow[5].split(";");
                    rules.forEach(rule => {
                        const parts = rule.split(":");
                        if (parts.length === 2) {
                            const colIdx = colLetterToIndex(parts[0].trim().toUpperCase());
                            const options = parts[1].split(",").map(o => o.trim());
                            dropdownMap[colIdx] = options;
                        }
                    });
                }

                activeReports.push({
                    id: regRow[0], name: regRow[1], sheetId: regRow[2], tabName: regRow[3],
                    editCols: regRow[4] ? regRow[4].split(",").map(c => c.trim().toUpperCase()) : [],
                    dropdowns: dropdownMap, // Store the map
                    allowedStores: userStores
                });
            }
        });

        select.innerHTML = `<option value="">-- Select Report --</option>`;
        activeReports.forEach((r, i) => select.innerHTML += `<option value="${i}">${r.name}</option>`);

    } catch (e) { console.error(e); select.innerHTML = `<option>Error</option>`; }
}


// 3. Load Selected Report (Renders Dropdowns)
// 3. Load Selected Report (FIXED: Bypasses browser cache)
window.loadSelectedReport = async function() {
    const index = document.getElementById("task-report-select").value;
    if (index === "") return;

    const config = activeReports[index];
    currentReportConfig = config;
    
    document.getElementById("task-content").classList.add("hidden");
    document.getElementById("task-loading").classList.remove("hidden");

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values/${config.tabName}!A:ZZ`; 
        
        // 🛑 FIXED: Added cache prevention headers so users always see fresh data
        const response = await fetch(url, { 
            headers: { 
                "Authorization": `Bearer ${accessToken}`,
                "Cache-Control": "no-cache",
                "Pragma": "no-cache"
            },
            cache: "no-store" 
        });
        
        const data = await response.json();

        if (!data.values) throw new Error("Empty report.");

        const headers = data.values[0];
        const colLetterToIndex = (letter) => {
            let column = 0, l = letter.length;
            for (let i = 0; i < l; i++) column += (letter.charCodeAt(i) - 64) * Math.pow(26, l - i - 1);
            return column - 1;
        };
        const editIndices = config.editCols.map(colLetterToIndex);
        
        let storeColIdx = headers.findIndex(h => h && h.toLowerCase().includes("store"));
        if (storeColIdx === -1) storeColIdx = 0;

        currentReportData = [];
        const maxEditIdx = Math.max(...editIndices) + 1; 
        const totalColsToRender = Math.max(headers.length, maxEditIdx);

        // Header
        let theadHtml = `<tr>`;
        for (let i = 0; i < totalColsToRender; i++) {
            const h = headers[i] || `(Col ${i+1})`;
            const isEditable = editIndices.includes(i);
            const style = isEditable ? "background:#fff9c4; border-bottom:2px solid #fbc02d;" : "background:#eee;";
            theadHtml += `<th style="${style} padding:10px; text-align:left; border:1px solid #ccc;">${h} ${isEditable?'✏️':''}</th>`;
        }
        document.getElementById("task-table-head").innerHTML = theadHtml + "</tr>";

        // Body
        let tbodyHtml = "";
        data.values.slice(1).forEach((row, rowIndex) => {
            const rowStoreId = String(row[storeColIdx] || "").trim();
            if (config.allowedStores.includes(rowStoreId)) {
                
                const trackedRow = { sheetRowIndex: rowIndex + 1, originalData: [...row], domId: `task-row-${rowIndex}` };
                currentReportData.push(trackedRow);

                tbodyHtml += `<tr id="${trackedRow.domId}">`;
                for(let i=0; i < totalColsToRender; i++) {
                    // 🛑 FIXED: Trim spaces to prevent dropdown matching errors
                    const cellVal = (row[i] || "").toString().trim().replace(/"/g, '&quot;');
                    
                    if (editIndices.includes(i)) {
                        if (config.dropdowns && config.dropdowns[i]) {
                            // RENDER DROPDOWN (Case insensitive match)
                            const options = config.dropdowns[i].map(opt => {
                                const isSelected = (opt.toLowerCase() === cellVal.toLowerCase()) ? "selected" : "";
                                return `<option value="${opt}" ${isSelected}>${opt}</option>`;
                            }).join("");
                            
                            tbodyHtml += `
                            <td style="padding:0; border:1px solid #ddd; background:#fffde7;">
                                <select data-row-id="${rowIndex}" data-col-idx="${i}" 
                                        style="width:100%; min-width:120px; padding:10px; border:none; background:transparent; outline:none; cursor:pointer;">
                                    <option value="">-- Select --</option>
                                    ${options}
                                </select>
                            </td>`;
                        } else {
                            // RENDER TEXT INPUT
                            tbodyHtml += `
                            <td style="padding:0; border:1px solid #ddd; background:#fffde7;">
                                <input type="text" data-row-id="${rowIndex}" data-col-idx="${i}" value="${cellVal}" 
                                       style="width:100%; min-width:80px; padding:10px; border:none; background:transparent; outline:none;">
                            </td>`;
                        }
                    } else {
                        tbodyHtml += `<td style="padding:10px; border:1px solid #ddd; background:#f9f9f9;">${cellVal}</td>`;
                    }
                }
                tbodyHtml += `</tr>`;
            }
        });
        document.getElementById("task-table-body").innerHTML = tbodyHtml;

    } catch (e) { console.error(e); } 
    finally {
        document.getElementById("task-loading").classList.add("hidden");
        document.getElementById("task-content").classList.remove("hidden");
    }
};

// 4. Save Changes (FIXED: Adds Sync Delay to show fresh data)
window.saveTaskData = async function() {
    const btn = document.querySelector("#task-content button");
    btn.innerText = "⏳ Saving..."; 
    btn.disabled = true;

    try {
        const inputs = document.querySelectorAll("#task-table-body input, #task-table-body select");
        const updates = []; 

        inputs.forEach(input => {
            const newVal = String(input.value).trim();
            const rowId = input.getAttribute("data-row-id");
            const colIdx = parseInt(input.getAttribute("data-col-idx"));
            
            const tracked = currentReportData.find(d => d.domId === `task-row-${rowId}`);
            if (tracked) {
                const originalVal = String(tracked.originalData[colIdx] || "").trim();
                
                if (newVal !== originalVal) {
                    let letter = "";
                    let temp = colIdx + 1;
                    while (temp > 0) {
                        let mod = (temp - 1) % 26;
                        letter = String.fromCharCode(65 + mod) + letter;
                        temp = Math.floor((temp - mod) / 26);
                    }

                    const safeTabName = `'${currentReportConfig.tabName}'`;
                    
                    updates.push({
                        range: `${safeTabName}!${letter}${tracked.sheetRowIndex}`,
                        values: [[newVal]]
                    });
                }
            }
        });

        if (updates.length === 0) { 
            alert("No changes detected."); 
            btn.innerText = "💾 Save Changes to Master"; 
            btn.disabled = false; 
            return; 
        }

        // Send Batch Update
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${currentReportConfig.sheetId}/values:batchUpdate`;
        const response = await fetch(url, {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${accessToken}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({ 
                valueInputOption: "USER_ENTERED", 
                data: updates 
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error ? result.error.message : "Failed to save to Google Sheets.");
        }

        btn.innerText = "✅ Saved!";
        
        // 🛑 FIXED: Give Google Sheets 1.5 seconds to process the save before fetching again.
        // This ensures the next screen reload shows the newly saved data.
        setTimeout(() => {
            window.loadSelectedReport(); 
            btn.innerText = "💾 Save Changes to Master"; 
            btn.disabled = false;
        }, 1500);

    } catch (e) { 
        alert("❌ Error saving data: " + e.message); 
        console.error("Save Error:", e);
        btn.innerText = "💾 Save Changes to Master"; 
        btn.disabled = false; 
    }
};
