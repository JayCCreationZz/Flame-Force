require("dotenv").config();

const { Client, GatewayIntentBits, AttachmentBuilder } = require("discord.js");
const cron = require("node-cron");
const db = require("./database");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/*
==============================
READY EVENT
==============================
*/

client.once("clientReady", () => {

  console.log("🔥 Flame Force Battle System Online");

});


/*
==============================
ROLE PING HELPER
==============================
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
==============================
UK TIME HELPERS
==============================
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
==============================
POST MESSAGE WITH POSTER
==============================
*/

async function sendBattleMessage(channel, battle, text) {

  try {

    const payload = {
      content: text
    };

    if (battle.posterdata) {

      payload.files = [
        new AttachmentBuilder(
          Buffer.from(battle.posterdata),
          { name: "battle.jpg" }
        )
      ];

    }

    await channel.send(payload);

  } catch (err) {

    console.log("Poster send error:", err.message);

  }

}


/*
==============================
REMINDER ENGINE
==============================
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

    for (const battle of result.rows) {

      const channel = await client.channels.fetch(
        battle.channel
      );

      if (!channel) continue;

      const rolePing =
        getRoleMentions(channel.guild);


      /*
      ==============================
      30 MINUTE REMINDER
      ==============================
      */

      if (
        battle.time === minus30 &&
        !battle.reminder30
      ) {

        await sendBattleMessage(

          channel,
          battle,

`${rolePing}

🔥 **BATTLE APPROACHING**

⚔️ ${battle.host} vs ${battle.opponent}
🕒 Begins in 30 minutes

Prepare the arena.
Charge your blessings.
Flame Force moves soon.`

        );

        await db.query(
          "UPDATE battles SET reminder30 = TRUE WHERE id = $1",
          [battle.id]
        );

      }


      /*
      ==============================
      10 MINUTE REMINDER
      ==============================
      */

      if (
        battle.time === minus10 &&
        !battle.reminder10
      ) {

        await sendBattleMessage(

          channel,
          battle,

`${rolePing}

🔥 **FINAL CALL TO ARMS**

⚔️ ${battle.host} vs ${battle.opponent}
🕒 Starts in 10 minutes

Support squad assemble now.
Momentum wins battles.
Flame Force stands together.`

        );

        await db.query(
          "UPDATE battles SET reminder10 = TRUE WHERE id = $1",
          [battle.id]
        );

      }


      /*
      ==============================
      LIVE ALERT
      ==============================
      */

      if (
        battle.time === nowTime &&
        !battle.live
      ) {

        await sendBattleMessage(

          channel,
          battle,

`${rolePing}

🔥 **BATTLE LIVE NOW**

⚔️ ${battle.host} vs ${battle.opponent}

Enter the arena.
Send blessings.
Push the victory.

Flame Force does not spectate — we dominate.`

        );

        await db.query(
          "UPDATE battles SET live = TRUE WHERE id = $1",
          [battle.id]
        );

      }

    }

  } catch (err) {

    console.log("Reminder engine error:", err.message);

  }

}, {
  timezone: "Europe/London"
});


/*
==============================
DAILY BATTLE BOARD
==============================
*/

cron.schedule("0 9 * * *", async () => {

  try {

    const today = getUKDate();

    const result = await db.query(
      "SELECT * FROM battles WHERE date = $1 ORDER BY time ASC",
      [today]
    );

    if (!result.rows.length) return;

    const firstBattle = result.rows[0];

    const channel = await client.channels.fetch(
      firstBattle.channel
    );

    if (!channel) return;

    const rolePing =
      getRoleMentions(channel.guild);

    let message = `${rolePing}

🔥 **TODAY'S FLAME FORCE BATTLE BOARD**

`;

    result.rows.forEach(battle => {

      message += `⚔️ ${battle.time} — ${battle.host} vs ${battle.opponent}\n`;

    });

    message += `

Support where you can.
Bless where it counts.
Victory is collective.`;

    await channel.send(message);

  } catch (err) {

    console.log("Daily board error:", err.message);

  }

}, {
  timezone: "Europe/London"
});


/*
==============================
LOGIN
==============================
*/

client.login(process.env.TOKEN);