const { Pool } = require("pg");

/*
PostgreSQL connection pool (Railway provides DATABASE_URL automatically)
*/
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/*
Create battles table if missing
*/
async function initDB() {

  try {

    await pool.query(`
      CREATE TABLE IF NOT EXISTS battles (
        id SERIAL PRIMARY KEY,
        host TEXT,
        opponent TEXT,
        date TEXT,
        time TEXT,
        poster TEXT,
        liveLink TEXT
      )
    `);

    console.log("✅ PostgreSQL connected & table ready");

  } catch (err) {

    console.error("❌ PostgreSQL init error:", err);

  }

}

initDB();

module.exports = pool;