// config.js
const CONFIG = {
    // 1. Credentials (Keep your existing encrypted string here)
    ENCRYPTED_CREDS: "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",

    // 2. Folder IDs
    SALES_FOLDER_ID: "1jguubICcAtMijiaNETV7B35G2YZlyM5O", 
    MEMBERS_FOLDER_ID: "1ViTdGxZu-mAMiUOyBCliV8uMNy30clNt",

    // 3. TRACKER GROUPS (New Structure)
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
            {name: "May 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "1367784345" },
            {name: "June 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "145164594" },
            {name: "July 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "1944372248" },
            {name: "Aug 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "222454485" },
            {name: "Sep 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "1715369830" },
            {name: "Oct 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "267301889" },
            {name: "Nov 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "1189778759" },
            {name: "Dec 25", id: "1U6y-mEgv7WoqdsmqESM3bhZqV-3d0ApgSY5G7MCbvaI", gid: "1778957169" },
        ]
    }
}
