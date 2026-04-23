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
Poster image route
*/
app.get("/poster/:id", async (req, res) => {

  try {

    const result = await pool.query(
      "SELECT posterdata FROM battles WHERE id=$1",
      [req.params.id]
    );

    if (!result.rows.length || !result.rows[0].posterdata)
      return res.status(404).send("Poster not found");

    res.set("Content-Type", "image/jpeg");
    res.send(result.rows[0].posterdata);

  } catch (err) {

    console.error(err);
    res.status(500).send("Poster error");

  }

});

/*
Dashboard
*/
app.get("/", async (req, res) => {

  const battles = await pool.query(
    "SELECT * FROM battles ORDER BY date ASC, time ASC"
  );

  res.render("dashboard", {
    battles: battles.rows,
    roleLevel: req.session?.roleLevel || "member",
    success: null
  });

});

/*
Calendar
*/
app.get("/calendar", async (req, res) => {

  const battles = await pool.query(
    "SELECT * FROM battles ORDER BY date ASC, time ASC"
  );

  res.render("calendar", {
    battles: battles.rows,
    roleLevel: req.session?.roleLevel || "member"
  });

});

/*
Create battle
*/
app.post("/create-battle", upload.single("poster"), async (req, res) => {

  const roleLevel =
    req.session?.roleLevel || "member";

  if (!["admin", "owner"].includes(roleLevel))
    return res.redirect("/");

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

  const poster =
    req.file ? req.file.buffer : null;

  await pool.query(
    `
    INSERT INTO battles
    (host, hostname, opponent, date, time, posterdata,
     managergifting, adultonly, powerups, nohammers)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
    [
      host,
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

});

/*
Request form
*/
app.get("/request", (req, res) => {

  res.render("request", {
    success: false
  });

});

/*
Submit request
*/
app.post("/submit-request", async (req, res) => {

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

  if (process.env.REQUEST_WEBHOOK_URL) {

    await axios.post(
      process.env.REQUEST_WEBHOOK_URL,
      {
        embeds: [{
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
        }]
      }
    );

  }

  res.render("request", {
    success: true
  });

});

app.listen(process.env.PORT || 3000, () => {
  console.log("🔥 Dashboard running");
});