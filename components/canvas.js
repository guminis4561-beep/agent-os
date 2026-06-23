// ═══════════════════════════════════════════════════
// COMPONENT: Canvas (Main Content Area)
// ═══════════════════════════════════════════════════

export function renderCanvas(contentHtml) {
  const canvas = document.getElementById('canvas');
  if (!canvas) return;
  
  canvas.innerHTML = `
    <div class="canvas__content">
      ${contentHtml}
    </div>
  `;
}

export function setCanvasLoading() {
  const canvas = document.getElementById('canvas');
  if (!canvas) return;

  canvas.innerHTML = `
    <div class="canvas__content">
      <div style="display:flex;flex-direction:column;gap:var(--space-4);padding:var(--space-6);">
        <div class="skeleton skeleton--title"></div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-4);">
          <div class="skeleton skeleton--card"></div>
          <div class="skeleton skeleton--card"></div>
          <div class="skeleton skeleton--card"></div>
          <div class="skeleton skeleton--card"></div>
        </div>
        <div class="skeleton" style="height:200px;"></div>
        <div class="skeleton skeleton--text" style="width:80%;"></div>
        <div class="skeleton skeleton--text" style="width:60%;"></div>
      </div>
    </div>
  `;
}
