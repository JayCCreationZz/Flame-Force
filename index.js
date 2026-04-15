const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
const config = require('./config.json');
const db = require('./database');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});


/*
==============================
BOT READY EVENT
==============================
*/

client.once('clientReady', () => {
  console.log('🔥 Flame Force Battle System Online');
});


/*
==============================
ROLE FETCH HELPER
==============================
*/

function getRoleMentions(guild) {

  const roleNames = ['Spark', 'Ember', 'Blaze'];

  const mentions = roleNames
    .map(name => guild.roles.cache.find(r => r.name === name))
    .filter(Boolean)
    .map(role => `<@&${role.id}>`)
    .join(' ');

  return mentions || '';
}


/*
==============================
HELPER: UK TIME FUNCTIONS
==============================
*/

function getUKTime(offsetMinutes = 0) {

  const now = new Date();
  now.setMinutes(now.getMinutes() + offsetMinutes);

  return now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London'
  });

}

function getUKDate() {

  return new Date().toLocaleDateString('en-GB', {
    timeZone: 'Europe/London'
  });

}


/*
==============================
SLASH COMMAND HANDLER
==============================
*/

client.on('interactionCreate', async interaction => {

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'battle') {

    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {

      const opponent = interaction.options.getString('opponent');
      const date = interaction.options.getString('date');
      const time = interaction.options.getString('time');

      db.run(
        `INSERT INTO battles (host, opponent, date, time, channel)
         VALUES (?, ?, ?, ?, ?)`,
        [
          interaction.user.username,
          opponent,
          date,
          time,
          interaction.channel.id
        ]
      );

      await interaction.reply(`🔥 **FLAME FORCE BATTLE LOCKED IN**

⚔️ Host: ${interaction.user.username}
🆚 Opponent: ${opponent}
📅 Date: ${date}
🕒 Time: ${time} (UK)

Your battlefield is prepared.
Summon your supporters. Gather your blessings.
Victory favours the relentless.`);
    }
  }
});


/*
==============================
REMINDER ENGINE
Runs every minute
==============================
*/

cron.schedule('* * * * *', async () => {

  const nowTime = getUKTime();
  const today = getUKDate();

  const minus10 = getUKTime(10);
  const minus30 = getUKTime(30);

  db.all(
    `SELECT * FROM battles WHERE date = ?`,
    [today],
    async (err, rows) => {

      if (!rows || rows.length === 0) return;

      rows.forEach(async battle => {

        const channel = client.channels.cache.get(battle.channel);
        if (!channel) return;

        const guild = channel.guild;
        const rolePing = getRoleMentions(guild);


        /*
        ==============================
        30 MINUTE WARNING
        ==============================
        */

        if (battle.time === minus30 && battle.reminder30 === 0) {

          channel.send(`${rolePing}

🔥 **BATTLE APPROACHING**

⚔️ ${battle.host} vs ${battle.opponent}
🕒 Begins in 30 minutes

Prepare the arena.
Charge your blessings.
Flame Force moves soon.`);

          db.run(
            `UPDATE battles SET reminder30 = 1 WHERE id = ?`,
            [battle.id]
          );
        }


        /*
        ==============================
        10 MINUTE WARNING
        ==============================
        */

        if (battle.time === minus10 && battle.reminder10 === 0) {

          channel.send(`${rolePing}

🔥 **FINAL CALL TO ARMS**

⚔️ ${battle.host} vs ${battle.opponent}
🕒 Starts in 10 minutes

Support squad assemble now.
Momentum wins battles.
Flame Force stands together.`);

          db.run(
            `UPDATE battles SET reminder10 = 1 WHERE id = ?`,
            [battle.id]
          );
        }


        /*
        ==============================
        LIVE ALERT
        ==============================
        */

        if (battle.time === nowTime && battle.live === 0) {

          channel.send(`${rolePing}

🔥 **BATTLE LIVE NOW**

⚔️ ${battle.host} vs ${battle.opponent}

Enter the arena.
Send blessings.
Push the victory.

Flame Force does not spectate — we dominate.`);

          db.run(
            `UPDATE battles SET live = 1 WHERE id = ?`,
            [battle.id]
          );
        }

      });

    }
  );

}, {
  timezone: "Europe/London"
});


/*
==============================
DAILY BATTLE BOARD
==============================
*/

cron.schedule('0 9 * * *', async () => {

  const today = getUKDate();

  db.all(
    `SELECT * FROM battles WHERE date = ? ORDER BY time ASC`,
    [today],
    async (err, rows) => {

      if (!rows || rows.length === 0) return;

      const channel = client.channels.cache.get(rows[0].channel);
      if (!channel) return;

      const rolePing = getRoleMentions(channel.guild);

      let message = `${rolePing}

🔥 **TODAY'S FLAME FORCE BATTLE BOARD**

`;

      rows.forEach(battle => {
        message += `⚔️ ${battle.time} — ${battle.host} vs ${battle.opponent}\n`;
      });

      message += `
Support where you can.
Bless where it counts.
Victory is collective.`;

      channel.send(message);

    }
  );

}, {
  timezone: "Europe/London"
});


/*
==============================
LOGIN
==============================
*/

client.login(config.token);