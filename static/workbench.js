const el = id => document.getElementById(id);
let report, serial = 0, previewUrl;
const sheet = el('sheet'), viewport = el('viewport');

let zoom = 1;
let selected = null;
let symbolBoxes = [];
function drawMarks() {
  const marks = el('marks');
  marks.replaceChildren();
  if (!report) return;
  const rules = report.pages[Number(el('page').value)].rules;
  const width = sheet.clientWidth, height = sheet.clientHeight;
  if (!width || !height || !el('drawing').naturalWidth || !el('drawing').complete) return;
  const shown = rules.map((rule,index)=>({rule,index})).filter(({rule,index})=>
    rule.boxes.length && (selected !== null ? selected === index : rule.status === '异常' && el('toggle').checked));
  const bounds = box => [box[0]*width,box[1]*height,box[2]*width,box[3]*height];
  const occupied = shown.flatMap(({rule})=>rule.boxes.map(bounds));
  for (const [x,y,right,bottom] of symbolBoxes) {
    const frame = document.createElement('div');
    frame.className = 'anno-rect symbol-focus';
    frame.style.cssText = 'left:'+x*100+'%;top:'+y*100+'%;width:'+(right-x)*100+'%;height:'+(bottom-y)*100+'%';
    marks.append(frame);
  }
  const ns = 'http://www.w3.org/2000/svg';
  const lines = document.createElementNS(ns,'svg');
  lines.classList.add('anno-lines');
  marks.append(lines);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width); canvas.height = Math.ceil(height);
  const ctx = canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(el('drawing'),0,0,canvas.width,canvas.height);
  const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data;
  function inkAt(x,y) {
    let ink=0;
    for(let dy=-14;dy<=14;dy+=2) for(let dx=-14;dx<=14;dx+=2) {
      const px=Math.max(0,Math.min(canvas.width-1,Math.round(x+dx)));
      const py=Math.max(0,Math.min(canvas.height-1,Math.round(y+dy)));
      const i=(py*canvas.width+px)*4;
      if(Math.min(pixels[i],pixels[i+1],pixels[i+2])<210) ink++;
    }
    return ink;
  }
  for (const {rule,index} of shown) {
    const number = rule.status === '异常' ? rules.slice(0,index+1).filter(r=>r.status==='异常').length : null;
    const title = (number ? '异常 '+number+' · ' : '')+rule.rule;
    const select = () => {
      const row = el('results').querySelector('[data-index="'+index+'"]');
      row.click();
      row.focus({preventScroll:true});
      el('results').scrollTop += row.getBoundingClientRect().top - el('results').getBoundingClientRect().top;
    };
    for (const [boxIndex,box] of rule.boxes.entries()) {
      if (boxIndex>0 && index!==selected) continue;
      const [l,t,r,b] = bounds(box);
      const frame = document.createElement('button');
      frame.className = 'anno-rect'+(index===selected?' active':'')+(boxIndex>0?' reference-box':'');
      frame.style.cssText = 'left:'+(l-3)+'px;top:'+(t-3)+'px;width:'+(r-l+6)+'px;height:'+(b-t+6)+'px';
      frame.title = (boxIndex>0?'对照依据 · ':'异常位置 · ')+title+' · '+rule.evidence;
      if (boxIndex>0) {
        const tag=document.createElement('span');tag.className='reference-label';tag.textContent='对照 '+number;frame.append(tag);
      }
      frame.onclick = select;
      marks.append(frame);
    }
    if (!number) continue;
    const [l,t,r,b] = bounds(rule.boxes[0]);
    const cx=(l+r)/2, cy=(t+b)/2;
    let best, score=Infinity;
    // 在框外寻找最近的可用位置，给编号留出完整的点击区域。
    for (let y=Math.max(13,t-90); y<=Math.min(height-13,b+90); y+=7) {
      for (let x=Math.max(13,l-90); x<=Math.min(width-13,r+90); x+=7) {
        const overlap=occupied.some(([a,c,d,e])=>x+13>a && x-13<d && y+13>c && y-13<e);
        const cost=(overlap ? 100000 : 0)+inkAt(x,y)*120+Math.hypot(x-cx,y-cy);
        if (cost<score) {best=[x,y];score=cost;}
      }
    }
    const [x,y]=best || [cx,cy];
    occupied.push([x-13,y-13,x+13,y+13]);
    const line=document.createElementNS(ns,'line');
    for (const [key,v] of Object.entries({x1:Math.max(l,Math.min(r,x)),y1:Math.max(t,Math.min(b,y)),x2:x,y2:y})) line.setAttribute(key,v);
    lines.append(line);
    const badge=document.createElement('button');
    badge.className='anno-badge'; badge.style.left=x+'px'; badge.style.top=y+'px';
    badge.textContent=number; badge.title=title; badge.onclick=select;
    marks.append(badge);
  }
}
function clearFocus() {
  symbolBoxes = [];
  selected = null;
  zoom=1;
  sheet.style.removeProperty('width');
  el('zoomLevel').textContent='100%';
  viewport.scrollTo(0,0);
  el('marks').replaceChildren();
  el('reset').hidden = false;
  for (const button of el('results').children) button.setAttribute('aria-pressed', 'false');
  document.querySelectorAll('.evidence-crops').forEach(node=>node.remove());
}
function changed() {
  serial++;
  report = null;
  el('toggleWrap').hidden = true;
  clearFocus();
  el('results').replaceChildren();
  el('symbols').replaceChildren();
  el('page').hidden = true;
  el('download').disabled = true;
  el('summary').textContent = '等待检测';
  el('message').textContent = '';
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  el('drawing').hidden = true;
  sheet.style.height = '100%';
  document.querySelector('#sheet object')?.remove();
  const pdf = document.createElement('object');
  pdf.type = 'application/pdf';
  const uploaded = el('sample').value === 'upload';
  pdf.data = uploaded ? (previewUrl = URL.createObjectURL(el('file').files[0])) : '/samples/' + el('sample').value + '.pdf';
  pdf.style.cssText = 'width:100%;height:100%';
  sheet.prepend(pdf);
}
function fitViewport() {
  viewport.style.setProperty('--viewport-top', (window.scrollY + viewport.getBoundingClientRect().top) + 'px');
}
window.addEventListener('resize',fitViewport);
function showPage() {
  clearFocus();
  const current = report.pages[Number(el('page').value)];
  el('drawing').src = 'data:image/png;base64,' + current.image;
  const counts = {};
  const buttons = current.rules.map((rule,index) => {
    counts[rule.status] = (counts[rule.status] || 0) + 1;
    const b = document.createElement('button'), status = document.createElement('b'), evidence = document.createElement('small');
    b.className = 'rule';
    b.dataset.index = index;
    const no = current.rules.slice(0,index+1).filter(r=>r.status==='异常').length;
    b.textContent = (rule.status==='异常' ? '异常 '+no+' ｜ ' : '')+'规则 '+(index+1)+' · '+rule.rule;
    status.textContent = rule.status;
    status.className = rule.status === '通过' ? 'pass' : 'fail';
    evidence.textContent = rule.evidence;
    b.append(status, evidence);
    for (const [label,value] of [
      ['判定依据',rule.criterion],['判定说明',rule.reason],
      ['修改建议',rule.advice],['图面位置','第 '+rule.page+' 页 · '+rule.location]
    ]) {
      const item = document.createElement('span');
      item.className = 'detail-field';
      const title = document.createElement('strong');
      const content = document.createElement('span');
      title.textContent = label;
      content.textContent = value;
      item.append(title,content);
      b.append(item);
    }
    b.onclick = () => {
      clearFocus();
      b.setAttribute('aria-pressed','true');
      if (!rule.boxes.length) return;
      setZoom(2.5);
      selected = index;
      const crops = document.createElement('span');
      crops.className = 'evidence-crops';
      rule.boxes.forEach(([x,y,r,bottom],n)=>{
        const figure=document.createElement('span');
        const caption=document.createElement('strong');
        caption.textContent=n===0?'异常标注':'对照依据';
        const canvas=document.createElement('canvas');
        const image=el('drawing');
        const left=Math.max(0,x*image.naturalWidth-12),top=Math.max(0,y*image.naturalHeight-12);
        const w=Math.min(image.naturalWidth-left,(r-x)*image.naturalWidth+24);
        const h=Math.min(image.naturalHeight-top,(bottom-y)*image.naturalHeight+24);
        canvas.width=Math.ceil(w*2);canvas.height=Math.ceil(h*2);
        canvas.getContext('2d').drawImage(image,left,top,w,h,0,0,canvas.width,canvas.height);
        figure.append(caption,canvas);crops.append(figure);
      });
      b.append(crops);
      drawMarks();
      el('marks').querySelector('.active')?.scrollIntoView({block:'center',inline:'center'});
      el('reset').hidden = false;
    };
    return b;
  });
  buttons.sort((a,b) => Number(current.rules[b.dataset.index].status==='异常')-Number(current.rules[a.dataset.index].status==='异常'));
  el('results').replaceChildren(...buttons);
  el('toggleWrap').hidden = !counts['异常'];
  const symbols = current.symbols || [];
  const rows = symbols.map(item => {
    const button = document.createElement('button');
    button.className = 'symbol-row';
    const value = document.createElement('strong'), context = document.createElement('small');
    value.textContent = item.category+' · '+item.value;
    context.textContent = item.context;
    button.append(value,context);
    button.onclick = () => {
      clearFocus();
      symbolBoxes = item.boxes;
      setZoom(2.5);
      drawMarks();
      el('marks').querySelector('.symbol-focus')?.scrollIntoView({block:'center',inline:'center'});
      el('reset').hidden = false;
    };
    return button;
  });
  const note = document.createElement('p');
  note.textContent = symbols.length ? '本页识别到 '+symbols.length+' 处标记，点击查看原文位置。' : '本页未从 PDF 文字层识别到支持的标记。';
  el('symbols').replaceChildren(note,...rows);
  fitViewport();
  drawMarks();
  el('summary').textContent = Object.entries(counts).map(([s,n])=>n+' 项'+s).join(' · ');
}
el('controls').onsubmit = async event => {
  event.preventDefault();
  changed();
  const token = serial;
  el('message').textContent = '正在核对图面标注…';
  const form = new FormData();
  form.set('kind',el('kind').value);
  if (el('sample').value === 'upload') form.set('file',el('file').files[0]);
  else form.set('sample',el('sample').value);
  try {
    const res = await fetch('/api/inspect',{method:'POST',body:form});
    const data = await res.json();
    if (token !== serial) return;
    if (!res.ok) throw Error(data.error || '检测失败');
    report = data;
    el('page').replaceChildren(...data.pages.map((_,i)=>new Option('第 '+(i+1)+' 页',i)));
    el('page').hidden = data.pages.length===1;
    el('download').disabled = false;
    document.querySelector('#sheet object')?.remove();
    sheet.style.height = 'auto';
    el('drawing').hidden = false;
    el('message').textContent = data.name;
    showPage();
  } catch(error) { if(token===serial) el('message').textContent=error.message; }
};
el('download').onclick = () => {
  const data = {...report,pages:report.pages.map(({rules,symbols},i)=>({page:i+1,rules,symbols}))};
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a = document.createElement('a'); a.href=url; a.download='图纸检测报告.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
el('file').onchange = () => {
  if (!el('file').files.length) return;
  el('sample').lastElementChild.disabled = false;
  el('sample').lastElementChild.textContent = el('file').files[0].name;
  el('sample').value='upload'; changed();
};
el('sample').onchange=el('kind').onchange=()=>el('controls').requestSubmit();
el('page').onchange=showPage;
el('reset').onclick=()=>{clearFocus();drawMarks();};
el('toggle').onchange=()=>{clearFocus();drawMarks();};
el('drawing').onload=()=>{
  sheet.style.setProperty('--ratio',el('drawing').naturalWidth/el('drawing').naturalHeight);
  drawMarks();
};
new ResizeObserver(drawMarks).observe(sheet);
el('controls').requestSubmit();

for (const [tab,other,panel] of [['rulesTab','symbolsTab','results'],['symbolsTab','rulesTab','symbols']]) {
  el(tab).onclick = () => {
    el(tab).setAttribute('aria-pressed','true');
    el(other).setAttribute('aria-pressed','false');
    el('results').hidden = panel !== 'results';
    el('symbols').hidden = panel !== 'symbols';
    clearFocus(); drawMarks();
  };
}

function fitWidth() {
  const image=el('drawing');
  const ratio=image.naturalWidth/image.naturalHeight || 1.414;
  return Math.min(viewport.clientWidth-24,(viewport.clientHeight-24)*ratio);
}
function setZoom(value, clientX, clientY) {
  if (!report || el('drawing').hidden) return;
  const frame=viewport.getBoundingClientRect();
  const old=sheet.getBoundingClientRect();
  const x=clientX ?? frame.left+viewport.clientWidth/2;
  const y=clientY ?? frame.top+viewport.clientHeight/2;
  const u=(x-old.left)/old.width, v=(y-old.top)/old.height;
  zoom=Math.max(.5,Math.min(8,value));
  sheet.style.width=(fitWidth()*zoom)+'px';
  el('zoomLevel').textContent=Math.round(zoom*100)+'%';
  const next=sheet.getBoundingClientRect();
  viewport.scrollLeft += next.left+u*next.width-x;
  viewport.scrollTop += next.top+v*next.height-y;
  drawMarks();
}
el('zoomIn').onclick=()=>setZoom(zoom*1.25);
el('zoomOut').onclick=()=>setZoom(zoom/1.25);
viewport.addEventListener('wheel',event=>{
  if (!report || el('drawing').hidden) return;
  event.preventDefault();
  setZoom(zoom*Math.exp(-Math.max(-80,Math.min(80,event.deltaY))*.003),event.clientX,event.clientY);
},{passive:false});
let drag;
viewport.addEventListener('pointerdown',event=>{
  if(event.button!==0 || event.target.closest('button') || !report) return;
  drag={x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add('dragging');
});
viewport.addEventListener('pointermove',event=>{
  if(!drag) return;
  viewport.scrollLeft=drag.left+drag.x-event.clientX;
  viewport.scrollTop=drag.top+drag.y-event.clientY;
});
for(const event of ['pointerup','pointercancel','lostpointercapture']) {
  viewport.addEventListener(event,()=>{drag=null;viewport.classList.remove('dragging');});
}
