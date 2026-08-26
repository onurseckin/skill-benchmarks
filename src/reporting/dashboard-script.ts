export const dashboardScript = `const table=document.querySelector('[data-leaderboard]');
const rows=table?Array.from(table.querySelectorAll('tbody tr')):[];
const controls=Array.from(document.querySelectorAll('[data-filter]'));
const resultCount=document.getElementById('result-count');
const emptyState=document.getElementById('filter-empty');
document.querySelector('.filters').addEventListener('submit',event=>event.preventDefault());
const normalized=value=>value.toLocaleLowerCase('en-US').trim();
const matchesSelection=(row,control)=>{
  if(!control.value)return true;
  const key=control.dataset.filter;
  if(key==='model'||key==='provider')return JSON.parse(row.dataset[key+'Values']).includes(control.value);
  return row.dataset[key]===control.value;
};
const applyFilters=()=>{
  let visible=0;
  rows.forEach(row=>{
    const search=normalized(document.getElementById('report-search').value);
    const matches=controls.every(control=>matchesSelection(row,control))&&(!search||normalized(row.textContent).includes(search));
    row.hidden=!matches;
    if(matches)visible+=1;
  });
  resultCount.textContent=visible+' eligible cohort '+(visible===1?'row':'rows')+' shown';
  emptyState.dataset.visible=String(visible===0);
};
controls.forEach(control=>control.addEventListener('input',applyFilters));
document.getElementById('report-search').addEventListener('input',applyFilters);
document.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>{
  const key=button.dataset.sort;
  const heading=button.closest('th');
  const direction=heading.getAttribute('aria-sort')==='ascending'?'descending':'ascending';
  document.querySelectorAll('th[aria-sort]').forEach(item=>item.setAttribute('aria-sort','none'));
  heading.setAttribute('aria-sort',direction);
  rows.sort((left,right)=>{
    const a=left.dataset[key]||'';
    const b=right.dataset[key]||'';
    const numeric=Number(a)-Number(b);
    const order=Number.isNaN(numeric)?a.localeCompare(b,'en-US'):numeric;
    return direction==='ascending'?order:-order;
  });
  rows.forEach(row=>table.tBodies[0].append(row));
}));
applyFilters();`;
