require("dotenv").config();

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const path = require("path");

const db = require("../database");

const app = express();

/* ============================
   EXPRESS SETUP
============================ */

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.set("view engine", "ejs");

app.set(
  "views",
  path.join(__dirname, "views")
);

app.use(express.static("public"));

/* ============================
   PASSPORT
============================ */

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL:
        process.env.DISCORD_CALLBACK_URL,
      scope: ["identify", "guilds"]
    },
    (accessToken, refreshToken, profile, done) => {
      process.nextTick(() => {
        return done(null, profile);
      });
    }
  )
);

/* ============================
   AUTH
============================ */

function checkAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }

  res.redirect("/login");
}

function resolveDisplayName(member) {
  return (
    member.nick ||
    member.user?.global_name ||
    member.user?.display_name ||
    member.user?.username ||
    "Unknown"
  );
}

/* ============================
   ROUTES
============================ */

app.get("/", checkAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT *
      FROM battles
      ORDER BY id DESC
    `);

    const battles = result.rows;

    res.render("dashboard", {
      user: req.user,
      battles,
      roleLevel: "owner"
    });

  } catch (err) {

    console.error(err);

    res.send("Database error");

  }
});

app.get(
  "/login",
  passport.authenticate("discord")
);

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

/* ============================
   POSTER ROUTE
============================ */

app.get("/poster/:id", async (req, res) => {

  try {

    const result = await db.query(
      "SELECT posterdata FROM battles WHERE id = $1",
      [req.params.id]
    );

    if (
      !result.rows.length ||
      !result.rows[0].posterdata
    ) {
      return res
        .status(404)
        .send("No poster found");
    }

    res.setHeader(
      "Content-Type",
      "image/jpeg"
    );

    res.send(result.rows[0].posterdata);

  } catch (err) {

    console.error(
      "❌ Failed loading poster:",
      err
    );

    res.status(500).send("Server error");

  }

});

/* ============================
   DELETE BATTLE
============================ */

app.post(
  "/battle/:id/delete",
  checkAuth,
  async (req, res) => {

    try {

      await db.query(
        "DELETE FROM battles WHERE id = $1",
        [req.params.id]
      );

      res.redirect("/");

    } catch (err) {

      console.error(err);

      res.send("Delete failed");

    }

  }
);

/* ============================
   START SERVER
============================ */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    `🔥 Dashboard running on port ${PORT}`
  );

});