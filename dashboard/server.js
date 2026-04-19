require("dotenv").config();

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const multer = require("multer");
const sharp = require("sharp");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const db = require("../database");

const app = express();

/*
ROLE IDS
*/
const OWNER_ROLE = "1439255505053683804";
const ADMIN_ROLE = "1439256200658157588";

/*
UPLOAD CONFIG
*/
const upload = multer({ dest: "tmp/" });

/*
POSTER PROCESSOR
*/
async function processPoster(file) {

if(!file) return null;

const buffer =
await sharp(file.path)
.resize(1080,1080,{fit:"cover"})
.jpeg({quality:92})
.toBuffer();

fs.unlinkSync(file.path);

return buffer;

}

/*
EXPRESS CONFIG
*/
app.set("view engine","ejs");

app.set(
"views",
process.cwd()+"/dashboard/views"
);

app.use(express.static(
process.cwd()+"/dashboard/public"
));

app.use(express.urlencoded({extended:true}));

app.set("trust proxy",1);

app.use(session({

secret:
process.env.SESSION_SECRET || "flame-force",

resave:false,
saveUninitialized:false,

cookie:{
secure:true,
sameSite:"none"
}

}));

app.use(passport.initialize());
app.use(passport.session());

/*
DISCORD LOGIN
*/
passport.use(new DiscordStrategy({

clientID:process.env.CLIENT_ID,
clientSecret:process.env.CLIENT_SECRET,
callbackURL:process.env.CALLBACK_URL,
scope:["identify"]

},

(a,b,profile,done)=>done(null,profile)
));

passport.serializeUser((u,d)=>d(null,u));
passport.deserializeUser((o,d)=>d(null,o));

/*
ROLE LOOKUP
*/
async function getUserRoleLevel(req){

try{

const response =
await axios.get(

`https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${req.user.id}`,

{
headers:{
Authorization:`Bot ${process.env.TOKEN}`
}
}

);

const roles=response.data.roles || [];

if(roles.includes(OWNER_ROLE))
return "owner";

if(roles.includes(ADMIN_ROLE))
return "admin";

return "member";

}catch(err){

console.log("Role lookup error:",err.message);

return "member";

}

}

/*
AUTH CHECK
*/
async function checkAuth(req,res,next){

if(!req.isAuthenticated())
return res.redirect("/");

req.roleLevel =
await getUserRoleLevel(req);

next();

}

/*
POSTER ENDPOINT
*/
app.get("/poster/:id", async(req,res)=>{

try{

const result =
await db.query(
"SELECT posterData FROM battles WHERE id=$1",
[req.params.id]
);

if(!result.rows.length ||
!result.rows[0].posterdata)
return res.sendStatus(404);

res.set("Content-Type","image/jpeg");

res.send(result.rows[0].posterdata);

}catch(err){

console.log("Poster fetch error:",err.message);

res.sendStatus(500);

}

});

/*
LOGIN ROUTES
*/
app.get("/",(req,res)=>res.render("login"));

app.get("/login",
passport.authenticate("discord")
);

app.get("/auth/callback",

passport.authenticate(
"discord",
{failureRedirect:"/"}
),

(req,res)=>res.redirect("/dashboard")
);

app.get("/logout",
(req,res)=>req.logout(()=>res.redirect("/"))
);

/*
FETCH DISCORD MEMBERS
*/
async function getAgencyMembers(){

try{

const response =
await axios.get(

`https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members?limit=1000`,

{
headers:{
Authorization:`Bot ${process.env.TOKEN}`
}
}

);

return response.data.map(member=>({

id:member.user.id,

name:
member.nick ||
member.user.global_name ||
member.user.username

}));

}catch(err){

console.log("Member fetch error:",err.message);

return [];

}

}

/*
DEBUG ROLE ROUTE
*/
app.get("/debug-roles", async(req,res)=>{

if(!req.user)
return res.send("Not logged in");

const response =
await axios.get(

`https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${req.user.id}`,

{
headers:{
Authorization:`Bot ${process.env.TOKEN}`
}
}

);

res.json(response.data.roles);

});

/*
DASHBOARD
*/
app.get("/dashboard",

checkAuth,

async(req,res)=>{

const battlesRaw =
await db.query(
"SELECT * FROM battles ORDER BY date,time"
);

const members =
await getAgencyMembers();

const memberMap = {};

members.forEach(m=>{
memberMap[m.id]=m.name;
});

const battles =
battlesRaw.rows.map(b=>{

b.hostName =
memberMap[b.host] || b.host;

return b;

});

res.render("dashboard",{

battles,
agencyMembers:members,
roleLevel:req.roleLevel

});

});

/*
CREATE BATTLE
*/
app.post("/create",

checkAuth,
upload.single("poster"),

async(req,res)=>{

if(!["owner","admin"].includes(req.roleLevel))
return res.send("Permission denied");

const posterBuffer =
await processPoster(req.file);

await db.query(

`INSERT INTO battles
(host,opponent,date,time,posterData,
liveLink,managerGifting,adultOnly,
powerUps,noHammers)

VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,

[
req.body.host,
req.body.opponent,
req.body.date,
req.body.time,
posterBuffer,
req.body.liveLink,
req.body.managerGifting==="true",
req.body.adultOnly==="true",
req.body.powerUps==="true",
req.body.noHammers==="true"
]

);

/*
DISCORD ANNOUNCEMENT
*/
try{

const form = new FormData();

form.append("content",

`🔥 **Battle Scheduled**

⚔ <@${req.body.host}> vs ${req.body.opponent}

📅 ${req.body.date}
⏰ ${req.body.time}

🎁 Manager Gifting:
${req.body.managerGifting==="true"?"Allowed":"Disabled"}

🔞 18+:
${req.body.adultOnly==="true"?"Enabled":"Disabled"}

⚡ Power Ups:
${req.body.powerUps==="true"?"Allowed":"Disabled"}

🔨 No Hammers:
${req.body.noHammers==="true"?"Enabled":"Disabled"}

${req.body.liveLink || ""}`
);

if(posterBuffer){

form.append(
"files[0]",
posterBuffer,
{
filename:"battle.jpg",
contentType:"image/jpeg"
}
);

}

await axios.post(

`https://discord.com/api/v10/channels/${process.env.BATTLE_CHANNEL_ID}/messages`,

form,

{
headers:{
Authorization:`Bot ${process.env.TOKEN}`,
...form.getHeaders()
}
}

);

}catch(err){

console.log("Discord post failed:",err.message);

}

res.redirect("/dashboard");

});

/*
REPLACE POSTER
*/
app.post("/replace-poster/:id",

checkAuth,
upload.single("poster"),

async(req,res)=>{

if(!["owner","admin"].includes(req.roleLevel))
return res.redirect("/dashboard");

const posterBuffer =
await processPoster(req.file);

await db.query(
"UPDATE battles SET posterData=$1 WHERE id=$2",
[posterBuffer,req.params.id]
);

res.redirect("/dashboard");

});

/*
DELETE BATTLE
*/
app.post("/delete/:id",

checkAuth,

async(req,res)=>{

if(!["owner","admin"].includes(req.roleLevel))
return res.redirect("/dashboard");

await db.query(
"DELETE FROM battles WHERE id=$1",
[req.params.id]
);

res.redirect("/dashboard");

});

/*
CALENDAR (FIXED VERSION)
*/
app.get("/calendar",

async(req,res)=>{

try{

const battlesRaw =
await db.query(
"SELECT * FROM battles ORDER BY date,time"
);

const members =
await getAgencyMembers();

const memberMap = {};

members.forEach(m=>{
memberMap[m.id]=m.name;
});

const battles =
battlesRaw.rows.map(b=>{

b.hostName =
memberMap[b.host] || b.host;

return b;

});

res.render("calendar",{

battles,
userId:req.user?.id || null

});

}catch(err){

console.log("Calendar load error:",err.message);

res.send("Calendar failed to load");

}

});

/*
START SERVER
*/
const PORT =
process.env.PORT || 8080;

app.listen(PORT,()=>{

console.log(
`🔥 Flame Force dashboard running on ${PORT}`
);

});