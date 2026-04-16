require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("./database");

/*
Convert battle date + time → timestamp
*/
function battleTimestamp(date, time) {

  return new Date(`${date} ${time}`).getTime();

}

/*
Find closest poster file by timestamp
*/
function closestPoster(targetTime, posters) {

  let bestMatch = null;
  let smallestDiff = Infinity;

  posters.forEach(poster => {

    const diff =
      Math.abs(poster.timestamp - targetTime);

    if (diff < smallestDiff) {

      smallestDiff = diff;
      bestMatch = poster;

    }

  });

  return bestMatch;

}

async function migratePosters() {

  try {

    const postersDir = path.join(
      process.cwd(),
      "dashboard/public/posters"
    );

    if (!fs.existsSync(postersDir)) {

      console.log("❌ posters folder not found");
      process.exit(1);

    }

    /*
    Load poster files with timestamps
    */

    const posters = fs
      .readdirSync(postersDir)
      .filter(file =>
        file.match(/\.(jpg|jpeg|png|webp)$/i)
      )
      .map(file => {

        const fullPath =
          path.join(postersDir, file);

        const stats =
          fs.statSync(fullPath);

        return {

          file,
          fullPath,
          timestamp: stats.mtimeMs

        };

      });

    if (!posters.length) {

      console.log("❌ no posters found");
      process.exit(1);

    }

    console.log(`Found ${posters.length} poster files`);

    /*
    Load battles
    */

    const battles =
      await db.query(
        "SELECT id,date,time FROM battles ORDER BY id"
      );

    if (!battles.rows.length) {

      console.log("❌ no battles found");
      process.exit(1);

    }

    console.log(
      `Found ${battles.rows.length} battles`
    );

    /*
    Match posters to battles
    */

    for (const battle of battles.rows) {

      const battleTime =
        battleTimestamp(
          battle.date,
          battle.time
        );

      const match =
        closestPoster(
          battleTime,
          posters
        );

      if (!match) continue;

      const buffer =
        fs.readFileSync(match.fullPath);

      await db.query(

        "UPDATE battles SET posterData=$1 WHERE id=$2",

        [buffer, battle.id]

      );

      console.log(
        `✅ Matched poster ${match.file} → battle ${battle.id}`
      );

    }

    console.log("🎉 Smart poster migration complete");

    process.exit();

  }

  catch (err) {

    console.error(
      "❌ Migration failed:",
      err.message
    );

    process.exit(1);

  }

}

migratePosters();