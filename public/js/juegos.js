const userBox = document.getElementById('userBox');
const content = document.getElementById('content');
const gameCount = document.getElementById('gameCount');

function formatPlaytime(minutes) {
  const hours = minutes / 60;
  if (hours < 1) return `${minutes} min`;
  return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
}

function getCustomGames() {
  return JSON.parse(localStorage.getItem('custom_family_games') || '[]');
}

function saveCustomGame(game) {
  const customList = getCustomGames();
  if (!customList.some(g => g.appid === game.appid)) {
    customList.push(game);
    localStorage.setItem('custom_family_games', JSON.stringify(customList));
  }
}

function removeCustomGame(appid) {
  let customList = getCustomGames();
  customList = customList.filter(g => g.appid !== appid);
  localStorage.setItem('custom_family_games', JSON.stringify(customList));
  loadGames();
}

async function init() {
  try {
    const userRes = await fetch('/api/user');
    const user = await userRes.json();

    if (!user.authenticated) {
      window.location.href = '/';
      return;
    }

    if (userBox) {
      userBox.innerHTML = `
        ${user.avatar ? `<img src="${user.avatar}" alt="avatar" />` : ''}
        <span>${user.displayName}</span>
        <a href="/auth/logout" class="topbar__logout">Salir</a>
      `;
    }

    setupLiveSearch();
    await loadGames();
  } catch (err) {
    console.error(err);
    if (content) {
      content.innerHTML = `<div class="state-msg">Ocurrió un error al cargar tu sesión. Intenta recargar la página.</div>`;
    }
  }
}

function setupLiveSearch() {
  const input = document.getElementById('customSearchInput');
  const resultsContainer = document.getElementById('searchResults');
  let debounceTimer;

  if (!input || !resultsContainer) return;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();

    if (query.length < 2) {
      resultsContainer.classList.remove('active');
      resultsContainer.innerHTML = '';
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/games/search?q=${encodeURIComponent(query)}`);
        const games = await res.json();

        if (!games.length) {
          resultsContainer.innerHTML = `<div class="search-item"><span style="color:#64748b;">Sin resultados encontrados</span></div>`;
          resultsContainer.classList.add('active');
          return;
        }

        resultsContainer.innerHTML = '';
        games.forEach(game => {
          const item = document.createElement('div');
          item.className = 'search-item';
          item.innerHTML = `
            <img src="${game.header_image}" alt="${game.name}" onerror="this.style.display='none'" />
            <span>${game.name}</span>
          `;
          
          item.addEventListener('click', () => addGameByAppId(game.appid, input, resultsContainer));
          resultsContainer.appendChild(item);
        });

        resultsContainer.classList.add('active');
      } catch (err) {
        console.error('Error al buscar:', err);
      }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !resultsContainer.contains(e.target)) {
      resultsContainer.classList.remove('active');
    }
  });
}

async function addGameByAppId(appid, input, resultsContainer) {
  resultsContainer.classList.remove('active');
  input.value = 'Agregando juego...';
  input.disabled = true;

  try {
    const res = await fetch('/api/games/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appid })
    });

    const data = await res.json();

    if (data.success) {
      saveCustomGame(data.game);
      input.value = '';
      await loadGames();
    } else {
      alert(data.error || 'No se pudo agregar el juego.');
      input.value = '';
    }
  } catch (err) {
    alert('Error de conexión con el servidor.');
    input.value = '';
  } finally {
    input.disabled = false;
  }
}

async function loadGames() {
  try {
    const res = await fetch('/api/games');
    if (!res.ok) throw new Error('No se pudo obtener la biblioteca');
    const data = await res.json();

    const apiGames = data.games || [];
    const customGames = getCustomGames();

    const apiAppIds = new Set(apiGames.map(g => g.appid));
    const filteredCustomGames = customGames.filter(g => !apiAppIds.has(g.appid));

    const allGames = [...filteredCustomGames, ...apiGames];

    if (!allGames.length) {
      if (content) content.innerHTML = `<div class="state-msg">No encontramos juegos en tu biblioteca. Revisa que tu perfil de Steam sea público.</div>`;
      return;
    }

    if (gameCount) gameCount.textContent = `${allGames.length} JUEGOS`;

    if (content) {
      content.innerHTML = `<div class="game-grid" id="gameGrid"></div>`;
      const grid = document.getElementById('gameGrid');

      allGames.forEach(game => {
        const card = document.createElement('div');
        card.className = 'game-card';
        card.style.position = 'relative';

        const deleteIcon = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        `;

        card.innerHTML = `
          ${game.customAdded ? `<button class="remove-btn" title="Eliminar de mi biblioteca">${deleteIcon}</button>` : ''}
          <div class="game-card__img-wrap">
            <img class="game-card__img" src="${game.header_image}" alt="${game.name}"
                 onerror="this.style.display='none'" />
            ${game.shared ? `<span class="shared-tag">👪 Compartido${game.ownerName ? ' · ' + game.ownerName : ''}</span>` : ''}
          </div>
          <div class="game-card__body">
            <p class="game-card__name" title="${game.name}">${game.name}</p>
            <div class="game-card__meta">
              <span>${formatPlaytime(game.playtime_forever)}</span>
            </div>
          </div>
        `;

        if (game.customAdded) {
          const removeBtn = card.querySelector('.remove-btn');
          removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`¿Quitar "${game.name}" de tu biblioteca personal?`)) {
              removeCustomGame(game.appid);
            }
          });
        }

        card.addEventListener('click', () => {
          const url = `/juego.html?appid=${game.appid}&name=${encodeURIComponent(game.name)}&header=${encodeURIComponent(game.header_image)}`;
          window.location.href = url;
        });

        grid.appendChild(card);
      });
    }
  } catch (err) {
    console.error(err);
    if (content) content.innerHTML = `<div class="state-msg">Error al cargar tu biblioteca de Steam.</div>`;
  }
}

init();