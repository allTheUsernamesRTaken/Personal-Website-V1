const renderCurl=new Float32Array(N);
function computeCurl(){
  for(let j=1;j<ROWS-1;j++)
    for(let i=1;i<COLS-1;i++)
      renderCurl[ix(i,j)]=Math.abs(
        (vy[ix(i+1,j)]-vy[ix(i-1,j)])*0.5-(vx[ix(i,j+1)]-vx[ix(i,j-1)])*0.5
      );
}

const CHARS=['░','░','▒','▒','▓','▓','█','■'];
ctx.font=`${CW+2}px monospace`;
ctx.textAlign='left';
ctx.textBaseline='top';

function render(){
  computeCurl();
  ctx.fillStyle='#05060c';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let j=0;j<ROWS;j++){
    const py=j*CH;
    for(let i=0;i<COLS;i++){
      const id=ix(i,j);
      const d=dens[id], vxi=vx[id], vyi=vy[id];
      const spd=Math.sqrt(vxi*vxi+vyi*vyi);
      const wrl=renderCurl[id];
      if(d<0.003&&spd<0.004) continue;
      let H=Math.atan2(vyi,vxi)*(180/Math.PI);
      if(H<0)H+=360;
      const S=82+Math.min(spd*15,16);
      const L=Math.min(8+d*52+spd*18+wrl*40,78);
      const alpha=Math.min(Math.pow(d*2.8+spd*0.8,1.4),1.0);
      ctx.fillStyle=`hsla(${H|0},${S|0}%,${L|0}%,${alpha.toFixed(2)})`;
      const fill=Math.min(d*2.5+spd*0.4,0.999);
      ctx.fillText(CHARS[Math.floor(fill*CHARS.length)],i*CW,py);
    }
  }
}
