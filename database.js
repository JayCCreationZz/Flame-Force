const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./flameforce.db');

db.run(`
CREATE TABLE IF NOT EXISTS battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host TEXT,
    opponent TEXT,
    date TEXT,
    time TEXT,
    channel TEXT,
    poster TEXT,
    liveLink TEXT
)
`);

module.exports = db;