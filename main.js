// ==========================================
// 1. GLOBAL STATE
// ==========================================
let accessToken = ""; 
let pyodide = null;
let currentMonthFolderId = "";

// ==========================================
// 2. AUTHENTICATION & SECURITY (Phase 2)
// ==========================================

// Unlock and Login Function
async function unlockAndLogin() {
    const userPass = document.getElementById("access-key").value;
    const errorMsg = document.getElementById("error-msg");
    const btn = document.querySelector("button");

    if(!userPass) return;

    btn.innerText = "Unlocking...";

    try {
        // Ensure CONFIG is loaded
        if (typeof CONFIG === 'undefined') {
            throw new Error("Config file not loaded. Check connection.");
        }

        // --- DECRYPTION STEP ---
        const bytes = CryptoJS.AES.decrypt(CONFIG.ENCRYPTED_CREDS, userPass);
        const decryptedString = bytes.toString(CryptoJS.enc.Utf8);

        if (!decryptedString) {
            throw new Error("Incorrect Access Key");
        }

        // Parse the hidden JSON data
        const creds = JSON.parse(decryptedString);
        if (creds.type !== "service_account") {
            throw new Error("Invalid Credentials Data");
        }

        console.log("Decryption Successful. Authenticating...");

        // --- AUTHENTICATION STEP ---
        accessToken = await generateAccessToken(creds);
        
        // --- SUCCESS UI ---
        document.getElementById("auth-overlay").classList.add("hidden");
        document.getElementById("dashboard").classList.remove("hidden");
        
        // Start loading Python immediately in background
        initPyodideEngine();

    } catch (e) {
        console.error(e);
        if(errorMsg) {
            errorMsg.innerText = "Error: " + (e.message || "Unknown error");
            errorMsg.style.display = "block";
        }
        btn.innerText = "Unlock & Connect";
        document.getElementById("access-key").value = ""; 
    }
}

// Helper: Exchange Service Account for Token
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
    if (data.error) throw new Error(data.error_description);
    return data.access_token;
}

// Test Function (Optional Debugging)
async function testDriveConnection() {
    const contentDiv = document.getElementById("content-area");
    contentDiv.innerHTML = "Querying Google Drive...";
    
    try {
        const response = await fetch("https://www.googleapis.com/drive/v3/files?pageSize=5", {
            headers: { "Authorization": `Bearer ${accessToken}` }
        });
        const data = await response.json();
        
        let html = "<h3>Drive Connection Successful!</h3><ul>";
        if(data.files) {
            data.files.forEach(file => {
                html += `<li>📄 ${file.name} (ID: ${file.id})</li>`;
            });
        }
        html += "</ul>";
        contentDiv.innerHTML = html;
        
    } catch (e) {
        contentDiv.innerHTML = `<p style="color:red">Connection Failed: ${e.message}</p>`;
    }
}

// ==========================================
// 3. SALES ENGINE (Phase 3)
// ==========================================

// A. Initialize Python Engine (Runs in background)
async function initPyodideEngine() {
    if (pyodide) return; // Already loaded
    console.log("Starting Python initialization...");
    try {
        pyodide = await loadPyodide();
        await pyodide.loadPackage("pandas");
        console.log("Python & Pandas Ready!");
    } catch (e) {
        console.error("Failed to load Pyodide:", e);
    }
}

// B. Load the Sales Dashboard (List Months)
async function loadSalesDashboard() {
    // UI Reset
    document.getElementById("sales-ui").classList.remove("hidden");
    document.getElementById("content-area").innerHTML = "Loading Folders...";
    document.getElementById("month-list").innerHTML = "Loading...";

    // Query Drive for folders inside SALES_FOLDER_ID
    const query = `'${CONFIG.SALES_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name)`;

    try {
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });

        // --- NEW ERROR CHECKING LOGIC ---
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Google Error ${response.status}: ${errText}`);
        }
        // --------------------------------

        const data = await response.json();
        const listContainer = document.getElementById("month-list");
        listContainer.innerHTML = ""; // Clear loading text

        if (data.files && data.files.length > 0) {
            document.getElementById("content-area").innerHTML = "<h3>Select a Month above to start.</h3>";
            
            // Create Buttons for each month
            data.files.forEach(folder => {
                const btn = document.createElement("button");
                btn.className = "folder-btn";
                btn.innerText = "📂 " + folder.name; 
                btn.onclick = () => selectMonth(folder.id, btn);
                listContainer.appendChild(btn);
            });
        } else {
            document.getElementById("content-area").innerHTML = `
                <p>No Month folders found.</p>
                <p style="font-size:12px; color: #666;">
                   Troubleshoot: Ensure folder ID <b>${CONFIG.SALES_FOLDER_ID}</b> is correct and shared with 
                   <b>analytics-fkw@analytics-fkw.iam.gserviceaccount.com</b>.
                </p>`;
        }
    } catch (e) {
        console.error(e);
        document.getElementById("content-area").innerHTML = `<span style="color:red">Error loading folders: ${e.message}</span>`;
    }
}

// C. User Selected a Month
function selectMonth(folderId, btnElement) {
    currentMonthFolderId = folderId;
    
    // Visual Highlight logic
    document.querySelectorAll(".folder-btn").forEach(b => b.classList.remove("active"));
    btnElement.classList.add("active");

    // Show Search Bar
    document.getElementById("store-search-box").classList.remove("hidden");
    document.getElementById("content-area").innerHTML = "Folder Selected. Enter Store ID (e.g., 4702) to view report.";
}

// D. Find & Load the CSV Report
async function findAndLoadReport() {
    const storeId = document.getElementById("store-id-input").value.trim();
    if (!storeId) {
        alert("Please enter a Store ID");
        return;
    }

    const outputDiv = document.getElementById("content-area");
    outputDiv.innerHTML = `Searching for <b>${storeId}.csv</b>...`;

    // Search for file inside the SELECTED Month Folder
    const query = `'${currentMonthFolderId}' in parents and name = '${storeId}.csv' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name)`;

    try {
        const response = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const data = await response.json();

        if (data.files && data.files.length > 0) {
            const fileId = data.files[0].id;
            outputDiv.innerHTML = "File Found! Downloading & Processing with Python...";
            await processCsvWithPython(fileId);
        } else {
            outputDiv.innerHTML = `<span style="color:red">File <b>${storeId}.csv</b> not found in this folder.</span>`;
        }
    } catch (e) {
        outputDiv.innerHTML = "Error searching file: " + e.message;
    }
}

// E. The Magic: Python (Pandas) Processing
async function processCsvWithPython(fileId) {
    if (!pyodide) {
        document.getElementById("content-area").innerHTML = "Python is still loading... please wait 5 seconds and try again.";
        return;
    }

    try {
        // 1. Download file content as Text from Google Drive
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { "Authorization": `Bearer ${accessToken}` }
        });
        const csvText = await response.text();

        // 2. Pass to Python environment
        pyodide.globals.set("csv_content", csvText);

        // 3. Run Python Script: Read CSV -> HTML Table
        const pythonScript = `
import pandas as pd
import io

# Read the string as a CSV
data = io.StringIO(csv_content)
df = pd.read_csv(data)

# Convert to HTML (clean table)
# classes='report-table' allows us to style it in CSS later
df.to_html(index=False, classes='report-table', border=0)
        `;

        const htmlTable = await pyodide.runPythonAsync(pythonScript);

        // 4. Display Result
        document.getElementById("content-area").innerHTML = htmlTable;

    } catch (e) {
        console.error(e);
        document.getElementById("content-area").innerHTML = "Python Processing Error: " + e.message;
    }
}
