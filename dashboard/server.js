const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');

const db = require('../database');

const config = {
    token: process.env.TOKEN,
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    guildId: process.env.GUILD_ID,
    callbackURL: process.env.CALLBACK_URL,
    managerRoles: ["Manager", "Admin", "Mod"]
};

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

/* SESSION */

app.use(session({
    secret: "flameforce-secret",
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

/* DISCORD LOGIN */

passport.use(new DiscordStrategy({
    clientID: config.clientId,
    clientSecret: config.clientSecret,
    callbackURL: config.callbackURL,
    scope: ['identify', 'guilds', 'guilds.members.read']
},
(accessToken, refreshToken, profile, done) => {
    profile.accessToken = accessToken;
    return done(null, profile);
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

/* FETCH CHANNELS */

async function getGuildChannels() {

    const response = await fetch(
        `https://discord.com/api/guilds/${config.guildId}/channels`,
        {
            headers: { Authorization: `Bot ${config.token}` }
        }
    );

    const channels = await response.json();

    return channels.filter(c => c.type === 0);
}

/* ROLE CHECK */

async function userHasAccess(req) {

    const memberResponse = await fetch(
        `https://discord.com/api/users/@me/guilds/${config.guildId}/member`,
        {
            headers: {
                Authorization: `Bearer ${req.user.accessToken}`
            }
        }
    );

    if (!memberResponse.ok) return false;

    const member = await memberResponse.json();

    const rolesResponse = await fetch(
        `https://discord.com/api/guilds/${config.guildId}/roles`,
        {
            headers: {
                Authorization: `Bot ${config.token}`
            }
        }
    );

    const roles = await rolesResponse.json();

    const allowedRoleIDs = roles
        .filter(role => config.managerRoles.includes(role.name))
        .map(role => role.id);

    return member.roles.some(role =>
        allowedRoleIDs.includes(role)
    );
}

/* AUTH */

async function checkAuth(req, res, next) {

    if (!req.isAuthenticated())
        return res.redirect('/');

    if (!(await userHasAccess(req)))
        return res.send("Access denied");

    next();
}

/* ROUTES */

app.get('/', (req, res) =>
    res.render('login')
);

app.get('/login',
    passport.authenticate('discord')
);

app.get('/auth/callback',
    passport.authenticate('discord', {
        failureRedirect: '/'
    }),
    (req, res) =>
        res.redirect('/dashboard')
);

app.get('/logout',
    (req, res) =>
        req.logout(() => res.redirect('/'))
);

/* DASHBOARD */

app.get('/dashboard', checkAuth, (req, res) => {

    db.all(
        "SELECT * FROM battles ORDER BY date,time",
        [],
        (err, battles) => {

            const week = {
                Monday: [],
                Tuesday: [],
                Wednesday: [],
                Thursday: [],
                Friday: [],
                Saturday: [],
                Sunday: []
            };

            battles.forEach(b => {

                const [d,m,y] = b.date.split('/');

                const dayName =
                    new Date(`${y}-${m}-${d}`)
                    .toLocaleDateString(
                        'en-GB',
                        { weekday: 'long' }
                    );

                if (week[dayName])
                    week[dayName].push(b);

            });

            res.render('dashboard', {
                battles,
                week
            });

        }
    );
});

/* PUBLIC CALENDAR */

app.get('/calendar', (req, res) => {

    db.all(
        "SELECT * FROM battles ORDER BY date,time",
        [],
        (err, battles) => {

            const week = {
                Monday: [],
                Tuesday: [],
                Wednesday: [],
                Thursday: [],
                Friday: [],
                Saturday: [],
                Sunday: []
            };

            battles.forEach(b => {

                const [d,m,y] = b.date.split('/');

                const dayName =
                    new Date(`${y}-${m}-${d}`)
                    .toLocaleDateString(
                        'en-GB',
                        { weekday: 'long' }
                    );

                if (week[dayName])
                    week[dayName].push(b);

            });

            res.render('calendar', { week });

        }
    );
});

/* CREATE */

app.post('/create', checkAuth, (req, res) => {

    const {
        host,
        opponent,
        date,
        time,
        poster,
        liveLink
    } = req.body;

    db.run(
        `INSERT INTO battles
        (host,opponent,date,time,poster,liveLink)
        VALUES (?,?,?,?,?,?)`,
        [host, opponent, date, time, poster, liveLink]
    );

    res.redirect('/dashboard');
});

/* DELETE */

app.post('/delete/:id', checkAuth, (req, res) => {

    db.run(
        `DELETE FROM battles WHERE id=?`,
        [req.params.id]
    );

    res.redirect('/dashboard');
});

/* EDIT */

app.get('/edit/:id', checkAuth, (req, res) => {

    db.get(
        `SELECT * FROM battles WHERE id=?`,
        [req.params.id],
        (err, battle) =>
            res.render('edit', { battle })
    );
});

/* UPDATE */

app.post('/edit/:id', checkAuth, (req, res) => {

    const {
        host,
        opponent,
        date,
        time,
        poster,
        liveLink
    } = req.body;

    db.run(
        `UPDATE battles
         SET host=?,opponent=?,date=?,time=?,poster=?,liveLink=?
         WHERE id=?`,
        [
            host,
            opponent,
            date,
            time,
            poster,
            liveLink,
            req.params.id
        ]
    );

    res.redirect('/dashboard');
});

/* START SERVER */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () =>
    console.log(`🔥 Dashboard running on port ${PORT}`)
);