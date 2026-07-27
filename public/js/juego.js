const userBox = document.getElementById('userBox');
const gameHeader = document.getElementById('gameHeader');
const achievementsContent = document.getElementById('achievementsContent');

// Elementos del Modal
const modal = document.getElementById('achievementModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalIcon = document.getElementById('modalIcon');
const modalTitle = document.getElementById('modalTitle');
const modalStatus = document.getElementById('modalStatus');
const modalDesc = document.getElementById('modalDesc');
const modalDate = document.getElementById('modalDate');

// Obtener parámetros de la URL
const urlParams = new URLSearchParams(window.location.search);
const appid = urlParams.get('appid');
const nameParam = urlParams.get('name');
const headerParam = urlParams.get('header');

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  return `Desbloqueado el ${date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })} a las ${date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
}

async function init() {
  if (!appid || !gameHeader || !achievementsContent) {
    return;
  }

  setupModalEvents();

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

    await loadGameDetails();
  } catch (err) {
    console.error(err);
    if (achievementsContent) {
      achievementsContent.innerHTML = `<div class="state-msg">Error al cargar la información del juego.</div>`;
    }
  }
}

async function loadGameDetails() {
  try {
    const res = await fetch(`/api/achievements/${appid}`);
    const data = await res.json();

    const gameName = (data.gameName && data.gameName !== 'testtest') 
      ? data.gameName 
      : (nameParam ? decodeURIComponent(nameParam) : 'Juego de Steam');

    const headerImage = headerParam 
      ? decodeURIComponent(headerParam) 
      : `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;

    const pct = data.total ? Math.round((data.unlocked / data.total) * 100) : 0;

    if (gameHeader) {
      gameHeader.innerHTML = `
        <div class="game-detail-card">
          <img class="game-detail-card__img" src="${headerImage}" alt="${gameName}" onerror="this.style.display='none'" />
          <div class="game-detail-card__info">
            <h1 class="game-detail-card__title">${gameName}</h1>
            <div class="game-detail-card__stats">
              <span>${data.unlocked} / ${data.total} logros</span>
              <span>·</span>
              <span>${pct}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-bar__fill" style="width: ${pct}%"></div>
            </div>
            <button id="refreshBtn" class="btn-refresh">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
              </svg>
              Actualizar logros
            </button>
          </div>
        </div>
      `;

      // Asignar evento al botón de refrescar
      const refreshBtn = document.getElementById('refreshBtn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
          refreshBtn.classList.add('spin');
          refreshBtn.disabled = true;
          await loadGameDetails();
        });
      }
    }

    if (!data.hasAchievements || !data.achievements.length) {
      if (achievementsContent) {
        achievementsContent.innerHTML = `<div class="state-msg">Este juego no contiene logros registrados o tu perfil es privado.</div>`;
      }
      return;
    }

    const unlocked = data.achievements.filter(a => a.achieved);
    const locked = data.achievements.filter(a => !a.achieved);

    if (achievementsContent) {
      achievementsContent.innerHTML = `
        ${renderSection('🔓 Desbloqueados', unlocked)}
        ${renderSection('🔒 Pendientes', locked)}
      `;

      document.querySelectorAll('.achievement-card').forEach(card => {
        card.addEventListener('click', () => {
          const achData = JSON.parse(card.dataset.achievement);
          openModal(achData);
        });
      });
    }

  } catch (err) {
    console.error(err);
    if (achievementsContent) {
      achievementsContent.innerHTML = `<div class="state-msg">Error al conectar con la API de Steam.</div>`;
    }
  }
}

function renderSection(title, achievements) {
  if (!achievements.length) return '';
  return `
    <div class="achievements-section">
      <h2 class="achievements-section__title">${title} <span>${achievements.length}</span></h2>
      <div class="achievements-list">
        ${achievements.map(a => `
          <div class="achievement-card ${a.achieved ? 'unlocked' : 'locked'}" data-achievement='${JSON.stringify(a).replace(/'/g, "&apos;")}'>
            <img class="achievement-card__icon" src="${a.icon}" alt="${a.name}" onerror="this.src='/img/placeholder.png'" />
            <div class="achievement-card__info">
              <p class="achievement-card__name">${a.name}</p>
              <p class="achievement-card__desc">${a.description || 'Desafío de la historia principal.'}</p>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function openModal(a) {
  if (!modal) return;
  if (modalIcon) modalIcon.src = a.icon;
  if (modalTitle) modalTitle.textContent = a.name;
  if (modalDesc) modalDesc.textContent = a.description || 'Este es un logro secreto de la historia del juego.';

  if (modalStatus && modalDate) {
    if (a.achieved) {
      modalStatus.textContent = 'Desbloqueado';
      modalStatus.className = 'modal-status unlocked';
      modalDate.textContent = formatDate(a.unlocktime);
    } else {
      modalStatus.textContent = 'Bloqueado';
      modalStatus.className = 'modal-status locked';
      modalDate.textContent = 'Aún no has completado este desafío.';
    }
  }

  modal.classList.add('active');
}

function closeModal() {
  if (modal) modal.classList.remove('active');
}

function setupModalEvents() {
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
      closeModal();
    }
  });
}

init();