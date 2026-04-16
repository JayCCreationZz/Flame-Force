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

const CREATOR_ROLES = [
  OWNER_ROLE,
  ADMIN_ROLE
];

const upload = multer({ dest: "tmp/" });

/*
IMAGE PROCESSOR
*/
async function processPoster(file) {

  if (!file) return null;

  const buffer = await sharp(file.path)
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

app.set("views", process.cwd()+"/dashboard/views");

app.use(express.static(
process.cwd()+"/dashboard/public"
));

app.use(express.urlencoded({extended:true}));

app.set("trust proxy",1);

app.use(session({

secret:
process.env.SESSION_SECRET || "secret",

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
ROLE CHECK
*/
async function getUserRoleLevel(req){

try{

const res =
await axios.get(

`https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${req.user.id}`,

{
headers:{
Authorization:`Bot ${process.env.TOKEN}`
}
}

);

const roles=res.data.roles;

if(roles.includes(OWNER_ROLE))
return "owner";

if(roles.includes(ADMIN_ROLE))
return "admin";

return "none";

}catch{

return "none";

}

}

/*
AUTH MIDDLEWARE
*/
async function checkAuth(req,res,next){

if(!req.isAuthenticated())
return res.redirect("/");

req.roleLevel =
await getUserRoleLevel(req);

if(req.roleLevel==="none")
return res.send("Access denied");

next();

}

/*
FETCH MEMBERS
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

return response.data

.filter(member =>
member.roles.some(role =>
CREATOR_ROLES.includes(role)
)
)

.map(member=>({

id:member.user.id,

name:
member.nick ||
member.user.global_name ||
member.user.username

}))

.sort((a,b)=>
a.name.localeCompare(b.name)
);

}catch{

return [];

}

}

/*
LOGIN ROUTES
*/
app.get("/",(req,res)=>res.render("login"));

app.get("/login",
passport.authenticate("discord")
);

app.get("/auth/callback",

passport.authenticate("discord",
{failureRedirect:"/"}),

(req,res)=>res.redirect("/dashboard")

);

app.get("/logout",
(req,res)=>req.logout(()=>res.redirect("/"))
);

/*
SERVE POSTER FROM DATABASE
*/
app.get("/poster/:id", async (req,res)=>{

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

const memberMap={};

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
roleLevel:req.roleLevel,
agencyMembers:members

});

});

/*
CREATE BATTLE
*/
app.post("/create",

checkAuth,

upload.single("poster"),

async(req,res)=>{

if(!["owner","admin"]
.includes(req.roleLevel))
return res.send("Permission denied");

const{

host,
opponent,
date,
time,
liveLink,
managerGifting,
adultOnly,
powerUps,
noHammers

}=req.body;

const poster =
await processPoster(req.file);

await db.query(

`INSERT INTO battles
(host,opponent,date,time,posterData,
liveLink,managerGifting,adultOnly,
powerUps,noHammers)

VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,

[
host,
opponent,
date,
time,
poster,
liveLink,
managerGifting==="true",
adultOnly==="true",
powerUps==="true",
noHammers==="true"
]

);

/*
POST TO DISCORD
*/
try{

await axios.post(

`https://discord.com/api/v10/channels/${process.env.BATTLE_CHANNEL_ID}/messages`,

{

content:

`🔥 **Flame Force Battle Scheduled**

⚔ <@${host}> vs ${opponent}

📅 ${date}
⏰ ${time}

🎁 Manager Gifting:
${managerGifting==="true"?"Allowed ✅":"Not Allowed ❌"}

🔞 18+:
${adultOnly==="true"?"Enabled 🔞":"Disabled"}

⚡ Power-Ups:
${powerUps==="true"?"Allowed ⚡":"Not Allowed ❌"}

🔨 Hammers:
${noHammers==="true"?"No Hammers ❌":"Allowed 🔨"}

${liveLink||""}`

},

{
headers:{
Authorization:`Bot ${process.env.TOKEN}`
}
}

);

}catch(err){

console.log("Discord post failed");

}

res.redirect("/dashboard");

});

/*
EDIT
*/
app.post("/edit/:id",

checkAuth,

upload.single("poster"),

async(req,res)=>{

if(!["owner","admin"]
.includes(req.roleLevel))
return res.send("Permission denied");

const{

host,
opponent,
date,
time,
liveLink,
managerGifting,
adultOnly,
powerUps,
noHammers

}=req.body;

const poster =
await processPoster(req.file);

if(poster){

await db.query(

`UPDATE battles
SET host=$1,
opponent=$2,
date=$3,
time=$4,
posterData=$5,
liveLink=$6,
managerGifting=$7,
adultOnly=$8,
powerUps=$9,
noHammers=$10
WHERE id=$11`,

[
host,
opponent,
date,
time,
poster,
liveLink,
managerGifting==="true",
adultOnly==="true",
powerUps==="true",
noHammers==="true",
req.params.id
]

);

}else{

await db.query(

`UPDATE battles
SET host=$1,
opponent=$2,
date=$3,
time=$4,
liveLink=$5,
managerGifting=$6,
adultOnly=$7,
powerUps=$8,
noHammers=$9
WHERE id=$10`,

[
host,
opponent,
date,
time,
liveLink,
managerGifting==="true",
adultOnly==="true",
powerUps==="true",
noHammers==="true",
req.params.id
]

);

}

res.redirect("/dashboard");

});

/*
DELETE
*/
app.post("/delete/:id",

checkAuth,

async(req,res)=>{

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

async(req,res)=>{

const battles =
await db.query(
"SELECT * FROM battles ORDER BY date,time"
);

res.render("calendar",{

battles:battles.rows,
userId:req.user?.id||null

});

});

/*
START SERVER
*/
const PORT =
process.env.PORT || 8080;

app.listen(PORT,()=>
console.log(`🔥 Dashboard running on ${PORT}`)
);