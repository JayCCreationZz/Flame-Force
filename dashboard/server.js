require("dotenv").config();

const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const path = require("path");
const multer = require("multer");
const db = require("../database");
const fetch = require("node-fetch");

const app = express();

/* ============================
   BASIC APP SETUP
============================ */

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.set("trust proxy", 1);

/* ============================
   SESSION CONFIG (PRODUCTION SAFE)
============================ */

app.use(
  session({
    store: new pgSession({
      pool: db,
      tableName: "session",
      pruneSessionInterval: 60 * 15
    }),
    secret: process.env.SESSION_SECRET || "flame_force_dev_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax"
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

/* ============================
   AUTO-CREATE agency_members TABLE
============================ */

async function ensureAgencyMembersTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS agency_members (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL
      );
    `);

    console.log("✅ agency_members table ready");
  } catch (err) {
    console.error("❌ Failed to ensure agency_members table:", err);
  }
}

ensureAgencyMembersTable();

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
   MEMBER SYNC HELPERS
============================ */

function resolveDisplayName(member) {
  if (member.nick) return member.nick;
  if (member.user?.global_name) return member.user.global_name;
  if (member.user?.username) return member.user.username;
  return "Unknown";
}

async function fetchGuildMembersFromDiscord() {
  if (!oauthEnabled) return [];

  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members?limit=1000`,
      { headers: { Authorization: `Bot ${process.env.TOKEN}` } }
    );

    if (!res.ok) return [];

    return await res.json();
  } catch {
    return [];
  }
}

async function syncGuildMembers() {
  const members = await fetchGuildMembersFromDiscord();

  if (!members.length) return [];

  const mapped = members.map((m) => ({
    id: m.user.id,
    username: resolveDisplayName(m)
  }));

  try {
    const values = mapped
      .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
      .join(", ");

    const params = mapped.flatMap((m) => [m.id, m.username]);

    if (params.length) {
      await db.query(
        `
        INSERT INTO agency_members (id, username)
        VALUES ${values}
        ON CONFLICT (id)
        DO UPDATE SET username = EXCLUDED.username
        `,
        params
      );
    }
  } catch (err) {
    console.error("❌ Failed syncing agency_members:", err);
  }

  return mapped;
}

/* ============================
   DASHBOARD
============================ */

app.get("/", async (req, res) => {
  try {
    await syncGuildMembers();

    const battlesResult = await db.query(
      "SELECT * FROM battles ORDER BY date ASC, time ASC"
    );

    const agencyMembersResult = await db.query(
      "SELECT id, username FROM agency_members ORDER BY username ASC"
    );

    res.render("dashboard", {
      battles: battlesResult.rows,
      agencyMembers: agencyMembersResult.rows,
      user: req.user || null,
      roleLevel: req.roleLevel || "guest"
    });
  } catch (err) {
    console.error("❌ Dashboard load error:", err);

    res.render("dashboard", {
      battles: [],
      agencyMembers: [],
      user: req.user || null,
      roleLevel: req.roleLevel || "guest"
    });
  }
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
    (host, hostname, opponent, date, time,
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
   DELETE BATTLE
============================ */

app.post("/battle/:id/delete", async (req, res) => {
  if (!["admin", "owner"].includes(req.roleLevel)) return res.redirect("/");

  await db.query("DELETE FROM battles WHERE id=$1", [req.params.id]);

  res.redirect("/");
});

/* ============================
   START SERVER
============================ */

const PORT = process.env.PORT || 8080;

app.listen(PORT, () =>
  console.log(`🔥 Dashboard running on port ${PORT}`)
);