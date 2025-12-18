// Global State
let userEmail = "";
let accessToken = ""; // Needed for Drive API later

function handleCredentialResponse(response) {
    // This function is called automatically by Google upon successful login
    console.log("Encoded JWT ID token: " + response.credential);
    
    // Decode the JWT to get user info (Simple decode for UI display)
    const responsePayload = decodeJwtResponse(response.credential);

    userEmail = responsePayload.email;
    console.log("ID: " + responsePayload.sub);
    console.log("Email: " + responsePayload.email);

    // Security Check: Ensure domain matches your org
    // Replace 'yourcompany.com' with your actual domain
    // if (!userEmail.endsWith("@yourcompany.com")) {
    //     alert("Access Restricted to Organization Users Only");
    //     return;
    // }

    // Unlock UI
    document.getElementById("auth-overlay").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");
    document.getElementById("user-info").innerText = `Logged in as: ${userEmail}`;
    
    // Trigger Token Client for Drive Access (Next Phase)
    initDriveScope(); 
}

// Helper to decode the JWT token from Google
function decodeJwtResponse(token) {
    var base64Url = token.split('.')[1];
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
}

function initDriveScope() {
    console.log("Ready to initialize Drive API scopes...");
    // We will add the Access Token logic in Phase 2
}
