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
GatewayIntentBits.GuildMessages
]
});

const sentReminders = new Set();


client.once("clientReady", () => {

console.log(`🔥 Battle Bot online as ${client.user.tag}`);

});


/*
POST EMBED
*/
async function postBattleNow(battle){

const channel =
await client.channels.fetch(
process.env.BATTLE_CHANNEL_ID
);

if(!channel) return;

const embed = new EmbedBuilder()

.setTitle("🔥 Battle Scheduled")

.addFields(
{ name:"Host", value:battle.hostname || battle.host },
{ name:"Opponent", value:battle.opponent },
{ name:"Date", value:battle.date },
{ name:"Time", value:battle.time }
)

.setColor("#ff6600")
.setTimestamp();

if(battle.livelink){

embed.addFields({
name:"🔴 LIVE",
value:battle.livelink
});

}

await channel.send({

embeds:[embed],

files: battle.posterdata
? [{ attachment:battle.posterdata, name:"poster.jpg" }]
: []

});

}


/*
APPROVE / REJECT BUTTONS
*/
client.on(Events.InteractionCreate, async interaction => {

if(!interaction.isButton()) return;

const [action,id] =
interaction.customId.split("_");


if(action==="reject"){

await db.query(
"DELETE FROM battle_requests WHERE id=$1",
[id]
);

return interaction.reply({
content:"❌ Request rejected",
ephemeral:true
});

}


if(action!=="approve") return;


const result =
await db.query(
"SELECT * FROM battle_requests WHERE id=$1",
[id]
);

if(!result.rows.length) return;

const request=result.rows[0];


await interaction.reply({
content:"📤 Upload poster within 60 seconds",
ephemeral:true
});


const collector =
interaction.channel.createMessageCollector({

filter:m =>
m.author.id === interaction.user.id &&
m.attachments.size > 0,

max:1,
time:60000

});


collector.on("collect", async msg=>{

const attachment=msg.attachments.first();

const response=await fetch(attachment.url);

const buffer=
Buffer.from(await response.arrayBuffer());


const member =
await interaction.guild.members.fetch(
interaction.user.id
);

const displayName =
member.displayName;


const inserted = await db.query(

`INSERT INTO battles
(host,hostname,opponent,date,time,posterdata)
VALUES ($1,$2,$3,$4,$5,$6)
RETURNING *`,

[
interaction.user.id,
displayName,
request.opponent,
request.preferred_date,
request.preferred_time,
buffer
]

);


await postBattleNow(inserted.rows[0]);


await db.query(
"DELETE FROM battle_requests WHERE id=$1",
[id]
);


msg.reply("✅ Battle approved");

});

});


/*
REMINDER SYSTEM
*/
cron.schedule("*/5 * * * *", async () => {

const battles =
await db.query("SELECT * FROM battles");

const now=new Date();


for(const battle of battles.rows){

const key=
`${battle.id}_${battle.date}_${battle.time}`;

if(sentReminders.has(key)) continue;

const diff =
(new Date(`${battle.date} ${battle.time}`)-now)/60000;


if(diff>29 && diff<31){

const channel =
await client.channels.fetch(
process.env.REMINDER_CHANNEL_ID
);

if(channel){

await channel.send(
`⏰ Reminder: ${
battle.hostname || battle.host
} vs ${battle.opponent} starts in 30 minutes`
);

sentReminders.add(key);

}

}

}

});


client.login(process.env.TOKEN);