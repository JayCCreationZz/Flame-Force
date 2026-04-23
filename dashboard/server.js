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
   AUTO‑CREATE agency_members TABLE
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
    })
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
   DISCORD AVATAR HELPER
============================ */

async function getDiscordAvatarUrl(userId) {
  if (!oauthEnabled) return null;

  try {
    const res = await fetch(
      `https://discord.com/api/v10/users/${userId}`,
      { headers: { Authorization: `Bot ${process.env.TOKEN}` } }
    );

    if (!res.ok) return null;
    const user = await res.json();

    if (!user.avatar) {
      return `https://cdn.discordapp.com/embed/avatars/${Number(user.discriminator) % 5}.png`;
    }

    const ext = user.avatar.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
  } catch {
    return null;
  }
}

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
   SEARCH / FILTER HELPERS
============================ */

function buildBattleFilter(query) {
  const where = [];
  const params = [];
  let idx = 1;

  if (query.q) {
    where.push(`(LOWER(hostname) LIKE $${idx} OR LOWER(opponent) LIKE $${idx})`);
    params.push(`%${query.q.toLowerCase()}%`);
    idx++;
  }

  if (query.host) {
    where.push(`host = $${idx}`);
    params.push(query.host);
    idx++;
  }

  if (query.opponent) {
    where.push(`LOWER(opponent) LIKE $${idx}`);
    params.push(`%${query.opponent.toLowerCase()}%`);
    idx++;
  }

  if (query.adultonly === "true") {
    where.push(`adultonly = true`);
  }

  if (query.powerups === "true") {
    where.push(`powerups = true`);
  }

  if (query.managergifting === "true") {
    where.push(`managergifting = true`);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return { whereClause, params };
}

/* ============================
   DASHBOARD
============================ */

app.get("/", async (req, res) => {
  try {
    const { whereClause, params } = buildBattleFilter(req.query);

    const battlesResult = await db.query(
      `SELECT * FROM battles ${whereClause} ORDER BY date ASC, time ASC`,
      params
    );

    const battles = battlesResult.rows;

    // Fetch avatars for distinct hosts
    const hostIds = [...new Set(battles.map(b => b.host).filter(Boolean))];
    const avatarMap = {};

    await Promise.all(
      hostIds.map(async (id) => {
        avatarMap[id] = await getDiscordAvatarUrl(id);
      })
    );

    const battlesWithAvatars = battles.map(b => ({
      ...b,
      avatarUrl: avatarMap[b.host] || null
    }));

    const agencyMembers = await db.query(`
      SELECT id, username
      FROM agency_members
      ORDER BY username ASC
    `);

    res.render("dashboard", {
      battles: battlesWithAvatars,
      agencyMembers: agencyMembers.rows,
      user: req.user || null,
      roleLevel: req.roleLevel || "guest",
      filters: req.query || {}
    });

  } catch (err) {
    console.error("❌ Dashboard load error:", err);

    res.render("dashboard", {
      battles: [],
      agencyMembers: [],
      user: req.user || null,
      roleLevel: req.roleLevel || "guest",
      filters: req.query || {}
    });
  }
});

/* ============================
   CALENDAR (WITH STATUS HELPERS)
============================ */

function computeBattleStatus(battle) {
  try {
    const dateStr = battle.date;
    const timeStr = battle.time || "00:00";

    const [year, month, day] = dateStr.split("-").map(Number);
    const [hour, minute] = timeStr.split(":").map(Number);

    const battleDate = new Date(year, month - 1, day, hour, minute);
    const now = new Date();

    if (now > battleDate) return "past";

    const diffMs = battleDate - now;
    const diffMinutes = diffMs / (1000 * 60);

    if (diffMinutes <= 0) return "live";
    if (diffMinutes <= 60) return "soon";

    return "upcoming";
  } catch {
    return "upcoming";
  }
}

app.get("/calendar", async (req, res) => {
  const { whereClause, params } = buildBattleFilter(req.query);

  const battlesResult = await db.query(
    `SELECT * FROM battles ${whereClause} ORDER BY date ASC, time ASC`,
    params
  );

  const battles = battlesResult.rows.map(b => ({
    ...b,
    status: computeBattleStatus(b)
  }));

  res.render("calendar", {
    battles,
    user: req.user || null,
    roleLevel: req.roleLevel || "guest",
    filters: req.query || {}
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
   EDIT BATTLE
============================ */

app.post("/battle/:id/edit", upload.single("poster"), async (req, res) => {
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

  const fields = [
    "host = $1",
    "hostName = $2",
    "opponent = $3",
    "date = $4",
    "time = $5",
    "livelink = $6",
    "managergifting = $7",
    "adultonly = $8",
    "powerups = $9",
    "nohammers = $10"
  ];

  const params = [
    host,
    hostName,
    opponent,
    date,
    time,
    liveLink || null,
    managergifting === "on",
    adultonly === "on",
    powerups === "on",
    nohammers === "on"
  ];

  if (req.file) {
    fields.push("posterdata = $11");
    params.push(req.file.buffer);
  }

  params.push(req.params.id);

  await db.query(
    `UPDATE battles SET ${fields.join(", ")} WHERE id = $${params.length}`,
    params
  );

  res.redirect("/");
});

/* ============================
   DELETE BATTLE
============================ */

app.post("/battle/:id/delete", async (req, res) => {
  if (!["admin", "owner"].includes(req.roleLevel)) return res.redirect("/");

  await db.query("DELETE FROM battles WHERE id = $1", [req.params.id]);
  res.redirect("/");
});

/* ============================
   ADMIN TOOLS: AGENCY MEMBERS
============================ */

app.get("/admin/members", async (req, res) => {
  if (!["admin", "owner"].includes(req.roleLevel)) return res.redirect("/");

  const members = await db.query(
    "SELECT id, username FROM agency_members ORDER BY username ASC"
  );

  res.render("admin_members", {
    members: members.rows,
    user: req.user || null,
    roleLevel: req.roleLevel || "guest"
  });
});

app.post("/admin/members/add", async (req, res) => {
  if (!["admin", "owner"].includes(req.roleLevel)) return res.redirect("/");

  const { id, username } = req.body;

  await db.query(
    `
    INSERT INTO agency_members (id, username)
    VALUES ($1, $2)
    ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username
    `,
    [id, username]
  );

  res.redirect("/admin/members");
});

app.post("/admin/members/remove", async (req, res) => {
  if (!["admin", "owner"].includes(req.roleLevel)) return res.redirect("/");

  const { id } = req.body;
  await db.query("DELETE FROM agency_members WHERE id = $1", [id]);

  res.redirect("/admin/members");
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
