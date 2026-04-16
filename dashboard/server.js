const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const multer = require("multer");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");

const db = require("../database");

const app = express();

/*
ROLE IDS (Flame Force)
*/
const OWNER_ROLE = "1465436891238367284";
const ADMIN_ROLE = "1493636042354331779";
const MEMBER_ROLE = "1458157807361720426";

/*
CREATOR ROLES (dropdown list)
*/
const CREATOR_ROLES = [
  OWNER_ROLE,
  ADMIN_ROLE,
  MEMBER_ROLE
];

/*
UPLOAD CONFIG
*/
const upload = multer({
  dest: path.join(process.cwd(), "dashboard/public/posters/tmp")
});

/*
AUTO RESIZE POSTER
*/
async function processPoster(file) {

  if (!file) return null;

  const postersDir = path.join(
    process.cwd(),
    "dashboard/public/posters"
  );

  if (!fs.existsSync(postersDir)) {
    fs.mkdirSync(postersDir, { recursive: true });
  }

  const filename =
    Date.now() + "-" +
    file.originalname.replace(/\s+/g, "_");

  const outputPath =
    path.join(postersDir, filename);

  await sharp(file.path)
    .resize(1080, 1080, { fit: "cover" })
    .jpeg({ quality: 90 })
    .toFile(outputPath);

  fs.unlinkSync(file.path);

  return `/posters/${filename}`;
}

/*
EXPRESS CONFIG
*/
app.set("view engine", "ejs");

app.set(
  "views",
  path.join(process.cwd(), "dashboard/views")
);

app.use(
  express.static(
    path.join(process.cwd(), "dashboard/public")
  )
);

app.use(express.urlencoded({ extended: true }));

/*
SESSION CONFIG
*/
app.set("trust proxy", 1);

app.use(
  session({
    secret: "flame-force-secret",
    resave: false,
    saveUninitialized: false
  })
);

app.use(passport.initialize());
app.use(passport.session());

/*
DISCORD LOGIN
*/
passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      callbackURL: process.env.CALLBACK_URL,
      scope: ["identify"]
    },
    (accessToken, refreshToken, profile, done) =>
      done(null, profile)
  )
);

passport.serializeUser((u, d) => d(null, u));
passport.deserializeUser((o, d) => d(null, o));

/*
ROLE LOOKUP (ROBUST VERSION)
*/
async function getUserRoleLevel(req) {

  try {

    const response = await axios.get(
      `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${req.user.id}`,
      {
        headers: {
          Authorization: `Bot ${process.env.TOKEN.trim()}`
        }
      }
    );

    const roles = response.data.roles || [];

    console.log("User:", req.user.id);
    console.log("Roles detected:", roles);

    if (roles.includes(OWNER_ROLE))
      return "owner";

    if (roles.includes(ADMIN_ROLE))
      return "admin";

    if (roles.includes(MEMBER_ROLE))
      return "member";

    return "none";

  } catch (err) {

    console.log(
      "Role lookup error:",
      err.response?.data || err.message
    );

    return "none";

  }

}

/*
AUTH CHECK
*/
async function checkAuth(req, res, next) {

  if (!req.isAuthenticated())
    return res.redirect("/");

  req.roleLevel =
    await getUserRoleLevel(req);

  if (req.roleLevel === "none")
    return res.send("Access denied");

  next();

}

/*
FETCH CREATOR LIST
*/
async function getAgencyMembers() {

  try {

    const response = await axios.get(
      `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members?limit=1000`,
      {
        headers: {
          Authorization: `Bot ${process.env.TOKEN}`
        }
      }
    );

    return response.data
      .filter(member =>
        member.roles.some(role =>
          CREATOR_ROLES.includes(role)
        )
      )
      .map(member => ({
        id: member.user.id,
        name: member.nick || member.user.username
      }));

  } catch (err) {

    console.log(
      "Creator fetch failed:",
      err.message
    );

    return [];

  }

}

/*
LOGIN ROUTES
*/
app.get("/", (req, res) =>
  res.render("login")
);

app.get(
  "/login",
  passport.authenticate("discord")
);

app.get(
  "/auth/callback",
  passport.authenticate("discord", {
    failureRedirect: "/"
  }),
  (req, res) =>
    res.redirect("/dashboard")
);

app.get("/logout", (req, res) =>
  req.logout(() =>
    res.redirect("/")
  )
);

/*
ROLE DEBUG ROUTE
*/
app.get("/debug-roles", async (req, res) => {

  if (!req.isAuthenticated())
    return res.send("Not logged in");

  try {

    const response = await axios.get(
      `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${req.user.id}`,
      {
        headers: {
          Authorization: `Bot ${process.env.TOKEN}`
        }
      }
    );

    res.json(response.data.roles);

  } catch (err) {

    res.json({
      error:
        err.response?.data ||
        err.message
    });

  }

});

/*
DASHBOARD
*/
app.get(
  "/dashboard",
  checkAuth,
  async (req, res) => {

    try {

      const result =
        await db.query(
          "SELECT * FROM battles ORDER BY date, time"
        );

      const agencyMembers =
        await getAgencyMembers();

      res.render("dashboard", {
        battles: result.rows,
        roleLevel: req.roleLevel,
        agencyMembers
      });

    } catch (err) {

      console.log(
        "Dashboard error:",
        err.message
      );

      res.render("dashboard", {
        battles: [],
        roleLevel: req.roleLevel,
        agencyMembers: []
      });

    }

  }
);

/*
CREATE BATTLE
*/
app.post(
  "/create",
  checkAuth,
  upload.single("poster"),
  async (req, res) => {

    if (!["owner", "admin"]
      .includes(req.roleLevel))
      return res.send("Permission denied");

    const {
      host,
      opponent,
      date,
      time,
      liveLink
    } = req.body;

    const poster =
      await processPoster(req.file);

    await db.query(
      `INSERT INTO battles
      (host, opponent, date, time, poster, liveLink)
      VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        host,
        opponent,
        date,
        time,
        poster,
        liveLink
      ]
    );

    /*
    POST TO DISCORD
    */
    try {

      const form =
        new FormData();

      const message =
        `🔥 **Flame Force Battle Scheduled!** 🔥\n\n` +
        `⚔ <@${host}> vs <@${opponent}>\n` +
        `📅 ${date} ⏰ ${time}\n\n` +
        (liveLink ? `🔗 ${liveLink}` : "");

      form.append("content", message);

      if (poster) {

        const posterPath =
          path.join(
            process.cwd(),
            "dashboard/public",
            poster
          );

        form.append(
          "file",
          fs.createReadStream(posterPath)
        );

      }

      await axios.post(
        `https://discord.com/api/v10/channels/${process.env.BATTLE_CHANNEL_ID}/messages`,
        form,
        {
          headers: {
            Authorization:
              `Bot ${process.env.TOKEN}`,
            ...form.getHeaders()
          }
        }
      );

      console.log(
        "📢 Posted to Discord"
      );

    } catch (err) {

      console.log(
        "Discord post failed:",
        err.message
      );

    }

    res.redirect("/dashboard");

  }
);

/*
DELETE BATTLE
*/
app.post(
  "/delete/:id",
  checkAuth,
  async (req, res) => {

    if (!["owner", "admin"]
      .includes(req.roleLevel))
      return res.send("Permission denied");

    await db.query(
      "DELETE FROM battles WHERE id=$1",
      [req.params.id]
    );

    res.redirect("/dashboard");

  }
);

/*
CALENDAR
*/
app.get(
  "/calendar",
  async (req, res) => {

    const result =
      await db.query(
        "SELECT * FROM battles ORDER BY date, time"
      );

    res.render("calendar", {
      battles: result.rows
    });

  }
);

/*
START SERVER
*/
const PORT =
  process.env.PORT || 8080;

app.listen(PORT, () =>
  console.log(
    `🔥 Flame Force dashboard running on ${PORT}`
  )
);