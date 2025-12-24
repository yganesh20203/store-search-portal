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
    DAILY_DISPATCH_SHEET_ID: "1rg-bNn8WqMg0uqpyczjG8ywOJuLhV-3DMS0S7ZSZQvI",
    WORK_REPORTS_FOLDER_ID: "1ViTdGxZu-mAMiUOyBCliV8uMNy30clNt",

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
    },
   WAREHOUSE_GROUPS: {
        "Flipkart Wholesale": [
            { name: "Zirakhpur", lat: 30.6374571, lng: 76.8239134 },
            { name: "Meerut", lat: 29.0356465, lng: 77.6701403 },
            { name: "Agra 1", lat: 27.2171019, lng: 78.0922942 },
            { name: "Hyderabad", lat: 17.335601, lng: 78.427409 },
            { name: "Agra 2", lat: 27.2203079, lng: 77.9270342 },
            { name: "Bhopal 2", lat: 23.1538093, lng: 77.4774699 },
            { name: "Indore 1", lat: 22.7503476, lng: 75.9336537 },
            { name: "Ludhiana-3", lat: 30.8861031, lng: 75.9394469 },
            { name: "Rajahmundry", lat: 17.0069742, lng: 81.8113343 },
            { name: "Amritsar", lat: 31.590188, lng: 74.961798 },
            { name: "Vizag", lat: 17.6852547, lng: 83.1879391 },
            { name: "Lucknow", lat: 26.7992258, lng: 81.0040274 },
            { name: "Jalandhar", lat: 31.2920647, lng: 75.6573569 },
            { name: "Bhopal 1", lat: 23.3040501, lng: 77.4189171 },
            { name: "Amravati", lat: 20.882687, lng: 77.7455037 },
            { name: "Karimnagar", lat: 18.4585025, lng: 79.0976901 },
            { name: "Jammu", lat: 32.7442937, lng: 74.8326817 },
            { name: "Ludhiana-1", lat: 30.9507084, lng: 75.8243597 },
            { name: "Indore 2", lat: 22.6531497, lng: 75.8018304 },
            { name: "Guntur", lat: 16.3082614, lng: 80.4641649 },
            { name: "Kota", lat: 25.1347848, lng: 75.8553842 },
            { name: "Tirupathi", lat: 13.63341419, lng: 79.48998826 },
            { name: "Vijayawada", lat: 16.511119, lng: 80.713661 },
            { name: "Kurnool", lat: 15.8076338, lng: 78.0391466 },
            { name: "Raipur", lat: 21.2918435, lng: 81.6272861 }
        ],
        
        "Metro Stores": [
            { name: "Ahmedabad (Sarkhej)", lat: 22.983, lng: 72.489 },
            { name: "Ajmer (Panchsheel)", lat: 26.505, lng: 74.654 },
            { name: "Amritsar (Verka Bypass)", lat: 31.666, lng: 74.916 },
            { name: "Amritsar (Mirankot)", lat: 31.671, lng: 74.843 },
            { name: "Bangalore (Yeshwanthpur)", lat: 13.024, lng: 77.553 },
            { name: "Bangalore (Kanakapura Rd)", lat: 12.879, lng: 77.570 },
            { name: "Bangalore (Hosur Rd)", lat: 12.868, lng: 77.659 },
            { name: "Bangalore (Binnypet)", lat: 12.964, lng: 77.561 },
            { name: "Bangalore (Whitefield)", lat: 12.996, lng: 77.696 },
            { name: "Bangalore (Mysore Rd)", lat: 12.923, lng: 77.499 },
            { name: "Bhilwara (Suzuki Colony)", lat: 25.328, lng: 74.620 },
            { name: "Bhopal (Hoshangabad Rd)", lat: 23.184, lng: 77.452 },
            { name: "Delhi (Shahdara)", lat: 28.658, lng: 77.295 },
            { name: "Delhi (Seelampur)", lat: 28.669, lng: 77.272 },
            { name: "Ghaziabad (Lal Kuan)", lat: 28.633, lng: 77.447 },
            { name: "Guntur (Mangalagiri Rd)", lat: 16.326, lng: 80.468 },
            { name: "Hubli (Navanagar)", lat: 15.396, lng: 75.102 },
            { name: "Hyderabad (Moosapet)", lat: 17.469, lng: 78.418 },
            { name: "Hyderabad (Uppal)", lat: 17.391, lng: 78.563 },
            { name: "Hyderabad (Gaganpahad)", lat: 17.301, lng: 78.435 },
            { name: "Hyderabad (Suchitra)", lat: 17.523, lng: 78.473 },
            { name: "Indore (Dewas Naka)", lat: 22.766, lng: 75.894 },
            { name: "Jaipur (Sikar Rd)", lat: 26.988, lng: 75.766 },
            { name: "Jalandhar (Reru)", lat: 31.365, lng: 75.578 },
            { name: "Kolkata (EM Bypass)", lat: 22.486, lng: 88.403 },
            { name: "Lucknow (Faizabad Rd)", lat: 26.883, lng: 81.050 },
            { name: "Meerut (Baghpat Rd)", lat: 28.966, lng: 77.674 },
            { name: "Mumbai (Bhandup)", lat: 19.153, lng: 72.935 },
            { name: "Mumbai (Borivali)", lat: 19.227, lng: 72.864 },
            { name: "Mumbai (Malad)", lat: 19.172, lng: 72.836 },
            { name: "Nashik (Tapovan)", lat: 20.002, lng: 73.805 },
            { name: "Surat (Althan)", lat: 21.149, lng: 72.784 },
            { name: "Tumkur (Mandipete)", lat: 13.340, lng: 77.100 },
            { name: "Vijayawada (Mogalrajpuram)", lat: 16.502, lng: 80.648 },
            { name: "Visakhapatnam (Madhurawada)", lat: 17.820, lng: 83.360 },
            { name: "Zirakpur (Baltana)", lat: 30.641, lng: 76.815 }
        ]
    }
};
