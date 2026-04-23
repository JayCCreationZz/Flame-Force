require("dotenv").config();

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const path = require("path");
const multer = require("multer");
const fetch = require("node-fetch");

const { pool } = require("../database");

const app = express();

/*
========================================
CONFIG
========================================
*/

const ADMIN_ROLE_IDS = [
  process.env.ADMIN_ROLE_ID,
  process.env.OWNER_ROLE_ID
];

const REQUEST_WEBHOOK = process.env.REQUEST_WEBHOOK_URL;

/*
========================================
MIDDLEWARE
========================================
*/

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "flameforce-secret",
    resave: false,
    saveUninitialized: false
  })
);

app.use(passport.initialize());
app.use(passport.session());

/*
========================================
DISCORD AUTH
========================================
*/

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      callbackURL: process.env.CALLBACK_URL,
      scope: ["identify", "guilds", "guilds.members.read"]
    },
    (accessToken, refreshToken, profile, done) => {
      process.nextTick(() => done(null, profile));
    }
  )
);

/*
========================================
FILE UPLOAD
========================================
*/

const storage = multer.diskStorage({
  destination: "./dashboard/public/posters",
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

/*
========================================
AUTH HELPERS
========================================
*/

function checkAuth(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }
  next();
}

function isAdmin(req) {
  if (!req.user || !req.user.guilds) return false;

  return req.user.guilds.some(g =>
    ADMIN_ROLE_IDS.includes(g.id)
  );
}

/*
========================================
LOGIN ROUTES
========================================
*/

app.get("/login", passport.authenticate("discord"));

app.get(
  "/callback",
  passport.authenticate("discord", {
    failureRedirect: "/"
  }),
  (req, res) => {
    res.redirect("/");
  }
);

app.get("/logout", (req, res) => {
  req.logout(() => {
    res.redirect("/");
  });
});

/*
========================================
HOME / DASHBOARD
========================================
*/

app.get("/", checkAuth, async (req, res) => {
  const battles = await pool.query(
    "SELECT * FROM battles ORDER BY date ASC"
  );

  res.render("dashboard", {
    user: req.user,
    battles: battles.rows,
    isAdmin: isAdmin(req)
  });
});

/*
========================================
CALENDAR VIEW (ALL MEMBERS)
========================================
*/

app.get("/calendar", checkAuth, async (req, res) => {
  const battles = await pool.query(
    "SELECT * FROM battles ORDER BY date ASC"
  );

  res.render("calendar", {
    battles: battles.rows,
    isAdmin: isAdmin(req)
  });
});

/*
========================================
CREATE BATTLE (ADMINS ONLY)
========================================
*/

app.post(
  "/create-battle",
  checkAuth,
  upload.single("poster"),
  async (req, res) => {
    if (!isAdmin(req)) return res.redirect("/");

    const { title, host, opponent, date, time } = req.body;

    const poster = req.file
      ? "/posters/" + req.file.filename
      : null;

    await pool.query(
      `
      INSERT INTO battles
      (title, host, opponent, date, time, poster)
      VALUES ($1,$2,$3,$4,$5,$6)
    `,
      [title, host, opponent, date, time, poster]
    );

    res.redirect("/");
  }
);

/*
========================================
REQUEST PAGE
========================================
*/

app.get("/request", (req, res) => {
  res.render("request", { success: false });
});

/*
========================================
SUBMIT REQUEST
========================================
*/

app.post("/request", async (req, res) => {
  const {
    agency,
    requester,
    opponent,
    preferred_date,
    preferred_time,
    notes
  } = req.body;

  await pool.query(
    `
    INSERT INTO battle_requests
    (agency, requester, opponent,
     preferred_date, preferred_time, notes)
    VALUES ($1,$2,$3,$4,$5,$6)
  `,
    [
      agency,
      requester,
      opponent,
      preferred_date,
      preferred_time,
      notes
    ]
  );

  /*
  SEND TO DISCORD REQUEST CHANNEL
  */

  if (REQUEST_WEBHOOK) {
    await fetch(REQUEST_WEBHOOK, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        embeds: [
          {
            title: "🔥 New Battle Request",
            color: 16753920,
            fields: [
              {
                name: "Agency",
                value: agency
              },
              {
                name: "Requester",
                value: requester
              },
              {
                name: "Opponent",
                value: opponent
              },
              {
                name: "Preferred Date",
                value: preferred_date
              },
              {
                name: "Preferred Time",
                value: preferred_time
              },
              {
                name: "Notes",
                value: notes || "None"
              }
            ]
          }
        ]
      })
    });
  }

  res.render("request", { success: true });
});

/*
========================================
DATABASE TABLE AUTO-CREATION
========================================
*/

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS battles (
      id SERIAL PRIMARY KEY,
      title TEXT,
      host TEXT,
      opponent TEXT,
      date DATE,
      time TEXT,
      poster TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS battle_requests (
      id SERIAL PRIMARY KEY,
      agency TEXT,
      requester TEXT,
      opponent TEXT,
      preferred_date TEXT,
      preferred_time TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending'
    )
  `);

  console.log("✅ PostgreSQL connected & schema synced successfully");
})();

/*
========================================
START SERVER
========================================
*/

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🔥 Dashboard running");
});