const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {

  try {

    await pool.query(`
      CREATE TABLE IF NOT EXISTS battles (
        id SERIAL PRIMARY KEY,
        host TEXT,
        opponent TEXT,
        date TEXT,
        time TEXT,
        posterData BYTEA,
        liveLink TEXT,
        managerGifting BOOLEAN DEFAULT false,
        adultOnly BOOLEAN DEFAULT false,
        powerUps BOOLEAN DEFAULT true,
        noHammers BOOLEAN DEFAULT false
      )
    `);

    console.log("✅ PostgreSQL connected & schema ready");

  } catch (err) {

    console.error("❌ PostgreSQL init error:", err);

  }

}

initDB();

module.exports = pool;