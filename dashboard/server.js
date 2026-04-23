require("dotenv").config();

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const multer = require("multer");
const sharp = require("sharp");
const fs = require("fs");
const axios = require("axios");

const db = require("../database");
const { postBattleNow } = require("../index");

const app = express();

const OWNER_ROLE = "1439255505053683804";
const ADMIN_ROLE = "1439256200658157588";

/*
UPLOAD
*/

const upload = multer({ dest: "tmp/" });

async function processPoster(file){

if(!file) return null;

const buffer = await sharp(file.path)
.resize(1080,1080,{ fit:"cover" })
.jpeg({ quality:92 })
.toBuffer();

fs.unlinkSync(file.path);

return buffer;

}

/*
CONFIG
*/

app.set("view engine","ejs");

app.set("views", process.cwd()+"/dashboard/views");

app.use(express.static(process.cwd()+"/dashboard/public"));

app.use(express.urlencoded({ extended:true }));

app.set("trust proxy",1);

/*
SESSION
*/

app.use(session({

secret:process.env.SESSION_SECRET || "ember-secret",

resave:false,
saveUninitialized:false,

cookie:{
secure:process.env.NODE_ENV==="production",
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

},(a,b,profile,done)=>done(null,profile)));

passport.serializeUser((u,d)=>d(null,u));
passport.deserializeUser((o,d)=>d(null,o));

/*
ROLE CHECK
*/

async function getUserRoleLevel(req){

try{

const response = await axios.get(
`https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${req.user.id}`,
{ headers:{ Authorization:`Bot ${process.env.TOKEN}` } }
);

const roles = response.data.roles || [];

if(roles.includes(OWNER_ROLE)) return "owner";
if(roles.includes(ADMIN_ROLE)) return "admin";

return "member";

}catch(err){

console.log("Role lookup error:",err.message);
return "member";

}

}

async function checkAuth(req,res,next){

if(!req.isAuthenticated())
return res.redirect("/");

req.roleLevel = await getUserRoleLevel(req);

next();

}

/*
GET DISCORD MEMBERS
*/

async function getAgencyMembers(){

const response = await axios.get(
`https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members?limit=1000`,
{ headers:{ Authorization:`Bot ${process.env.TOKEN}` } }
);

return response.data.map(member=>({

id:member.user.id,
name:
member.nick ||
member.user.global_name ||
member.user.username

}));

}

/*
POSTER STREAM
*/

app.get("/poster/:id", async(req,res)=>{

const result = await db.query(
"SELECT posterdata FROM battles WHERE id=$1",
[req.params.id]
);

if(!result.rows.length) return res.sendStatus(404);

res.set("Content-Type","image/jpeg");
res.send(result.rows[0].posterdata);

});

/*
LOGIN ROUTES
*/

app.get("/",(req,res)=>res.render("login"));

app.get("/login",passport.authenticate("discord"));

app.get("/auth/callback",
passport.authenticate("discord",{ failureRedirect:"/" }),
(req,res)=>res.redirect("/dashboard")
);

app.get("/logout",(req,res)=>req.logout(()=>res.redirect("/")));

/*
DASHBOARD
*/

app.get("/dashboard",checkAuth,async(req,res)=>{

const battlesRaw =
await db.query("SELECT * FROM battles ORDER BY date,time");

const members = await getAgencyMembers();

const map = {};
members.forEach(m=>map[m.id]=m.name);

const battles = battlesRaw.rows.map(b=>{
b.hostName = map[b.host] || b.host;
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

const posterBuffer = await processPoster(req.file);

const inserted = await db.query(
`INSERT INTO battles
(host,opponent,date,time,posterdata,
livelink,managergifting,adultonly,
powerups,nohammers)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
RETURNING *`,
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
POST TO DISCORD
*/

await postBattleNow(inserted.rows[0]);

res.redirect("/dashboard");

});

/*
DELETE
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
CALENDAR
*/

app.get("/calendar",
checkAuth,
async(req,res)=>{

const battlesRaw =
await db.query("SELECT * FROM battles ORDER BY date,time");

const members = await getAgencyMembers();

const map = {};
members.forEach(m=>map[m.id]=m.name);

const battles = battlesRaw.rows.map(b=>{
b.hostName = map[b.host] || b.host;
return b;
});

res.render("calendar",{
battles,
roleLevel:req.roleLevel,
userId:req.user.id
});

});

/*
PUBLIC REQUEST FORM
*/

app.get("/request",(req,res)=>{

res.render("request");

});

/*
SUBMIT REQUEST + WEBHOOK
*/

app.post("/request",async(req,res)=>{

const inserted = await db.query(
`INSERT INTO battle_requests
(requester,agency,opponent,
preferred_date,preferred_time,notes)
VALUES ($1,$2,$3,$4,$5,$6)
RETURNING *`,
[
req.body.requester,
req.body.agency,
req.body.opponent,
req.body.date,
req.body.time,
req.body.notes
]
);

const r = inserted.rows[0];

if(process.env.REQUEST_WEBHOOK_URL){

try{

await axios.post(
process.env.REQUEST_WEBHOOK_URL,
{
embeds:[
{
title:"📩 New Battle Request",
color:0xff6600,
fields:[
{ name:"Agency",value:r.agency||"Unknown",inline:true },
{ name:"Requester",value:r.requester||"Unknown",inline:true },
{ name:"Opponent",value:r.opponent||"Unknown",inline:true },
{ name:"Preferred Date",value:r.preferred_date||"Not specified",inline:true },
{ name:"Preferred Time",value:r.preferred_time||"Not specified",inline:true },
{ name:"Notes",value:r.notes||"None" }
],
timestamp:new Date()
}
]
}
);

console.log("📨 Request sent to Discord");

}catch(err){

console.log("Webhook failed:",err.message);

}

}

res.send("Battle request submitted successfully ✅");

});

/*
START SERVER
*/

app.listen(process.env.PORT||8080,()=>{

console.log("🔥 Dashboard running");

});