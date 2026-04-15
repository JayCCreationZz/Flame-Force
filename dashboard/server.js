const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const multer = require("multer");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const axios = require("axios");

const db = require("../database");

const app = express();

/*
FLAME FORCE CONFIG
*/
const config = {
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  guildId: process.env.GUILD_ID,
  callbackURL: process.env.CALLBACK_URL,

  ownerRoles: ["1439255505053683804"],
  adminRoles: ["1471132938467803322"],
  memberRoles: [
    "1439256282409209926",
    "1439256200658157588"
  ]
};

/*
UPLOAD STORAGE
*/
const upload = multer({
  dest: path.join(process.cwd(), "dashboard/public/posters/tmp")
});

/*
AUTO-RESIZE POSTERS
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
SESSION CONFIG
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
      clientID: config.clientId,
      clientSecret: config.clientSecret,
      callbackURL: config.callbackURL,
      scope: ["identify"]
    },
    (accessToken, refreshToken, profile, done) =>
      done(null, profile)
  )
);

passport.serializeUser((u, d) => d(null, u));
passport.deserializeUser((o, d) => d(null, o));

/*
ROLE CHECK
*/
async function getUserRoleLevel(req) {

  if (!req.user?.id) return "none";

  const response = await axios.get(
    `https://discord.com/api/guilds/${config.guildId}/members/${req.user.id}`,
    {
      headers: {
        Authorization: `Bot ${config.token}`
      }
    }
  );

  const member = response.data;

  if (member.roles.some(r => config.ownerRoles.includes(r)))
    return "owner";

  if (member.roles.some(r => config.adminRoles.includes(r)))
    return "admin";

  if (member.roles.some(r => config.memberRoles.includes(r)))
    return "member";

  return "none";
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
DASHBOARD VIEW
*/
app.get("/dashboard", checkAuth, (req, res) => {

  db.all(
    "SELECT * FROM battles ORDER BY date, time",
    [],
    (err, battles) => {

      if (err) {
        console.error(err);
        return res.send("Database error");
      }

      res.render("dashboard", {
        battles,
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

          console.log("Posting battle to Discord...");

          const form = new FormData();

          const messageText =
            `🔥 **Flame Force Battle Scheduled!** 🔥\n\n` +
            `⚔ ${host} vs ${opponent}\n` +
            `📅 ${date} ⏰ ${time}\n\n` +
            (liveLink ? `🔗 Watch here:\n${liveLink}` : "");

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

          console.error(
            "Discord post failed:",
            err.response?.data || err.message
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
CALENDAR VIEW
*/
app.get("/calendar", (req, res) => {

  db.all(
    "SELECT * FROM battles ORDER BY date, time",
    [],
    (err, battles) => {

      if (err)
        return res.send("Database error");

      res.render("calendar", { battles });

    }
  );

});

/*
START SERVER
*/
const PORT = process.env.PORT || 8080;

app.listen(PORT, () =>
  console.log(
    `🔥 Flame Force dashboard running on port ${PORT}`
  )
);