const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const path = require("path");
const multer = require("multer");
const db = require("../database");
const fetch = require("node-fetch");

require("dotenv").config();

const app = express();

/* ============================
   BASIC APP SETUP
============================ */

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "flame_force_dev_secret",
    resave: false,
    saveUninitialized: false
  })
);

app.use(passport.initialize());
app.use(passport.session());

/* ============================
   OAUTH ENABLE CHECK
============================ */

const oauthEnabled =
  process.env.DISCORD_CLIENT_ID &&
  process.env.DISCORD_CLIENT_SECRET &&
  process.env.DISCORD_CALLBACK_URL &&
  process.env.GUILD_ID &&
  process.env.ADMIN_ROLE_ID &&
  process.env.OWNER_ROLE_ID &&
  process.env.TOKEN;

if (oauthEnabled) {
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
        profile._accessToken = accessToken;
        return done(null, profile);
      }
    )
  );

  app.get("/login", passport.authenticate("discord"));

  app.get(
    "/auth/discord/callback",
    passport.authenticate("discord", { failureRedirect: "/" }),
    (req, res) => res.redirect("/")
  );

  app.get("/logout", (req, res) => {
    req.logout(() => res.redirect("/"));
  });
} else {
  app.get("/login", (_, res) => res.send("OAuth not configured."));
  app.get("/logout", (_, res) => res.redirect("/"));
}

/* ============================
   ROLE DETECTION
============================ */

async function fetchMemberRoles(userId) {
  const url = `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${userId}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bot ${process.env.TOKEN}` }
  });

  if (!res.ok) return null;

  const data = await res.json();
  return data.roles || [];
}

async function resolveRoleLevel(req) {
  if (!oauthEnabled || !req.user) return "guest";

  try {
    const roles = await fetchMemberRoles(req.user.id);
    if (!roles) return "guest";

    if (roles.includes(process.env.OWNER_ROLE_ID)) return "owner";
    if (roles.includes(process.env.ADMIN_ROLE_ID)) return "admin";
    return "member";
  } catch {
    return "guest";
  }
}

app.use(async (req, _res, next) => {
  req.roleLevel = await resolveRoleLevel(req);
  next();
});

/* ============================
   FILE UPLOAD
============================ */

const upload = multer({ storage: multer.memoryStorage() });

/* ============================
   POSTER ROUTE
============================ */

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

/* ============================
   DASHBOARD
============================ */

app.get("/", async (req, res) => {
  const battles = await db.query(
    `SELECT * FROM battles ORDER BY date ASC, time ASC`
  );

  const agencyMembers = await db.query(`
    SELECT id, username
    FROM agency_members
    ORDER BY username ASC
  `);

  res.render("dashboard", {
    battles: battles.rows,
    agencyMembers: agencyMembers.rows,
    user: req.user || null,
    roleLevel: req.roleLevel || "guest"
  });
});

/* ============================
   CALENDAR
============================ */

app.get("/calendar", async (req, res) => {
  const battles = await db.query(
    `SELECT * FROM battles ORDER BY date ASC, time ASC`
  );

  res.render("calendar", {
    battles: battles.rows,
    user: req.user || null,
    roleLevel: req.roleLevel || "guest"
  });
});

/* ============================
   CREATE BATTLE
============================ */

app.post("/create-battle", upload.single("poster"), async (req, res) => {
  if (!["admin", "owner"].includes(req.roleLevel)) return res.redirect("/");

  const {
    host,
    hostName,
    opponent,
    date,
    time,
    liveLink,
    managergifting,
    adultonly,
    powerups,
    nohammers
  } = req.body;

  await db.query(
    `
    INSERT INTO battles
    (host, hostName, opponent, date, time,
     livelink, managergifting, adultonly,
     powerups, nohammers, posterdata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `,
    [
      host,
      hostName,
      opponent,
      date,
      time,
      liveLink || null,
      managergifting === "on",
      adultonly === "on",
      powerups === "on",
      nohammers === "on",
      req.file ? req.file.buffer : null
    ]
  );

  res.redirect("/");
});

/* ============================
   REQUEST PAGE
============================ */

app.get("/request", (req, res) => {
  res.render("request", {
    user: req.user || null,
    roleLevel: req.roleLevel || "guest",
    success: false
  });
});

app.post("/request", async (req, res) => {
  res.render("request", {
    user: req.user || null,
    roleLevel: req.roleLevel || "guest",
    success: true
  });
});

/* ============================
   START SERVER
============================ */

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🔥 Dashboard running on port ${PORT}`));
