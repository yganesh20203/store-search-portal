// config.js
const CONFIG = {
    // 1. PASTE YOUR NEW CONSOLE STRING HERE
    ENCRYPTED_CREDS: "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",

    // 2. Folder IDs
    SALES_FOLDER_ID: "1jguubICcAtMijiaNETV7B35G2YZlyM5O", 
    MEMBERS_FOLDER_ID: "1ViTdGxZu-mAMiUOyBCliV8uMNy30clNt",

    // 3. TRACKER GROUPS
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
