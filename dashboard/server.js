require("dotenv").config();

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const path = require("path");
const multer = require("multer");

const {
  Client,
  GatewayIntentBits
} = require("discord.js");

const db = require("../database");

const app = express();

const upload = multer({
  storage: multer.memoryStorage()
});

/* ============================
DISCORD CLIENT
============================ */

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

/* ============================
DISCORD LOGIN
============================ */

if (
  process.env.BOT_TOKEN &&
  process.env.BOT_TOKEN !== "undefined"
) {

  discordClient.login(process.env.BOT_TOKEN)

    .then(() => {

      console.log(
        "✅ Dashboard Discord client connected"
      );

    })

    .catch(err => {

      console.error(
        "❌ Dashboard Discord login failed:",
        err.message
      );

    });

} else {

  console.error(
    "❌ BOT_TOKEN missing in Railway variables"
  );

}

/* ============================
EXPRESS
============================ */

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,

    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7
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

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

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
AUTH
============================ */

function checkAuth(req, res, next) {

  if (req.isAuthenticated()) {
    return next();
  }

  res.redirect("/auth/discord");

}

/* ============================
ROLE CHECK
============================ */

function getRoleLevel(user) {

  return "owner";

}

/* ============================
HOME
============================ */

app.get("/", checkAuth, async (req, res) => {

  try {

    /*
    GET BATTLES
    */

    const result = await db.query(`
      SELECT *
      FROM battles
      ORDER BY id DESC
    `);

    const battles = result.rows;

    /*
    DEFAULT VALUES
    */

    let guild = null;

    let guildMembers = [];

    /*
    FETCH DISCORD GUILD
    */

    try {

      if (
        discordClient &&
        discordClient.isReady()
      ) {

        guild =
          await discordClient.guilds.fetch(
            process.env.GUILD_ID
          );

      }

    } catch (err) {

      console.error(
        "❌ Guild fetch failed:",
        err.message
      );

    }

    /*
    FETCH MEMBERS
    */

    if (guild) {

      try {

        const fetchedMembers =
          await guild.members.fetch();

        guildMembers = fetchedMembers

          .filter(member =>
            !member.user.bot
          )

          .map(member => ({

            id: member.id,

            name:
              member.displayName ||
              member.user.username,

            avatar:
              member.user.displayAvatarURL({
                dynamic: true
              })

          }))

          .sort((a, b) =>
            a.name.localeCompare(b.name)
          );

      } catch (err) {

        console.error(
          "❌ Failed to fetch members:",
          err.message
        );

      }

    }

    /*
    ATTACH DISPLAY NAMES
    */

    for (const battle of battles) {

      battle.hostdisplayname =
        battle.host;

      battle.avatarUrl = null;

      if (guild) {

        try {

          const member =
            await guild.members.fetch(
              battle.host
            );

          if (member) {

            battle.hostdisplayname =
              member.displayName ||
              member.user.username;

            battle.avatarUrl =
              member.user.displayAvatarURL({
                dynamic: true
              });

          }

        } catch (err) {

          console.log(
            `⚠ Could not fetch member ${battle.host}`
          );

        }

      }

    }

    /*
    RENDER
    */

    res.render("dashboard", {

      user: req.user,

      battles,

      guildMembers,

      roleLevel:
        getRoleLevel(req.user)

    });

  } catch (err) {

    console.error(
      "❌ Dashboard load error:",
      err
    );

    res.status(500).send(
      "Dashboard failed"
    );

  }

});

/* ============================
CALENDAR
============================ */

app.get(
  "/calendar",
  checkAuth,

  async (req, res) => {

    try {

      const result =
        await db.query(`
          SELECT *
          FROM battles
          ORDER BY date ASC
        `);

      const battles =
        result.rows;

      res.render(
        "calendar",
        {
          user: req.user,
          battles,
          roleLevel:
            getRoleLevel(req.user)
        }
      );

    } catch (err) {

      console.error(
        "Calendar error:",
        err
      );

      res.send(
        "Calendar failed"
      );

    }

  }
);

/* ============================
REQUEST PAGE
============================ */

app.get(
  "/request",

  (req, res) => {

    res.render(
      "request",
      {
        user: req.user,
        success: false
      }
    );

  }
);

/* ============================
SUBMIT REQUEST
============================ */

app.post(
  "/request",

  async (req, res) => {

    try {

      const {
        requester,
        agency,
        preferred_date,
        preferred_time,
        notes
      } = req.body;

      await db.query(

        `
        INSERT INTO battle_requests
        (
          requester,
          agency,
          preferred_date,
          preferred_time,
          notes
        )

        VALUES ($1,$2,$3,$4,$5)
        `,

        [
          requester,
          agency,
          preferred_date,
          preferred_time,
          notes
        ]

      );

      res.render(
        "request",
        {
          success: true,
          user: req.user
        }
      );

    } catch (err) {

      console.error(
        "Request submit error:",
        err
      );

      res.send(
        "Request failed"
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
  upload.single("poster"),

  async (req, res) => {

    try {

      const {
        host,
        opponent,
        date,
        time,
        livelink,
        managergifting,
        adultonly,
        powerups,
        nohammers
      } = req.body;

      /*
CONVERT HTML DATE INPUT
YYYY-MM-DD
TO
DD/MM/YYYY
*/

let formattedDate = date;

if (date.includes("-")) {

  const [year, month, day] =
    date.split("-");

  formattedDate =
    `${day}/${month}/${year}`;

}

/*
VALIDATE DATE
*/

const dateRegex =
  /^\d{2}\/\d{2}\/\d{4}$/;

/*
VALIDATE TIME
*/

const timeRegex =
  /^\d{2}:\d{2}$/;

if (
  !dateRegex.test(formattedDate)
) {

  return res.send(
    "Invalid date format"
  );

}

if (
  !timeRegex.test(time)
) {

  return res.send(
    "Invalid time format"
  );

}

 /*
INSERT BATTLE
*/

const inserted =
  await db.query(

    `
    INSERT INTO battles
    (
      host,
      opponent,
      date,
      time,
      posterdata,
      livelink,
      managergifting,
      adultonly,
      powerups,
      nohammers
    )

    VALUES
    (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
    )

    RETURNING *
    `,

    [

      host,

      opponent,

      formattedDate,

      time,

      req.file
        ? req.file.buffer
        : null,

      livelink,

      !!managergifting,

      !!adultonly,

      !!powerups,

      !!nohammers

    ]

  );
      /*
INSTANT POST TO DISCORD
*/

try {

  const battle =
    inserted.rows[0];

  const channel =
    await discordClient.channels.fetch(
      process.env.BATTLE_CHANNEL_ID
    );

  if (channel) {

    const {
      EmbedBuilder
    } = require("discord.js");

    const embed =
      new EmbedBuilder()

      .setTitle(
        "🔥 New Battle Scheduled"
      )

      .addFields(

        {
          name: "Host",
          value:
            `<@${battle.host}>`
        },

        {
          name: "Opponent",
          value:
            battle.opponent
        },

        {
          name: "Date",
          value:
            battle.date
        },

        {
          name: "Time",
          value:
            battle.time
        }

      )

      .setColor("#ff6600")

      .setTimestamp();

    /*
    LIVE LINK
    */

    if (battle.livelink) {

      embed.addFields({

        name: "🔴 LIVE",

        value:
          battle.livelink

      });

    }

    /*
    SEND MESSAGE
    */

    await channel.send({

      content:
        `<@${battle.host}>`,

      embeds: [embed],

      files:
        battle.posterdata

        ? [

            {

              attachment:
                battle.posterdata,

              name:
                "poster.jpg"

            }

          ]

        : []

    });

    console.log(
      "✅ Battle instantly posted to Discord"
    );

  } else {

    console.log(
      "❌ Battle channel not found"
    );

  }

} catch(err) {

  console.error(
    "❌ Instant Discord post failed:",
    err
  );

}
/*
REDIRECT
*/

res.redirect("/");

} catch(err) {

  console.error(
    "Create battle error:",
    err
  );

  res.send(
    "Battle creation failed"
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

      res.redirect("/");

    } catch (err) {

      console.error(
        "Delete error:",
        err
      );

      res.send(
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
  passport.authenticate("discord")
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

    res.redirect("/");

  }
);

/* ============================
LOGOUT
============================ */

app.get("/logout", (req, res) => {

  req.logout(() => {

    req.session.destroy(() => {

      res.redirect("/");

    });

  });

});

/* ============================
POSTER ROUTE
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
          .send("No poster");

      }

      res.setHeader(
        "Content-Type",
        "image/jpeg"
      );

      res.send(
        result.rows[0].posterdata
      );

    } catch (err) {

      console.error(
        "Poster error:",
        err
      );

      res.send(
        "Poster failed"
      );

    }

  }
);

/* ============================
HEALTH
============================ */

app.get("/health", (req, res) => {

  res.json({
    online: true
  });

});

/* ============================
START SERVER
============================ */

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    `🔥 Flame Force Dashboard running on port ${PORT}`
  );

});