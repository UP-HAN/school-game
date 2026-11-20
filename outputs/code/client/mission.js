// 학생용 문제 창. 정답은 서버만 알고, 여기서는 고른 답을 보내고 결과만 받는다.
const $ = (id) => document.getElementById(id);

/** opts: { send(msg), onOpen(), onClose() } */
export function initMission(opts) {
  let open = false;
  let kind = null;
  let lockTimer = 0;
  let lockedUntil = 0;

  function setLocked(ms) {
    clearInterval(lockTimer);
    lockedUntil = performance.now() + ms;
    const tick = () => {
      const left = Math.ceil((lockedUntil - performance.now()) / 1000);
      const locked = left > 0;
      for (const b of $('m-choices').children) b.disabled = locked || b.classList.contains('removed');
      $('m-submit').disabled = locked;
      $('m-input').disabled = locked;
      if (locked) {
        $('m-feedback').textContent = `다시 확인해 보세요. ${left}초 뒤에 다시 답할 수 있어요.`;
      } else {
        clearInterval(lockTimer);
        if (ms > 0) {
          $('m-feedback').textContent = '다시 도전!';
          if (kind === 'short') $('m-input').focus();
        }
      }
    };
    tick();
    if (ms > 0) lockTimer = setInterval(tick, 250);
  }

  function showHelp(help, removedCount) {
    let text = '';
    if (help) {
      text = `도움: 정답은 ${help.length}글자예요.`;
      if (help.first) text += ` 첫 글자는 "${help.first}"예요.`;
    } else if (removedCount) {
      text = '도움: 틀린 보기를 지웠어요.';
    }
    $('m-help').textContent = text;
  }
  function markRemoved(removed) {
    [...$('m-choices').children].forEach((b, i) => {
      if (removed.includes(i)) {
        b.classList.add('removed');
        b.disabled = true;
      }
    });
  }

  function show(m) {
    open = true;
    kind = m.kind;
    $('m-text').textContent = m.text;
    $('m-feedback').textContent = '';
    $('m-feedback').className = 'mission-feedback';
    const box = $('m-choices');
    box.replaceChildren();
    box.hidden = m.kind !== 'choice';
    $('m-form').hidden = m.kind !== 'short';
    if (m.kind === 'choice') {
      m.choices.forEach((text, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn choice';
        b.textContent = text;
        b.addEventListener('click', () => {
          b.classList.add('picked-wrong'); // 정답이면 창이 닫히므로 표시가 남는 것은 오답뿐이다
          opts.send({ t: 'answer', value: i });
        });
        box.append(b);
      });
      markRemoved(m.removed || []);
    } else {
      $('m-input').value = '';
    }
    showHelp(m.help, (m.removed || []).length);
    $('mission').hidden = false;
    setLocked(m.lockMs || 0);
    if (m.kind === 'short' && !m.lockMs) $('m-input').focus();
    opts.onOpen();
  }

  function hide() {
    if (!open) return;
    open = false;
    clearInterval(lockTimer);
    $('mission').hidden = true;
    opts.onClose();
  }

  function result(m) {
    if (!open) return;
    const fb = $('m-feedback');
    if (m.ok) {
      clearInterval(lockTimer);
      fb.textContent = '정답! 단말기를 고쳤어요!';
      fb.className = 'mission-feedback ok';
      for (const b of $('m-choices').children) b.disabled = true;
      $('m-submit').disabled = true;
      setTimeout(hide, 900);
      return;
    }
    fb.className = 'mission-feedback no';
    const card = document.querySelector('.mission-card');
    card.classList.remove('shake');
    void card.offsetWidth; // 흔들기 효과를 다시 시작시킨다
    card.classList.add('shake');
    markRemoved(m.removed || []);
    showHelp(m.help, (m.removed || []).length);
    setLocked(m.lockMs || 0);
  }

  $('m-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = $('m-input').value.trim();
    if (value) opts.send({ t: 'answer', value });
  });
  $('m-close').addEventListener('click', () => {
    opts.send({ t: 'closeq' });
    hide();
  });
  window.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') $('m-close').click();
  });

  return { show, result, hide, isOpen: () => open };
}
