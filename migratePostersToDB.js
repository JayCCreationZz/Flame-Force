const fs = require("fs");
const path = require("path");
const db = require("./database");

async function migratePosters() {

  try {

    const postersDir =
      path.join(
        process.cwd(),
        "dashboard/public/posters"
      );

    if (!fs.existsSync(postersDir)) {

      console.log("❌ posters folder not found");
      process.exit();

    }

    const files =
      fs.readdirSync(postersDir);

    if (!files.length) {

      console.log("❌ no posters found to migrate");
      process.exit();

    }

    console.log(`Found ${files.length} poster files`);

    const battles =
      await db.query(
        "SELECT id FROM battles ORDER BY id"
      );

    for (const battle of battles.rows) {

      /*
      Try matching filename containing battle id
      Example:
      171234567-Poster.jpg
      */

      const match =
        files.find(file =>
          file.includes(battle.id.toString())
        );

      if (!match) continue;

      const filePath =
        path.join(postersDir, match);

      const imageBuffer =
        fs.readFileSync(filePath);

      await db.query(

        "UPDATE battles SET posterData=$1 WHERE id=$2",

        [imageBuffer, battle.id]

      );

      console.log(
        `✅ Migrated poster for battle ${battle.id}`
      );

    }

    console.log("🎉 Poster migration complete");

    process.exit();

  }

  catch (err) {

    console.error(
      "Migration failed:",
      err.message
    );

  }

}

migratePosters();