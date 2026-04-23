require("dotenv").config();

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const path = require("path");
const multer = require("multer");
const axios = require("axios");

const pool = require("../database");

const app = express();

app.use(session({
  secret: "flame-force-secret",
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_REDIRECT_URI,
  scope: ["identify", "guilds", "guilds.members.read"]
},
async (accessToken, refreshToken, profile, done) => {

  try {

    const guild = profile.guilds.find(
      g => g.id === process.env.DISCORD_GUILD_ID
    );

    if (!guild) {
      return done(null, false);
    }

    const member = await axios.get(
      `https://discord.com/api/users/@me/guilds/${process.env.DISCORD_GUILD_ID}/member`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const roles = member.data.roles;

    let roleLevel = "member";

    if (roles.includes(process.env.OWNER_ROLE_ID))
      roleLevel = "owner";
    else if (roles.includes(process.env.ADMIN_ROLE_ID))
      roleLevel = "admin";

    profile.roleLevel = roleLevel;

    done(null, profile);

  } catch (err) {

    console.error(err);
    done(err);

  }

}));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });


/*
LOGIN ROUTES
*/

app.get("/login",
  passport.authenticate("discord")
);

app.get("/auth/callback",
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
POSTER ROUTE
*/

app.get("/poster/:id", async (req, res) => {

  const result = await pool.query(
    "SELECT posterdata FROM battles WHERE id=$1",
    [req.params.id]
  );

  if (!result.rows.length)
    return res.status(404).send("Not found");

  res.set("Content-Type", "image/jpeg");
  res.send(result.rows[0].posterdata);

});


/*
DASHBOARD
*/

app.get("/", async (req, res) => {

  const battles =
    await pool.query(
      "SELECT * FROM battles ORDER BY date ASC,time ASC"
    );

  res.render("dashboard", {
    battles: battles.rows,
    roleLevel: req.user?.roleLevel || "member",
    user: req.user || null
  });

});


/*
CREATE BATTLE (ADMIN ONLY)
*/

app.post("/create-battle",
upload.single("poster"),
async (req, res) => {

  const role =
    req.user?.roleLevel || "member";

  if (!["admin","owner"].includes(role))
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

  await pool.query(`
    INSERT INTO battles
    (host,hostname,opponent,date,time,posterdata,
     managergifting,adultonly,powerups,nohammers)
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
  ]);

  res.redirect("/");

});


/*
REQUEST FORM
*/

app.get("/request", (req,res)=>{

  res.render("request",{ success:false });

});


app.listen(process.env.PORT || 3000,
()=> console.log("🔥 Dashboard running"));