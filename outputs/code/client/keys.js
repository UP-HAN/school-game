// 조작 키 표 (한 곳에서 정한다). game.js(키 받기)·meeting.js·app.js(버튼 아래 키 글자)·manual.js(놀이 방법)·tips.js(TIP)가
// 모두 이 값을 쓴다. 키를 바꾸려면 여기만 고치면 된다.
//   code: 자판의 자리(e.code). 한글 자판·Caps Lock 이어도 같은 키로 받는다.
//   label: 버튼 아래 작은 글씨 "(Space)" 에 쓰는 이름, name: 설명 글에 쓰는 이름
export const KEYS = {
  move: { codes: { L: ['ArrowLeft', 'KeyA'], R: ['ArrowRight', 'KeyD'], U: ['ArrowUp', 'KeyW'], D: ['ArrowDown', 'KeyS'] }, label: 'WASD·방향키', name: 'W A S D 또는 방향키(← ↑ ↓ →)' },
  act: { codes: ['Space', 'Enter', 'NumpadEnter'], label: 'Space', name: '스페이스(또는 엔터)' },
  sabo1: { codes: ['Digit1', 'Numpad1'], label: '1', name: '1' },
  sabo2: { codes: ['Digit2', 'Numpad2'], label: '2', name: '2' },
  sabo3: { codes: ['Digit3', 'Numpad3'], label: '3', name: '3' },
  bag: { codes: ['KeyB'], label: 'B', name: 'B' },
  notebook: { codes: ['KeyN'], label: 'N', name: 'N' },
  map: { codes: ['KeyM'], label: 'M', name: 'M' },
  esc: { codes: ['Escape'], label: 'Esc', name: 'Esc' },
  pick: { codes: [], label: '방향키', name: '방향키(←→)' },
};

// 버튼 아래에 붙는 작은 글씨: "(Space)"
export const keyHint = (k) => (KEYS[k] ? `(${KEYS[k].label})` : '');
// 설명 글에 쓰는 이름: "스페이스(또는 엔터)"
export const keyName = (k) => (KEYS[k] ? KEYS[k].name : '');

// data-keyhint="act" 처럼 표시해 둔 칸에 키 글자를 채운다
export function applyKeyHints(root = document) {
  for (const el of root.querySelectorAll('[data-keyhint]')) el.textContent = keyHint(el.dataset.keyhint);
}

// 키보드를 쓰는 기기인지: 마우스·터치패드가 있거나, 키를 한 번이라도 누르면 키 글자를 보여 준다.
// 터치만 되는 휴대폰·태블릿은 <html class="touch-only"> 로 키 글자를 숨긴다 (CSS).
export function watchKeyboard() {
  const root = document.documentElement;
  const fine = window.matchMedia ? window.matchMedia('(any-pointer: fine)') : { matches: true };
  const set = () => root.classList.toggle('touch-only', !fine.matches && !root.classList.contains('has-kbd'));
  set();
  if (fine.addEventListener) fine.addEventListener('change', set);
  window.addEventListener(
    'keydown',
    (e) => {
      // 글자칸에서 누른 키는 화면 키보드일 수 있어 세지 않는다
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.code && !root.classList.contains('has-kbd')) {
        root.classList.add('has-kbd');
        set();
      }
    },
    true,
  );
}
