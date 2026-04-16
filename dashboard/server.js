const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const multer = require("multer");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
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
CREATOR ROLE FILTER
*/
const CREATOR_ROLES = [
  OWNER_ROLE,
  ADMIN_ROLE
];

/*
UPLOAD CONFIG
*/
const upload = multer({
  dest: path.join(
    process.cwd(),
    "dashboard/public/posters/tmp"
  )
});

/*
POSTER PROCESSOR
*/
async function processPoster(file) {

  if (!file) return null;

  const postersDir =
    path.join(
      process.cwd(),
      "dashboard/public/posters"
    );

  if (!fs.existsSync(postersDir)) {
    fs.mkdirSync(postersDir, {
      recursive: true
    });
  }

  const filename =
    Date.now() +
    "-" +
    file.originalname.replace(/\s+/g, "_");

  const outputPath =
    path.join(postersDir, filename);

  await sharp(file.path)
    .resize(1080,1080,{fit:"cover"})
    .jpeg({quality:92})
    .toFile(outputPath);

  fs.unlinkSync(file.path);

  return `/posters/${filename}`;
}

/*
EXPRESS CONFIG
*/
app.set("view engine","ejs");

app.set(
  "views",
  path.join(
    process.cwd(),
    "dashboard/views"
  )
);

app.use(express.static(
  path.join(
    process.cwd(),
    "dashboard/public"
  )
));

app.use(express.urlencoded({
  extended:true
}));

/*
SESSION CONFIG
*/
app.set("trust proxy",1);

app.use(session({

  secret:
    process.env.SESSION_SECRET ||
    "flame-force-secret",

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

  clientID:
    process.env.CLIENT_ID,

  clientSecret:
    process.env.CLIENT_SECRET,

  callbackURL:
    process.env.CALLBACK_URL,

  scope:["identify"]

},

(accessToken,refreshToken,profile,done)=>
done(null,profile)
));

passport.serializeUser((u,d)=>d(null,u));
passport.deserializeUser((o,d)=>d(null,o));

/*
ROLE CHECK
*/
async function getUserRoleLevel(req){

  try{

    const response =
      await axios.get(

        `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${req.user.id}`,

        {
          headers:{
            Authorization:
            `Bot ${process.env.TOKEN}`
          }
        }

      );

    const roles =
      response.data.roles || [];

    if(roles.includes(OWNER_ROLE))
      return "owner";

    if(roles.includes(ADMIN_ROLE))
      return "admin";

    return "none";

  }

  catch(err){

    console.log(
      "Role lookup error:",
      err.response?.data ||
      err.message
    );

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
FETCH MEMBERS WITH NICKNAMES
*/
async function getAgencyMembers(){

  try{

    const response =
      await axios.get(

        `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members?limit=1000`,

        {
          headers:{
            Authorization:
            `Bot ${process.env.TOKEN}`
          }
        }

      );

    return response.data

      .filter(member =>
        member.roles.some(role =>
          CREATOR_ROLES.includes(role)
        )
      )

      .map(member=>{

        const displayName =
          member.nick ||
          member.user.global_name ||
          member.user.username;

        return {
          id:member.user.id,
          name:displayName
        };

      })

      .sort((a,b)=>
        a.name.localeCompare(b.name)
      );

  }

  catch(err){

    console.log(
      "Creator fetch failed:",
      err.message
    );

    return [];

  }

}

/*
LOGIN ROUTES
*/
app.get("/",(req,res)=>
res.render("login")
);

app.get(
  "/login",
  passport.authenticate("discord")
);

app.get(
  "/auth/callback",

  passport.authenticate(
    "discord",
    {failureRedirect:"/"}
  ),

  (req,res)=>
  res.redirect("/dashboard")

);

app.get(
  "/logout",
  (req,res)=>
  req.logout(()=>
    res.redirect("/")
  )
);

/*
DEBUG ROLE ROUTE
*/
app.get(
  "/debug-roles",

  async(req,res)=>{

    if(!req.isAuthenticated())
      return res.send("Not logged in");

    const response =
      await axios.get(

        `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${req.user.id}`,

        {
          headers:{
            Authorization:
            `Bot ${process.env.TOKEN}`
          }
        }

      );

    res.json(response.data.roles);

  }
);

/*
DASHBOARD
*/
app.get(
  "/dashboard",

  checkAuth,

  async(req,res)=>{

    const battlesRaw =
      await db.query(
        "SELECT * FROM battles ORDER BY date,time"
      );

    const agencyMembers =
      await getAgencyMembers();

/*
MAP ID → NAME
*/
    const memberMap = {};

    agencyMembers.forEach(member=>{
      memberMap[member.id] =
        member.name;
    });

/*
FORMAT BATTLES
*/
    const battles =
      battlesRaw.rows.map(b=>{

        b.hostName =
          memberMap[b.host] ||
          b.host;

/*
FIX OLD POSTER PATHS
*/
        if(
          b.poster &&
          !b.poster.startsWith("/posters/")
        ){

          const filename =
            b.poster.split("/").pop();

          b.poster =
            "/posters/" + filename;

        }

        return b;

      });

    res.render("dashboard",{

      battles,
      roleLevel:req.roleLevel,
      agencyMembers

    });

});

/*
CREATE BATTLE
*/
app.post(
  "/create",

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

    } = req.body;

    const poster =
      await processPoster(req.file);

    await db.query(

      `INSERT INTO battles
       (host,opponent,date,time,poster,
        liveLink,managerGifting,
        adultOnly,powerUps,noHammers)

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
DISCORD POST
*/
    try{

      const form =
        new FormData();

      form.append(

        "content",

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

      );

      if(poster){

        form.append(
          "file",

          fs.createReadStream(
            path.join(
              process.cwd(),
              "dashboard/public",
              poster
            )
          )

        );

      }

      await axios.post(

        `https://discord.com/api/v10/channels/${process.env.BATTLE_CHANNEL_ID}/messages`,

        form,

        {
          headers:{
            Authorization:
            `Bot ${process.env.TOKEN}`,
            ...form.getHeaders()
          }
        }

      );

      console.log("Posted to Discord");

    }

    catch(err){

      console.log(
        "Discord post failed:",
        err.message
      );

    }

    res.redirect("/dashboard");

});

/*
EDIT BATTLE
*/
app.post(
  "/edit/:id",

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

    } = req.body;

    let poster=null;

    if(req.file)
      poster=
        await processPoster(req.file);

    if(poster){

      await db.query(

`UPDATE battles
SET host=$1,
opponent=$2,
date=$3,
time=$4,
poster=$5,
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

    }

    else{

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
DELETE BATTLE
*/
app.post(
  "/delete/:id",

  checkAuth,

  async(req,res)=>{

    if(!["owner","admin"]
      .includes(req.roleLevel))
      return res.send("Permission denied");

    await db.query(
      "DELETE FROM battles WHERE id=$1",
      [req.params.id]
    );

    res.redirect("/dashboard");

});

/*
CALENDAR
*/
app.get(
  "/calendar",

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
SERVER START
*/
const PORT =
process.env.PORT || 8080;

app.listen(PORT,()=>{

console.log(
`🔥 Flame Force dashboard running on ${PORT}`
);

});