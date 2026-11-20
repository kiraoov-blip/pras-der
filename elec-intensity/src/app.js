'use strict';
const D=JSON.parse(document.getElementById('data').textContent);
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const YEARS=D.years, T=D.tables, YI={}; YEARS.forEach((y,i)=>YI[y]=i);
const Y0=YEARS[0], YA=Y0, Y1=YEARS[YEARS.length-1], YR=YEARS.slice();
const EDS={intl:'Ember·세계은행',bok:'한국은행 ECOS',calc:'판매량 ÷ 부가가치',69:'제69호',75:'2006년판',81:'제81호',82:'제82호',86:'제86호',87:'제87호',95:'제95호'};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- 분류 정의 ---------- */
const CLS=[['res','주택용','#3a3f47'],['gen','일반용','#c2410c'],['edu','교육용','#f2a900'],['ind','산업용','#4b5563'],
  ['agr','농사용','#2e9e6b'],['str','가로등','#8b5cf6'],['night','심야','#0e9aa7'],['gis','일반·교육·산업(합산)','#9aa3af']];
const USE=[['res','가정용','#3a3f47'],['pub','공공용','#f2a900'],['svc','서비스업','#c2410c'],['agr','농림어업','#2e9e6b'],['min','광업','#8b5cf6'],['mfg','제조업','#4b5563']];
// 제조업 업종: 한국은행 경제활동별 GDP의 13개 업종 구분(석유정제·화학제품은 판매량이 2017년까지 한 칸이라 합산 업종을 따로 둔다)
const KIND=[['음식료','#c76b00'],['섬유','#d9487a'],['출판목재인쇄','#a1887f'],['석유정제·화학','#0e9aa7'],['석유정제','#0b5e66'],['화학제품','#4fc3c9'],['비금속','#7c8b2a'],['1차금속','#5b6b7f'],['금속가공','#b08900'],['컴퓨터전자','#7c3aed'],['전기장비','#3f7fd9'],['기계장비','#e2725b'],['운송장비','#1f8a5a'],['기타제조','#9aa3af']];
const KCOL=Object.fromEntries(KIND);

const DEF={year:Y1,base:2015,from:Y0,to:Y1,unit:'big',yax:'zero',
  iCls:'mfg',iSel:['제조업','1차금속','비금속','석유정제·화학','컴퓨터전자','운송장비'],iSelC:['total','ind','gen','edu','agr'],iSelU:['total','mfg','svc','pub','agr','min'],iMode:'value',iUnit:'krw',iAx:{},
  hMode:'value',
  wBase:'ppp',wMode:'value',wGroup:'all',wPick:['USA','GBR','DEU','FRA','ITA','JPN','CHN'],wRef:['WLD','OECD','EU'],wKor:true,wAvg:true,wGrey:false,wSort:'desc',wRefRows:true,wYear:2024,wAx:{},
  dTable:'inten'};
let S=structuredClone(DEF);

/* ---------- 단위·형식 ---------- */
const big=()=>true;
const U={ // [표시 단위, 원자료→표시 배율]
  energy:()=>big()?['TWh',1e-6]:['GWh',1e-3],   // MWh
  money:()=>big()?['조원',1e-9]:['억원',1e-5],   // 천원
  power:()=>big()?['GW',1e-6]:['MW',1e-3],       // kW
};
function nf(v,d){ if(v==null||!isFinite(v)) return '–'; const a=Math.abs(v);
  if(d==null) d=a>=1000?0:a>=100?1:a>=10?1:2;
  return v.toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d}); }
const isZero=s=>!/[1-9]/.test(s);
const sgn=(v,d)=>{ if(v==null||!isFinite(v)) return '–'; const s=nf(Math.abs(v),d); return isZero(s)?s:(v>0?'+':'−')+s; };
const pf=(v,d=1)=>v==null||!isFinite(v)?'–':sgn(v,d)+'%';
const chgCls=v=>v==null||Math.abs(v)<1e-6?'':v>0?'up':'down';
const at=(tab,col,y)=>{const a=T[tab][col]; return a?a[YI[y]]:null};
const sum=a=>{let s=0,ok=false; a.forEach(v=>{if(v!=null){s+=v;ok=true}}); return ok?s:null};
function nearest(tab,col,y){ // 값이 없으면 가장 가까운 연도
  for(let d=0;d<40;d++){ for(const yy of [y-d,y+d]){ if(YI[yy]!=null&&yy>=Y0){const v=at(tab,col,yy); if(v!=null) return {v,y:yy}} } }
  return {v:null,y:null}; }


/* ---------- 툴팁·토스트 ---------- */
const tip=$('#tip');
function showTip(e,html){tip.innerHTML=html;tip.hidden=false;moveTip(e)}
function moveTip(e){const w=tip.offsetWidth,h=tip.offsetHeight;let x=e.clientX+14,y=e.clientY+14;if(x+w>innerWidth-8)x=e.clientX-w-14;if(y+h>innerHeight-8)y=e.clientY-h-14;tip.style.left=Math.max(4,x)+'px';tip.style.top=Math.max(4,y)+'px'}
function hideTip(){tip.hidden=true}
document.addEventListener('mouseover',e=>{const t=e.target.closest('[data-tip]'); if(t) showTip(e,t.dataset.tip)});
document.addEventListener('mousemove',e=>{if(e.target.closest('[data-tip]')) moveTip(e)});
document.addEventListener('mouseout',e=>{if(e.target.closest('[data-tip]')) hideTip()});
function legToggle(t){ const h=hid(t.dataset.leg),k=t.dataset.k; h.has(k)?h.delete(k):h.add(k); render(); }
document.addEventListener('click',e=>{const t=e.target.closest('.legend [data-leg]'); if(t) legToggle(t)});
document.addEventListener('keydown',e=>{const t=e.target.closest&&e.target.closest('.legend [data-leg]'); if(t&&(e.key==='Enter'||e.key===' ')){e.preventDefault();const q=`.legend [data-leg="${t.dataset.leg}"][data-k="${t.dataset.k}"]`;legToggle(t);const n=document.querySelector(q);n&&n.focus()}});
function toast(m){const t=document.createElement('div');t.className='toast';t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),2200)}

/* ---------- SVG 선그래프 ---------- */
function niceTicks(lo,hi,n=5){ if(hi<=lo) hi=lo+1; const step0=(hi-lo)/n, mag=Math.pow(10,Math.floor(Math.log10(step0)));
  const step=[1,2,2.5,5,10].map(m=>m*mag).find(s=>s>=step0);
  const a=Math.floor(lo/step)*step, b=Math.ceil(hi/step)*step, t=[]; for(let v=a;v<=b+step*1e-6;v+=step) t.push(+v.toFixed(10));
  return {t,step,lo:a,hi:b}; }
const tickFmt=(v,step)=>v.toLocaleString('ko-KR',{maximumFractionDigits:step<0.01?3:step<1?2:step<10?1:0});
const EXP={};
function lineChart(el,o){
  const xs=o.x, n=xs.length, W=Math.max(300,el.clientWidth||600), H=o.h||340, m={l:58,r:18,t:20,b:28};
  const all=o.series.flatMap(s=>s.pts.filter(v=>v!=null));
  if(!all.length){ el.innerHTML='<div class="empty">표시할 항목이 없습니다. 범례를 눌러 항목을 다시 켜 주세요.</div>'; return; }
  let lo=Math.min(...all), hi=Math.max(...all); if(o.zero&&lo>0) lo=0; if(o.zero&&hi<0) hi=0;
  const ax=o.axis||{}; if(ax.min!=null) lo=ax.min; if(ax.max!=null) hi=ax.max;
  if(lo>=hi){ if(ax.max!=null&&ax.min==null) lo=hi-1; else hi=lo+1; }
  if(lo===hi){lo-=1;hi+=1}
  let tk=niceTicks(lo,hi); const iw=W-m.l-m.r, ih=H-m.t-m.b;
  if(ax.min!=null||ax.max!=null||ax.step){ // 직접 입력한 축: 입력값을 그대로 경계로 쓴다
    const L=ax.min!=null?ax.min:tk.lo, Hh=ax.max!=null?ax.max:tk.hi;
    let st=ax.step>0&&(Hh-L)/ax.step<=40?ax.step:niceTicks(L,Hh).step, t=[];
    for(let v=ax.min!=null?L:Math.ceil(L/st-1e-9)*st;v<=Hh+st*1e-6;v+=st) t.push(+v.toFixed(10)); // 최소값을 넣었으면 눈금도 거기서 시작(엑셀과 같게)
    tk={t,step:st,lo:L,hi:Hh}; }
  const X=i=>m.l+(n>1?iw*i/(n-1):iw/2), Y=v=>m.t+ih*(1-(v-tk.lo)/(tk.hi-tk.lo));
  let g='';
  tk.t.forEach(v=>{g+=`<line x1="${m.l}" x2="${W-m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v===0?'#b9bec7':'#eceef1'}"/><text x="${m.l-8}" y="${Y(v)+4}" text-anchor="end">${tickFmt(v,tk.step)}</text>`});
  const every=Math.ceil(n/(W<520?6:12));
  xs.forEach((x,i)=>{ if(i===n-1||(i%every===0&&n-1-i>=every)) g+=`<text x="${X(i)}" y="${H-8}" text-anchor="middle">${x}</text>`});
  (o.marks||[]).forEach((mk,mi)=>{const i=xs.indexOf(mk.x); if(i<1) return;
    g+=`<line x1="${X(i)-iw/(n-1)/2}" x2="${X(i)-iw/(n-1)/2}" y1="${m.t-6}" y2="${m.t+ih}" stroke="#9a6b00" stroke-dasharray="4 4" stroke-opacity=".55"/><text x="${X(i)-iw/(n-1)/2+4}" y="${m.t+4+mi*14}" style="fill:#9a6b00;font-size:11px">${esc(mk.label)}</text>`});
  const FLm=new Map(); // 표시 연도 → 내용 (영향을 받는 계열이 그래프에 있을 때만)
  (o.flags||[]).forEach(([x,note,cols])=>{const i=xs.indexOf(x); if(i<0) return;
    const hit=o.series.filter(s=>s.pts[i]!=null&&(!cols||(s.fk&&cols.includes(s.fk))));
    if(!hit.length) return; FLm.set(x,{note:(FLm.has(x)?FLm.get(x).note+' / ':'')+note,ss:new Set([...(FLm.has(x)?FLm.get(x).ss:[]),...hit])})});
  FLm.forEach((n,x)=>{const i=xs.indexOf(x); g+=`<text x="${X(i)}" y="${m.t+ih-5}" text-anchor="middle" style="fill:#c8303a;font-size:12px;font-weight:700">※</text>`});
  let p='';
  o.series.forEach(s=>{ let d='',pen=false;
    s.pts.forEach((v,i)=>{ if(v==null){pen=false;return} d+=(pen?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1); pen=true;
      const lone=(i===0||s.pts[i-1]==null)&&(i===n-1||s.pts[i+1]==null);
      if(lone) p+=`<circle cx="${X(i)}" cy="${Y(v)}" r="${lone?3.2:2.6}" fill="${s.color}"/>`; });
    p+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w||2.2}" ${s.dash?'stroke-dasharray="6 5"':''} stroke-linejoin="round" stroke-linecap="round"/>`;
    FLm.forEach((n,x)=>{const i=xs.indexOf(x), v=s.pts[i]; if(v!=null&&n.ss.has(s)) p+=`<circle cx="${X(i)}" cy="${Y(v)}" r="4.6" fill="#fff" stroke="${s.color}" stroke-width="2.2"/>`}); });
  const cid='clip'+(el.id||Math.random().toString(36).slice(2)); // 축을 좁혀도 선이 그림 영역 밖으로 나가지 않게
  p=`<clipPath id="${cid}"><rect x="${m.l-6}" y="${m.t-6}" width="${iw+12}" height="${ih+12}"/></clipPath><g clip-path="url(#${cid})">${p}</g>`;
  el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title||'추이 그래프')}"><g class="axis">${g}<text x="${m.l}" y="12" style="font-weight:700;fill:#6b7280">${esc(o.unit||'')}</text></g>${p}<line class="cur" y1="${m.t}" y2="${m.t+ih}" stroke="#24282e" stroke-opacity=".35" visibility="hidden"/><rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  const svg=el.querySelector('svg'), cur=svg.querySelector('.cur'), rect=svg.querySelector('rect.hit'); // 첫 rect는 그림 영역 자르기용(clipPath)이라 마우스 영역을 따로 찾는다
  const move=e=>{ const r=svg.getBoundingClientRect(), px=(e.clientX-r.left)/r.width*W;
    const i=Math.max(0,Math.min(n-1,Math.round((px-m.l)/(n>1?iw/(n-1):1))));
    cur.setAttribute('x1',X(i));cur.setAttribute('x2',X(i));cur.setAttribute('visibility','visible');
    const rows=o.series.filter(s=>s.pts[i]!=null&&!s.quiet).sort((a,b)=>b.pts[i]-a.pts[i]).map(s=>`<div class="r"><span><i style="background:${s.color}"></i>${esc(s.name)}</span><b>${nf(s.pts[i],o.d)}</b></div>`).join('');
    showTip(e,`<div class="t">${xs[i]}${o.xsuf||'년'} <span style="font-weight:500;color:#cfd1d5">${esc(o.unit||'')}</span></div>${rows||'<div class="r">자료 없음</div>'}${FLm.has(xs[i])?`<div class="r" style="display:block;max-width:300px;white-space:normal;color:#ffb3b8;margin-top:4px">※ ${esc(FLm.get(xs[i]).note)}</div>`:''}`); };
  rect.addEventListener('mousemove',move); rect.addEventListener('mouseleave',()=>{cur.setAttribute('visibility','hidden');hideTip()});
  if(o.key){ const es=o.series.filter(s=>!s.quiet); EXP[o.key]={name:o.title,head:['연도',...es.map(s=>`${s.name} (${o.unit})`)],rows:xs.map((x,i)=>[x,...es.map(s=>rnd(s.pts[i]))])}; }
  return [...FLm.keys()];
}
const HID={}; const hid=id=>HID[id]||(HID[id]=new Set());
const vis=(id,ss)=>ss.filter(s=>!hid(id).has(s.name));
const legendHtml=(ss,id)=>ss.map(s=>`<span data-leg="${id}" data-k="${esc(s.name)}" class="${hid(id).has(s.name)?'off':''}" role="button" tabindex="0" title="눌러서 숨기기·다시 보이기"><i class="${s.dash?'dash':''}" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
const sqLegend=(defs,id)=>defs.map(([k,n,c])=>`<span data-leg="${id}" data-k="${n}" class="${hid(id).has(n)?'off':''}" role="button" tabindex="0" title="눌러서 숨기기·다시 보이기"><i class="sq" style="background:${c}"></i>${n}</span>`).join('');
const rnd=v=>v==null||!isFinite(v)?'':Math.round(v*10000)/10000;
function stackBar(parts,unit,id){ // parts: [[name,color,value]]
  if(id) parts=parts.filter(p=>!hid(id).has(p[0]));
  const tot=parts.reduce((a,p)=>a+Math.max(0,p[2]||0),0); if(!tot) return '<div class="mxbar"></div>';
  return `<div class="mxbar">${parts.filter(p=>p[2]>0).map(p=>`<span style="width:${(p[2]/tot*100).toFixed(3)}%;background:${p[1]}" data-tip="${esc(`<div class='t'>${p[0]}</div><div class='r'><span>${nf(p[2])} ${unit}</span><b>${nf(p[2]/tot*100,1)}%</b></div>`)}"></span>`).join('')}</div>`;
}
const range=()=>YR.filter(y=>y>=S.from&&y<=S.to);
const FL=D.flags||{}, FC=D.flagcols||{}, flagOf=(t,y)=>(FL[t]||{})[y];
const flagsFor=(ts,ys)=>{const out=[]; ts.forEach(t=>ys.forEach(y=>{const n=flagOf(t,y); if(n) out.push([y,n,(FC[t]||{})[y]?(FC[t][y]).map(c=>t+':'+c):null])})); return out};
const flagNote=fl=>fl.length?' ※ 표시한 연도('+fl.map(y=>y+'년').join('·')+')는 원자료 안에서 숫자가 서로 맞지 않는 값입니다. 그래프의 빈 원에 마우스를 올리면 내용을 볼 수 있습니다.':'';
function transform(pts,mode,totals){ if(mode==='idx'){ const b=pts.find(v=>v!=null); return pts.map(v=>v==null||!b?null:v/b*100); }
  if(mode==='share') return pts.map((v,i)=>v==null||!totals[i]?null:v/totals[i]*100); return pts; }


/* ---------- 컨트롤 ---------- */
function fillSel(el,opts,val){ el.innerHTML=opts.map(([v,n])=>`<option value="${v}">${n}</option>`).join(''); if(val!=null) el.value=val; }
function setupControls(){
  const yo=YR.slice().reverse().map(y=>[y,y+'년']);
  fillSel($('#year'),yo); fillSel($('#base'),yo); fillSel($('#tFrom'),YR.map(y=>[y,y+'년'])); fillSel($('#tTo'),YR.map(y=>[y,y+'년']));
  fillSel($('#dTable'),DT.map(d=>[d.id,d.n]));
  const bind=(id,key,num)=>$(id).addEventListener('change',e=>{S[key]=num?+e.target.value:e.target.value;render()});
  bind('#year','year',1);bind('#base','base',1);bind('#iMode','iMode');bind('#iUnit','iUnit');bind('#iCls','iCls');bind('#hMode','hMode');bind('#wBase','wBase');bind('#wMode','wMode');
  $('#wYear').addEventListener('change',e=>{S.wYear=+e.target.value;renderIntl()});
  [['wKor','wKor'],['wAvg','wAvg'],['wGrey','wGrey'],['wRefRows','wRefRows']].forEach(([id,k])=>$('#'+id).addEventListener('change',e=>{S[k]=e.target.checked;renderIntl()}));
  $('#wAdd').addEventListener('change',e=>{const v=e.target.value; if(v) wToggle(v,true); e.target.value=''});
  document.addEventListener('click',e=>{
    const g=e.target.closest('[data-wgroup]'); if(g){S.wGroup=g.dataset.wgroup;renderIntl();return}
    const r=e.target.closest('[data-wref]'); if(r){const k=r.dataset.wref;S.wRef=S.wRef.includes(k)?S.wRef.filter(x=>x!==k):[...S.wRef,k];renderIntl();return}
    const x=e.target.closest('[data-wdel]'); if(x){wToggle(x.dataset.wdel,false);return}
    const w=e.target.closest('.wrow[data-iso]'); if(w){wToggle(w.dataset.iso);return}
    const pr=e.target.closest('[data-wpreset]'); if(pr){S.wPick=[...WPRE[pr.dataset.wpreset]];renderIntl();return}});
  ['wAxMin','wAxMax','wAxStep'].forEach(id=>$('#'+id).addEventListener('change',()=>{const k=wAxKey(), a=S.wAx[k]||(S.wAx[k]={}), v=$('#'+id).value;
    a[{wAxMin:'min',wAxMax:'max',wAxStep:'step'}[id]]=v===''?null:+v; renderIntl()}));
  $('#wAxReset').addEventListener('click',()=>{delete S.wAx[wAxKey()];renderIntl()});
  ['iAxMin','iAxMax','iAxStep'].forEach(id=>$('#'+id).addEventListener('change',()=>{const a=S.iAx[iAxKey()]||(S.iAx[iAxKey()]={}), v=$('#'+id).value;
    a[{iAxMin:'min',iAxMax:'max',iAxStep:'step'}[id]]=v===''?null:+v; renderInten()}));
  $('#iAxReset').addEventListener('click',()=>{delete S.iAx[iAxKey()];renderInten()});
  $('#dTable').addEventListener('change',e=>{S.dTable=e.target.value;renderTable()});
  $('#tFrom').addEventListener('change',e=>{S.from=+e.target.value;if(S.from>=S.to)S.to=Math.min(Y1,S.from+1);sync();render()});
  $('#tTo').addEventListener('change',e=>{S.to=+e.target.value;if(S.to<=S.from)S.from=Math.max(Y0,S.to-1);sync();render()});
  $('#tPreset').addEventListener('change',e=>{const v=e.target.value; if(v!=='custom'){S.from=+v;S.to=Y1;} sync();render(); if(v==='custom') $('#tFrom').focus()});
  const radio=(name,key)=>$$(`input[name=${name}]`).forEach(r=>r.addEventListener('change',()=>{S[key]=r.value;render()}));
  radio('yax','yax');radio('wSort','wSort');
  $('#reset').addEventListener('click',()=>{S=structuredClone(DEF);Object.keys(HID).forEach(k=>delete HID[k]);sync();render();toast('기본값으로 초기화했습니다')});
  $('#copyTsv').addEventListener('click',copyTable);
  document.addEventListener('click',e=>{const b=e.target.closest('[data-png],[data-csv],[data-xlsx]'); if(!b) return;
    if(b.dataset.png) savePNG(b.dataset.png,b); else if(b.dataset.csv) saveCSV(b.dataset.csv); else saveXLSX(b.dataset.xlsx); });
}
function sync(){
  $('#year').value=S.year;$('#base').value=S.base;$('#tFrom').value=S.from;$('#tTo').value=S.to;
  $('#tPreset').value=S.to===Y1&&[1995,2000,2010].includes(S.from)?String(S.from):'custom';
  $('#iMode').value=S.iMode;$('#iUnit').value=S.iUnit;$('#iCls').value=S.iCls;$('#hMode').value=S.hMode;
  $('#wBase').value=S.wBase;$('#wMode').value=S.wMode;['wKor','wAvg','wGrey','wRefRows'].forEach(k=>$('#'+k).checked=S[k]);$('#dTable').value=S.dTable;
  [['yax',S.yax],['wSort',S.wSort]].forEach(([n,v])=>$$(`input[name=${n}]`).forEach(r=>r.checked=r.value===v));
}
function chips(el,defs,sel,cb){
  el.innerHTML=defs.map(([k,n,c])=>`<button type="button" class="chip toggle" data-k="${k}" aria-pressed="${sel.includes(k)}"><i style="background:${c}"></i>${n}</button>`).join('');
  el.querySelectorAll('button').forEach(b=>b.onclick=()=>{const k=b.dataset.k,i=sel.indexOf(k); if(i>=0) sel.splice(i,1); else sel.push(k); cb()});
}

/* ---------- 핵심 지표 ---------- */
function kpi(label,val,unit,prev,base,opt={}){
  if(val==null) return `<div class="kpi${opt.lead?' lead':''}"><p class="k">${label}</p><div class="v">–</div><div class="n">${S.year}년 자료가 없습니다</div></div>`;
  const yoy=prev!=null&&prev?(opt.pp?val-prev:(val/prev-1)*100):null, vb=base!=null&&base?(opt.pp?val-base:(val/base-1)*100):null;
  const f=v=>v==null?'–':opt.pp?sgn(v,1)+'%p':pf(v);
  return `<div class="kpi${opt.lead?' lead':''}"><p class="k">${label}</p><div class="v">${nf(val,opt.d)}<small>${unit}</small></div>
    <div class="n"><span>전년 대비 <b class="${chgCls(yoy)}">${f(yoy)}</b></span><span>${S.base}년 대비 <b class="${chgCls(vb)}">${f(vb)}</b></span>${opt.ex?`<span class="ex">${opt.ex}</span>`:''}</div></div>`;
}
function renderKPI(){
  const y=S.year, b=S.base, iu=IU(), has=yy=>YI[yy]!=null;
  const g3=fn=>[fn(y),has(y-1)?fn(y-1):null,has(b)?fn(b):null];
  const iv=(t,k)=>yy=>{const v=at(t,k,yy);return v==null?null:v*iu.f};
  const tot=g3(iv('intenc','total')), mfg=g3(iv('inten','제조업')), svc=g3(iv('intenu','svc'));
  const inW=yy=>yy>=WY0&&yy<=WY1;
  const kor=g3(yy=>inW(yy)?wv('KOR',yy,'ppp'):null);
  const rel=g3(yy=>{if(!inW(yy)) return null; const k=wv('KOR',yy,'ppp'), o=wAgg('oecd',yy,'ppp'); return k!=null&&o?k/o*100:null});
  const sales=g3(yy=>{const v=at('sales','total',yy);return v==null?null:v*1e-6});
  const gdp=g3(yy=>{const v=at('gva','GDP',yy);return v==null?null:v*iu.gf});
  const hh=g3(yy=>at('hh','use_res',yy));
  let rk=''; if(inW(y)){ const o=wMem('oecd').map(i=>[i,wv(i,y,'ppp')]).filter(x=>x[1]!=null).sort((a,c)=>c[1]-a[1]); const r=o.findIndex(x=>x[0]==='KOR');
    if(r>=0) rk=`OECD ${o.length}개국 중 ${r+1}번째로 높음`; }
  $('#kpisMain').innerHTML=
     kpi('국가 전력원단위 <small>판매량 ÷ GDP</small>',tot[0],iu.u,tot[1],tot[2],{lead:1,d:iu.d})
    +kpi('제조업 전력원단위',mfg[0],iu.u,mfg[1],mfg[2],{lead:1,d:iu.d})
    +kpi('서비스업 전력원단위 <small>용도별</small>',svc[0],iu.u,svc[1],svc[2],{lead:1,d:iu.d})
    +kpi('한국 전력원단위 <small>Ember 수요 ÷ GDP(PPP)</small>',kor[0],'kWh/$',kor[1],kor[2],{lead:1,d:3,ex:rk})
    +kpi('총 판매전력량',sales[0],'TWh',sales[1],sales[2],{d:1})
    +kpi('실질 GDP <small>2020년 연쇄가격</small>',gdp[0],iu.gu,gdp[1],gdp[2],{d:1})
    +kpi('가정용 호당 사용량',hh[0],'kWh/호',hh[1],hh[2],{d:0})
    +kpi('한국 ÷ OECD <small>PPP 기준</small>',rel[0],'%',rel[1],rel[2],{d:0,pp:1,ex:rel[0]!=null?`OECD 합계보다 ${rel[0]>=100?nf(rel[0]-100,0)+'% 높음':nf(100-rel[0],0)+'% 낮음'}`:''});
}

/* ---------- 02 국내 전력원단위 ---------- */
const IDEF=[['제조업','제조업 전체','#24282e'],['전체','전체 (판매량÷GDP)','#e5a800'],...KIND.map(([k,c])=>[k,k,c])];
const IYA=1995;
const iAxKey=()=>S.iCls+'|'+S.iUnit+'|'+S.iMode; // 단위·값 기준마다 축 입력을 따로 기억한다
const FX20=1180.1; // 2020년 연평균 원/달러 환율(한국은행). 실질 부가가치가 2020년 기준 연쇄가격이라 2020년 환율 하나로 바꾼다
const IU=()=>S.iUnit==='usd'?{u:'kWh/USD',f:FX20/1e6,d:3,gu:'십억 달러',gf:1/FX20}:{u:'kWh/백만원',f:1,d:0,gu:'조원',gf:1e-3};
// 분류별 설정: 항목마다 판매량(분자)과 짝지은 한국은행 부가가치(분모)
const sumOf=(...xs)=>xs.some(v=>v==null)?null:xs.reduce((a,b)=>a+b,0);
const CC=Object.fromEntries(CLS.map(([k,,c])=>[k,c])), UC=Object.fromEntries(USE.map(([k,,c])=>[k,c]));
const ICFG={
  mfg:{title:'제조업 업종별 전력원단위',tab:'inten',sel:'iSel',defs:IDEF,tot:'제조업',totName:'제조업 전체',col:k=>KCOL[k],
    items:y=>KIND.map(([k])=>k).filter(k=>y>=2018?k!=='석유정제·화학':k!=='석유정제'&&k!=='화학제품'),
    q:(k,y)=>k==='전체'?at('sales','total',y):k==='제조업'?at('use','mfg',y):at('mfgk',k,y), g:(k,y)=>at('gva',k==='전체'?'GDP':k,y),
    gname:k=>k==='전체'?'GDP':k==='제조업'?'제조업':k, first:[['제조업','제조업 전체'],['전체','전체 (판매량÷GDP)']],
    marks:[{x:2016,label:'기계→전자 이동'},{x:2018,label:'석유정제·화학 분리'}], hint:'한국은행 13개 업종 구분'},
  cls:{title:'요금종별 전력원단위',tab:'intenc',sel:'iSelC',tot:'total',totName:'전체 (판매량÷GDP)',col:k=>({total:'#24282e',ge:'#c76b00'}[k]||CC[k]),
    defs:[['total','전체 (판매량÷GDP)','#24282e'],['ind','산업용',CC.ind],['gen','일반용',CC.gen],['edu','교육용',CC.edu],['agr','농사용',CC.agr],['ge','일반용+교육용','#c76b00']],
    items:()=>['ind','gen','edu','agr'], first:[['total','전체 (판매량÷GDP)'],['ge','일반용+교육용']],
    q:(k,y)=>k==='ge'?sumOf(at('sales','gen',y),at('sales','edu',y)):at('sales',k,y),
    g:(k,y)=>at('gva',{total:'GDP',ind:'광공업',gen:'서비스업(교육 제외)',edu:'교육서비스',ge:'서비스업',agr:'농림어업'}[k],y),
    gname:k=>({total:'GDP',ind:'광공업',gen:'서비스업(교육 제외)',edu:'교육서비스',ge:'서비스업',agr:'농림어업'}[k]),
    name:k=>({total:'전체',ind:'산업용',gen:'일반용',edu:'교육용',agr:'농사용',ge:'일반용+교육용'}[k]), marks:[], hint:'요금종을 가장 가까운 한국은행 업종에 짝지은 근사'},
  use:{title:'용도별 전력원단위',tab:'intenu',sel:'iSelU',tot:'total',totName:'전체 (판매량÷GDP)',col:k=>k==='total'?'#24282e':UC[k],
    defs:[['total','전체 (판매량÷GDP)','#24282e'],['mfg','제조업',UC.mfg],['min','광업',UC.min],['svc','서비스업',UC.svc],['pub','공공용',UC.pub],['agr','농림어업',UC.agr]],
    items:()=>['mfg','min','svc','pub','agr'], first:[['total','전체 (판매량÷GDP)']],
    q:(k,y)=>k==='total'?at('sales','total',y):at('use',k,y),
    g:(k,y)=>at('gva',{total:'GDP',mfg:'제조업',min:'광업',svc:'서비스업(공공행정 제외)',pub:'공공행정',agr:'농림어업'}[k],y),
    gname:k=>({total:'GDP',mfg:'제조업',min:'광업',svc:'서비스업(공공행정 제외)',pub:'공공행정',agr:'농림어업'}[k]),
    name:k=>({total:'전체',mfg:'제조업',min:'광업',svc:'서비스업',pub:'공공용',agr:'농림어업'}[k]), marks:[], hint:'용도 분류는 업종에 가까워 부가가치와 짝이 잘 맞음'}};
const INOTE={
  mfg:'판매전력량은 한국전력통계 제조업종별 판매량을, 부가가치는 한국은행 「경제활동별 GDP(실질, 2020년 연쇄가격)」를 썼습니다(2025년은 잠정치). 판매량의 업종은 한국은행 13개 업종 구분에 맞춰 묶었고, 석유정제와 화학제품은 판매량이 2017년까지 한 칸이라 2018년부터만 나뉩니다(그 전은 “석유정제·화학” 합산). 2016년에는 판매량 원자료에서 기계 일부가 전자로 옮겨 집계되어 두 업종의 원단위가 한 해에 크게 바뀝니다. 석유정제는 부가가치가 정제마진에 따라 크게 출렁여(2020년 급감) 원단위 변동이 큽니다. 2017년까지 판매량에는 한국은행 기준으로 제조업이 아닌 출판·재생재료가 조금(제조업의 1% 미만) 들어 있습니다. 실질 연쇄가격은 업종을 더해도 제조업과 같지 않아, 제조업 전체는 업종 합이 아닌 제조업 부가가치로 나눴습니다.',
  cls:'요금종(계약종별)은 업종이 아니라 요금을 매기는 기준이라, 가장 가까운 한국은행 업종 부가가치에 짝지은 근사값입니다: 산업용 ÷ 광공업, 일반용 ÷ 서비스업(교육서비스 제외), 교육용 ÷ 교육서비스, 농사용 ÷ 농림어업. 산업용에는 광업·제조업이 아닌 사용처도 일부 들어 있어(2025년 산업용 280TWh, 용도별 광업+제조업 252TWh) 원단위가 높게 나오고, 서비스업 일부는 다른 요금종을 써서 일반용 원단위는 낮게 나옵니다. 그래서 일반용과 교육용을 합쳐 서비스업 전체로 나눈 값도 함께 둡니다. 농사용은 시설원예·양식 등 쓰임새가 늘면서 원단위가 크게 올랐습니다. 주택용은 부가가치가 없어 호당 사용량으로 따로 보여 주고, 심야·가로등은 짝지을 업종이 없어 뺐습니다. 서비스업에서 교육을 뺀 값은 연쇄가격 차감이라 2020년에서 멀수록 근사입니다.',
  use:'용도별 판매량은 고객의 업종을 기준으로 나눈 것이라 요금종별보다 한국은행 업종과 짝이 잘 맞습니다: 제조업 ÷ 제조업, 광업 ÷ 광업, 서비스업 ÷ 서비스업(공공행정 제외), 공공용 ÷ 공공행정·국방·사회보장, 농림어업 ÷ 농림어업. 그래도 두 분류의 경계가 완전히 같지는 않아 근사값입니다. 광업은 부가가치가 계속 줄어(1995년 3.7조 → 2025년 1.4조원) 원단위가 크게 오릅니다. 가정용은 부가가치가 없어 호당 사용량으로 따로 보여 줍니다(주택용 고객호수 기준).'};
function renderInten(){
  const C=ICFG[S.iCls], ys=range().filter(y=>y>=IYA), xs=ys.length>1?ys:YR.filter(y=>y>=IYA), idx=S.iMode==='idx';
  if(!S[C.sel].length) S[C.sel]=[C.tot];
  $('#intTitle').textContent=C.title; $('#iClsHint').textContent=C.hint;
  chips($('#iChips'),C.defs,S[C.sel],renderInten);
  const iu=IU(), iv=(k,y)=>{const v=at(C.tab,k,y);return v==null?null:v*iu.f}, nm=k=>C.name?C.name(k):k;
  $('#iUnitHint').textContent=S.iUnit==='usd'?`2020년 연평균 환율 ${nf(FX20,1)}원/달러로 환산 (1 kWh/백만원 = ${nf(FX20/1e6,6)} kWh/USD)`:'전력원단위 = 판매전력량 ÷ 실질 부가가치';
  const series=S[C.sel].map(k=>{const d=C.defs.find(x=>x[0]===k); return {name:d[1],color:d[2],dash:k===C.tot||k==='전체',pts:transform(xs.map(y=>iv(k,y)),idx?'idx':'value')}});
  const unit=idx?`지수 (${xs[0]}=100)`:iu.u;
  $('#intDesc').textContent=`${xs[0]}–${xs[xs.length-1]}년 · ${unit} · 판매전력량 ÷ 실질 부가가치(2020년 연쇄가격${S.iUnit==='usd'?', 2020년 환율로 달러 환산':''}). 값이 작을수록 같은 부가가치를 만드는 데 전기를 덜 씁니다.`;
  $('#iLegend').innerHTML=legendHtml(series,'inten');
  const axv=S.iAx[iAxKey()]||{}; $('#iAxMin').value=axv.min??''; $('#iAxMax').value=axv.max??''; $('#iAxStep').value=axv.step??''; $('#iAxUnit').textContent=`(${unit})`;
  lineChart($('#iChart'),{x:xs,series:vis('inten',series),unit,axis:axv,zero:S.yax==='zero',marks:C.marks,title:C.title,key:'inten',d:idx?1:iu.d,h:380});
  $('#iNote').textContent=INOTE[S.iCls]+(S.iUnit==='usd'?` kWh/USD는 2020년 불변 원화 부가가치를 2020년 연평균 환율(${nf(FX20,1)}원/달러) 하나로 바꾼 값이라, 원화 기준과 추이·변화율이 같고 수준만 달라집니다. 해마다 다른 환율을 쓰면 환율 변동이 원단위에 섞이므로 쓰지 않았습니다.`:'');
  // 순위·표
  const y=S.year<IYA?Y1:S.year, b=S.base<IYA?IYA:S.base, [eu,em]=U.energy(), inds=C.items(y), lab=S.iCls==='mfg'?'업종':S.iCls==='cls'?'요금종':'용도';
  $('#iRankTitle').textContent=`${y}년 ${lab}별 전력원단위 (${iu.u})`;
  const list=inds.map(k=>({k,v:iv(k,y),w:iv(k,b)})).filter(x=>x.v!=null).sort((a,c)=>c.v-a.v);
  const mv=iv(C.tot,y), max=Math.max(...list.map(x=>x.v),mv||0,1);
  $('#iRank').innerHTML=list.map((x,i)=>`<div class="rrow"><span class="no">${i+1}</span><span class="nm"><i class="dot" style="background:${C.col(x.k)}"></i>${nm(x.k)}</span>
    <span class="track"><span class="fill" style="width:${(x.v/max*100).toFixed(2)}%;background:${C.col(x.k)};opacity:.55"></span>${mv?`<span class="vline" style="left:${(mv/max*100).toFixed(2)}%"></span>`:''}</span>
    <span class="val">${nf(x.v,iu.d)}</span><span class="pc">${x.w?`<b class="${chgCls(x.v/x.w-1)}">${pf((x.v/x.w-1)*100)}</b>`:''}</span></div>`).join('')||'<div class="empty">자료가 없습니다.</div>';
  const hh=S.iCls==='mfg'?'':(()=>{const k=S.iCls==='cls'?'res':'use_res', v=at('hh',k,y), w=at('hh',k,b);
    return v?` ${S.iCls==='cls'?'주택용':'가정용'}은 부가가치가 없어 호당 사용량으로 봅니다: ${y}년 ${nf(v,0)} kWh/호${w?`(${b}년 ${nf(w,0)}, ${pf((v/w-1)*100)})`:''}.`:''})();
  $('#iRankNote').textContent=`세로 점선은 ${C.totName}(${nf(mv,iu.d)} ${iu.u})입니다. 오른쪽 숫자는 ${b}년 대비 변화율로, 마이너스(초록색)일수록 같은 부가가치에 전기를 덜 쓰게 된 것입니다.${hh}${S.iCls==='mfg'&&y>=2018&&b<2018?' 석유정제·화학제품은 2018년부터 나뉘어 2017년 이전과는 비교하지 않습니다.':''}${S.year<IYA?` 분석 연도 자료가 없어 ${Y1}년으로 보여 줍니다.`:''}`;
  const n=y-b, rows=[...C.first,...inds.map(k=>[k,nm(k)])].map(([k,name])=>{
    const q=C.q(k,y), g=C.g(k,y), v=iv(k,y), w=iv(k,b);
    const ch=v!=null&&w?(v/w-1)*100:null, cagr=v!=null&&w&&n>0?(Math.pow(v/w,1/n)-1)*100:null;
    return {k,nm:name,gn:C.gname(k),q,g,v,w,ch,cagr}});
  $('#iTblTitle').textContent=`${y}년과 ${b}년 비교`;
  $('#iTbl thead').innerHTML=`<tr><th>${lab}</th><th>판매량 (${eu})</th><th>부가가치 (${iu.gu})</th><th>원단위 ${y}</th><th>원단위 ${b}</th><th>변화율</th><th>연평균</th></tr>`;
  $('#iTbl tbody').innerHTML=rows.map(r=>`<tr${r.k===C.tot?' class="sum"':''}><td>${r.k===C.tot||r.k==='전체'?'':`<i class="dot" style="background:${C.col(r.k)}"></i>`}${r.nm}${S.iCls==='mfg'?'':`<br><small style="color:#828893">÷ ${r.gn}</small>`}</td><td>${nf(r.q==null?null:r.q*em)}</td><td>${nf(r.g==null?null:r.g*iu.gf,1)}</td><td>${nf(r.v,iu.d)}</td><td>${nf(r.w,iu.d)}</td><td><b class="${chgCls(r.ch)}">${r.ch==null?'–':pf(r.ch)}</b></td><td>${r.cagr==null?'–':pf(r.cagr,1)}</td></tr>`).join('');
  EXP.intenTbl={name:`${y}년 ${lab}별 전력원단위`,head:[lab,'짝지은 부가가치','판매량(MWh)','실질 부가가치(십억원)',`원단위 ${y}(${iu.u})`,`원단위 ${b}(${iu.u})`,'변화율(%)','연평균 변화율(%)'],rows:rows.map(r=>[r.nm,r.gn,rnd(r.q),rnd(r.g),rnd(r.v),rnd(r.w),rnd(r.ch),rnd(r.cagr)])};
}

/* ---------- 03 가정 부문 ---------- */
function renderHH(){
  const xs=range(), idx=S.hMode==='idx', unit=idx?`지수 (${xs[0]}=100)`:'kWh/호';
  const defs=[['res','주택용 (요금종 · 판매량 ÷ 주택용 고객호수)','#3a3f47'],['use_res','가정용 (용도별 · 판매량 ÷ 주택용 고객호수)','#e5a800']];
  const series=defs.map(([k,n,c])=>({name:n,color:c,pts:transform(xs.map(y=>at('hh',k,y)),idx?'idx':'value')}));
  $('#hhDesc').textContent=`${xs[0]}–${xs[xs.length-1]}년 · ${unit} · 가정은 부가가치가 없어 고객 한 호가 1년에 쓰는 전기로 봅니다.`;
  $('#hLegend').innerHTML=legendHtml(series,'hh');
  lineChart($('#hChart'),{x:xs,series:vis('hh',series),unit,zero:S.yax==='zero',title:'가정 부문 호당 사용량',key:'hh',d:idx?1:0,h:340});
  $('#hNote').textContent='주택용은 계약종별(요금종) 판매량, 가정용은 용도별 판매량이며 둘 다 주택용 고객호수로 나눴습니다. 요금종(어떤 요금을 쓰는지)과 용도(누가 쓰는지)는 나누는 기준이 달라, 가정용 판매량이 주택용보다 조금(2025년 약 3%) 작습니다. 1997년까지 주택용에는 심야전력이 포함되어 있습니다.';
  const y=S.year, b=S.base, n=y-b, rows=[
    ['주택용 판매량','TWh',yy=>{const v=at('sales','res',yy);return v==null?null:v*1e-6},1],
    ['가정용 판매량 (용도별)','TWh',yy=>{const v=at('use','res',yy);return v==null?null:v*1e-6},1],
    ['주택용 고객호수','만 호',yy=>{const v=at('cust','res',yy);return v==null?null:v/1e4},0],
    ['호당 사용량 · 주택용','kWh/호',yy=>at('hh','res',yy),0],
    ['호당 사용량 · 가정용','kWh/호',yy=>at('hh','use_res',yy),0]].map(([nm,u,f,d])=>{const v=f(y),w=f(b);
      return {nm,u,d,v,w,ch:v!=null&&w?(v/w-1)*100:null,cagr:v!=null&&w&&n>0?(Math.pow(v/w,1/n)-1)*100:null}});
  $('#hTblTitle').textContent=`${y}년과 ${b}년 비교`;
  $('#hTbl thead').innerHTML=`<tr><th>항목</th><th>단위</th><th>${y}</th><th>${b}</th><th>변화율</th><th>연평균</th></tr>`;
  $('#hTbl tbody').innerHTML=rows.map((r,i)=>`<tr${i>=3?' class="sum"':''}><td>${r.nm}</td><td>${r.u}</td><td>${nf(r.v,r.d)}</td><td>${nf(r.w,r.d)}</td><td><b class="${chgCls(r.ch)}">${r.ch==null?'–':pf(r.ch)}</b></td><td>${r.cagr==null?'–':pf(r.cagr,1)}</td></tr>`).join('');
}

/* ---------- 04 해외 전력원단위 비교 ---------- */
// 모든 국가: Ember 전력수요(TWh) ÷ 세계은행 실질 GDP(십억 달러) = kWh/$. 권역은 회원국 합계(수요 합 ÷ GDP 합)
const IN=D.intl, WY0=IN.years[0], WY1=IN.years[1], WC={}; IN.countries.forEach(c=>WC[c.iso]=c);
const WG={all:['전체 국가',c=>true],oecd:['OECD',c=>c.oecd,'OECD'],eu:['EU',c=>c.eu,'EU'],g7:['G7',c=>c.g7,'G7'],g20:['G20',c=>c.g20,'G20'],asean:['ASEAN',c=>c.asean,'ASN'],
  asia:['아시아',c=>c.reg==='Asia'],europe:['유럽',c=>c.reg==='Europe'],me:['중동',c=>c.reg==='Middle East'],africa:['아프리카',c=>c.reg==='Africa'],
  lac:['중남미',c=>c.reg==='Latin America and Caribbean'],na:['북미',c=>c.reg==='North America'],oce:['오세아니아',c=>c.reg==='Oceania'],pick:['선택 국가만',c=>c.iso==='KOR'||S.wPick.includes(c.iso)]};
const WREF=[['WLD','세계','all'],['OECD','OECD','oecd'],['EU','EU 27개국','eu'],['G7','G7','g7'],['G20','G20','g20'],['ASEAN','ASEAN','asean'],['ASIA','아시아','asia'],['EUR','유럽','europe'],
  ['ME','중동','me'],['AFR','아프리카','africa'],['LAC','중남미','lac'],['NA','북미','na'],['OCE','오세아니아','oce']];
const WRC={WLD:'#24282e',OECD:'#5b6270',EU:'#5b8def',G7:'#8b5cf6',G20:'#c76b00',ASEAN:'#2e9e6b',ASIA:'#d9487a',EUR:'#3f7fd9',ME:'#b08900',AFR:'#7c8b2a',LAC:'#e2725b',NA:'#0e9aa7',OCE:'#a1887f'};
const WPAL=['#1f5fa8','#7c3aed','#6b7280','#0e9aa7','#2e9e6b','#be123c','#a21caf','#d9487a','#3f7fd9','#8a5a2b'];
const WPRE={def:['USA','GBR','DEU','FRA','ITA','JPN','CHN'],g7:['USA','GBR','DEU','FRA','ITA','JPN','CAN'],asia:['JPN','CHN','IND','IDN','VNM','THA','MYS','SGP','PHL','BGD'],eur:['DEU','GBR','FRA','ITA','ESP','NLD','POL','SWE','NOR'],none:[]};
const wMem=g=>IN.countries.filter(WG[g][1]).map(c=>c.iso);
const wv=(iso,y,b)=>{const i=y-WY0, d=(IN.dem[iso]||[])[i], g=(IN[b][iso]||[])[i]; return d!=null&&g?d/g:null};
const WAC={}; // 권역 값 캐시: 회원국 GDP의 90% 이상이 자료를 갖춘 해만 계산
function wAgg(g,y,b){ const key=g+'|'+y+'|'+b+(g==='pick'?S.wPick.join():''); if(key in WAC) return WAC[key];
  let sd=0,sg=0,all=0; wMem(g).forEach(iso=>{const i=y-WY0, gd=(IN[b][iso]||[])[i], d=(IN.dem[iso]||[])[i]; if(gd){all+=gd; if(d!=null){sd+=d;sg+=gd}}});
  return WAC[key]=sg&&sg/all>=.9?sd/sg:null; }
function wAvgOf(g,y,b){ const v=wMem(g).map(iso=>wv(iso,y,b)).filter(x=>x!=null); return v.length?v.reduce((a,c)=>a+c,0)/v.length:null; }
const flagHtml=iso=>{const f=IN.flags[iso]; return f?`<span class="flag" style="background-image:url(${f})" aria-hidden="true"></span>`:'<span class="flag" aria-hidden="true"></span>'};
const refFlag=k=>{const t={OECD:'OECD',EU:'EU',G7:'G7',G20:'G20',ASEAN:'ASN'}[k]; return t?`<span class="flag tx" aria-hidden="true">${t}</span>`:'<span class="flag avg" aria-hidden="true"></span>'};
const wName=iso=>WC[iso]?WC[iso].ko:iso, wCol=iso=>iso==='KOR'?'#e5a800':WPAL[S.wPick.indexOf(iso)%WPAL.length]||'#1f5fa8';
function wToggle(iso,on){ if(iso==='KOR') return; const has=S.wPick.includes(iso); if(on===undefined) on=!has;
  if(on&&!has){ if(S.wPick.length>=10){ alertNote('비교 국가는 최대 10개까지 고를 수 있습니다.'); return; } S.wPick=[...S.wPick,iso]; }
  if(!on&&has) S.wPick=S.wPick.filter(x=>x!==iso); renderIntl(); }
function alertNote(t){ $('#wRankNote').textContent=t; }
const wAxKey=()=>S.wBase+'|'+S.wMode;
// 데이터 표용: 주요국 + 권역(회원국 합계)
(function(){ const ks=['KOR','USA','GBR','DEU','FRA','ITA','JPN','CHN'];
  [['intl_ppp','ppp'],['intl_usd','usd']].forEach(([t,b])=>{ T[t]={}; ks.forEach(k=>T[t][k]=YR.map(y=>y>=WY0&&y<=WY1?wv(k,y,b):null)); WREF.forEach(([k,,g])=>T[t][k]=YR.map(y=>y>=WY0&&y<=WY1?wAgg(g,y,b):null)); });
  T.intl_dem={}; ks.forEach(k=>T.intl_dem[k]=YR.map(y=>y>=WY0&&y<=WY1?(IN.dem[k]||[])[y-WY0]??null:null));
  WREF.forEach(([k,,g])=>T.intl_dem[k]=YR.map(y=>{ if(y<WY0||y>WY1) return null; const v=wMem(g).map(i=>(IN.dem[i]||[])[y-WY0]); return v.some(x=>x!=null)?v.reduce((a,c)=>a+(c||0),0):null }));
  ['intl_ppp','intl_usd','intl_dem'].forEach(t=>D.edition&&(D.edition[t]=YR.map(y=>y>=WY0&&y<=WY1?'intl':null)));
})();
function renderIntl(){
  const b=S.wBase, idx=S.wMode==='idx', ys=range().filter(y=>y>=WY0&&y<=WY1), xs=ys.length>1?ys:YR.filter(y=>y>=WY0&&y<=WY1);
  const u=b==='ppp'?'kWh/$ (2021년 PPP)':'kWh/$ (2015년 불변 달러)', unit=idx?`지수 (${xs[0]}=100)`:u, G=S.wGroup, gl=WG[G][0];
  // 패널
  $('#wGroups').innerHTML=Object.entries(WG).map(([k,[lab]])=>`<button type="button" class="wg" data-wgroup="${k}" aria-pressed="${G===k}">${lab}<small>${k==='pick'?S.wPick.length+1:wMem(k).length}</small></button>`).join('');
  const y=Math.min(Math.max(S.wYear,WY0),WY1), by=Math.min(Math.max(S.base,WY0),WY1);
  $('#wYear').innerHTML=YR.filter(v=>v>=WY0&&v<=WY1).reverse().map(v=>`<option value="${v}"${v===y?' selected':''}>${v}년${v===2024?' (자료가 가장 많은 최근 연도)':v===2025?' (일부 국가)':''}</option>`).join('');
  const mem=wMem(G), withV=mem.filter(i=>wv(i,y,b)!=null);
  $('#wGroupHint').textContent=`${gl} ${mem.length}개국 중 ${y}년 자료 ${withV.length}개국`+(y===2025?' · 2025년은 Ember 수요 자료가 일부 국가만 있습니다':'');
  $('#wPickCount').textContent=`(${S.wPick.length}/10)`;
  $('#wPicks').innerHTML=`<span class="wp">${flagHtml('KOR')}<i class="c" style="background:#e5a800"></i>한국 <span class="base">기준</span></span>`+
    S.wPick.map(iso=>`<span class="wp">${flagHtml(iso)}<i class="c" style="background:${wCol(iso)}"></i>${wName(iso)}<button type="button" data-wdel="${iso}" aria-label="${wName(iso)} 빼기">×</button></span>`).join('');
  $('#wAdd').innerHTML='<option value="">+ 비교 국가 추가</option>'+IN.countries.filter(c=>c.iso!=='KOR'&&!S.wPick.includes(c.iso)).map(c=>`<option value="${c.iso}">${esc(c.ko)}</option>`).join('');
  $('#wRefs').innerHTML=WREF.map(([k,lab])=>`<button type="button" class="wr" data-wref="${k}" aria-pressed="${S.wRef.includes(k)}" style="color:${WRC[k]}"><i></i><span style="color:#1f2733">${lab}</span></button>`).join('');
  // 그래프
  const pts=f=>transform(xs.map(f),idx?'idx':'value');
  const grey=S.wGrey?mem.filter(i=>i!=='KOR'&&!S.wPick.includes(i)).map(i=>({name:wName(i),color:'#d3d7de',w:1,quiet:true,pts:pts(yy=>wv(i,yy,b))})):[];
  const main=[{name:'한국',color:'#e5a800',w:3.4,pts:pts(yy=>wv('KOR',yy,b))},...S.wPick.map(i=>({name:wName(i),color:wCol(i),pts:pts(yy=>wv(i,yy,b))}))];
  const refs=S.wRef.map(k=>{const r=WREF.find(x=>x[0]===k); return {name:r[1],color:WRC[k],dash:true,w:1.8,pts:pts(yy=>wAgg(r[2],yy,b))}});
  const avg=S.wAvg&&G!=='all'||S.wAvg&&G==='all'?[{name:`${gl} 평균(단순)`,color:'#111827',dash:true,w:2,pts:pts(yy=>wAvgOf(G,yy,b))}]:[];
  const series=[...grey,...main,...refs,...avg];
  $('#wDesc').textContent=`${xs[0]}–${xs[xs.length-1]}년 · ${unit} · 전력수요(Ember) ÷ 실질 GDP(세계은행) · ${IN.countries.length}개국. 값이 작을수록 같은 GDP를 만드는 데 전기를 덜 씁니다.`;
  $('#wLegend').innerHTML=legendHtml(series.filter(s=>!s.quiet),'intl');
  const axv=S.wAx[wAxKey()]||{}; $('#wAxMin').value=axv.min??''; $('#wAxMax').value=axv.max??''; $('#wAxStep').value=axv.step??''; $('#wAxUnit').textContent=`(${unit})`;
  lineChart($('#wChart'),{x:xs,series:vis('intl',series),unit,axis:axv,zero:S.yax==='zero',title:'해외 전력원단위',key:'intl',d:idx?1:3,h:400});
  $('#wNote').textContent='전력수요는 Ember 「Yearly electricity data」의 Demand(발전량 + 순수입, TWh), GDP는 세계은행 WDI의 실질 GDP입니다(2025년은 추정치일 수 있음). 권역 기준선은 회원국 수요 합 ÷ GDP 합이며, 회원국 GDP의 90% 이상이 자료를 갖춘 해만 그립니다. 그룹 평균(단순)은 자료가 있는 회원국 원단위의 단순 평균이라 해마다 국가 수가 다를 수 있습니다. 세계은행 GDP가 없는 곳(대만·북한·베네수엘라·쿠바 등)은 계산에서 빠집니다. 나라끼리 같은 정의로 맞추려고 한국도 Ember 수요를 써서 한전 판매량 기준 국내 원단위와는 직접 비교하지 않습니다(2024년 Ember 628TWh, 한전 판매량 550TWh). 시장환율 기준은 물가가 낮은 나라의 GDP를 작게 잡아 원단위가 높게 나오므로, 나라 간 비교는 PPP 기준이 더 적합합니다. 범례를 누르면 선을 끄고 켤 수 있습니다.';
  // 순위
  const wld=wAgg('all',y,b), list=[...new Set([...mem,...(S.wKor?['KOR']:[])])].map(i=>({iso:i,v:wv(i,y,b),w:wv(i,by,b)})).filter(x=>x.v!=null);
  const rows=list.map(x=>({...x,kind:'c'}));
  if(S.wRefRows){ S.wRef.forEach(k=>{const r=WREF.find(z=>z[0]===k), v=wAgg(r[2],y,b); if(v!=null) rows.push({iso:k,v,w:wAgg(r[2],by,b),kind:'ref',name:r[1]})});
    if(S.wAvg){const v=wAvgOf(G,y,b); if(v!=null) rows.push({iso:'AVG',v,w:wAvgOf(G,by,b),kind:'avg',name:`${gl} 평균`,n:withV.length})} }
  rows.sort((a,c)=>S.wSort==='desc'?c.v-a.v:a.v-c.v);
  const max=Math.max(...rows.map(r=>r.v),1e-9); let no=0;
  $('#wRankTitle').textContent=`${y}년 전력원단위 순위 · ${gl}`;
  $('#wRankSub').textContent=`${withV.length}개국 · ${u} · 오른쪽 %는 세계(${nf(wld,3)}) 대비 · 막대를 누르면 비교 국가에 추가·해제`;
  $('#wRank').innerHTML=rows.map(r=>{ const c=r.kind==='c', pick=c&&(r.iso==='KOR'||S.wPick.includes(r.iso)); if(c) no++;
    const col=c?(pick?wCol(r.iso):'#e3e4e7'):'#ececee';
    return `<div class="wrow${c?'':' ref'}${pick?' pick':''}${r.iso==='KOR'?' kor':''}" ${c?`data-iso="${r.iso}" title="${pick?'눌러서 비교 국가에서 빼기':'눌러서 비교 국가에 추가'}"`:''}><span class="no">${c?no:''}</span>
      <span class="nm">${c?flagHtml(r.iso):r.kind==='avg'?'<span class="flag avg"></span>':refFlag(r.iso)}${c?esc(wName(r.iso)):esc(r.name)}${r.kind==='avg'?`<span class="tag">${r.n}개국</span>`:''}</span>
      <span class="bar" style="width:${(r.v/max*100).toFixed(2)}%;background:${col}"></span><span class="val">${nf(r.v,3)}</span><span class="pc">${wld?nf(r.v/wld*100,0)+'%':''}</span></div>`}).join('')||'<div class="empty">자료가 없습니다.</div>';
  $('#wRankNote').textContent=`색 막대는 한국과 비교 국가, 옅은 막대는 그 밖의 ${gl} 국가입니다. ${y}년 자료가 없는 국가는 빠집니다.`;
  // 비교표: 한국·비교 국가·기준선
  const n=y-by, trs=[['KOR','한국','c'],...S.wPick.map(i=>[i,wName(i),'c']),...S.wRef.map(k=>[k,WREF.find(z=>z[0]===k)[1],'r'])].map(([k,nm,t])=>{
    const g=t==='c'?null:WREF.find(z=>z[0]===k)[2];
    const v=t==='c'?wv(k,y,b):wAgg(g,y,b), w=t==='c'?wv(k,by,b):wAgg(g,by,b);
    const d=t==='c'?(IN.dem[k]||[])[y-WY0]:wMem(g).reduce((a,i)=>a+((IN.dem[i]||[])[y-WY0]||0),0);
    const gd=t==='c'?(IN[b][k]||[])[y-WY0]:null;
    return {k,nm,t,v,w,d,gd,ch:v!=null&&w?(v/w-1)*100:null,cagr:v!=null&&w&&n>0?(Math.pow(v/w,1/n)-1)*100:null}});
  $('#wTblTitle').textContent=`${y}년과 ${by}년 비교 · 한국·비교 국가·권역 (연도는 순위 연도와 분석 조건의 비교 연도)`;
  $('#wTbl thead').innerHTML=`<tr><th>국가·권역</th><th>전력수요 (TWh)</th><th>GDP (조 달러)</th><th>원단위 ${y}</th><th>원단위 ${by}</th><th>변화율</th><th>연평균</th></tr>`;
  $('#wTbl tbody').innerHTML=trs.map(r=>`<tr${r.k==='KOR'?' class="sum"':''}><td>${r.t==='c'?flagHtml(r.k)+' ':refFlag(r.k)+' '}${esc(r.nm)}</td><td>${nf(r.d,0)}</td><td>${r.gd==null?'–':nf(r.gd/1000,1)}</td><td>${nf(r.v,3)}</td><td>${nf(r.w,3)}</td><td><b class="${chgCls(r.ch)}">${r.ch==null?'–':pf(r.ch)}</b></td><td>${r.cagr==null?'–':pf(r.cagr,1)}</td></tr>`).join('');
  EXP.intlTbl={name:`${y}년 전력원단위 순위 (${gl})`,head:['순위','국가·권역',`원단위 ${y}(${u})`,`원단위 ${by}`,'세계 대비(%)'],rows:(()=>{let k=0;return rows.map(r=>[r.kind==='c'?++k:'',r.kind==='c'?wName(r.iso):r.name,rnd(r.v),rnd(r.w),wld?rnd(r.v/wld*100):''])})()};
}

/* ---------- 05 데이터 표 ---------- */
const MAIN8=['KOR','USA','GBR','DEU','FRA','ITA','JPN','CHN'];
const DT=[
 {id:'inten',n:'제조업 업종별 전력원단위 (kWh/백만원)',t:'inten',cols:[['제조업','제조업 전체'],['전체','전체 (판매량÷GDP)'],...KIND.map(([k])=>[k,k])]},
 {id:'intenc',n:'요금종별 전력원단위 (kWh/백만원, 근사)',t:'intenc',cols:[['total','전체 (÷GDP)'],['ind','산업용 (÷광공업)'],['gen','일반용 (÷서비스업, 교육 제외)'],['edu','교육용 (÷교육서비스)'],['ge','일반용+교육용 (÷서비스업)'],['agr','농사용 (÷농림어업)']]},
 {id:'intenu',n:'용도별 전력원단위 (kWh/백만원)',t:'intenu',cols:[['total','전체 (÷GDP)'],['mfg','제조업'],['min','광업'],['svc','서비스업 (÷공공행정 제외)'],['pub','공공용 (÷공공행정)'],['agr','농림어업']]},
 {id:'hh',n:'호당 사용량 (kWh/호, 주택용 고객호수 기준)',t:'hh',cols:[['res','주택용'],['use_res','가정용(용도별)']]},
 {id:'intl_ppp',dp:3,n:'해외 전력원단위 · PPP (kWh/$, 2021년 국제달러)',t:'intl_ppp',cols:[...MAIN8.map(k=>[k,wName(k)]),...WREF.map(([k,n])=>[k,n])]},
 {id:'intl_usd',dp:3,n:'해외 전력원단위 · 시장환율 (kWh/$, 2015년 불변 달러)',t:'intl_usd',cols:[...MAIN8.map(k=>[k,wName(k)]),...WREF.map(([k,n])=>[k,n])]},
 {id:'intl_dem',n:'해외 전력수요 (TWh, Ember)',t:'intl_dem',cols:[...MAIN8.map(k=>[k,wName(k)]),...WREF.map(([k,n])=>[k,n])]},
 {id:'sales',n:'계약종별 판매전력량 (MWh)',t:'sales',cols:[...CLS.filter(([k])=>k!=='gis').map(([k,n])=>[k,n]),['total','합계']]},
 {id:'use',n:'용도별 판매전력량 (MWh)',t:'use',cols:[...USE.map(([k,n])=>[k,n]),['total','합계']]},
 {id:'mfgk',n:'제조업 업종별 판매량 · 한국은행 업종 구분 (MWh)',t:'mfgk',cols:[...KIND.map(([k])=>[k,k]),['합계','합계']]},
 {id:'gva',n:'실질 부가가치 (십억원, 2020년 연쇄가격)',t:'gva',cols:[['제조업','제조업'],...KIND.map(([k])=>[k,k]),['농림어업','농림어업'],['광업','광업'],['광공업','광공업'],['서비스업','서비스업'],['교육서비스','교육서비스'],['공공행정','공공행정·국방·사회보장'],['서비스업(교육 제외)','서비스업(교육 제외)'],['서비스업(공공행정 제외)','서비스업(공공행정 제외)'],['GDP','국내총생산']]},
 {id:'cust',n:'주택용 고객호수 (호)',t:'cust',cols:[['res','주택용']]}];
const SRCTXT={calc:'한국전력통계 판매전력량 ÷ 한국은행 실질 부가가치로 계산',bok:'한국은행 ECOS 「경제활동별 GDP 및 GNI(원계열, 실질, 연간)」 · 2020년 기준 연쇄가격 · 2025년은 잠정치',intl:'Ember 「Yearly electricity data」 전력수요 · 세계은행 WDI 실질 GDP · 권역은 회원국 합계'};
const DSRC={hh:'한국전력통계 판매전력량 ÷ 주택용 고객호수로 계산',intl_dem:'Ember 「Yearly electricity data」 전력수요(발전량 + 순수입) · 권역은 회원국 합계'};
function tableData(){
  const d=DT.find(x=>x.id===S.dTable), cols=d.cols, tab=d.t;
  const rows=YEARS.slice().reverse().map(y=>[y,...cols.map(([c])=>at(tab,c,y))]).filter(r=>r.slice(1).some(v=>v!=null));
  // 자료 출처: 표 안의 열 대신 표 위에 따로 적는다(같은 출처가 이어지는 연도를 묶어서)
  const ys=rows.map(r=>r[0]).sort((a,b)=>a-b), seg=[];
  ys.forEach(y=>{const e=D.edition[tab][YI[y]]||''; const l=seg[seg.length-1]; if(l&&l.e===e&&l.b===y-1) l.b=y; else seg.push({e,a:y,b:y})});
  const lab=e=>DSRC[d.id]&&(e==='calc'||e==='intl')?DSRC[d.id]:SRCTXT[e]||('「한국전력통계」 '+((D.meta.editions||{})[e]||EDS[e]||e));
  const src=seg.length===1?lab(seg[0].e):seg.map(g=>`${g.a===g.b?g.a:g.a+'–'+g.b}년 ${lab(g.e).replace('「한국전력통계」 ','')}`).join(' · ');
  return {name:d.n,head:['연도',...cols.map(c=>c[1])],rows,ftab:tab,dp:d.dp,src:seg.length>1?'「한국전력통계」 '+src:src};
}
function renderTable(){
  const t=tableData();
  $('#dataDesc').textContent=`${t.name} · 원자료 단위 그대로 · ${t.rows.length}개 연도`;
  $('#dataSrc').innerHTML=`<b>자료</b>${esc(t.src)}`;
  $('#tbl thead').innerHTML='<tr>'+t.head.map(h=>`<th>${esc(h)}</th>`).join('')+'</tr>';
  $('#tbl tbody').innerHTML=t.rows.map(r=>`<tr class="${r[0]===S.year?'base':''}">`+r.map((v,i)=>`<td>${i===0?v:(v==null?'–':nf(v,t.dp!=null?t.dp:Math.abs(v)<1000&&!Number.isInteger(v)?2:0))}</td>`).join('')+'</tr>').join('');
}
function copyTable(){ const t=tableData(), txt=[t.head,...t.rows.map(r=>r.map(v=>v==null?'':v))].map(r=>r.join('\t')).join('\n'), box=$('#copyBox');
  const fb=()=>{box.hidden=false;box.value=txt;box.focus();box.select();toast('자동 복사가 막혀 아래 상자에 표시했습니다. Ctrl+C로 복사하세요')};
  if(navigator.clipboard&&window.isSecureContext) navigator.clipboard.writeText(txt).then(()=>toast('표를 복사했습니다'),fb); else fb(); }

/* ---------- 내려받기 ---------- */
const stamp=()=>{const d=new Date();return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`};
const fname=(b,ext)=>`Electricity-Intensity_${b}_${stamp()}.${ext}`.replace(/[\\/:*?"<>|]/g,'_').replace(/\s+/g,'');
function save(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
const getExp=k=>k==='table'?tableData():EXP[k];
function saveCSV(k){const t=getExp(k); if(!t) return toast('저장할 데이터가 없습니다');
  const cell=v=>{v=v==null?'':String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  save(fname(t.name,'csv'),new Blob(['﻿'+[t.head,...t.rows].map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}))}
function saveXLSX(k){const t=getExp(k); if(!window.XLSX) return toast('엑셀 모듈을 불러오는 중입니다. 잠시 후 다시 눌러 주세요');
  const ws=XLSX.utils.aoa_to_sheet([t.head,...t.rows]), wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'data'); XLSX.writeFile(wb,fname(t.name,'xlsx'))}
async function savePNG(id,btn){ if(!window.html2canvas) return toast('그림 저장 모듈을 불러오는 중입니다. 잠시 후 다시 눌러 주세요');
  const el=document.getElementById(id); btn.disabled=true;
  try{const c=await html2canvas(el,{scale:2,backgroundColor:id==='kpiWrap'?'#f1f2f4':'#ffffff',ignoreElements:e=>e.hasAttribute&&e.hasAttribute('data-noexport')});
    c.toBlob(b=>save(fname((el.querySelector('h2')||{}).textContent||'핵심지표','png'),b));}catch(e){toast('그림 저장에 실패했습니다')} btn.disabled=false; }

/* ---------- 실행 ---------- */
function render(){renderKPI();renderInten();renderHH();renderIntl();renderTable()}
setupControls();sync();render();
let rt;addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(render,150)});
(()=>{const links=$$('#navList a'), secs=links.map(a=>$(a.getAttribute('href')));
  const io=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){links.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+e.target.id))}})},{rootMargin:'-20% 0px -70% 0px'});
  secs.forEach(s=>s&&io.observe(s));})();
