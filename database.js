const { Pool } = require("pg");

/*
Railway PostgreSQL connection
*/

const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl: {
rejectUnauthorized: false
}
});

/*
INITIALIZE DATABASE TABLES
*/

async function initDB() {

try {

/*
BATTLES TABLE
*/

await pool.query(`
CREATE TABLE IF NOT EXISTS battles (
id SERIAL PRIMARY KEY,
host TEXT,
hostname TEXT,
opponent TEXT,
date TEXT,
time TEXT,
posterdata BYTEA,
livelink TEXT,
managergifting BOOLEAN DEFAULT false,
adultonly BOOLEAN DEFAULT false,
powerups BOOLEAN DEFAULT false,
nohammers BOOLEAN DEFAULT false,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`);

/*
BATTLE REQUESTS TABLE
*/

await pool.query(`
CREATE TABLE IF NOT EXISTS battle_requests (
id SERIAL PRIMARY KEY,
requester TEXT,
agency TEXT,
opponent TEXT,
preferred_date TEXT,
preferred_time TEXT,
notes TEXT,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`);

console.log("✅ PostgreSQL connected & schema synced successfully");

} catch (err) {

console.error("❌ PostgreSQL init error:", err);

}

}

initDB();

module.exports = pool;