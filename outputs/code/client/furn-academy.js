// academy 맵 전용 가구·바닥 그림. maprender.js 가 그리기 도구(kit)를 넘겨 주면 { FURN, FLOORS } 를 돌려준다.
// FURN[종류](c, x, y, w, h) 는 가구 그림, FLOORS[이름](c, x, y, w, h) 는 방 바닥 그림 (rooms 의 floor).
// 이미 있는 이름(maprender.js)은 다시 정의하지 말고, 새 이름만 만든다.
export default function make(kit) {
  // const { rr, circle, shadow, lines, checker, label, INK } = kit;
  const FURN = {};
  const FLOORS = {};
  return { FURN, FLOORS };
}
