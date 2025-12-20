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
