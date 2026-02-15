function linSolve(b,x,x0,a,c){
  const inv=1/c;
  for(let k=0;k<ITER;k++){
    for(let j=1;j<ROWS-1;j++)
      for(let i=1;i<COLS-1;i++)
        x[ix(i,j)]=(x0[ix(i,j)]+a*(x[ix(i-1,j)]+x[ix(i+1,j)]+x[ix(i,j-1)]+x[ix(i,j+1)]))*inv;
    setBound(b,x);
  }
}

function diffuse(b,x,x0,coeff){
  const a=DT*coeff*(COLS-2)*(ROWS-2);
  linSolve(b,x,x0,a,1+4*a);
}

function advect(b,d,d0,vX,vY){
  const dtx=DT*(COLS-2), dty=DT*(ROWS-2);
  for(let j=1;j<ROWS-1;j++){
    for(let i=1;i<COLS-1;i++){
      let px=i-dtx*vX[ix(i,j)];
      let py=j-dty*vY[ix(i,j)];
      px=Math.max(0.5,Math.min(COLS-1.5,px));
      py=Math.max(0.5,Math.min(ROWS-1.5,py));
      const i0=Math.floor(px),i1=i0+1;
      const j0=Math.floor(py),j1=j0+1;
      const s1=px-i0,s0=1-s1,t1=py-j0,t0=1-t1;
      d[ix(i,j)]=s0*(t0*d0[ix(i0,j0)]+t1*d0[ix(i0,j1)])+s1*(t0*d0[ix(i1,j0)]+t1*d0[ix(i1,j1)]);
    }
  }
  setBound(b,d);
}

function project(vX,vY,p,div){
  const hx=1/COLS,hy=1/ROWS;
  for(let j=1;j<ROWS-1;j++)
    for(let i=1;i<COLS-1;i++){
      div[ix(i,j)]=-0.5*(hx*(vX[ix(i+1,j)]-vX[ix(i-1,j)])+hy*(vY[ix(i,j+1)]-vY[ix(i,j-1)]));
      p[ix(i,j)]=0;
    }
  setBound(0,div); setBound(0,p);
  linSolve(0,p,div,1,4);
  for(let j=1;j<ROWS-1;j++)
    for(let i=1;i<COLS-1;i++){
      vX[ix(i,j)]-=0.5*(p[ix(i+1,j)]-p[ix(i-1,j)])/hx;
      vY[ix(i,j)]-=0.5*(p[ix(i,j+1)]-p[ix(i,j-1)])/hy;
    }
  setBound(1,vX); setBound(2,vY);
}

function vorticityConfinement(vX,vY){
  const curl=new Float32Array(N);
  for(let j=1;j<ROWS-1;j++)
    for(let i=1;i<COLS-1;i++)
      curl[ix(i,j)]=(vY[ix(i+1,j)]-vY[ix(i-1,j)])*0.5-(vX[ix(i,j+1)]-vX[ix(i,j-1)])*0.5;
  for(let j=1;j<ROWS-1;j++)
    for(let i=1;i<COLS-1;i++){
      const dx=(Math.abs(curl[ix(i+1,j)])-Math.abs(curl[ix(i-1,j)]))*0.5;
      const dy=(Math.abs(curl[ix(i,j+1)])-Math.abs(curl[ix(i,j-1)]))*0.5;
      const len=Math.sqrt(dx*dx+dy*dy)+1e-6;
      vX[ix(i,j)]+=VORT*DT*(dy/len)*curl[ix(i,j)];
      vY[ix(i,j)]-=VORT*DT*(dx/len)*curl[ix(i,j)];
    }
}

function step(){
  addSource(vx,vx0); addSource(vy,vy0);
  [vx,vx0]=[vx0,vx]; diffuse(1,vx,vx0,VISC);
  [vy,vy0]=[vy0,vy]; diffuse(2,vy,vy0,VISC);
  project(vx,vy,vx0,vy0);
  [vx,vx0]=[vx0,vx]; [vy,vy0]=[vy0,vy];
  advect(1,vx,vx0,vx0,vy0);
  advect(2,vy,vy0,vx0,vy0);
  project(vx,vy,vx0,vy0);
  vorticityConfinement(vx,vy);
  addSource(dens,dens0);
  [dens,dens0]=[dens0,dens]; diffuse(0,dens,dens0,DIFF);
  [dens,dens0]=[dens0,dens]; advect(0,dens,dens0,vx,vy);
  for(let i=0;i<N;i++){
    vx0[i]=0; vy0[i]=0; dens0[i]=0;
    dens[i]*=FADE; vx[i]*=VEL_DAMP; vy[i]*=VEL_DAMP;
  }
}
