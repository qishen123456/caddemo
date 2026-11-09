async function load(sample){
  const form=new FormData();form.set('sample',sample);
  const response=await fetch('/api/inspect',{method:'POST',body:form});
  const data=await response.json();if(!response.ok)throw Error(data.error);
  const page=data.pages[0], image=new Image();image.src='data:image/png;base64,'+page.image;await image.decode();
  return {page,image};
}
function text(tag,value,cls){
  const node=document.createElement(tag);node.textContent=value;if(cls)node.className=cls;return node;
}
function crop(image,box){
  const [x,y,r,b]=box,pad=12;
  const left=Math.max(0,x*image.naturalWidth-pad),top=Math.max(0,y*image.naturalHeight-pad);
  const width=Math.min(image.naturalWidth-left,(r-x)*image.naturalWidth+pad*2);
  const height=Math.min(image.naturalHeight-top,(b-y)*image.naturalHeight+pad*2);
  const canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height*2;
  canvas.getContext('2d').drawImage(image,left,top,width,height,0,0,canvas.width,canvas.height);
  return canvas;
}
(async()=>{
  const [good,bad]=await Promise.all([load('reference'),load('revision')]);
  for(const [data,title] of [[good,'正常图纸 · 10 项通过'],[bad,'异常图纸 · 6 项异常 / 4 项通过']]){
    const card=document.createElement('article');card.append(text('h2',title,data===good?'good':'bad'),data.image);document.getElementById('overview').append(card);
  }
  const errors=bad.page.rules.map((rule,index)=>({rule,index})).filter(x=>x.rule.status==='异常');
  errors.forEach(({rule,index},n)=>{
    const section=document.createElement('section');
    section.append(text('h2',(n+1)+' · '+rule.rule+'（'+(index<8?'常规流程':'技术标记')+'）'));
    const pair=document.createElement('div');pair.className='evidence';
    for(const [data,label] of [[good,'正常'],[bad,'异常']]){
      const item=data.page.rules[index],card=document.createElement('article');
      card.append(text('h3',label,data===good?'good':'bad'),crop(data.image,item.boxes[0]),text('p',item.evidence));
      pair.append(card);
    }
    section.append(pair,text('p','检出原因　'+rule.reason),text('small','修改建议　'+rule.advice));
    document.getElementById('details').append(section);
  });
  document.getElementById('loading').textContent='先展示正常图纸全部通过，再展示异常图纸的六处差异。以下图片和结论均由当前样本现场读取。';
})().catch(error=>{document.getElementById('loading').textContent=error.message;});
