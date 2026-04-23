require("dotenv").config();

const {
Client,
GatewayIntentBits,
Events,
EmbedBuilder,
ActionRowBuilder,
ButtonBuilder,
ButtonStyle
} = require("discord.js");

const cron = require("node-cron");
const db = require("./database");

const client = new Client({

intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent
]

});

/*
BOT READY
*/

client.once("ready", () => {

console.log(
`🔥 Battle Bot online as ${client.user.tag}`
);

});

/*
POST BATTLE EMBED
*/

async function postBattleNow(battle){

try{

const channel =
await client.channels.fetch(
process.env.BATTLE_CHANNEL_ID
);

if(!channel) return;

const embed = new EmbedBuilder()

.setTitle("🔥 Battle Scheduled")

.addFields(

{
name:"Host",
value:battle.hostname || battle.host,
inline:true
},

{
name:"Opponent",
value:battle.opponent,
inline:true
},

{
name:"Date",
value:battle.date,
inline:true
},

{
name:"Time",
value:battle.time,
inline:true
}

)

.setColor("#ff6600")

.setTimestamp();

if(battle.livelink)
embed.addFields({
name:"Live Link",
value:battle.livelink
});

await channel.send({

embeds:[embed],

files: battle.posterdata
? [{ attachment:battle.posterdata, name:"poster.jpg" }]
: []

});

console.log(
`📢 Poster sent to Discord: ${battle.hostname || battle.host} vs ${battle.opponent}`
);

}catch(err){

console.log(
"Battle post error:",
err.message
);

}

}

module.exports.postBattleNow = postBattleNow;

/*
SEND REQUEST EMBED WITH BUTTONS
*/

async function sendBattleRequestEmbed(request){

const channel =
await client.channels.fetch(
process.env.REQUEST_CHANNEL_ID
);

if(!channel) return;

const row =
new ActionRowBuilder().addComponents(

new ButtonBuilder()
.setCustomId(`approve_${request.id}`)
.setLabel("Approve Battle")
.setStyle(ButtonStyle.Success),

new ButtonBuilder()
.setCustomId(`reject_${request.id}`)
.setLabel("Reject Request")
.setStyle(ButtonStyle.Danger)

);

await channel.send({

embeds:[
new EmbedBuilder()

.setTitle("📩 New Battle Request")

.addFields(

{ name:"Agency", value:request.agency || "Unknown", inline:true },

{ name:"Requester", value:request.requester || "Unknown", inline:true },

{ name:"Opponent", value:request.opponent || "Unknown", inline:true },

{ name:"Preferred Date", value:request.preferred_date || "Not set", inline:true },

{ name:"Preferred Time", value:request.preferred_time || "Not set", inline:true },

{ name:"Notes", value:request.notes || "None" }

)

.setColor("#ffaa00")

.setTimestamp()

],

components:[row]

});

}

module.exports.sendBattleRequestEmbed =
sendBattleRequestEmbed;

/*
APPROVE / REJECT BUTTON HANDLER
*/

client.on(Events.InteractionCreate, async interaction => {

if(!interaction.isButton()) return;

const [action, requestId] =
interaction.customId.split("_");

if(action === "reject"){

await db.query(
"DELETE FROM battle_requests WHERE id=$1",
[requestId]
);

return interaction.reply({

content:"❌ Request rejected",

ephemeral:true

});

}

if(action !== "approve") return;

/*
FETCH REQUEST
*/

const result =
await db.query(
"SELECT * FROM battle_requests WHERE id=$1",
[requestId]
);

if(!result.rows.length)
return interaction.reply({

content:"Request not found",

ephemeral:true

});

const request = result.rows[0];

await interaction.reply({

content:
"📤 Upload the battle poster image within 60 seconds",

ephemeral:true

});

/*
WAIT FOR POSTER UPLOAD
*/

const filter = msg =>
msg.author.id === interaction.user.id &&
msg.attachments.size > 0;

const collector =
interaction.channel.createMessageCollector({

filter,
max:1,
time:60000

});

collector.on("collect", async msg => {

const attachment =
msg.attachments.first();

const response =
await fetch(attachment.url);

const buffer =
Buffer.from(await response.arrayBuffer());

/*
INSERT BATTLE
*/

const inserted =
await db.query(

`INSERT INTO battles
(host, opponent, date, time, posterdata)
VALUES ($1,$2,$3,$4,$5)
RETURNING *`,

[
request.requester,
request.opponent,
request.preferred_date,
request.preferred_time,
buffer
]

);

/*
POST TO CHANNEL
*/

await postBattleNow(inserted.rows[0]);

/*
REMOVE REQUEST
*/

await db.query(
"DELETE FROM battle_requests WHERE id=$1",
[requestId]
);

await msg.reply(
"✅ Battle approved and posted"
);

});

collector.on("end", collected => {

if(!collected.size){

interaction.followUp({

content:
"❌ Poster upload timed out",

ephemeral:true

});

}

});

});

/*
REMINDER SYSTEM
*/

cron.schedule("*/5 * * * *", async () => {

const battles =
await db.query(
"SELECT * FROM battles"
);

const now = new Date();

for(const battle of battles.rows){

const battleTime =
new Date(`${battle.date} ${battle.time}`);

const diff =
(battleTime - now) / 60000;

if(diff > 29 && diff < 31){

const channel =
await client.channels.fetch(
process.env.REMINDER_CHANNEL_ID
);

if(!channel) return;

await channel.send(

`⏰ Reminder: ${battle.hostname || battle.host} vs ${battle.opponent} starts in 30 minutes!`

);

}

}

});

/*
LOGIN
*/

client.login(process.env.TOKEN);