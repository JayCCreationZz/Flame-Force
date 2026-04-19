require("dotenv").config();

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDB() {

  try {

    /*
    CORE TABLE
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
    POSTER STORAGE
    */

    await pool.query(`
      ALTER TABLE battles
      ADD COLUMN IF NOT EXISTS posterData BYTEA
    `);


    /*
    RULE FLAGS
    */

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


    /*
    REMINDER FLAGS
    */

    await pool.query(`
      ALTER TABLE battles
      ADD COLUMN IF NOT EXISTS reminder30 BOOLEAN DEFAULT false
    `);

    await pool.query(`
      ALTER TABLE battles
      ADD COLUMN IF NOT EXISTS reminder10 BOOLEAN DEFAULT false
    `);

    await pool.query(`
      ALTER TABLE battles
      ADD COLUMN IF NOT EXISTS live BOOLEAN DEFAULT false
    `);

    await pool.query(`
      ALTER TABLE battles
      ADD COLUMN IF NOT EXISTS posted BOOLEAN DEFAULT false
    `);


    console.log("✅ PostgreSQL schema synced successfully");

  }

  catch (err) {

    console.error("❌ PostgreSQL init error:", err);

  }

}

initDB();

module.exports = pool;