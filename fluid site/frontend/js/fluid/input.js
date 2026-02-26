function inject(ci,cj,dvxi,dvyi,amount){
  for(let dj=-INJ_RADIUS;dj<=INJ_RADIUS;dj++)
    for(let di=-INJ_RADIUS;di<=INJ_RADIUS;di++){
      const ni=ci+di,nj=cj+dj;
      if(ni<0||ni>=COLS||nj<0||nj>=ROWS) continue;
      const dist=Math.sqrt(di*di+dj*dj);
      if(dist>INJ_RADIUS) continue;
      const f=Math.pow(1-dist/INJ_RADIUS,2);
      const id=ix(ni,nj);
      dens0[id]+=amount*f;
      vx0[id]+=dvxi*f*INJ_VEL;
      vy0[id]+=dvyi*f*INJ_VEL;
    }
}

const card=document.getElementById('card');
let prevCi=-1,prevCj=-1;

function getCell(cx,cy){
  const r=canvas.getBoundingClientRect();
  return{
    ci:Math.floor((cx-r.left)*(COLS/r.width)),
    cj:Math.floor((cy-r.top) *(ROWS/r.height))
  };
}

function isOverCard(e){
  return e.target===card||card.contains(e.target);
}

function applyMove(ci,cj){
  if(prevCi<0){prevCi=ci;prevCj=cj;return;}
  const dvx=(ci-prevCi)*2.8,dvy=(cj-prevCj)*2.8;
  const spd=Math.sqrt(dvx*dvx+dvy*dvy);
  if(spd>0.05) inject(ci,cj,dvx/spd,dvy/spd,INJ_DENS+spd*0.3);
  prevCi=ci;prevCj=cj;
}

function burstAt(ci,cj){
  for(let a=0;a<360;a+=6){
    const r=a*Math.PI/180;
    inject(ci,cj,Math.cos(r),Math.sin(r),8);
  }
}

/* Mouse: movement always injects; click bursts when not over card */
document.addEventListener('mousemove',e=>{
  const{ci,cj}=getCell(e.clientX,e.clientY);
  applyMove(ci,cj);
});

document.addEventListener('mouseleave',()=>{prevCi=-1;prevCj=-1;});

document.addEventListener('mousedown',e=>{
  if(isOverCard(e)) return;
  const{ci,cj}=getCell(e.clientX,e.clientY);
  burstAt(ci,cj);
});

/* Touch: same behavior for mobile — movement injects, touch burst */
function getTouchCell(e){
  if(!e.touches||!e.touches.length) return null;
  const t=e.touches[0];
  return getCell(t.clientX,t.clientY);
}

document.addEventListener('touchstart',e=>{
  if(isOverCard(e)) return;
  const cell=getTouchCell(e);
  if(cell){ burstAt(cell.ci,cell.cj); prevCi=cell.ci; prevCj=cell.cj; }
},{passive:true});

document.addEventListener('touchmove',e=>{
  if(isOverCard(e)) return;
  const cell=getTouchCell(e);
  if(cell){ applyMove(cell.ci,cell.cj); e.preventDefault(); }
},{passive:false});

document.addEventListener('touchend',()=>{prevCi=-1;prevCj=-1;});
document.addEventListener('touchcancel',()=>{prevCi=-1;prevCj=-1;});
