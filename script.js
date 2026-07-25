// ===== واجهات TypeScript =====
interface SlideData {
  id: string | number;
  name: string;
  canvasJSON: string | null;
  bgColor: string;
  zoom: number;
}

interface EffectDefinition {
  type: string;
  duration: number;
  delay: number;
  easing: string;
  infinite: boolean;
}

interface ExportedSlide {
  version: string;
  slideName: string;
  canvasJSON: object | null;
  bgColor: string;
  zoom: number;
}

// ===== تعقيم النصوص (Sanitizer) =====
const ALLOWED_TAGS = new Set(['b', 'i', 'u', 'br', 'span', 'div']);
const sanitizeHTML = (input: string): string => {
  const div = document.createElement('div');
  div.textContent = input;
  return div.innerHTML;
};

const sanitizeSlideName = (name: string): string => {
  return name.replace(/[<>&"']/g, '');
};

// ===== دوال مساعدة =====
const escapeHtml = (s: string): string => {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return s.replace(/[&<>"']/g, (m) => map[m] || m);
};

// ===== التحقق من صحة ملف REPT المستورد =====
interface ReptFileSchema {
  version?: string;
  slideName?: string;
  canvasJSON?: object;
  bgColor?: string;
  zoom?: number;
}

const validateReptFile = (data: unknown): data is ReptFileSchema => {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if (obj.canvasJSON !== undefined && typeof obj.canvasJSON !== 'object') return false;
  if (obj.bgColor !== undefined && typeof obj.bgColor !== 'string') return false;
  if (obj.zoom !== undefined && typeof obj.zoom !== 'number') return false;
  if (obj.slideName !== undefined && typeof obj.slideName !== 'string') return false;
  return true;
};

// ===== الثوابت =====
const container = document.getElementById('fabric-canvas-container') as HTMLElement;
const zoomLevelDisplay = document.getElementById('zoomLevelDisplay') as HTMLElement;
const undoBtn = document.querySelector('[data-action="undo"]') as HTMLButtonElement;
const redoBtn = document.querySelector('[data-action="redo"]') as HTMLButtonElement;
const boldBtn = document.querySelector('[data-action="bold"]') as HTMLButtonElement;
const italicBtn = document.querySelector('[data-action="italic"]') as HTMLButtonElement;
const underlineBtn = document.querySelector('[data-action="underline"]') as HTMLButtonElement;
const alignLeftBtn = document.querySelector('[data-action="alignLeft"]') as HTMLButtonElement;
const alignCenterBtn = document.querySelector('[data-action="alignCenter"]') as HTMLButtonElement;
const alignRightBtn = document.querySelector('[data-action="alignRight"]') as HTMLButtonElement;
const fillColorBtn = document.getElementById('fillColorBtn') as HTMLButtonElement;
const bgColorBtn = document.getElementById('bgColorBtn') as HTMLButtonElement;
const modal = document.getElementById('effectModal') as HTMLElement;

// ===== المتغيرات العامة =====
let slides: SlideData[] = [];
let currentSlideIndex = 0;
let canvas: fabric.Canvas;
let historyStack: string[] = [];
let historyIndex = -1;
let zoomLevel = 1;
let historySaveTimer: number | null = null;
let hasUnsavedChanges = false;

// ===== دوال الحالة =====
const markAsChanged = (): void => {
  hasUnsavedChanges = true;
};
const clearUnsaved = (): void => {
  hasUnsavedChanges = false;
};

const saveCurrentSlideState = (): void => {
  if (canvas && slides.length) {
    slides[currentSlideIndex].canvasJSON = JSON.stringify(
      canvas.toJSON(['id', 'effectDef'])
    );
    slides[currentSlideIndex].bgColor = canvas.backgroundColor as string;
    slides[currentSlideIndex].zoom = zoomLevel;
  }
  clearUnsaved();
};

const loadSlide = (index: number): boolean => {
  if (index < 0 || index >= slides.length) return false;
  saveCurrentSlideState();
  const slide = slides[index];
  currentSlideIndex = index;
  if (slide.canvasJSON) {
    canvas.loadFromJSON(slide.canvasJSON, () => {
      if (slide.bgColor)
        canvas.setBackgroundColor(slide.bgColor, () => {});
      canvas.renderAll();
      zoomLevel = slide.zoom || 1;
      canvas.setZoom(zoomLevel);
      updateZoomDisplay();
      resetHistoryFromCurrentCanvas();
      canvas.renderAll();
      clearUnsaved();
    });
  } else {
    canvas.clear();
    canvas.backgroundColor = slide.bgColor || '#2b2b2b';
    canvas.setZoom(1);
    zoomLevel = 1;
    canvas.renderAll();
    resetHistoryFromCurrentCanvas();
  }
  renderSlideSidebar();
  updateStyleButtonsState();
  return true;
};

const resetHistoryFromCurrentCanvas = (): void => {
  const state = JSON.stringify(canvas.toJSON(['id']));
  historyStack = [state];
  historyIndex = 0;
  updateUndoRedoButtons();
};

const updateUndoRedoButtons = (): void => {
  if (undoBtn) undoBtn.disabled = historyIndex <= 0;
  if (redoBtn) redoBtn.disabled = historyIndex >= historyStack.length - 1;
};

const scheduleHistorySave = (): void => {
  if (historySaveTimer) clearTimeout(historySaveTimer);
  historySaveTimer = window.setTimeout(() => {
    const state = JSON.stringify(canvas.toJSON(['id']));
    if (historyStack.length === 0 || historyStack[historyIndex] !== state) {
      historyStack = historyStack.slice(0, historyIndex + 1);
      historyStack.push(state);
      historyIndex++;
      markAsChanged();
      updateUndoRedoButtons();
    }
    saveCurrentSlideState();
  }, 150);
};

const undo = (): void => {
  if (historyIndex > 0) {
    historyIndex--;
    loadHistoryState();
  }
};

const redo = (): void => {
  if (historyIndex < historyStack.length - 1) {
    historyIndex++;
    loadHistoryState();
  }
};

const loadHistoryState = (): void => {
  canvas.loadFromJSON(historyStack[historyIndex], () => {
    canvas.renderAll();
    updateUndoRedoButtons();
    updateStyleButtonsState();
    markAsChanged();
    saveCurrentSlideState();
  });
};

const updateZoomDisplay = (): void => {
  zoomLevelDisplay.textContent = Math.round(zoomLevel * 100) + '%';
};

const zoomIn = (): void => {
  zoomLevel = Math.min(2, zoomLevel + 0.1);
  canvas.setZoom(zoomLevel);
  updateZoomDisplay();
  scheduleHistorySave();
};

const zoomOut = (): void => {
  zoomLevel = Math.max(0.5, zoomLevel - 0.1);
  canvas.setZoom(zoomLevel);
  updateZoomDisplay();
  scheduleHistorySave();
};

const groupSelected = (): void => {
  const objs = canvas.getActiveObjects();
  if (objs.length < 2) {
    alert('Select at least 2 objects.');
    return;
  }
  const activeObj = canvas.getActiveObject();
  if (activeObj) {
    activeObj.toGroup();
    canvas.renderAll();
    scheduleHistorySave();
    updateStyleButtonsState();
  }
};

const ungroupSelected = (): void => {
  const obj = canvas.getActiveObject();
  if (!obj || obj.type !== 'group') {
    alert('Select a group.');
    return;
  }
  (obj as fabric.Group).toActiveSelection();
  canvas.renderAll();
  scheduleHistorySave();
  updateStyleButtonsState();
};

// ===== EFFECT ENGINE =====
const easingMap: Record<string, (t: number) => number> = {
  easeOutCubic: (fabric.util.ease as any).easeOutCubic,
  easeOutBounce: (fabric.util.ease as any).easeOutBounce,
  easeInOutQuad: (fabric.util.ease as any).easeInOutQuad,
  linear: (fabric.util.ease as any).linear,
};

const applyEffectToObject = (
  obj: fabric.Object,
  effect: string,
  duration: number,
  delay: number,
  easingName: string,
  isInfinite: boolean = false
): void => {
  if (!obj) return;
  const easingFn = easingMap[easingName] || easingMap.easeOutCubic;
  let completed = false;

  const runAnimation = (callback?: () => void): void => {
    const originalLeft = obj.left!;
    const originalTop = obj.top!;
    const originalScaleX = obj.scaleX!;
    const originalScaleY = obj.scaleY!;
    const originalAngle = obj.angle!;
    const originalOpacity = obj.opacity !== undefined ? obj.opacity : 1;
    let targetProps: Record<string, number> = {};

    switch (effect) {
      case 'fadeIn':
        obj.set('opacity', 0);
        targetProps = { opacity: originalOpacity };
        break;
      case 'slideInLeft':
        obj.set('left', originalLeft - 300);
        targetProps = { left: originalLeft };
        break;
      case 'slideInRight':
        obj.set('left', originalLeft + 300);
        targetProps = { left: originalLeft };
        break;
      case 'slideInUp':
        obj.set('top', originalTop + 200);
        targetProps = { top: originalTop };
        break;
      case 'slideInDown':
        obj.set('top', originalTop - 200);
        targetProps = { top: originalTop };
        break;
      case 'zoomIn':
        obj.set('scaleX', 0.1);
        obj.set('scaleY', 0.1);
        targetProps = { scaleX: originalScaleX, scaleY: originalScaleY };
        break;
      case 'bounce':
        obj.set('scaleX', 0.8);
        obj.set('scaleY', 0.8);
        targetProps = { scaleX: originalScaleX, scaleY: originalScaleY };
        break;
      case 'flipX':
        obj.set('scaleX', -originalScaleX);
        targetProps = { scaleX: originalScaleX };
        break;
      case 'flipY':
        obj.set('scaleY', -originalScaleY);
        targetProps = { scaleY: originalScaleY };
        break;
      case 'rotateIn':
        obj.set('angle', -45);
        targetProps = { angle: originalAngle };
        break;
      default:
        if (callback) callback();
        return;
    }
    canvas.renderAll();
    obj.animate(targetProps, {
      duration: duration,
      easing: easingFn,
      onChange: canvas.renderAll.bind(canvas),
      onComplete: () => {
        if (effect === 'flipX') obj.set('scaleX', originalScaleX);
        if (effect === 'flipY') obj.set('scaleY', originalScaleY);
        canvas.renderAll();
        if (callback) callback();
      },
    } as any);
  };

  const startLoop = (): void => {
    runAnimation(() => {
      if (isInfinite && !completed) {
        setTimeout(startLoop, delay + duration + 100);
      }
    });
  };

  if (delay > 0) setTimeout(startLoop, delay);
  else startLoop();
};

const setObjectEffect = (obj: fabric.Object, effectData: EffectDefinition): void => {
  (obj as any).effectDef = { ...effectData };
  applyEffectToObject(
    obj,
    effectData.type,
    effectData.duration,
    effectData.delay,
    effectData.easing,
    effectData.infinite
  );
  scheduleHistorySave();
};

const showEffectModal = (): void => {
  modal.classList.add('active');
};

const closeEffectModal = (): void => {
  modal.classList.remove('active');
};

const applyEffectFromUI = (): void => {
  const obj = canvas.getActiveObject();
  if (!obj) {
    alert('Please select an object.');
    return;
  }
  const effectType = (document.getElementById('effectSelect') as HTMLSelectElement).value;
  const duration = parseInt(
    (document.getElementById('effectDuration') as HTMLInputElement).value,
    10
  );
  const delay = parseInt(
    (document.getElementById('effectDelay') as HTMLInputElement).value,
    10
  );
  const easing = (document.getElementById('effectEasing') as HTMLSelectElement).value;
  const isInfinite =
    (
      document.querySelector(
        'input[name="timePeriod"]:checked'
      ) as HTMLInputElement
    )?.value === 'infinite';
  const effectData: EffectDefinition = {
    type: effectType,
    duration,
    delay,
    easing,
    infinite: isInfinite,
  };
  setObjectEffect(obj, effectData);
  closeEffectModal();
};

// ===== PREVIEW MODE =====
const openPreviewMode = (): void => {
  saveCurrentSlideState();
  const slidesData = slides.map((slide) => ({
    name: slide.name,
    canvasJSON: slide.canvasJSON ? JSON.parse(slide.canvasJSON) : null,
    bgColor: slide.bgColor,
  }));
  const currentIdx = currentSlideIndex;

  const win = window.open('about:blank', '_blank');
  if (!win) {
    alert('Popup blocked. Please allow popups.');
    return;
  }

  const previewHTML = `<!DOCTYPE html>
<html>
<head><title>Presentation Preview</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js"><\/script>
<style>
body{margin:0;overflow:hidden;background:#1e1e1e;font-family:'Segoe UI',sans-serif;}
.preview-container{position:relative;width:100vw;height:100vh;display:flex;justify-content:center;align-items:center;background:#000;}
canvas{box-shadow:0 0 0 1px #3c3c3c;max-width:90vw;max-height:90vh;}
.nav-controls{position:fixed;bottom:20px;left:0;right:0;text-align:center;background:rgba(0,0,0,0.7);padding:10px;color:white;z-index:100;}
button{background:#007acc;border:none;color:white;padding:8px 16px;margin:0 8px;border-radius:8px;cursor:pointer;font-size:16px;}
.slide-counter{margin:0 16px;font-size:16px;}
.instruction{position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.5);padding:5px 10px;border-radius:8px;font-size:12px;}
</style></head>
<body>
<div class="preview-container"><canvas id="previewCanvas" width="900" height="600"></canvas></div>
<div class="nav-controls"><button id="prevBtn">◀ Previous</button><span class="slide-counter" id="slideCounter">Slide 1 / 1</span><button id="nextBtn">Next ▶</button></div>
<div class="instruction">← → keys | ESC to close</div>
<script>
  const slidesData = ${JSON.stringify(slidesData)};
  let currentIdx = ${currentIdx};
  let canvas;
  let activeTimeouts = [];
  function clearEffects(){ activeTimeouts.forEach(function(t){clearTimeout(t);}); activeTimeouts=[]; }
  function applyObjectEffect(obj,effectDef){
    if(!obj||!effectDef)return;
    var easingMap={easeOutCubic:fabric.util.ease.easeOutCubic,easeOutBounce:fabric.util.ease.easeOutBounce,easeInOutQuad:fabric.util.ease.easeInOutQuad,linear:fabric.util.ease.linear};
    var easing=easingMap[effectDef.easing]||easingMap.easeOutCubic;
    var duration=effectDef.duration,delay=effectDef.delay,effect=effectDef.type,isInfinite=effectDef.infinite===true;
    function animateOnce(cb){
      var oL=obj.left,oT=obj.top,oSX=obj.scaleX,oSY=obj.scaleY,oA=obj.angle,oO=obj.opacity||1,target={};
      if(effect==='fadeIn'){obj.set('opacity',0);target={opacity:oO};}
      else if(effect==='slideInLeft'){obj.set('left',oL-300);target={left:oL};}
      else if(effect==='slideInRight'){obj.set('left',oL+300);target={left:oL};}
      else if(effect==='slideInUp'){obj.set('top',oT+200);target={top:oT};}
      else if(effect==='slideInDown'){obj.set('top',oT-200);target={top:oT};}
      else if(effect==='zoomIn'){obj.set('scaleX',0.1);obj.set('scaleY',0.1);target={scaleX:oSX,scaleY:oSY};}
      else if(effect==='bounce'){obj.set('scaleX',0.8);obj.set('scaleY',0.8);target={scaleX:oSX,scaleY:oSY};}
      else if(effect==='flipX'){obj.set('scaleX',-oSX);target={scaleX:oSX};}
      else if(effect==='flipY'){obj.set('scaleY',-oSY);target={scaleY:oSY};}
      else if(effect==='rotateIn'){obj.set('angle',-45);target={angle:oA};}
      else{if(cb)cb();return;}
      canvas.renderAll();
      obj.animate(target,{duration:duration,easing:easing,onChange:canvas.renderAll.bind(canvas),onComplete:function(){
        if(effect==='flipX')obj.set('scaleX',oSX);if(effect==='flipY')obj.set('scaleY',oSY);canvas.renderAll();if(cb)cb();
      }});
    }
    function startLoop(){animateOnce(function(){if(isInfinite){var t=setTimeout(startLoop,delay+duration+100);activeTimeouts.push(t);}});}
    if(delay>0){var t=setTimeout(startLoop,delay);activeTimeouts.push(t);}else startLoop();
  }
  function loadSlide(index){
    clearEffects();var slide=slidesData[index];
    if(slide&&slide.canvasJSON)canvas.loadFromJSON(slide.canvasJSON,function(){
      if(slide.bgColor)canvas.setBackgroundColor(slide.bgColor,function(){canvas.renderAll();});
      canvas.renderAll();
      canvas.getObjects().forEach(function(obj){if(obj.effectDef)applyObjectEffect(obj,obj.effectDef);});
    });
    else{canvas.clear();if(slide&&slide.bgColor)canvas.setBackgroundColor(slide.bgColor,function(){canvas.renderAll();});else canvas.setBackgroundColor('#2b2b2b',function(){canvas.renderAll();});canvas.renderAll();}
    document.getElementById('slideCounter').innerText='Slide '+(index+1)+' / '+slidesData.length;
  }
  function initPreview(){canvas=new fabric.Canvas('previewCanvas',{selection:false,preserveObjectStacking:true});canvas.setWidth(900);canvas.setHeight(600);loadSlide(currentIdx);}
  function nextSlide(){if(currentIdx<slidesData.length-1){currentIdx++;loadSlide(currentIdx);}}
  function prevSlide(){if(currentIdx>0){currentIdx--;loadSlide(currentIdx);}}
  document.getElementById('prevBtn').addEventListener('click',prevSlide);
  document.getElementById('nextBtn').addEventListener('click',nextSlide);
  window.addEventListener('keydown',function(e){if(e.key==='ArrowLeft')prevSlide();else if(e.key==='ArrowRight')nextSlide();else if(e.key==='Escape')window.close();});
  initPreview();
<\/script>
</body></html>`;

  win.document.write(previewHTML);
  win.document.close();
};

// ===== CANVAS INIT & SLIDES =====
const initCanvas = (): void => {
  const existingCanvas = document.getElementById('fabric-canvas');
  if (existingCanvas) existingCanvas.remove();
  const newCanvasElem = document.createElement('canvas');
  newCanvasElem.id = 'fabric-canvas';
  newCanvasElem.width = container.clientWidth || 900;
  newCanvasElem.height = container.clientHeight || 600;
  container.innerHTML = '';
  container.appendChild(newCanvasElem);
  canvas = new fabric.Canvas('fabric-canvas', {
    preserveObjectStacking: true,
    selection: true,
    backgroundColor: '#2b2b2b',
  });
  canvas.setWidth(container.clientWidth);
  canvas.setHeight(container.clientHeight);
  canvas.renderAll();
  canvas.on('object:added', () => scheduleHistorySave());
  canvas.on('object:modified', () => scheduleHistorySave());
  canvas.on('object:removed', () => scheduleHistorySave());
  canvas.on('selection:created', () => updateStyleButtonsState());
  canvas.on('selection:updated', () => updateStyleButtonsState());
  canvas.on('selection:cleared', () => updateStyleButtonsState());
};

const renameSlide = (index: number): void => {
  const currentName = slides[index].name;
  const newName = prompt('Rename slide:', currentName);
  if (newName && newName.trim() !== '') {
    slides[index].name = sanitizeSlideName(newName.trim());
    renderSlideSidebar();
    markAsChanged();
  }
};

const renderSlideSidebar = (): void => {
  const div = document.getElementById('slidesList') as HTMLElement;
  while (div.firstChild) {
    div.removeChild(div.firstChild);
  }

  slides.forEach((slide, idx) => {
    const item = document.createElement('div');
    item.className = `slide-item ${idx === currentSlideIndex ? 'active' : ''}`;

    const infoDiv = document.createElement('div');
    infoDiv.className = 'slide-info';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'slide-name';
    nameDiv.textContent = slide.name;

    const indexDiv = document.createElement('div');
    indexDiv.className = 'slide-index';
    indexDiv.textContent = `Slide ${idx + 1}`;

    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(indexDiv);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'slide-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'rename-slide-btn';
    renameBtn.title = 'Rename slide';
    renameBtn.innerHTML = '<span class="material-icons">edit</span>';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      renameSlide(idx);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-slide-btn';
    deleteBtn.title = 'Delete slide';
    deleteBtn.innerHTML =
      '<span class="material-icons">delete_outline</span>';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSlide(idx);
    });

    actionsDiv.appendChild(renameBtn);
    actionsDiv.appendChild(deleteBtn);

    infoDiv.addEventListener('click', () => loadSlide(idx));

    item.appendChild(infoDiv);
    item.appendChild(actionsDiv);
    div.appendChild(item);
  });
};

const deleteSlide = (i: number): void => {
  if (slides.length <= 1) {
    alert('Cannot delete last slide.');
    return;
  }
  if (confirm(`Delete "${slides[i].name}"?`)) {
    slides.splice(i, 1);
    if (currentSlideIndex >= slides.length) currentSlideIndex = slides.length - 1;
    loadSlide(currentSlideIndex);
    renderSlideSidebar();
    markAsChanged();
  }
};

const addNewSlide = (): void => {
  saveCurrentSlideState();
  slides.push({
    id: Date.now(),
    name: sanitizeSlideName(`Slide ${slides.length + 1}`),
    canvasJSON: null,
    bgColor: '#2b2b2b',
    zoom: 1,
  });
  loadSlide(slides.length - 1);
  renderSlideSidebar();
  markAsChanged();
};

const initSlides = (): void => {
  slides = [
    {
      id: 'init',
      name: 'Slide 1',
      canvasJSON: null,
      bgColor: '#2b2b2b',
      zoom: 1,
    },
  ];
  currentSlideIndex = 0;
  initCanvas();
  resetHistoryFromCurrentCanvas();
  loadSlide(0);
  renderSlideSidebar();
};

// ===== أدوات التحرير =====
const addTextBox = (): void => {
  const tb = new fabric.Textbox('نص جديد', {
    left: 100,
    top: 100,
    width: 200,
    fontSize: 24,
    fill: '#ffffff',
    fontFamily: 'Segoe UI'
  });
  canvas.add(tb);
  canvas.setActiveObject(tb);
  canvas.renderAll();
  scheduleHistorySave();
};

const addRectangle = (): void => {
  canvas.add(
    new fabric.Rect({
      left: 150,
      top: 150,
      width: 120,
      height: 80,
      fill: '#3498db',
      stroke: '#ffffff',
      strokeWidth: 2,
    })
  );
  canvas.renderAll();
  scheduleHistorySave();
};

const addCircle = (): void => {
  canvas.add(
    new fabric.Circle({
      left: 200,
      top: 200,
      radius: 50,
      fill: '#e67e22',
      stroke: '#ffffff',
      strokeWidth: 2,
    })
  );
  canvas.renderAll();
  scheduleHistorySave();
};

const addImageFromFile = (): void => {
  document.getElementById('imageFileInput')!.click();
};

const addQRCode = (): void => {
  const t = prompt('Enter text/URL:');
  if (t) {
    const encoded = encodeURIComponent(t.trim().slice(0, 500));
    fabric.Image.fromURL(
      `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encoded}`,
      (img) => {
        img.set({ left: 100, top: 100 });
        canvas.add(img);
        canvas.renderAll();
        scheduleHistorySave();
      }
    );
  }
};

const handleImageFileSelect = (e: Event): void => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (f && f.type.startsWith('image/')) {
    const r = new FileReader();
    r.onload = (ev) => {
      const result = ev.target?.result as string;
      if (result) {
        fabric.Image.fromURL(result, (img) => {
          img.scaleToWidth(250);
          img.set({ left: 100, top: 100 });
          canvas.add(img);
          canvas.renderAll();
          scheduleHistorySave();
        });
      }
    };
    r.readAsDataURL(f);
  }
  input.value = '';
};

const deleteSelected = (): void => {
  canvas.getActiveObjects().forEach((o) => canvas.remove(o));
  canvas.discardActiveObject();
  canvas.renderAll();
  scheduleHistorySave();
};

const applyToSelected = (cb: (o: fabric.Object) => void): void => {
  canvas.getActiveObjects().forEach(cb);
  canvas.renderAll();
  scheduleHistorySave();
  updateStyleButtonsState();
};

const setBold = (): void => {
  applyToSelected((o) => {
    if (o.type === 'textbox' || o.type === 'i-text') {
      const textObj = o as fabric.Textbox;
      textObj.fontWeight = textObj.fontWeight === 'bold' ? 'normal' : 'bold';
    }
  });
};

const setItalic = (): void => {
  applyToSelected((o) => {
    if (o.type === 'textbox' || o.type === 'i-text') {
      const textObj = o as fabric.Textbox;
      textObj.fontStyle = textObj.fontStyle === 'italic' ? 'normal' : 'italic';
    }
  });
};

const setUnderline = (): void => {
  applyToSelected((o) => {
    if (o.type === 'textbox' || o.type === 'i-text') {
      const textObj = o as fabric.Textbox;
      textObj.underline = !textObj.underline;
    }
  });
};

const setFontSize = (s: string): void => {
  applyToSelected((o) => {
    if ((o as any).fontSize) {
      (o as any).fontSize = parseInt(s);
    }
  });
};

const setLineHeight = (h: string): void => {
  applyToSelected((o) => {
    if ((o as any).lineHeight) {
      (o as any).lineHeight = parseFloat(h);
    }
  });
};

const setFillColor = (c: string): void => {
  applyToSelected((o) => {
    if (o.type !== 'image') {
      o.set('fill', c);
    }
  });
};

const setBackgroundColor = (c: string): void => {
  applyToSelected((o) => {
    if (o.type === 'textbox' || o.type === 'i-text') {
      (o as fabric.Textbox).set('backgroundColor', c);
    }
  });
};

const setTextAlign = (a: string): void => {
  applyToSelected((o) => {
    if ((o as any).textAlign) {
      (o as any).textAlign = a;
    }
  });
};

const setCanvasBgColor = (c: string): void => {
  canvas.setBackgroundColor(c, () => canvas.renderAll());
  scheduleHistorySave();
};

const bringForward = (): void => {
  const o = canvas.getActiveObject();
  if (o) canvas.bringForward(o);
  canvas.renderAll();
  scheduleHistorySave();
};

const sendBackward = (): void => {
  const o = canvas.getActiveObject();
  if (o) canvas.sendBackwards(o);
  canvas.renderAll();
  scheduleHistorySave();
};

const increaseIndent = (): void => {
  applyToSelected((o) => {
    if (o.type === 'textbox' || o.type === 'i-text') {
      (o as fabric.Textbox).text = '    ' + (o as fabric.Textbox).text;
    }
  });
};

const decreaseIndent = (): void => {
  applyToSelected((o) => {
    if (o.type === 'textbox' || o.type === 'i-text') {
      (o as fabric.Textbox).text = (o as fabric.Textbox).text.replace(/^ {1,4}/, '');
    }
  });
};

const transformText = (t: string): void => {
  applyToSelected((o) => {
    if (o.type === 'textbox' || o.type === 'i-text') {
      const tb = o as fabric.Textbox;
      if (t === 'uppercase') tb.text = tb.text.toUpperCase();
      else if (t === 'lowercase') tb.text = tb.text.toLowerCase();
      else if (t === 'capitalize')
        tb.text = tb.text.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  });
};

// ===== تحديث حالة أزرار التنسيق =====
const updateStyleButtonsState = (): void => {
  const o = canvas.getActiveObject();
  
  // تفعيل/تعطيل الأزرار حسب نوع الكائن المحدد
  const isText = o && (o.type === 'textbox' || o.type === 'i-text');
  const isShape = o && (o.type === 'rect' || o.type === 'circle' || o.type === 'triangle');
  
  // أزرار التنسيق النصي (تعمل فقط مع النصوص)
  if (boldBtn) {
    boldBtn.disabled = !isText;
    if (isText) {
      const tb = o as fabric.Textbox;
      boldBtn.classList.toggle('active', tb.fontWeight === 'bold');
    } else {
      boldBtn.classList.remove('active');
    }
  }
  
  if (italicBtn) {
    italicBtn.disabled = !isText;
    if (isText) {
      const tb = o as fabric.Textbox;
      italicBtn.classList.toggle('active', tb.fontStyle === 'italic');
    } else {
      italicBtn.classList.remove('active');
    }
  }
  
  if (underlineBtn) {
    underlineBtn.disabled = !isText;
    if (isText) {
      const tb = o as fabric.Textbox;
      underlineBtn.classList.toggle('active', !!tb.underline);
    } else {
      underlineBtn.classList.remove('active');
    }
  }
  
  // أزرار المحاذاة
  if (alignLeftBtn) {
    alignLeftBtn.disabled = !isText;
    if (isText) {
      const tb = o as fabric.Textbox;
      const a = tb.textAlign || 'left';
      alignLeftBtn.classList.toggle('active', a === 'left');
      alignCenterBtn.classList.toggle('active', a === 'center');
      alignRightBtn.classList.toggle('active', a === 'right');
    } else {
      alignLeftBtn.classList.remove('active');
      alignCenterBtn.classList.remove('active');
      alignRightBtn.classList.remove('active');
    }
  }
  
  // زر لون التعبئة (يعمل مع النصوص والأشكال)
  if (fillColorBtn) {
    fillColorBtn.disabled = !o || o.type === 'image';
  }
  
  // زر لون الخلفية (يعمل فقط مع النصوص)
  if (bgColorBtn) {
    bgColorBtn.disabled = !isText;
  }
};

// ===== تصدير واستيراد =====
const exportCurrentSlide = (): void => {
  saveCurrentSlideState();
  const slide = slides[currentSlideIndex];
  const exportObj: ExportedSlide = {
    version: '1.0',
    slideName: slide.name,
    canvasJSON: slide.canvasJSON ? JSON.parse(slide.canvasJSON) : canvas.toJSON(['id', 'effectDef']),
    bgColor: canvas.backgroundColor as string,
    zoom: zoomLevel,
  };
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `slide_${slide.name.replace(/\s/g, '_')}.rept`;
  a.click();
  URL.revokeObjectURL(blob.href);
  clearUnsaved();
};

const importReptFile = (file: File): void => {
  if (hasUnsavedChanges && !confirm('Replace current slide?')) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const result = e.target?.result as string;
      const imported = JSON.parse(result);
      if (!validateReptFile(imported)) {
        alert('Invalid .REPT file structure.');
        return;
      }
      const jsonToLoad = imported.canvasJSON || imported;
      canvas.loadFromJSON(jsonToLoad, () => {
        if (imported.bgColor) canvas.setBackgroundColor(imported.bgColor, () => {});
        canvas.renderAll();
        zoomLevel = imported.zoom || 1;
        canvas.setZoom(zoomLevel);
        updateZoomDisplay();
        resetHistoryFromCurrentCanvas();
        slides[currentSlideIndex].canvasJSON = JSON.stringify(
          canvas.toJSON(['id', 'effectDef'])
        );
        slides[currentSlideIndex].bgColor = canvas.backgroundColor as string;
        slides[currentSlideIndex].zoom = zoomLevel;
        if (imported.slideName)
          slides[currentSlideIndex].name = sanitizeSlideName(imported.slideName);
        renderSlideSidebar();
        saveCurrentSlideState();
        clearUnsaved();
      });
    } catch (err) {
      alert('Invalid .REPT file.');
    }
  };
  reader.readAsText(file);
};

// ===== ربط الأحداث (المُحسَّن) =====
document.addEventListener('DOMContentLoaded', function() {
  console.log('🚀 ReStudio initialized!');
  
  // ===== ربط جميع الأزرار =====
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      const action = this.dataset.action;
      console.log('🔘 Button clicked:', action || 'no-action');
      
      if (!action) return;
      
      // تنفيذ الإجراءات
      switch(action) {
        case 'newDoc':
          addNewSlide();
          break;
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
        case 'deleteSelected':
          deleteSelected();
          break;
        case 'addText':
          addTextBox();
          break;
        case 'addImage':
          addImageFromFile();
          break;
        case 'addRectangle':
          addRectangle();
          break;
        case 'addCircle':
          addCircle();
          break;
        case 'addQR':
          addQRCode();
          break;
        case 'bold':
          setBold();
          break;
        case 'italic':
          setItalic();
          break;
        case 'underline':
          setUnderline();
          break;
        case 'alignLeft':
          setTextAlign('left');
          break;
        case 'alignCenter':
          setTextAlign('center');
          break;
        case 'alignRight':
          setTextAlign('right');
          break;
        case 'bringForward':
          bringForward();
          break;
        case 'sendBackward':
          sendBackward();
          break;
        case 'zoomIn':
          zoomIn();
          break;
        case 'zoomOut':
          zoomOut();
          break;
        case 'focusMode':
          document.body.classList.toggle('focus-mode');
          break;
        case 'exportRept':
          exportCurrentSlide();
          break;
        case 'indentInc':
          increaseIndent();
          break;
        case 'indentDec':
          decreaseIndent();
          break;
        case 'group':
          groupSelected();
          break;
        case 'ungroup':
          ungroupSelected();
          break;
        default:
          console.log('⚠️ Unknown action:', action);
      }
    });
  });

  // ===== ربط أزرار خاصة =====
  document.getElementById('imageFileInput')?.addEventListener('change', handleImageFileSelect);
  
  document.getElementById('importJsonBtn')?.addEventListener('click', () =>
    document.getElementById('importFileInput')?.click()
  );
  
  document.getElementById('importFileInput')?.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) importReptFile(input.files[0]);
    input.value = '';
  });
  
  document.getElementById('addSlideBtn')?.addEventListener('click', addNewSlide);
  
  document.getElementById('exitFocusBtn')?.addEventListener('click', () =>
    document.body.classList.remove('focus-mode')
  );
  
  document.getElementById('effectBtn')?.addEventListener('click', showEffectModal);
  
  document.getElementById('closeEffectModal')?.addEventListener('click', closeEffectModal);
  
  document.getElementById('applyEffectBtn')?.addEventListener('click', applyEffectFromUI);
  
  document.getElementById('previewModeBtn')?.addEventListener('click', openPreviewMode);

  // ===== اختصارات لوحة المفاتيح =====
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      undo();
    }
    if (e.ctrlKey && e.key === 'y') {
      e.preventDefault();
      redo();
    }
    if (e.key === 'Delete' && document.activeElement === document.body) {
      deleteSelected();
    }
    if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) {
      document.body.classList.remove('focus-mode');
    }
  });

  // ===== إغلاق القوائم عند النقر خارجها =====
  document.addEventListener('click', () => {
    document.querySelectorAll('.dropdown-container.open').forEach(c => c.classList.remove('open'));
    document.querySelectorAll('.color-picker-popup.show').forEach(p => p.classList.remove('show'));
  });

  // ===== منع إغلاق القوائم عند النقر داخلها =====
  document.querySelectorAll('.dropdown-container, .color-picker-popup').forEach(el => {
    el.addEventListener('click', (e) => e.stopPropagation());
  });

  // ===== فتح/إغلاق القوائم المنسدلة =====
  document.querySelectorAll('.dropdown-container .tool-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const container = this.closest('.dropdown-container');
      if (container) {
        container.classList.toggle('open');
        // إغلاق القوائم الأخرى
        document.querySelectorAll('.dropdown-container.open').forEach(c => {
          if (c !== container) c.classList.remove('open');
        });
      }
    });
  });

  // ===== ألوان القوائم =====
  const presetColors: string[] = [
    '#ffffff', '#000000', '#e74c3c', '#e67e22', '#f1c40f', 
    '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#ecf0f1',
    '#c0392b', '#2980b9', '#8e44ad', '#2c3e50', '#16a085',
    '#27ae60', '#f39c12', '#d35400', '#7f8c8d', '#95a5a6'
  ];

  const buildPalette = (
    gridId: string,
    customId: string,
    cb: (c: string) => void
  ): void => {
    const grid = document.getElementById(gridId) as HTMLElement;
    if (!grid) return;
    grid.innerHTML = '';
    presetColors.forEach((c) => {
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = c;
      swatch.addEventListener('click', () => {
        cb(c);
        const customInput = document.getElementById(customId) as HTMLInputElement;
        if (customInput) customInput.value = c;
        const popup = grid.closest('.color-picker-popup');
        if (popup) popup.classList.remove('show');
      });
      grid.appendChild(swatch);
    });
    const customInput = document.getElementById(customId) as HTMLInputElement;
    if (customInput) {
      customInput.addEventListener('input', (e) =>
        cb((e.target as HTMLInputElement).value)
      );
    }
  };

  buildPalette('fillColorGrid', 'fillColorCustom', setFillColor);
  buildPalette('bgColorGrid', 'bgColorCustom', setBackgroundColor);
  buildPalette('canvasBgGrid', 'canvasBgCustom', setCanvasBgColor);

  // ===== فتح/إغلاق لوحات الألوان =====
  document.querySelectorAll('.color-picker-popup').forEach(picker => {
    const btn = picker.closest('.dropdown-container')?.querySelector('.tool-btn');
    if (btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const pickerEl = this.closest('.dropdown-container')?.querySelector('.color-picker-popup');
        if (pickerEl) {
          pickerEl.classList.toggle('show');
          // إغلاق اللوحات الأخرى
          document.querySelectorAll('.color-picker-popup.show').forEach(p => {
            if (p !== pickerEl) p.classList.remove('show');
          });
        }
      });
    }
  });

  // ===== أحداث القوائم المنسدلة =====
  document.querySelectorAll('[data-fontsize]').forEach((el) =>
    el.addEventListener('click', () => {
      const size = (el as HTMLElement).dataset.fontsize;
      if (size) setFontSize(size);
      // إغلاق القائمة بعد الاختيار
      const container = el.closest('.dropdown-container');
      if (container) container.classList.remove('open');
    })
  );

  document.querySelectorAll('[data-lineheight]').forEach((el) =>
    el.addEventListener('click', () => {
      const height = (el as HTMLElement).dataset.lineheight;
      if (height) setLineHeight(height);
      const container = el.closest('.dropdown-container');
      if (container) container.classList.remove('open');
    })
  );

  document.querySelectorAll('[data-transform]').forEach((el) =>
    el.addEventListener('click', () => {
      const transform = (el as HTMLElement).dataset.transform;
      if (transform) transformText(transform);
      const container = el.closest('.dropdown-container');
      if (container) container.classList.remove('open');
    })
  );

  // ===== تحذير قبل المغادرة =====
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = 'Unsaved changes';
      return e.returnValue;
    }
  });

  // ===== تهيئة التطبيق =====
  initSlides();

});
