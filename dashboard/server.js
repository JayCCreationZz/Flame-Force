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

/*
IMPORTANT:
Import instant-post function from bot
*/
const { postBattleNow } = require("../index");

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

if(roles.includes(OWNER_ROLE)) return "owner";
if(roles.includes(ADMIN_ROLE)) return "admin";

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

const result =
await db.query(
"SELECT posterData FROM battles WHERE id=$1",
[req.params.id]
);

if(!result.rows.length)
return res.sendStatus(404);

res.set("Content-Type","image/jpeg");

res.send(result.rows[0].posterdata);

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
FETCH MEMBERS
*/

async function getAgencyMembers(){

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

}

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

const memberMap={};

members.forEach(m=>{
memberMap[m.id]=m.name;
});

const battles=battlesRaw.rows.map(b=>{

b.hostName=
memberMap[b.host]||b.host;

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

/*
INSERT + RETURN ROW
*/

const inserted =
await db.query(

`INSERT INTO battles
(host,opponent,date,time,posterData,
liveLink,managerGifting,adultOnly,
powerUps,noHammers)

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
INSTANT DISCORD POST
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
await db.query(
"SELECT * FROM battles ORDER BY date,time"
);

res.render("calendar",{

battles:battlesRaw.rows,
roleLevel:req.roleLevel,
userId:req.user.id

});

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