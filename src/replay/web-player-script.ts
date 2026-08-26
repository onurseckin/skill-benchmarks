export const webPlayerScript = `const data=JSON.parse(document.getElementById('replay-data').textContent);
const frameList=document.getElementById('frames');
const content=document.getElementById('frame-content');
const seekInput=document.getElementById('seek');
const indicator=document.getElementById('indicator');
const filterInput=document.getElementById('frame-filter');
const playButton=document.getElementById('play');
const number=new Intl.NumberFormat('en-US',{maximumFractionDigits:3});
let currentIndex=0;
let activeTab='overview';
let timer;
const element=(tag,className,text)=>{
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=text;
  return node;
};
const addRow=(label,value)=>content.append(element('p','row',label+': '+value));
const addPre=value=>content.append(element('pre','',value));
const renderFrameList=()=>{
  const filter=filterInput.value.toLocaleLowerCase('en-US').trim();
  const nodes=[];
  data.frames.forEach((frame,index)=>{
    if(filter&&!frame.summary.toLocaleLowerCase('en-US').includes(filter)&&!frame.sourceEventType.toLocaleLowerCase('en-US').includes(filter))return;
    const item=element('li');
    const button=element('button');
    button.type='button';
    button.setAttribute('aria-current',String(index===currentIndex));
    button.setAttribute('aria-label','Open persisted frame '+(index+1)+': '+frame.sourceEventType);
    const heading=element('span','frame-head');
    heading.append(element('span','',('#'+(index+1)+' '+frame.sourceEventType)),element('span','',number.format(frame.elapsedMs/1000)+' s'));
    button.append(heading,element('span','frame-summary',frame.summary));
    button.addEventListener('click',()=>seek(index));
    item.append(button);
    nodes.push(item);
  });
  frameList.replaceChildren(...nodes);
};
const renderActiveFrame=()=>{
  const frame=data.frames[currentIndex];
  if(!frame)return;
  content.replaceChildren(element('h2','','Persisted frame '+(currentIndex+1)));
  if(activeTab==='overview'){
    addRow('Event type',frame.sourceEventType);
    addRow('Summary',frame.summary);
    addRow('Timestamp microseconds',frame.timestampUs);
    addRow('Elapsed milliseconds',number.format(frame.elapsedMs));
    if(frame.turnIndex!==undefined)addRow('Turn',number.format(frame.turnIndex));
    if(frame.totalTokens!==undefined)addRow('Observed tokens',number.format(frame.totalTokens));
    addPre(JSON.stringify(frame.payload,null,2));
  }else if(activeTab==='tool'){
    if(frame.toolCall){
      addRow('Tool',frame.toolCall.toolName);
      addRow('Call ID',frame.toolCall.callId);
      if(frame.toolCall.inputPayload!==undefined)addPre(JSON.stringify(frame.toolCall.inputPayload,null,2));
      if(frame.toolCall.durationMs!==undefined)addRow('Duration milliseconds',number.format(frame.toolCall.durationMs));
      if(frame.toolCall.exitCode!==undefined)addRow('Exit code',number.format(frame.toolCall.exitCode));
    }else if(frame.command){
      addRow('Command ID',frame.command.commandId);
      if(frame.command.stream)addRow('Stream',frame.command.stream);
      if(frame.command.chunk!==undefined)addPre(frame.command.chunk);
      if(frame.command.durationMs!==undefined)addRow('Duration milliseconds',number.format(frame.command.durationMs));
      if(frame.command.exitCode!==undefined)addRow('Exit code',number.format(frame.command.exitCode));
    }else addRow('Availability','No tool or command evidence exists in this frame');
  }else if(activeTab==='thinking'){
    if(frame.thinking)addPre(frame.thinking.thoughtChunk);
    else addRow('Availability','No reasoning evidence exists in this frame');
  }else if(activeTab==='diff'){
    if(frame.diff){
      addRow('Path',frame.diff.path);
      addRow('Changes','+'+frame.diff.insertions+' −'+frame.diff.deletions);
      if(frame.diff.diffHunk!==undefined)addPre(frame.diff.diffHunk);
    }else addRow('Availability','No diff evidence exists in this frame');
  }else if(activeTab==='telemetry'){
    if(frame.telemetry){
      addRow('CPU',number.format(frame.telemetry.cpuPercent)+'%');
      addRow('Memory RSS',number.format(frame.telemetry.memoryRssMb)+' MB');
      addRow('Memory limit',number.format(frame.telemetry.memoryLimitMb)+' MB');
      addRow('Active PIDs',number.format(frame.telemetry.activePids));
    }else addRow('Availability','No resource sample exists in this frame');
  }
  seekInput.value=String(currentIndex);
  indicator.textContent=(currentIndex+1)+' of '+data.frames.length+' frames';
  renderFrameList();
};
const seek=index=>{
  currentIndex=Math.max(0,Math.min(data.frames.length-1,Number(index)));
  renderActiveFrame();
};
const selectTab=button=>{
  activeTab=button.dataset.tab;
  content.setAttribute('aria-labelledby',button.id);
  document.querySelectorAll('[role="tab"]').forEach(item=>{
    const selected=item===button;
    item.setAttribute('aria-selected',String(selected));
    item.tabIndex=selected?0:-1;
  });
  renderActiveFrame();
};
const tabs=Array.from(document.querySelectorAll('[role="tab"]'));
tabs.forEach((button,index)=>{
  button.addEventListener('click',()=>selectTab(button));
  button.addEventListener('keydown',event=>{
    const direction=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
    const target=event.key==='Home'?0:event.key==='End'?tabs.length-1:direction===0?undefined:(index+direction+tabs.length)%tabs.length;
    if(target===undefined)return;
    event.preventDefault();
    tabs[target].focus();
    selectTab(tabs[target]);
  });
});
filterInput.addEventListener('input',renderFrameList);
seekInput.addEventListener('input',()=>seek(seekInput.value));
document.getElementById('previous').addEventListener('click',()=>seek(currentIndex-1));
document.getElementById('next').addEventListener('click',()=>seek(currentIndex+1));
playButton.addEventListener('click',()=>{
  if(timer){clearInterval(timer);timer=undefined;playButton.textContent='Play';playButton.setAttribute('aria-label','Play persisted replay');return;}
  playButton.textContent='Pause';
  playButton.setAttribute('aria-label','Pause persisted replay');
  timer=setInterval(()=>{
    if(currentIndex>=data.frames.length-1){clearInterval(timer);timer=undefined;playButton.textContent='Play';playButton.setAttribute('aria-label','Play persisted replay');return;}
    seek(currentIndex+1);
  },Math.max(20,Math.round(500/Number(document.getElementById('speed').value))));
});
renderActiveFrame();`;
