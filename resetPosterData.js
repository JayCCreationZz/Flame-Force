require("dotenv").config();

const db = require("./database");

async function resetPosters() {

  try {

    console.log("Clearing existing posterData...");

    await db.query(
      "UPDATE battles SET posterData = NULL"
    );

    console.log("✅ posterData cleared successfully");

    process.exit();

  }

  catch (err) {

    console.error(
      "❌ Failed to reset posterData:",
      err.message
    );

    process.exit(1);

  }

}

resetPosters();