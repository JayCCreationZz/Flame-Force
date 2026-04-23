const { Pool } = require("pg");

const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl:{ rejectUnauthorized:false }
});

async function initDB(){

try{

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
nohammers BOOLEAN DEFAULT false
)
`);

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

}catch(err){

console.error("❌ PostgreSQL init error:",err);

}

}

initDB();

module.exports = pool;