import { loadJSON } from './engine/loader.js';
import { LocalizedError } from './engine/errors.js';
import { I18n } from './engine/i18n.js';
import { Display } from './engine/display.js';
import { Assets } from './engine/assets.js';
import { AudioManager } from './engine/audio.js';
import { Input } from './engine/input.js';
import { Game } from './game/game.js';
import { Weapons } from './game/weapons.js';
import { GrenadeTypes } from './game/grenades.js';
import { Ranks, Career } from './game/ranks.js';
import { VehicleTypes } from './game/vehicles.js';
import { RocketTypes } from './game/rockets.js';
import { Menu } from './menu.js';
import { Settings } from './settings.js';

const $ = (id) => document.getElementById(id);

function showMessage(text) {
  $('message-text').textContent = text;
  $('overlay-message').classList.remove('hidden');
}

function hideMessage() {
  $('overlay-message').classList.add('hidden');
}

async function enterFullscreenLandscape(mobileCfg) {
  if (!mobileCfg?.requestFullscreen) return;
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
    }
    if (mobileCfg.lockLandscape && screen.orientation?.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch (e) {
    // Non supportato (es. iOS Safari): l'overlay "ruota il dispositivo" fa da fallback
  }
}

async function boot() {
  const i18n = new I18n();
  let i18nReady = false;
  try {
    const config = await loadJSON('config/game.json');
    document.title = config.title || document.title;
    const settings = new Settings(config.menu?.storageKey);

    await i18n.load(config.i18n, settings.get('lang', null));
    i18nReady = true;
    i18n.applyToDOM();
    showMessage(i18n.t('loading'));

    const levelList = config.levels || [];
    if (!levelList.length) throw new LocalizedError('errors.noLevels', {}, 'No levels defined in game.json ("levels")');
    const [assetsCfg, effectsCfg, weaponsCfg, vehiclesCfg, ...levelData] = await Promise.all([
      loadJSON(config.assets),
      loadJSON(config.effects),
      loadJSON(config.weapons),
      config.vehicles ? loadJSON(config.vehicles) : {},
      ...levelList.map((l) => loadJSON(l.file)),
    ]);
    const levels = levelList.map((l, i) => ({ ...l, data: levelData[i] }));
    const weapons = new Weapons(weaponsCfg);
    const grenadeTypes = new GrenadeTypes(weaponsCfg);
    const rocketTypes = new RocketTypes(weaponsCfg);
    const vehicleTypes = new VehicleTypes(vehiclesCfg);

    const display = new Display($('game'), $('ui'), config.display);
    const assets = new Assets();
    await assets.load(assetsCfg, config.teams); // + varianti di squadra degli sprite "teamColored"

    const audio = new AudioManager(assetsCfg.sounds, config.audio);
    audio.setVolume(settings.get('volume', audio.volume));
    await audio.load();

    // ?debug=1 nell'URL: mostra i pulsanti touch di debug (es. togli/ridai vita)
    const urlDebug = new URLSearchParams(location.search).get('debug') === '1';
    const input = new Input(display, config.input, { debug: urlDebug });
    input.setBindings(settings.get('keys', {})); // tasti personalizzati dalle opzioni
    // gradi (game.json -> ranks) e punti di carriera del giocatore salvati tra una partita e l'altra
    const career = new Career(settings, new Ranks(config.ranks));
    const game = new Game({ config, assets, audio, display, input, effectsCfg, weapons, grenadeTypes, i18n, career, vehicleTypes, rocketTypes });

    const menu = new Menu({
      config,
      i18n,
      game,
      input,
      audio,
      assets,
      display,
      levels,
      settings,
      fullscreen: () => enterFullscreenLandscape(config.mobile),
    });
    // fine partita (una squadra senza ticket): schermata di vittoria/sconfitta/pareggio, vedi Menu
    game.onMatchEnd = (outcome) => menu.onMatchEnd(outcome);
    game.onRestart = () => menu.onRestart();

    hideMessage();
    menu.showMain();
    game.start();

    window.BAF2D = game; // comodo per il debug da console
    window.BAF2D_MENU = menu;
  } catch (e) {
    console.error(e);
    // Se i file lingua non sono disponibili si usa il testo inglese di riserva dell'errore
    showMessage(i18nReady ? i18n.error(e) : e.message);
  }
}

boot();
