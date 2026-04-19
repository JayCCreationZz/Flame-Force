require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  EmbedBuilder
} = require("discord.js");

const cron = require("node-cron");
const db = require("./database");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});


/*
READY EVENT
*/

client.once("clientReady", () => {

  console.log("🔥 Flame Force Battle System Online");

});


/*
ROLE PINGS
*/

function getRoleMentions(guild) {

  const roleNames = ["Spark", "Ember", "Blaze"];

  return roleNames
    .map(name => guild.roles.cache.find(r => r.name === name))
    .filter(Boolean)
    .map(role => `<@&${role.id}>`)
    .join(" ");

}


/*
UK TIME HELPERS
*/

function getUKTime(offset = 0) {

  const now = new Date();
  now.setMinutes(now.getMinutes() + offset);

  return now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London"
  });

}

function getUKDate() {

  return new Date().toLocaleDateString("en-GB", {
    timeZone: "Europe/London"
  });

}


/*
RULE BADGES
*/

function formatRules(battle) {

  return [

    battle.managergifting
      ? "🎁 Manager Gifting Allowed"
      : "🚫 Manager Gifting Disabled",

    battle.adultonly
      ? "🔞 18+ Battle"
      : "🟢 All Ages",

    battle.powerups
      ? "⚡ Power Ups Enabled"
      : "🚫 No Power Ups",

    battle.nohammers
      ? "🔨 No Hammers"
      : "🟢 Hammers Allowed"

  ].join("\n");

}


/*
EMBED BUILDER
*/

function buildEmbed(battle, title) {

  return new EmbedBuilder()

    .setColor("#ff4d00")

    .setTitle(title)

    .setDescription(
      `⚔ <@${battle.host}> vs **${battle.opponent}**`
    )

    .addFields(
      { name: "📅 Date", value: battle.date, inline: true },
      { name: "⏰ Time", value: battle.time, inline: true },
      { name: "Battle Rules", value: formatRules(battle) }
    )

    .setFooter({
      text: "Flame Force Agency"
    });

}


/*
SEND EMBED WITH POSTER
*/

async function sendEmbed(channel, battle, title) {

  const embed = buildEmbed(battle, title);

  const payload = { embeds: [embed] };

  if (battle.posterdata) {

    const attachment = new AttachmentBuilder(
      Buffer.from(battle.posterdata),
      { name: "battle.jpg" }
    );

    embed.setImage("attachment://battle.jpg");

    payload.files = [attachment];

  }

  await channel.send(payload);

}


/*
REMINDER ENGINE
*/

cron.schedule("* * * * *", async () => {

  try {

    const today = getUKDate();

    const nowTime = getUKTime();
    const minus10 = getUKTime(10);
    const minus30 = getUKTime(30);

    const result = await db.query(
      "SELECT * FROM battles WHERE date = $1",
      [today]
    );

    if (!result.rows.length) return;

    const reminderChannel =
      await client.channels.fetch(
        process.env.REMINDER_CHANNEL_ID
      );

    if (!reminderChannel) {

      console.log("❌ Reminder channel not found");
      return;

    }

    const rolePing =
      getRoleMentions(reminderChannel.guild);


    for (const battle of result.rows) {


      /*
      30 MIN REMINDER
      */

      if (
        battle.time === minus30 &&
        !battle.reminder30
      ) {

        await reminderChannel.send(rolePing);

        await sendEmbed(
          reminderChannel,
          battle,
          "🔥 Battle Starting In 30 Minutes"
        );

        await db.query(
          "UPDATE battles SET reminder30 = TRUE WHERE id = $1",
          [battle.id]
        );

      }


      /*
      10 MIN REMINDER
      */

      if (
        battle.time === minus10 &&
        !battle.reminder10
      ) {

        await reminderChannel.send(rolePing);

        await sendEmbed(
          reminderChannel,
          battle,
          "🔥 Final Call — Battle Starts Soon"
        );

        await db.query(
          "UPDATE battles SET reminder10 = TRUE WHERE id = $1",
          [battle.id]
        );

      }


      /*
      LIVE ALERT
      */

      if (
        battle.time === nowTime &&
        !battle.live
      ) {

        await reminderChannel.send(rolePing);

        await sendEmbed(
          reminderChannel,
          battle,
          "🔥 Battle LIVE NOW"
        );

        await db.query(
          "UPDATE battles SET live = TRUE WHERE id = $1",
          [battle.id]
        );

      }

    }

  }

  catch (err) {

    console.log("Reminder engine error:", err.message);

  }

}, {
  timezone: "Europe/London"
});


/*
LOGIN
*/

client.login(process.env.TOKEN);