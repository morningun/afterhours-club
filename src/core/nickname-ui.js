import { NET_COLORS, peerColor, restyleRig, nameTag, cssOf } from './avatar.js';

/**
 * Wire the shared nickname / outfit panel.
 * storageKeyPrefix e.g. 'afterhours' or 'embers' → localStorage `${prefix}.name|color`
 */
export function setupNicknameUI({
  storageKeyPrefix,
  playerRig,
  player,
  getPlayerTag,
  setPlayerTag,
  defaultColor = 0,
  defaultTagName = null,
  sendProfile = null,
  onApplied = null
}) {
  const meBtn = document.getElementById('me');
  const meDot = document.getElementById('meDot');
  const meName = document.getElementById('meName');
  const panel = document.getElementById('panel');
  const nameInput = document.getElementById('nameInput');
  const swatches = document.getElementById('swatches');
  const applyBtn = document.getElementById('apply');
  const panelMsg = document.getElementById('panelMsg');

  const STORE_NAME = storageKeyPrefix + '.name';
  const STORE_COLOR = storageKeyPrefix + '.color';
  const ME = { color: defaultColor, name: '' };

  function markSwatch(i) {
    for (const el of swatches.children) el.classList.toggle('on', Number(el.dataset.i) === i);
  }

  function paintSwatches() {
    swatches.innerHTML = '';
    NET_COLORS.forEach((hex, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.i = String(i);
      b.style.background = cssOf(hex);
      b.setAttribute('aria-label', '옷 색 ' + (i + 1));
      b.addEventListener('click', () => {
        ME.color = i;
        for (const el of swatches.children) el.classList.toggle('on', el === b);
        panelMsg.textContent = '';
        panelMsg.classList.remove('err');
      });
      swatches.appendChild(b);
    });
    markSwatch(ME.color);
  }

  function retagPlayer(name, hex) {
    const prev = getPlayerTag();
    if (prev) {
      player.remove(prev);
      if (prev.material.map) prev.material.map.dispose();
      prev.material.dispose();
    }
    const tag = nameTag(name, hex);
    player.add(tag);
    setPlayerTag(tag);
  }

  function applyMe(name, colorIdx, remember) {
    ME.color = colorIdx;
    ME.name = name || ME.name;
    restyleRig(playerRig, peerColor(colorIdx));
    if (name) retagPlayer(name, peerColor(colorIdx));
    meDot.style.background = cssOf(peerColor(colorIdx));
    meDot.style.color = cssOf(peerColor(colorIdx));
    meName.textContent = ME.name || '나';
    markSwatch(colorIdx);
    if (remember) {
      try {
        localStorage.setItem(STORE_NAME, ME.name);
        localStorage.setItem(STORE_COLOR, String(colorIdx));
      } catch (e) { /* private mode */ }
    }
    if (onApplied) onApplied(ME);
  }

  function setPanelMsg(text, bad) {
    panelMsg.textContent = text;
    panelMsg.classList.toggle('err', !!bad);
  }

  function openPanel(open) {
    panel.classList.toggle('open', open);
    if (open) {
      nameInput.value = ME.name;
      nameInput.focus();
      nameInput.select();
      panelMsg.textContent = '';
    }
  }

  meBtn.addEventListener('click', e => {
    e.stopPropagation();
    openPanel(!panel.classList.contains('open'));
  });
  panel.addEventListener('click', e => e.stopPropagation());
  addEventListener('pointerdown', e => {
    if (panel.classList.contains('open') && !panel.contains(e.target) && !meBtn.contains(e.target)) {
      openPanel(false);
    }
  });

  function commit() {
    const want = nameInput.value.replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!want) { setPanelMsg('닉네임을 입력해 주세요.', true); nameInput.focus(); return; }

    let sent = false;
    if (sendProfile) sent = !!sendProfile(want, ME.color);
    applyMe(want, ME.color, true);

    if (sendProfile) {
      if (sent) setPanelMsg('다른 사람 화면에도 반영됐어요.');
      else setPanelMsg('저장했어요. 서버에 붙으면 그때 함께 반영됩니다.', true);
    } else {
      setPanelMsg('저장했어요.');
    }
    openPanel(false);
  }

  applyBtn.addEventListener('click', commit);
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); openPanel(false); }
  });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.classList.contains('open')) openPanel(false);
  });

  function restoreMe() {
    let name = '', color = defaultColor;
    try {
      name = localStorage.getItem(STORE_NAME) || '';
      const c = Number(localStorage.getItem(STORE_COLOR));
      if (Number.isInteger(c) && c >= 0 && c < NET_COLORS.length) color = c;
    } catch (e) { /* private mode */ }
    ME.color = color;
    paintSwatches();
    restyleRig(playerRig, peerColor(color));
    meDot.style.background = cssOf(peerColor(color));
    meDot.style.color = cssOf(peerColor(color));
    markSwatch(color);
    if (name) {
      ME.name = name;
      meName.textContent = name;
      retagPlayer(name, peerColor(color));
    } else if (defaultTagName) {
      retagPlayer(defaultTagName, peerColor(color));
    }
    return { name, color };
  }

  restoreMe();

  return { ME, applyMe, retagPlayer, openPanel, setPanelMsg, restoreMe, paintSwatches };
}
