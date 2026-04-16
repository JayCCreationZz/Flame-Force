const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {

  try {

    /*
    Ensure base table exists
    */
    await pool.query(`
      CREATE TABLE IF NOT EXISTS battles (
        id SERIAL PRIMARY KEY,
        host TEXT,
        opponent TEXT,
        date TEXT,
        time TEXT,
        liveLink TEXT
      )
    `);

    /*
    ADD NEW COLUMNS SAFELY
    */

    await pool.query(`
      ALTER TABLE battles
      ADD COLUMN IF NOT EXISTS posterData BYTEA
    `);

    await pool.query(`
      ALTER TABLE battles
      ADD COLUMN IF NOT EXISTS managerGifting BOOLEAN DEFAULT false
    `);

    await pool.query(`
      ALTER TABLE battles
      ADD COLUMN IF NOT EXISTS adultOnly BOOLEAN DEFAULT false
    `);

    await pool.query(`
      ALTER TABLE battles
      ADD COLUMN IF NOT EXISTS powerUps BOOLEAN DEFAULT true
    `);

    await pool.query(`
      ALTER TABLE battles
      ADD COLUMN IF NOT EXISTS noHammers BOOLEAN DEFAULT false
    `);

    console.log("✅ PostgreSQL schema synced successfully");

  }

  catch (err) {

    console.error("❌ PostgreSQL init error:", err);

  }

}

initDB();

module.exports = pool;