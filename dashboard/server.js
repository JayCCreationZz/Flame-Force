const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const db = require("../database");

require("dotenv").config();

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "flame_force_dev_secret",
    resave: false,
    saveUninitialized: false
  })
);

app.use(passport.initialize());
app.use(passport.session());

/*
============================
OAUTH SAFE MODE CHECK
============================
*/

const oauthEnabled =
  process.env.DISCORD_CLIENT_ID &&
  process.env.DISCORD_CLIENT_SECRET &&
  process.env.DISCORD_CALLBACK_URL &&
  process.env.GUILD_ID &&
  process.env.ADMIN_ROLE_ID &&
  process.env.OWNER_ROLE_ID;

if (oauthEnabled) {
  console.log("✅ Discord OAuth enabled");

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((obj, done) => done(null, obj));

  passport.use(
    new DiscordStrategy(
      {
        clientID: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        callbackURL: process.env.DISCORD_CALLBACK_URL,
        scope: ["identify", "guilds", "guilds.members.read"]
      },
      (accessToken, refreshToken, profile, done) => {
        return done(null, profile);
      }
    )
  );

  app.get(
    "/login",
    passport.authenticate("discord")
  );

  app.get(
    "/auth/discord/callback",
    passport.authenticate("discord", {
      failureRedirect: "/"
    }),
    (req, res) => res.redirect("/")
  );

  app.get("/logout", (req, res) => {
    req.logout(() => res.redirect("/"));
  });

} else {
  console.log("⚠️ Discord OAuth disabled (missing env variables)");

  app.get("/login", (_, res) =>
    res.send("OAuth not configured.")
  );

  app.get("/logout", (_, res) =>
    res.redirect("/")
  );
}

/*
============================
ROLE DETECTION
============================
*/

function getRoleLevel(req) {
  if (!oauthEnabled || !req.user) return "guest";

  const guild = req.user.guilds?.find(
    g => g.id === process.env.GUILD_ID
  );

  if (!guild) return "guest";

  const roles = guild.roles || [];

  if (roles.includes(process.env.OWNER_ROLE_ID)) return "owner";
  if (roles.includes(process.env.ADMIN_ROLE_ID)) return "admin";

  return "member";
}

/*
============================
FILE UPLOAD STORAGE
============================
*/

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }
});

/*
============================
POSTER ROUTE
============================
*/

app.get("/poster/:id", async (req, res) => {
  const result = await db.query(
    "SELECT posterdata FROM battles WHERE id=$1",
    [req.params.id]
  );

  if (!result.rows.length || !result.rows[0].posterdata)
    return res.sendStatus(404);

  res.contentType("image/png");
  res.send(result.rows[0].posterdata);
});

/*
============================
DASHBOARD
============================
*/

app.get("/", async (req, res) => {

  const battles = await db.query(`
    SELECT *,
    host AS hostname
    FROM battles
    ORDER BY date ASC
  `);

  res.render("dashboard", {
    battles: battles.rows,
    user: req.user || null,
    roleLevel: getRoleLevel(req)
  });
});

/*
============================
CALENDAR VIEW
============================
*/

app.get("/calendar", async (req, res) => {

  const battles = await db.query(`
    SELECT *,
    host AS hostname
    FROM battles
    ORDER BY date ASC
  `);

  res.render("calendar", {
    battles: battles.rows,
    user: req.user || null,
    roleLevel: getRoleLevel(req)
  });
});

/*
============================
CREATE BATTLE (ADMIN ONLY)
============================
*/

app.post(
  "/create-battle",
  upload.single("poster"),
  async (req, res) => {

    const role = getRoleLevel(req);

    if (role !== "admin" && role !== "owner")
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

    await db.query(
      `
      INSERT INTO battles
      (host, opponent, date, time,
       managergifting, adultonly,
       powerups, nohammers,
       posterdata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        host,
        opponent,
        date,
        time,
        managergifting === "on",
        adultonly === "on",
        powerups === "on",
        nohammers === "on",
        req.file ? req.file.buffer : null
      ]
    );

    res.redirect("/");
  }
);

/*
============================
REQUEST PAGE
============================
*/

app.get("/request", (_, res) => {
  res.render("request");
});

/*
============================
SERVER START
============================
*/

const PORT = process.env.PORT || 3000;

app.listen(PORT, () =>
  console.log(`🔥 Dashboard running on port ${PORT}`)
);