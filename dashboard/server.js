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
ROLE CONFIG
Replace with your real role IDs
*/
const config = {
  ownerRoles: ["1439255505053683804"],
  adminRoles: ["1471132938467803322"],
  memberRoles: ["1439256282409209926", "1439256200658157588"]
};

/*
UPLOAD STORAGE
*/
const upload = multer({
  dest: path.join(process.cwd(), "dashboard/public/posters/tmp")
});

/*
POSTER RESIZE
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
    Date.now() + "-" + file.originalname.replace(/\s+/g, "_");

  const outputPath = path.join(postersDir, filename);

  await sharp(file.path)
    .resize(1080, 1080, { fit: "cover" })
    .jpeg({ quality: 90 })
    .toFile(outputPath);

  fs.unlinkSync(file.path);

  return `/posters/${filename}`;
}

/*
VIEW ENGINE
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
SESSION
*/
app.set("trust proxy", 1);

app.use(
  session({
    secret: "flame-force-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      sameSite: "none"
    }
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
SAFE ROLE LOOKUP
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

    const roles = response.data.roles;

    if (roles.some(r => config.ownerRoles.includes(r)))
      return "owner";

    if (roles.some(r => config.adminRoles.includes(r)))
      return "admin";

    if (roles.some(r => config.memberRoles.includes(r)))
      return "member";

    return "none";

  } catch (err) {
    console.log("Role lookup failed:", err.message);
    return "none";
  }
}

/*
LOAD AGENCY MEMBERS FROM DISCORD
*/
async function getAgencyMembers() {

  try {

    const response = await axios.get(
      `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members?limit=1000`,
      {
        headers: {
          Authorization: `Bot ${process.env.TOKEN.trim()}`
        }
      }
    );

    const agencyRoleIDs = [
      ...config.ownerRoles,
      ...config.adminRoles,
      ...config.memberRoles
    ];

    return response.data
      .filter(member =>
        member.roles.some(role =>
          agencyRoleIDs.includes(role)
        )
      )
      .map(member => ({
        id: member.user.id,
        name:
          member.nick ||
          member.user.global_name ||
          member.user.username
      }));

  } catch (err) {

    console.log(
      "Failed loading agency members:",
      err.message
    );

    return [];

  }
}

/*
AUTH CHECK
*/
async function checkAuth(req, res, next) {

  if (!req.isAuthenticated())
    return res.redirect("/");

  req.roleLevel = await getUserRoleLevel(req);

  if (req.roleLevel === "none")
    return res.send("Access denied");

  next();

}

/*
LOGIN ROUTES
*/
app.get("/", (req, res) => res.render("login"));

app.get("/login", passport.authenticate("discord"));

app.get(
  "/auth/callback",
  passport.authenticate("discord", {
    failureRedirect: "/"
  }),
  (req, res) => res.redirect("/dashboard")
);

app.get("/logout", (req, res) =>
  req.logout(() => res.redirect("/"))
);

/*
DASHBOARD
*/
app.get("/dashboard", checkAuth, async (req, res) => {

  const agencyMembers = await getAgencyMembers();

  db.all(
    "SELECT * FROM battles ORDER BY date, time",
    [],
    (err, battles) => {

      if (err) return res.send("Database error");

      res.render("dashboard", {
        battles,
        agencyMembers,
        roleLevel: req.roleLevel
      });

    }
  );

});

/*
CREATE BATTLE + POST TO DISCORD
*/
app.post(
  "/create",
  checkAuth,
  upload.single("poster"),
  async (req, res) => {

    if (!["owner", "admin"].includes(req.roleLevel))
      return res.send("Permission denied");

    const { host, opponent, date, time, liveLink } = req.body;

    const poster = await processPoster(req.file);

    db.run(
      `INSERT INTO battles
       (host, opponent, date, time, poster, liveLink)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [host, opponent, date, time, poster, liveLink],
      async () => {

        try {

          const form = new FormData();

          const messageText =
            `🔥 **Flame Force Battle Scheduled!** 🔥\n\n` +
            `⚔ <@${host}> vs <@${opponent}>\n` +
            `📅 ${date} ⏰ ${time}\n\n` +
            (liveLink
              ? `🔗 Watch here:\n${liveLink}`
              : "");

          form.append("content", messageText);

          if (poster) {

            const posterPath = path.join(
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
                Authorization: `Bot ${process.env.TOKEN}`,
                ...form.getHeaders()
              }
            }
          );

          console.log("Discord announcement posted");

        } catch (err) {

          console.log(
            "Discord post failed:",
            err.message
          );

        }

        res.redirect("/dashboard");

      }
    );

  }
);

/*
DELETE BATTLE
*/
app.post("/delete/:id", checkAuth, (req, res) => {

  if (!["owner", "admin"].includes(req.roleLevel))
    return res.send("Permission denied");

  db.run(
    "DELETE FROM battles WHERE id=?",
    [req.params.id]
  );

  res.redirect("/dashboard");

});

/*
CALENDAR
*/
app.get("/calendar", (req, res) => {

  db.all(
    "SELECT * FROM battles ORDER BY date, time",
    [],
    (err, battles) => {

      if (err) return res.send("Database error");

      res.render("calendar", { battles });

    }
  );

});

/*
START SERVER
*/
const PORT = process.env.PORT || 8080;

app.listen(PORT, () =>
  console.log(`🔥 Flame Force dashboard running on ${PORT}`)
);