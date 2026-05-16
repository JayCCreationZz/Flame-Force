require("dotenv").config();

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const path = require("path");

const {
  Client,
  GatewayIntentBits
} = require("discord.js");

const db = require("../database");

const app = express();

/* ============================
   DISCORD CLIENT
============================ */

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

discordClient.login(process.env.BOT_TOKEN)
  .then(() => {
    console.log("✅ Dashboard Discord client connected");
  })
  .catch(err => {
    console.error(
      "❌ Dashboard Discord login failed:",
      err
    );
  });

/* ============================
   EXPRESS SETUP
============================ */

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,

    cookie: {
      maxAge:
        1000 * 60 * 60 * 24 * 7
    }
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

passport.serializeUser(
  (user, done) => {
    done(null, user);
  }
);

passport.deserializeUser(
  (obj, done) => {
    done(null, obj);
  }
);

passport.use(
  new DiscordStrategy(
    {
      clientID:
        process.env.DISCORD_CLIENT_ID,

      clientSecret:
        process.env.DISCORD_CLIENT_SECRET,

      callbackURL:
        process.env.DISCORD_CALLBACK_URL,

      scope: [
        "identify",
        "guilds"
      ]
    },

    (
      accessToken,
      refreshToken,
      profile,
      done
    ) => {

      process.nextTick(() => {
        return done(null, profile);
      });

    }
  )
);

/* ============================
   AUTH MIDDLEWARE
============================ */

function checkAuth(
  req,
  res,
  next
) {

  if (req.isAuthenticated()) {
    return next();
  }

  res.redirect("/auth/discord");

}

/* ============================
   HOME DASHBOARD
============================ */

app.get(
  "/",
  checkAuth,

  async (req, res) => {

    try {

      const result =
        await db.query(`
          SELECT *
          FROM battles
          ORDER BY id DESC
        `);

      const battles =
        result.rows;

      const guild =
        await discordClient.guilds.fetch(
          process.env.GUILD_ID
        );

      for (const battle of battles) {

        try {

          const member =
            await guild.members.fetch(
              battle.host
            );

          battle.hostdisplayname =
            member.displayName;

        } catch {

          battle.hostdisplayname =
            battle.host;

        }

      }

      res.render(
        "dashboard",
        {
          user: req.user,
          battles,
          roleLevel: "owner"
        }
      );

    } catch (err) {

      console.error(
        "❌ Dashboard load error:",
        err
      );

      res.status(500).send(
        "Dashboard failed to load"
      );

    }

  }
);

/* ============================
   CREATE BATTLE
============================ */

app.post(
  "/battle/create",
  checkAuth,

  async (req, res) => {

    try {

      const {
        host,
        opponent,
        date,
        time,
        livelink
      } = req.body;

      await db.query(

        `
        INSERT INTO battles
        (
          host,
          opponent,
          date,
          time,
          livelink
        )

        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5
        )
        `,

        [
          host,
          opponent,
          date,
          time,
          livelink
        ]

      );

      console.log(
        `✅ Battle created: ${host} vs ${opponent}`
      );

      res.redirect("/");

    } catch (err) {

      console.error(
        "❌ Create battle error:",
        err
      );

      res.status(500).send(
        "Failed to create battle"
      );

    }

  }
);

/* ============================
   EDIT BATTLE
============================ */

app.post(
  "/battle/:id/edit",
  checkAuth,

  async (req, res) => {

    try {

      const {
        host,
        opponent,
        date,
        time,
        livelink
      } = req.body;

      await db.query(

        `
        UPDATE battles

        SET
          host = $1,
          opponent = $2,
          date = $3,
          time = $4,
          livelink = $5

        WHERE id = $6
        `,

        [
          host,
          opponent,
          date,
          time,
          livelink,
          req.params.id
        ]

      );

      console.log(
        `✏️ Updated battle ${req.params.id}`
      );

      res.redirect("/");

    } catch (err) {

      console.error(
        "❌ Edit battle error:",
        err
      );

      res.status(500).send(
        "Failed to edit battle"
      );

    }

  }
);

/* ============================
   DELETE BATTLE
============================ */

app.post(
  "/battle/:id/delete",
  checkAuth,

  async (req, res) => {

    try {

      await db.query(
        `
        DELETE FROM battles
        WHERE id = $1
        `,
        [req.params.id]
      );

      console.log(
        `🗑 Deleted battle ${req.params.id}`
      );

      res.redirect("/");

    } catch (err) {

      console.error(
        "❌ Delete battle error:",
        err
      );

      res.status(500).send(
        "Delete failed"
      );

    }

  }
);

/* ============================
   DISCORD AUTH
============================ */

app.get(
  "/auth/discord",

  passport.authenticate(
    "discord"
  )
);

app.get(
  "/auth/discord/callback",

  passport.authenticate(
    "discord",
    {
      failureRedirect: "/"
    }
  ),

  (req, res) => {

    console.log(
      `✅ ${req.user.username} logged in`
    );

    res.redirect("/");

  }
);

/* ============================
   LOGOUT
============================ */

app.get(
  "/logout",

  (req, res) => {

    req.logout(() => {

      req.session.destroy(() => {

        res.redirect("/");

      });

    });

  }
);

/* ============================
   POSTER IMAGE ROUTE
============================ */

app.get(
  "/poster/:id",

  async (req, res) => {

    try {

      const result =
        await db.query(

          `
          SELECT posterdata
          FROM battles
          WHERE id = $1
          `,

          [req.params.id]
        );

      if (
        !result.rows.length ||
        !result.rows[0].posterdata
      ) {

        return res
          .status(404)
          .send(
            "No poster found"
          );

      }

      res.setHeader(
        "Content-Type",
        "image/jpeg"
      );

      res.send(
        result.rows[0]
          .posterdata
      );

    } catch (err) {

      console.error(
        "❌ Failed loading poster:",
        err
      );

      res.status(500).send(
        "Poster load failed"
      );

    }

  }
);

/* ============================
   HEALTH CHECK
============================ */

app.get(
  "/health",

  (req, res) => {

    res.json({
      status: "online",
      dashboard: true,
      timestamp: new Date()
    });

  }
);

/* ============================
   START SERVER
============================ */

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,

  () => {

    console.log(
      `🔥 Flame Force Dashboard running on port ${PORT}`
    );

  }
);