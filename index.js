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
intents:[GatewayIntentBits.Guilds]
});


/*
BOT READY
*/

client.once("clientReady", async()=>{

console.log("🔥 Flame Force Battle System Online");

try{

const ch =
await client.channels.fetch(
process.env.REMINDER_CHANNEL_ID
);

if(ch){

await ch.send("✅ Reminder system connected");

}

}catch(err){

console.log("Reminder channel test failed:",err.message);

}

});


/*
ROLE PINGS
*/

function getRoleMentions(guild){

const roleNames=["Spark","Ember","Blaze"];

return roleNames
.map(name=>guild.roles.cache.find(r=>r.name===name))
.filter(Boolean)
.map(role=>`<@&${role.id}>`)
.join(" ");

}


/*
UK DATE/TIME HELPERS
*/

function getUKNow(){

return new Date(
new Date().toLocaleString(
"en-GB",
{timeZone:"Europe/London"}
)
);

}

function minutesFromTime(str){

if(!str) return null;

const parts=str.split(":");

if(parts.length!==2) return null;

return Number(parts[0])*60 + Number(parts[1]);

}


/*
RULE BADGES
*/

function formatRules(battle){

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

function buildEmbed(battle,title){

return new EmbedBuilder()

.setColor("#ff4d00")

.setTitle(title)

.setDescription(
`⚔ <@${battle.host}> vs **${battle.opponent}**`
)

.addFields(
{ name:"📅 Date",value:battle.date,inline:true },
{ name:"⏰ Time",value:battle.time,inline:true },
{ name:"Battle Rules",value:formatRules(battle) }
)

.setFooter({
text:"Flame Force Agency"
});

}


/*
SEND EMBED WITH POSTER
*/

async function sendEmbed(channel,battle,title){

const embed=buildEmbed(battle,title);

const payload={embeds:[embed]};

if(battle.posterdata){

const attachment=
new AttachmentBuilder(
Buffer.from(battle.posterdata),
{name:"battle.jpg"}
);

embed.setImage("attachment://battle.jpg");

payload.files=[attachment];

}

await channel.send(payload);

}


/*
POST BATTLE IMMEDIATELY WHEN CREATED
*/

async function postBattleNow(battle){

try{

const channel=
await client.channels.fetch(
process.env.BATTLE_CHANNEL_ID
);

if(!channel){

console.log("❌ Battle channel missing");
return;

}

await sendEmbed(
channel,
battle,
"⚔ New Battle Scheduled"
);

console.log(
"📢 Battle posted:",
battle.host,
"vs",
battle.opponent
);

}catch(err){

console.log("Battle post error:",err.message);

}

}


/*
REMINDER ENGINE
*/

cron.schedule("* * * * *",async()=>{

try{

const now=getUKNow();

const today=now.toLocaleDateString("en-GB");

const nowMinutes=
now.getHours()*60 + now.getMinutes();

const result=
await db.query(
"SELECT * FROM battles WHERE date=$1",
[today]
);

if(!result.rows.length) return;

const reminderChannel=
await client.channels.fetch(
process.env.REMINDER_CHANNEL_ID
);

if(!reminderChannel){

console.log("❌ Reminder channel missing");
return;

}

const rolePing=
getRoleMentions(reminderChannel.guild);


for(const battle of result.rows){

const battleMinutes=
minutesFromTime(battle.time);

if(battleMinutes===null) continue;

const diff=battleMinutes-nowMinutes;


/*
30 MIN REMINDER
*/

if(diff===30 && !battle.reminder30){

await reminderChannel.send(rolePing);

await sendEmbed(
reminderChannel,
battle,
"🔥 Battle Starting In 30 Minutes"
);

await db.query(
"UPDATE battles SET reminder30=TRUE WHERE id=$1",
[battle.id]
);

}


/*
10 MIN REMINDER
*/

if(diff===10 && !battle.reminder10){

await reminderChannel.send(rolePing);

await sendEmbed(
reminderChannel,
battle,
"🔥 Final Call — Battle Starts Soon"
);

await db.query(
"UPDATE battles SET reminder10=TRUE WHERE id=$1",
[battle.id]
);

}


/*
LIVE ALERT
*/

if(diff===0 && !battle.live){

await reminderChannel.send(rolePing);

await sendEmbed(
reminderChannel,
battle,
"🔥 Battle LIVE NOW"
);

await db.query(
"UPDATE battles SET live=TRUE WHERE id=$1",
[battle.id]
);

}

}

}catch(err){

console.log("Reminder engine error:",err.message);

}

},{
timezone:"Europe/London"
});


/*
EXPORT FUNCTION FOR DASHBOARD CREATE ROUTE
*/

module.exports.postBattleNow=postBattleNow;


/*
LOGIN
*/

client.login(process.env.TOKEN);