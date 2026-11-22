/**
 * 시뮬레이터 접근 승인 중계(Cloudflare Worker)
 *
 * 회사망처럼 script.google.com 이 막힌 곳에서도 로그인할 수 있도록,
 * 우리 도메인(auth.simulator-kepco.co.kr)으로 받은 요청을 Apps Script 승인 서버에 그대로 전달하고
 * 받은 답을 돌려준다. 회사망에서는 우리 도메인만 보이고 구글 주소는 보이지 않는다.
 *
 * - 데이터는 저장하지 않는다(그대로 전달만 한다).
 * - 우리 사이트(simulator-kepco.co.kr)에서 온 요청만 받는다.
 * - Apps Script를 새로 배포해 주소(/exec)가 바뀌면 TARGET 한 줄만 고친다.
 */
const TARGET = 'https://script.google.com/macros/s/AKfycbyimpa3X5-KDXxJC8_iqLtXn1uHOhidJ6XqJ2o-0H_UkP6jDKE4XMa8N8PLj09-hsu2DA/exec';
const ALLOWED = ['https://simulator-kepco.co.kr', 'https://www.simulator-kepco.co.kr'];
const MAX_BODY = 20000; // 승인 요청은 수백 바이트 수준이라 넉넉한 상한

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(obj, origin, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    // 브라우저로 주소를 열었을 때 동작 확인용
    if (request.method === 'GET') {
      return new Response('시뮬레이터 접근 승인 중계가 동작 중입니다.', {
        headers: { ...cors(origin), 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    if (request.method !== 'POST') return json({ ok: false, msg: '허용되지 않은 요청입니다.' }, origin, 405);
    if (origin && !ALLOWED.includes(origin)) return json({ ok: false, msg: '허용되지 않은 사이트에서 온 요청입니다.' }, origin, 403);

    const body = await request.text();
    if (!body || body.length > MAX_BODY) return json({ ok: false, msg: '요청 형식이 올바르지 않습니다.' }, origin, 400);

    let text;
    try {
      const r = await fetch(TARGET, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow',
      });
      text = await r.text();
    } catch (e) {
      return json({ ok: false, msg: '중계 서버가 승인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.' }, origin, 502);
    }

    // Apps Script가 JSON 대신 오류 페이지(HTML)를 돌려주면 알아볼 수 있는 문구로 바꾼다
    try { JSON.parse(text); } catch (e) {
      return json({ ok: false, msg: '승인 서버에서 오류가 났습니다. 잠시 후 다시 시도하거나 관리자에게 문의해주세요.' }, origin, 502);
    }
    return new Response(text, {
      headers: { ...cors(origin), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  },
};
