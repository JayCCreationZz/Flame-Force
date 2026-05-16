process.env.TZ = "Europe/London";

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder
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

const sentReminders = new Set();

/*
BOT READY
*/

client.once("clientReady", () => {

  console.log(
    `🔥 Battle Bot online as ${client.user.tag}`
  );

});

/*
POST BATTLE EMBED
*/

async function postBattleNow(battle) {

  try {

    const channel =
      await client.channels.fetch(
        process.env.BATTLE_CHANNEL_ID
      );

    if (!channel) {

      console.log(
        "❌ Battle channel not found"
      );

      return;

    }

    const embed = new EmbedBuilder()

      .setTitle("🔥 Battle Scheduled")

      .addFields(
        {
          name: "Host",
          value:
            battle.hostname ||
            battle.host ||
            "Unknown"
        },
        {
          name: "Opponent",
          value:
            battle.opponent ||
            "Unknown"
        },
        {
          name: "Date",
          value:
            battle.date ||
            "Unknown"
        },
        {
          name: "Time",
          value:
            battle.time ||
            "Unknown"
        }
      )

      .setColor("#ff6600")
      .setTimestamp();

    if (battle.livelink) {

      embed.addFields({
        name: "🔴 LIVE",
        value: battle.livelink
      });

    }

    await channel.send({

      embeds: [embed],

      files: battle.posterdata
        ? [
            {
              attachment:
                battle.posterdata,
              name: "poster.jpg"
            }
          ]
        : []

    });

    console.log(
      `✅ Posted battle: ${
        battle.hostname ||
        battle.host
      } vs ${battle.opponent}`
    );

  } catch(err) {

    console.error(
      "❌ Failed to post battle:",
      err
    );

  }

}

/*
APPROVE / REJECT REQUESTS
*/

client.on(
  Events.InteractionCreate,
  async interaction => {

    if (!interaction.isButton()) return;

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

    if (action !== "approve")
      return;

    const result =
      await db.query(

        `
        SELECT *
        FROM battle_requests
        WHERE id = $1
        `,

        [id]

      );

    if (!result.rows.length)
      return;

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

          const member =
            await interaction.guild.members.fetch(
              interaction.user.id
            );

          const displayName =
            member.displayName;

          const inserted =
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
                $1,
                $2,
                $3,
                $4,
                $5,
                $6
              )
              RETURNING *
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

          await postBattleNow(
            inserted.rows[0]
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
AUTO POST BATTLES
EVERY MINUTE
*/

cron.schedule(
  "* * * * *",
  async () => {

    try {

      const result =
        await db.query(

          `
          SELECT *
          FROM battles
          WHERE posted = FALSE
          OR posted IS NULL
          `

        );

      const battles =
        result.rows;

      const now =
        new Date();

      const currentDay =
        String(
          now.getDate()
        ).padStart(2, "0");

      const currentMonth =
        String(
          now.getMonth() + 1
        ).padStart(2, "0");

      const currentYear =
        now.getFullYear();

      const currentHour =
        String(
          now.getHours()
        ).padStart(2, "0");

      const currentMinute =
        String(
          now.getMinutes()
        ).padStart(2, "0");

      const currentDate =
        `${currentDay}/${currentMonth}/${currentYear}`;

      const currentTime =
        `${currentHour}:${currentMinute}`;

      console.log(

        `🕒 Checking battles at ${currentDate} ${currentTime}`

      );

      const channel =
        await client.channels.fetch(
          process.env.BATTLE_CHANNEL_ID
        );

      if (!channel) {

        console.log(
          "❌ Battle channel not found"
        );

        return;

      }

      for (const battle of battles) {

        if (

          battle.date ===
            currentDate &&

          battle.time ===
            currentTime

        ) {

          console.log(

            `⚔ Posting battle: ${
              battle.hostname ||
              battle.host
            } vs ${battle.opponent}`

          );

          await postBattleNow(
            battle
          );

          await db.query(

            `
            UPDATE battles
            SET posted = TRUE
            WHERE id = $1
            `,

            [battle.id]

          );

          console.log(
            `✅ Battle posted`
          );

        }

      }

    } catch(err) {

      console.error(
        "❌ Battle posting error:",
        err
      );

    }

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
          "SELECT * FROM battles"
        );

      const now =
        new Date();

      for (const battle of battles.rows) {

        const key =
          `${battle.id}_${battle.date}_${battle.time}`;

        if (
          sentReminders.has(key)
        ) continue;

        /*
        PARSE DATE
        DD/MM/YYYY
        */

        const [
          day,
          month,
          year
        ] =
          battle.date.split("/");

        /*
        PARSE TIME
        HH:MM
        */

        const [
          hour,
          minute
        ] =
          battle.time.split(":");

        const battleDate =
          new Date(

            year,
            month - 1,
            day,
            hour,
            minute

          );

        /*
        DIFF IN MINUTES
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