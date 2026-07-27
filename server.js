require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const path = require('path');

const gamesRouter = require('./routes/games');

const app = express();
const PORT = process.env.PORT || 3000;

// Construimos la URL base asegurando el protocolo https:// si no viene en las env
const DOMAIN = process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}` 
  : `http://localhost:${PORT}`;

// Damos prioridad a REALM y RETURN_URL de las variables de entorno si existen
const REALM = process.env.REALM || `${DOMAIN}/`;
const RETURN_URL = process.env.RETURN_URL || `${DOMAIN}/auth/steam/return`;

if (!process.env.STEAM_API_KEY) {
  console.warn('\n⚠️  No definiste STEAM_API_KEY en las variables de entorno.\n');
}

// --- Passport / Steam OpenID ---
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new SteamStrategy(
  {
    returnURL: RETURN_URL,
    realm: REALM,
    apiKey: process.env.STEAM_API_KEY
  },
  (identifier, profile, done) => {
    profile.identifier = identifier;
    return done(null, profile);
  }
));

// --- Middlewares ---
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-cambiame',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 días
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'No autenticado' });
}

// --- Auth routes ---
app.get('/auth/steam', passport.authenticate('steam'));

app.get(
  '/auth/steam/return',
  passport.authenticate('steam', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/juegos.html');
  }
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });
});

app.get('/api/user', (req, res) => {
  if (req.isAuthenticated()) {
    return res.json({
      authenticated: true,
      steamId: req.user.id,
      displayName: req.user.displayName,
      avatar: req.user.photos && req.user.photos.length ? req.user.photos[2].value : null,
      profileUrl: req.user._json ? req.user._json.profileurl : null
    });
  }
  res.json({ authenticated: false });
});

// --- API de juegos / logros (protegida) ---
app.use('/api', requireAuth, gamesRouter);

// Solo iniciamos el servidor local si no estamos en Vercel
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  });
}

// Requerido para Vercel Serverless Functions
module.exports = app;