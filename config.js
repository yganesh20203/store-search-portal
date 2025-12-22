// config.js
const CONFIG = {
    // 1. YOUR NEW, CLEAN ENCRYPTED CREDENTIALS
    ENCRYPTED_CREDS: "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",

    SALES_FOLDER_ID: "1jguubICcAtMijiaNETV7B35G2YZlyM5O", 
    MEMBERS_FOLDER_ID: "1ViTdGxZu-mAMiUOyBCliV8uMNy30clNt",

    WALKIN_FOLDERS: {
        "Walkin-sales": "1TU9jhb2jZ-MRKPijG-5I3AyTPvyOqnUE4yrF-W6CbkU",
        "Walkin-MAC": "1TU9jhb2jZ-MRKPijG-5I3AyTPvyOqnUE4yrF-W6CbkU",
        "SaveEasy": "1TU9jhb2jZ-MRKPijG-5I3AyTPvyOqnUE4yrF-W6CbkU",
        "Offer posters": "1J2epmcfA8hT8YFk4Q7G9LM3qLZzw3W_H",
        "Offer articles": "11TDD91U2naMQAUHB-pWa54fPzMU5eIFH"
    },
    
    // 3. UPDATED: Hourly Images Folder
    HOURLY_SALES_FOLDER_ID: "1I42onyk5d1FWl7F58Go7oQFxamEM8ph4",
    FEEDBACK_SHEET_ID: "1pWgjKGWBypp8vldYLhNXCWHOfQO5qS8sV1yayzFAw0U",
    TICKET_SHEET_ID: "1w3Hs0teV2AACnHitf4iVG-Yg3i-PXP4Sek9VMwWStTw",
    TICKET_SCRIPT_URL: "https://script.google.com/a/macros/flipkart.com/s/AKfycbzpB3QtwSOZok3ZBJVqsSj6b74UHSVzUOrlRTOeaXEMfe1oRi41NedwfDSZqxKthcAd/exec",

    // 4. Tracker Groups
    TRACKER_GROUPS: {
        "🚛 Vehicle Dispatch Summary": [
            { name: "May 25", id: "1eYd1U5ooBjdgjwL3g4wWnUocNgnhaH6defIccVtx4CI", gid: "1165108349" },
            { name: "June 25", id: "1eYd1U5ooBjdgjwL3g4wWnUocNgnhaH6defIccVtx4CI", gid: "141081355" },
            { name: "July 25", id: "1eYd1U5ooBjdgjwL3g4wWnUocNgnhaH6defIccVtx4CI", gid: "1576983784" },
            { name: "Aug 25", id: "1eYd1U5ooBjdgjwL3g4wWnUocNgnhaH6defIccVtx4CI", gid: "339939351" },
            { name: "Sep 25", id: "1eYd1U5ooBjdgjwL3g4wWnUocNgnhaH6defIccVtx4CI", gid: "382086234" },
            { name: "Oct 25", id: "1eYd1U5ooBjdgjwL3g4wWnUocNgnhaH6defIccVtx4CI", gid: "347795099" },
            { name: "Nov 25", id: "1eYd1U5ooBjdgjwL3g4wWnUocNgnhaH6defIccVtx4CI", gid: "1247998899" },
            { name: "Dec 25", id: "1eYd1U5ooBjdgjwL3g4wWnUocNgnhaH6defIccVtx4CI", gid: "1616527984" }
        ],
        
        "🎯 DSD Attainment": [
            { name: "May 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "1367784345" },
            { name: "June 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "145164594" },
            { name: "July 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "1944372248" },
            { name: "Aug 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "222454485" },
            { name: "Sep 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "1715369830" },
            { name: "Oct 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "267301889" },
            { name: "Nov 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "1189778759" },
            { name: "Dec 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "1778957169" }
        ]
    }
};
