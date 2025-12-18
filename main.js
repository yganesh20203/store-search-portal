// Global State
let accessToken = ""; 

// 1. Unlock and Login Function
async function unlockAndLogin() {
    // Get the password the user typed
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
        // We use the password to unlock the hidden string in config.js
        const bytes = CryptoJS.AES.decrypt(CONFIG.ENCRYPTED_CREDS, userPass);
        const decryptedString = bytes.toString(CryptoJS.enc.Utf8);

        // If the password was wrong, the result will be empty
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
        // Generate a Google Token using the service account keys
        accessToken = await generateAccessToken(creds);
        
        // --- SUCCESS UI ---
        document.getElementById("auth-overlay").classList.add("hidden");
        document.getElementById("dashboard").classList.remove("hidden");

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

// 2. Helper: Exchange Service Account for Token
// This manually signs a JWT to get an access token from Google
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

// 3. Test Function (Click the "Test Connection" button to run this)
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
