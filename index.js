process.env.TZ = "Europe/London";

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events
} = require("discord.js");

const cron = require("node-cron");
const db = require("./database");
const fetch = require("node-fetch");

const client = new Client({

  intents: [

    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers

  ]

});

const sentReminders =
  new Set();

/*
BOT READY
*/

client.once(
  "clientReady",
  () => {

    console.log(

      `🔥 Battle Bot online as ${client.user.tag}`

    );

  }
);

/*
APPROVE / REJECT REQUESTS
*/

client.on(
  Events.InteractionCreate,

  async interaction => {

    if (
      !interaction.isButton()
    ) return;

    const [action, id] =
      interaction.customId.split("_");

    /*
    REJECT
    */

    if (action === "reject") {

      await db.query(

        `
        DELETE FROM battle_requests
        WHERE id = $1
        `,

        [id]

      );

      return interaction.reply({

        content:
          "❌ Request rejected",

        ephemeral: true

      });

    }

    /*
    APPROVE
    */

    if (
      action !== "approve"
    ) return;

    const result =
      await db.query(

        `
        SELECT *
        FROM battle_requests
        WHERE id = $1
        `,

        [id]

      );

    if (
      !result.rows.length
    ) return;

    const request =
      result.rows[0];

    await interaction.reply({

      content:
        "📤 Upload poster within 60 seconds",

      ephemeral: true

    });

    const collector =
      interaction.channel.createMessageCollector({

        filter: m =>

          m.author.id ===
            interaction.user.id &&

          m.attachments.size > 0,

        max: 1,

        time: 60000

      });

    collector.on(
      "collect",

      async msg => {

        try {

          const attachment =
            msg.attachments.first();

          const response =
            await fetch(
              attachment.url
            );

          const buffer =
            Buffer.from(
              await response.arrayBuffer()
            );

          let member =
            interaction.guild.members.cache.get(
              interaction.user.id
            );

          if (!member) {

            try {

              member =
                await interaction.guild.members.fetch(
                  interaction.user.id
                );

            } catch {

              member = null;

            }

          }

          const displayName =

            member
              ? member.displayName
              : interaction.user.username;

          await db.query(

            `
            INSERT INTO battles
            (
              host,
              hostname,
              opponent,
              date,
              time,
              posterdata
            )

            VALUES
            (
              $1,$2,$3,$4,$5,$6
            )
            `,

            [

              interaction.user.id,

              displayName,

              request.opponent,

              request.preferred_date,

              request.preferred_time,

              buffer

            ]

          );

          await db.query(

            `
            DELETE FROM battle_requests
            WHERE id = $1
            `,

            [id]

          );

          msg.reply(
            "✅ Battle approved"
          );

        } catch(err) {

          console.error(
            "❌ Approval error:",
            err
          );

        }

      }

    );

  }

);

/*
REMINDER SYSTEM
30 MINUTES BEFORE
*/

cron.schedule(

  "* * * * *",

  async () => {

    try {

      console.log(
        "⏰ Checking reminders..."
      );

      const battles =
        await db.query(

          `
          SELECT *
          FROM battles
          `

        );

      const now =
        new Date();

      for (const battle of battles.rows) {

        /*
        SKIP INVALID
        */

        if (

          !battle.date ||

          !battle.time

        ) continue;

        const key =
          `${battle.id}_${battle.date}_${battle.time}`;

        if (
          sentReminders.has(key)
        ) continue;

        /*
        VALIDATE DATE
        */

        const dateParts =
          battle.date.split("/");

        const timeParts =
          battle.time.split(":");

        if (

          dateParts.length !== 3 ||

          timeParts.length !== 2

        ) {

          console.log(

            `⚠ Invalid date/time for battle ${battle.id}`

          );

          continue;

        }

        const [
          day,
          month,
          year
        ] = dateParts;

        const [
          hour,
          minute
        ] = timeParts;

        const battleDate =
          new Date(

            year,
            month - 1,
            day,
            hour,
            minute

          );

        /*
        INVALID DATE CHECK
        */

        if (
          isNaN(battleDate)
        ) {

          console.log(

            `⚠ Invalid parsed date for battle ${battle.id}`

          );

          continue;

        }

        /*
        DIFF
        */

        const diff =
          (
            battleDate - now
          ) / 60000;

        console.log(

          `Battle ${battle.id}: ${diff.toFixed(2)} mins`

        );

        /*
        SEND REMINDER
        */

        if (

          diff <= 30 &&

          diff > 29

        ) {

          const channel =
            await client.channels.fetch(
              process.env.REMINDER_CHANNEL_ID
            );

          if (channel) {

            await channel.send(

              `⏰ Reminder: ${
                battle.hostname ||
                battle.host
              } vs ${
                battle.opponent
              } starts in 30 minutes!`

            );

            console.log(

              `✅ Reminder sent for battle ${battle.id}`

            );

            sentReminders.add(
              key
            );

          }

        }

      }

    } catch(err) {

      console.error(

        "❌ Reminder system error:",
        err

      );

    }

  }

);

/*
DISCORD LOGIN
*/

client.login(
  process.env.BOT_TOKEN
)

.then(() => {

  console.log(
    "✅ Discord login successful"
  );

})

.catch(err => {

  console.error(
    "❌ Discord login failed:",
    err
  );

});