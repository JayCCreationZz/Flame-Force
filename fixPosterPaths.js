const db = require("./database");

async function fixPaths() {

  const result = await db.query(
    "SELECT id, poster FROM battles WHERE poster IS NOT NULL"
  );

  for (const battle of result.rows) {

    if (!battle.poster.startsWith("/posters/")) {

      const filename =
        battle.poster.split("/").pop();

      const newPath =
        `/posters/${filename}`;

      await db.query(
        "UPDATE battles SET poster=$1 WHERE id=$2",
        [newPath, battle.id]
      );

      console.log(
        `Fixed poster for battle ${battle.id}`
      );
    }
  }

  console.log("✅ Poster path repair complete");
  process.exit();

}

fixPaths();