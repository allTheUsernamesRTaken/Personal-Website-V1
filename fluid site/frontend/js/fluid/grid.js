function ix(i,j){ return j*COLS+i; }

function addSource(x,s){ for(let i=0;i<N;i++) x[i]+=DT*s[i]; }

function setBound(b,x){
  for(let i=0;i<COLS;i++){
    x[ix(i,0)]      = x[ix(i,1)]      * 0.5;
    x[ix(i,ROWS-1)] = x[ix(i,ROWS-2)] * 0.5;
  }
  for(let j=0;j<ROWS;j++){
    x[ix(0,j)]      = x[ix(1,j)]      * 0.5;
    x[ix(COLS-1,j)] = x[ix(COLS-2,j)] * 0.5;
  }
}
