// Draw 16×16 pixel art icons (8×8 grid, 2px per cell)
(function () {
  const S = 2;

  function drawIcon(id, grid) {
    const c = document.getElementById(id);
    const ctx = c.getContext('2d');
    grid.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) { ctx.fillStyle = '#fff'; ctx.fillRect(x*S, y*S, S, S); }
      })
    );
  }

  drawIcon('liIcon', liGrid);
  drawIcon('ghIcon', ghGrid);
  drawIcon('emIcon', emGrid);
})();
