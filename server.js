require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const path = require('path');

const gamesRouter = require('./routes/games');

const app = express();
const PORT = process.env.PORT || 3000;

// Indicar a Express que confíe en el proxy de Vercel
app.set('trust proxy', 1);

const BASE_URL = process.env.REALM 
  ? process.env.REALM.replace(/\/$/, '') 
  : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${PORT}`);

const REALM = `${BASE_URL}/`;
const RETURN_URL = `${BASE_URL}/auth/steam/return`;

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

// Configuración de Sesiones compatible con Vercel Serverless
app.use(session({
  cookie: { 
    maxAge: 86400000, // 24 horas
    secure: process.env.NODE_ENV === 'production' || !!process.env.VERCEL_URL,
    sameSite: 'lax'
  },
  store: new MemoryStore({
    checkPeriod: 86400000 // Limpia sesiones expiradas cada 24h
  }),
  resave: true,
  saveUninitialized: true,
  secret: process.env.SESSION_SECRET || 'dev-secret-cambiame'
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

// Solo iniciamos el servidor si no estamos en producción (Vercel)
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL_URL) {
  app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;