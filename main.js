// Global State
let userEmail = "";
let accessToken = ""; 
let tokenClient;

// 1. Initialize the Token Client (run this immediately)
function initTokenClient() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (response) => {
            if (response.error !== undefined) {
                throw (response);
            }
            console.log("Access Token Received!");
            accessToken = response.access_token;
            
            // UI Update: Hide Auth, Show Dashboard
            document.getElementById("auth-overlay").classList.add("hidden");
            document.getElementById("dashboard").classList.remove("hidden");
            
            // Ready to work!
            console.log("Ready to fetch files.");
        },
    });
}

// 2. Handle the "Identity" Login (The Zero-Click part)
function handleCredentialResponse(response) {
    const responsePayload = decodeJwtResponse(response.credential);
    userEmail = responsePayload.email;
    document.getElementById("user-info").innerText = `User: ${userEmail}`;
    
    // After we know WHO they are, we ask for PERMISSION (Access Token)
    // We cannot auto-trigger this without a user click due to browser popup blockers.
    // So we change the overlay text to ask for a click.
    document.querySelector("#auth-overlay h1").innerText = "Welcome, " + responsePayload.given_name;
    document.querySelector("#auth-overlay p").innerText = "Click below to grant Drive access.";
    
    // Create a button dynamically to trigger the permission popup
    let btn = document.createElement("button");
    btn.innerText = "Connect to Google Drive";
    btn.onclick = () => tokenClient.requestAccessToken();
    btn.style.padding = "10px 20px";
    btn.style.fontSize = "16px";
    btn.style.marginTop = "20px";
    
    // Replace the old Google button with our new Permission button
    const container = document.getElementById("auth-overlay");
    const oldBtn = document.getElementById("g_id_onload");
    if(oldBtn) oldBtn.remove(); // Clean up
    container.appendChild(btn);
}

// 3. JWT Decoder Helper
function decodeJwtResponse(token) {
    var base64Url = token.split('.')[1];
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
}

// 4. Load Sections (Placeholder for now)
function loadSection(section) {
    console.log("Loading section:", section);
    const content = document.getElementById("content-area");
    content.innerHTML = `<h3>Active Section: ${section}</h3><p>Engine not connected yet.</p>`;
}

// Wait for window load to init the token client logic
window.onload = function() {
    // We can't init the client until the Google Script is loaded.
    // Usually it loads fast, but robust apps check for 'google' object.
    const checkGoogle = setInterval(() => {
        if (typeof google !== 'undefined') {
            clearInterval(checkGoogle);
            initTokenClient();
        }
    }, 100);
}
