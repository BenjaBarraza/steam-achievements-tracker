const express = require('express');
const axios = require('axios');

const router = express.Router();
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const STEAM_ACCESS_TOKEN = process.env.STEAM_ACCESS_TOKEN;
const STEAM_API_BASE = 'https://api.steampowered.com';

async function getFamilySharedGames(steamId) {
  if (!STEAM_ACCESS_TOKEN) return [];

  let cleanToken = STEAM_ACCESS_TOKEN.replace(/^"|"$/g, '').trim();

  const axiosConfig = {
    headers: {
      'Cookie': `steamLoginSecure=${cleanToken}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  };

  try {
    const groupRes = await axios.get(
      `${STEAM_API_BASE}/IFamilyGroupsService/GetFamilyGroupForUser/v1/?steamid=${steamId}`,
      axiosConfig
    );

    const familyGroupId = groupRes.data.response && groupRes.data.response.family_groupid;
    if (!familyGroupId) return [];

    const sharedRes = await axios.get(
      `${STEAM_API_BASE}/IFamilyGroupsService/GetSharedLibraryApps/v1/?family_groupid=${familyGroupId}&include_own=false&include_free=true`,
      axiosConfig
    );

    const apps = (sharedRes.data.response && sharedRes.data.response.apps) || [];

    return apps
      .filter(a => a.exclude_reason === 0 || a.exclude_reason === undefined)
      .filter(a => !(a.owner_steamids || []).includes(steamId))
      .map(a => ({
        appid: a.appid,
        name: a.name,
        shared: true,
        ownerSteamId: (a.owner_steamids || [])[0] || null,
        playtime_forever: a.rt_playtime || 0,
        img_icon_url: null,
        header_image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${a.appid}/header.jpg`
      }));
  } catch (err) {
    return [];
  }
}

// GET /api/games/search -> Busca juegos en la tienda de Steam
router.get('/games/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);

  try {
    const searchRes = await axios.get(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=spanish&cc=US`);
    const items = searchRes.data.items || [];
    
    const results = items.map(item => ({
      appid: item.id,
      name: item.name,
      header_image: item.tiny_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/header.jpg`
    }));

    res.json(results);
  } catch (err) {
    console.error('Error al buscar juegos:', err.message);
    res.status(500).json({ error: 'Error al buscar en la tienda de Steam' });
  }
});

// POST /api/games/custom -> Agrega un juego por su AppID
router.post('/games/custom', async (req, res) => {
  const { appid } = req.body;

  if (!appid || isNaN(appid)) {
    return res.status(400).json({ error: 'Debes seleccionar un juego válido.' });
  }

  try {
    const storeRes = await axios.get(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=spanish`);
    const appData = storeRes.data[appid];

    if (!appData || !appData.success) {
      return res.status(404).json({ error: 'No se encontró el juego en Steam.' });
    }

    const gameInfo = appData.data;

    const customGame = {
      appid: parseInt(appid),
      name: gameInfo.name,
      shared: true,
      customAdded: true,
      ownerName: 'Steam Family',
      playtime_forever: 0,
      img_icon_url: null,
      header_image: gameInfo.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`
    };

    res.json({ success: true, game: customGame });
  } catch (err) {
    console.error('Error al agregar juego manual:', err.message);
    res.status(500).json({ error: 'No se pudo obtener la información del juego desde Steam.' });
  }
});

// GET /api/games -> biblioteca completa
router.get('/games', async (req, res) => {
  const steamId = req.user.id;
  try {
    const { data } = await axios.get(`${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/`, {
      params: {
        key: STEAM_API_KEY,
        steamid: steamId,
        include_appinfo: true,
        include_played_free_games: true
      }
    });

    const ownedGames = (data.response.games || []).map(g => ({
      appid: g.appid,
      name: g.name,
      shared: false,
      playtime_forever: g.playtime_forever,
      img_icon_url: g.img_icon_url
        ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg`
        : null,
      header_image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`
    }));

    const ownedAppIds = new Set(ownedGames.map(g => g.appid));
    const sharedGames = (await getFamilySharedGames(steamId))
      .filter(g => !ownedAppIds.has(g.appid));

    if (sharedGames.length) {
      const ownerIds = [...new Set(sharedGames.map(g => g.ownerSteamId).filter(Boolean))];
      try {
        const { data: summaryData } = await axios.get(`${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/`, {
          params: { key: STEAM_API_KEY, steamids: ownerIds.join(',') }
        });
        const nameMap = {};
        (summaryData.response.players || []).forEach(p => { nameMap[p.steamid] = p.personaname; });
        sharedGames.forEach(g => { g.ownerName = nameMap[g.ownerSteamId] || 'un amigo'; });
      } catch (e) {
        sharedGames.forEach(g => { g.ownerName = 'un amigo'; });
      }
    }

    const games = [...ownedGames, ...sharedGames]
      .sort((a, b) => b.playtime_forever - a.playtime_forever);

    res.json({ total: games.length, games });
  } catch (err) {
    console.error('Error /api/games:', err.message);
    res.status(500).json({ error: 'No se pudo obtener la biblioteca de Steam.' });
  }
});

// GET /api/achievements/:appid -> Logros del usuario combinados con el esquema de la API de Steam
router.get('/achievements/:appid', async (req, res) => {
  const { appid } = req.params;
  const steamId = req.user.id;

  try {
    const [achievementsResult, schemaResult, storeResult] = await Promise.allSettled([
      axios.get(`${STEAM_API_BASE}/ISteamUserStats/GetPlayerAchievements/v1/`, {
        params: { key: STEAM_API_KEY, steamid: steamId, appid, l: 'spanish' }
      }),
      axios.get(`${STEAM_API_BASE}/ISteamUserStats/GetSchemaForGame/v2/`, {
        params: { key: STEAM_API_KEY, appid, l: 'spanish' }
      }),
      axios.get(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=spanish`)
    ]);

    const playerOk =
      achievementsResult.status === 'fulfilled' &&
      achievementsResult.value.data.playerstats &&
      achievementsResult.value.data.playerstats.success;

    if (!playerOk) {
      let gameName = null;
      if (schemaResult.status === 'fulfilled' && schemaResult.value.data.game) {
        gameName = schemaResult.value.data.game.gameName;
      }
      return res.json({ hasAchievements: false, gameName, total: 0, unlocked: 0, achievements: [] });
    }

    const playerAchievements = achievementsResult.value.data.playerstats.achievements || [];

    const schemaAchievements =
      schemaResult.status === 'fulfilled' &&
      schemaResult.value.data.game &&
      schemaResult.value.data.game.availableGameStats
        ? schemaResult.value.data.game.availableGameStats.achievements || []
        : [];

    const schemaMap = {};
    schemaAchievements.forEach(a => { schemaMap[a.name] = a; });

    // Extraer descripciones de la Store API de Steam si existen
    const storeAchievementsMap = {};
    if (storeResult.status === 'fulfilled' && storeResult.value.data[appid] && storeResult.value.data[appid].success) {
      const storeData = storeResult.value.data[appid].data;
      if (storeData.achievements && storeData.achievements.highlighted) {
        storeData.achievements.highlighted.forEach(ach => {
          storeAchievementsMap[ach.name.toLowerCase()] = ach.path; // Referencia de la tienda
        });
      }
    }

    const achievements = playerAchievements
      .map(a => {
        const info = schemaMap[a.apiname] || {};
        const title = info.displayName || a.apiname;
        
        let description = info.description;
        
        // Si sigue viniendo vacía la descripción de Steam, muestra qué tipo de logro es según su nombre o estado
        if (!description || description.trim() === '') {
          description = a.achieved 
            ? 'Logro completado con éxito.' 
            : 'Desbloquea este logro secreto progresando en la aventura.';
        }

        return {
          apiname: a.apiname,
          achieved: !!a.achieved,
          unlocktime: a.unlocktime || null,
          name: title,
          description: description,
          icon: a.achieved ? info.icon : (info.icongray || info.icon)
        };
      })
      .sort((a, b) => (b.achieved - a.achieved) || (b.unlocktime - a.unlocktime));

    const unlocked = achievements.filter(a => a.achieved).length;

    let gameName = achievementsResult.value.data.playerstats.gameName;
    if (!gameName || gameName === 'testtest') {
      if (schemaResult.status === 'fulfilled' && schemaResult.value.data.game) {
        gameName = schemaResult.value.data.game.gameName;
      } else if (storeResult.status === 'fulfilled' && storeResult.value.data[appid] && storeResult.value.data[appid].success) {
        gameName = storeResult.value.data[appid].data.name;
      }
    }

    res.json({
      hasAchievements: true,
      gameName,
      total: achievements.length,
      unlocked,
      achievements
    });
  } catch (err) {
    console.error(`Error /api/achievements/${appid}:`, err.message);
    res.status(500).json({ error: 'No se pudieron obtener los logros de este juego.' });
  }
});

module.exports = router;