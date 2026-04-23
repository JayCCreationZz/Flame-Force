require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");
const multer = require("multer");
const axios = require("axios");

const pool = require("../database");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: "flame-force-secret",
  resave: false,
  saveUninitialized: false
}));

const upload = multer({ storage: multer.memoryStorage() });

/*
Ensure request table exists at runtime
(prevents Railway crash loops)
*/
(async () => {
  try {

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

    console.log("✅ battle_requests table ready");

  } catch (err) {

    console.error("❌ request table init failed:", err);

  }
})();

/*
Dashboard Home
*/
app.get("/", async (req, res) => {

  const battles = await pool.query(
    "SELECT * FROM battles ORDER BY date ASC, time ASC"
  );

  res.render("dashboard", {
    battles: battles.rows,
    success: null
  });

});

/*
Calendar View (visible to all members)
*/
app.get("/calendar", async (req, res) => {

  const battles = await pool.query(
    "SELECT * FROM battles ORDER BY date ASC, time ASC"
  );

  res.render("calendar", {
    battles: battles.rows
  });

});

/*
Create Battle
(Admin / Owner)
*/
app.post("/create-battle", upload.single("poster"), async (req, res) => {

  try {

    const {
      host,
      opponent,
      date,
      time,
      managergifting,
      adultonly,
      powerups,
      nohammers
    } = req.body;

    const poster = req.file ? req.file.buffer : null;

    await pool.query(
      `
      INSERT INTO battles
      (host, opponent, date, time, posterdata,
       managergifting, adultonly, powerups, nohammers)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        host,
        opponent,
        date,
        time,
        poster,
        managergifting === "on",
        adultonly === "on",
        powerups === "on",
        nohammers === "on"
      ]
    );

    res.redirect("/");

  } catch (err) {

    console.error(err);
    res.redirect("/");

  }

});

/*
Battle Request Form Page
*/
app.get("/request", (req, res) => {

  res.render("request", {
    success: false
  });

});

/*
Submit Battle Request
*/
app.post("/submit-request", async (req, res) => {

  try {

    const {
      requester,
      agency,
      opponent,
      preferred_date,
      preferred_time,
      notes
    } = req.body;

    await pool.query(
      `
      INSERT INTO battle_requests
      (requester, agency, opponent,
       preferred_date, preferred_time, notes)
      VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [
        requester,
        agency,
        opponent,
        preferred_date,
        preferred_time,
        notes
      ]
    );

    /*
    Optional webhook alert
    */

    if (process.env.REQUEST_WEBHOOK_URL) {

      await axios.post(process.env.REQUEST_WEBHOOK_URL, {

        embeds: [
          {
            title: "🔥 New Battle Request",
            fields: [
              { name: "Requester", value: requester },
              { name: "Agency", value: agency },
              { name: "Opponent", value: opponent },
              { name: "Preferred Date", value: preferred_date },
              { name: "Preferred Time", value: preferred_time },
              { name: "Notes", value: notes || "None" }
            ],
            color: 16753920
          }
        ]

      });

    }

    res.render("request", {
      success: true
    });

  } catch (err) {

    console.error(err);

    res.render("request", {
      success: false
    });

  }

});

app.listen(process.env.PORT || 3000, () => {
  console.log("🔥 Dashboard running");
});