// ========== SECURITY UTILITIES ==========

// 1. Sanitization - منع هجمات XSS
function sanitizeText(text) {
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') return String(text);
    
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;',
        '=': '&#x3D;',
        '`': '&#x60;'
    };
    return text.replace(/[&<>"'/=`]/g, function(match) {
        return map[match];
    });
}

// التحقق من صحة النص (منع الأكواد الضارة)
function isValidText(text) {
    if (typeof text !== 'string') return false;
    const dangerousPatterns = [
        /javascript:/i,
        /on\w+\s*=/i,
        /<script/i,
        /<iframe/i,
        /<object/i,
        /<embed/i,
        /data:text\/html/i,
        /vbscript:/i
    ];
    return !dangerousPatterns.some(pattern => pattern.test(text));
}

// 2. التحقق من صحة الملفات المستوردة
function validateREPTFile(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid file format: Data is not an object');
    }
    
    // التحقق من حجم الملف
    const MAX_FILE_SIZE_MB = 20;
    const jsonString = JSON.stringify(data);
    const sizeInMB = new Blob([jsonString]).size / (1024 * 1024);
    if (sizeInMB > MAX_FILE_SIZE_MB) {
        throw new Error('File too large: ' + sizeInMB.toFixed(2) + 'MB (max ' + MAX_FILE_SIZE_MB + 'MB)');
    }
    
    // التحقق من بنية الكائنات
    if (data.objects && !Array.isArray(data.objects)) {
        throw new Error('Invalid file: Objects must be an array');
    }
    
    // التحقق من كل كائن
    if (data.objects) {
        for (let i = 0; i < data.objects.length; i++) {
            const obj = data.objects[i];
            if (!obj || typeof obj !== 'object') {
                throw new Error('Invalid object at index ' + i);
            }
            
            // تقييد الأنواع المسموحة
            const allowedTypes = ['textbox', 'rect', 'circle', 'image', 'group'];
            if (obj.type && !allowedTypes.includes(obj.type)) {
                throw new Error('Invalid object type: ' + obj.type);
            }
            
            // تنظيف النصوص
            if (obj.type === 'textbox' && obj.text) {
                if (!isValidText(obj.text)) {
                    throw new Error('Suspicious content detected in text object');
                }
                obj.text = sanitizeText(obj.text);
            }
        }
    }
    
    return true;
}

// 3. التحقق من الحدود - عند الوصول إلى المصفوفات
function validateArrayAccess(arr, index) {
    if (!Array.isArray(arr)) {
        console.warn('Invalid array access');
        return false;
    }
    if (index < 0 || index >= arr.length) {
        console.warn('Array index out of bounds: ' + index);
        return false;
    }
    return true;
}

// التحقق من حدود الكانفس
function validateCanvasAccess(canvasInstance) {
    if (!canvasInstance) {
        console.warn('Canvas not initialized');
        return false;
    }
    if (typeof canvasInstance.getActiveObject !== 'function') {
        console.warn('Canvas is not properly initialized');
        return false;
    }
    return true;
}

function getActiveObjectSafe() {
    if (!validateCanvasAccess(canvas)) return null;
    try {
        return canvas.getActiveObject();
    } catch (err) {
        console.error('Error getting active object:', err);
        return null;
    }
}

function getActiveObjectsSafe() {
    if (!validateCanvasAccess(canvas)) return [];
    try {
        return canvas.getActiveObjects() || [];
    } catch (err) {
        console.error('Error getting active objects:', err);
        return [];
    }
}

// ========== MAIN APPLICATION ==========

(function() {
    'use strict';
    
    // ---------- GLOBALS ----------
    let slides = [];
    let currentSlideIndex = 0;
    let canvas;
    let historyStack = [], historyIndex = -1;
    let zoomLevel = 1;
    let historySaveTimer = null;
    let hasUnsavedChanges = false;
    let isInitialized = false;
    
    const container = document.getElementById('fabric-canvas-container');
    const zoomLevelDisplay = document.getElementById('zoomLevelDisplay');
    const undoBtn = document.querySelector('[data-action="undo"]');
    const redoBtn = document.querySelector('[data-action="redo"]');
    const boldBtn = document.querySelector('[data-action="bold"]');
    const italicBtn = document.querySelector('[data-action="italic"]');
    const underlineBtn = document.querySelector('[data-action="underline"]');
    const alignLeftBtn = document.querySelector('[data-action="alignLeft"]');
    const alignCenterBtn = document.querySelector('[data-action="alignCenter"]');
    const alignRightBtn = document.querySelector('[data-action="alignRight"]');
    const fillColorBtn = document.getElementById('fillColorBtn');
    const bgColorBtn = document.getElementById('bgColorBtn');

    function markAsChanged() { hasUnsavedChanges = true; }
    function clearUnsaved() { hasUnsavedChanges = false; }
    
    function saveCurrentSlideState() {
        if (canvas && slides.length && validateArrayAccess(slides, currentSlideIndex)) {
            slides[currentSlideIndex].canvasJSON = JSON.stringify(canvas.toJSON(['id', 'effectDef']));
            slides[currentSlideIndex].bgColor = canvas.backgroundColor;
            slides[currentSlideIndex].zoom = zoomLevel;
        }
        clearUnsaved();
    }
    
    function escapeHtml(s) {
        return sanitizeText(s);
    }
    
    function loadSlide(index) {
        if (!validateArrayAccess(slides, index)) return false;
        
        saveCurrentSlideState();
        const slide = slides[index];
        currentSlideIndex = index;
        
        if (slide.canvasJSON) {
            canvas.loadFromJSON(slide.canvasJSON, () => {
                if (slide.bgColor) canvas.setBackgroundColor(slide.bgColor, () => {});
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
    }
    
    function resetHistoryFromCurrentCanvas() {
        const state = JSON.stringify(canvas.toJSON(['id']));
        historyStack = [state];
        historyIndex = 0;
        updateUndoRedoButtons();
    }
    
    function updateUndoRedoButtons() {
        if (undoBtn) undoBtn.disabled = (historyIndex <= 0);
        if (redoBtn) redoBtn.disabled = (historyIndex >= historyStack.length - 1);
    }
    
    function scheduleHistorySave() {
        if (historySaveTimer) clearTimeout(historySaveTimer);
        historySaveTimer = setTimeout(() => {
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
    }
    
    function undo() {
        if (historyIndex > 0) {
            historyIndex--;
            loadHistoryState();
        }
    }
    
    function redo() {
        if (historyIndex < historyStack.length - 1) {
            historyIndex++;
            loadHistoryState();
        }
    }
    
    function loadHistoryState() {
        canvas.loadFromJSON(historyStack[historyIndex], () => {
            canvas.renderAll();
            updateUndoRedoButtons();
            updateStyleButtonsState();
            markAsChanged();
            saveCurrentSlideState();
        });
    }
    
    function updateZoomDisplay() {
        if (zoomLevelDisplay) {
            zoomLevelDisplay.textContent = Math.round(zoomLevel * 100) + '%';
        }
    }
    
    function zoomIn() {
        if (!canvas || !isInitialized) return;
        zoomLevel = Math.min(2, zoomLevel + 0.1);
        canvas.setZoom(zoomLevel);
        canvas.renderAll();
        updateZoomDisplay();
        scheduleHistorySave();
    }
    
    function zoomOut() {
        if (!canvas || !isInitialized) return;
        zoomLevel = Math.max(0.5, zoomLevel - 0.1);
        canvas.setZoom(zoomLevel);
        canvas.renderAll();
        updateZoomDisplay();
        scheduleHistorySave();
    }

    function groupSelected() {
        const objs = getActiveObjectsSafe();
        if (objs.length < 2) {
            alert("Select at least 2 objects.");
            return;
        }
        const activeObj = getActiveObjectSafe();
        if (activeObj) {
            activeObj.toGroup();
            canvas.renderAll();
            scheduleHistorySave();
            updateStyleButtonsState();
        }
    }
    
    function ungroupSelected() {
        const obj = getActiveObjectSafe();
        if (!obj || obj.type !== 'group') {
            alert("Select a group.");
            return;
        }
        obj.toActiveSelection();
        canvas.renderAll();
        scheduleHistorySave();
        updateStyleButtonsState();
    }

    // ---------- EFFECT ENGINE ----------
    const easingMap = {
        easeOutCubic: fabric.util.ease.easeOutCubic,
        easeOutBounce: fabric.util.ease.easeOutBounce,
        easeInOutQuad: fabric.util.ease.easeInOutQuad,
        linear: fabric.util.ease.linear
    };
    
    function applyEffectToObject(obj, effect, duration, delay, easingName, isInfinite = false) {
        if (!obj) return;
        const easingFn = easingMap[easingName] || fabric.util.ease.easeOutCubic;
        
        function runAnimation(callback) {
            const originalLeft = obj.left;
            const originalTop = obj.top;
            const originalScaleX = obj.scaleX;
            const originalScaleY = obj.scaleY;
            const originalAngle = obj.angle;
            const originalOpacity = obj.opacity !== undefined ? obj.opacity : 1;
            let targetProps = {};
            
            switch(effect) {
                case 'fadeIn': obj.set('opacity', 0); targetProps = { opacity: originalOpacity }; break;
                case 'slideInLeft': obj.set('left', originalLeft - 300); targetProps = { left: originalLeft }; break;
                case 'slideInRight': obj.set('left', originalLeft + 300); targetProps = { left: originalLeft }; break;
                case 'slideInUp': obj.set('top', originalTop + 200); targetProps = { top: originalTop }; break;
                case 'slideInDown': obj.set('top', originalTop - 200); targetProps = { top: originalTop }; break;
                case 'zoomIn': obj.set('scaleX', 0.1); obj.set('scaleY', 0.1); targetProps = { scaleX: originalScaleX, scaleY: originalScaleY }; break;
                case 'bounce': obj.set('scaleX', 0.8); obj.set('scaleY', 0.8); targetProps = { scaleX: originalScaleX, scaleY: originalScaleY }; break;
                case 'flipX': obj.set('scaleX', -originalScaleX); targetProps = { scaleX: originalScaleX }; break;
                case 'flipY': obj.set('scaleY', -originalScaleY); targetProps = { scaleY: originalScaleY }; break;
                case 'rotateIn': obj.set('angle', -45); targetProps = { angle: originalAngle }; break;
                default: if(callback) callback(); return;
            }
            
            canvas.renderAll();
            obj.animate(targetProps, {
                duration: duration,
                easing: easingFn,
                onChange: canvas.renderAll.bind(canvas),
                onComplete: () => {
                    if(effect === 'flipX') obj.set('scaleX', originalScaleX);
                    if(effect === 'flipY') obj.set('scaleY', originalScaleY);
                    canvas.renderAll();
                    if(callback) callback();
                }
            });
        }
        
        function startLoop() {
            runAnimation(() => {
                if (isInfinite) {
                    setTimeout(startLoop, delay + duration + 100);
                }
            });
        }
        
        if (delay > 0) setTimeout(startLoop, delay);
        else startLoop();
    }
    
    function setObjectEffect(obj, effectData) {
        obj.effectDef = { ...effectData };
        applyEffectToObject(obj, effectData.type, effectData.duration, effectData.delay, effectData.easing, effectData.infinite);
        scheduleHistorySave();
    }
    
    // Effect modal UI
    const modal = document.getElementById('effectModal');
    
    function showEffectModal() { 
        if (modal) modal.classList.add('active'); 
    }
    
    function closeEffectModal() { 
        if (modal) modal.classList.remove('active'); 
    }
    
    function applyEffectFromUI() {
        const obj = getActiveObjectSafe();
        if (!obj) {
            alert("Please select an object.");
            return;
        }
        
        const effectType = document.getElementById('effectSelect').value;
        const duration = parseInt(document.getElementById('effectDuration').value, 10);
        const delay = parseInt(document.getElementById('effectDelay').value, 10);
        const easing = document.getElementById('effectEasing').value;
        const isInfinite = (document.querySelector('input[name="timePeriod"]:checked').value === 'infinite');
        
        // التحقق من القيم
        if (isNaN(duration) || duration < 100 || duration > 10000) {
            alert("Invalid duration value.");
            return;
        }
        if (isNaN(delay) || delay < 0 || delay > 10000) {
            alert("Invalid delay value.");
            return;
        }
        
        const effectData = { type: effectType, duration, delay, easing, infinite: isInfinite };
        setObjectEffect(obj, effectData);
        closeEffectModal();
    }
    
    // ---------- PREVIEW MODE ----------
    function openPreviewMode() {
        saveCurrentSlideState();
        const slidesData = slides.map(slide => ({
            name: sanitizeText(slide.name),
            canvasJSON: slide.canvasJSON ? JSON.parse(slide.canvasJSON) : null,
            bgColor: slide.bgColor
        }));
        
        const currentIdx = currentSlideIndex;
        const win = window.open();
        
        if (!win) {
            alert("Popup blocked. Please allow popups.");
            return;
        }
        
        win.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Presentation Preview</title>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js"><\/script>
                <style>
                    body { margin:0; overflow:hidden; background:#1e1e1e; font-family:'Segoe UI',sans-serif; }
                    .preview-container { position:relative; width:100vw; height:100vh; display:flex; justify-content:center; align-items:center; background:#000; }
                    canvas { box-shadow:0 0 0 1px #3c3c3c; max-width:90vw; max-height:90vh; }
                    .nav-controls { position:fixed; bottom:20px; left:0; right:0; text-align:center; background:rgba(0,0,0,0.7); padding:10px; color:white; z-index:100; }
                    button { background:#007acc; border:none; color:white; padding:8px 16px; margin:0 8px; border-radius:8px; cursor:pointer; font-size:16px; }
                    .slide-counter { margin:0 16px; font-size:16px; }
                    .instruction { position:fixed; top:10px; right:10px; background:rgba(0,0,0,0.5); padding:5px 10px; border-radius:8px; font-size:12px; }
                </style>
            </head>
            <body>
                <div class="preview-container"><canvas id="previewCanvas" width="900" height="600"></canvas></div>
                <div class="nav-controls"><button id="prevBtn">◀ Previous</button><span class="slide-counter" id="slideCounter">Slide 1 / 1</span><button id="nextBtn">Next ▶</button></div>
                <div class="instruction">← → keys | ESC to close</div>
                <script>
                    const slidesData = ${JSON.stringify(slidesData)};
                    let currentIdx = ${currentIdx};
                    let canvas;
                    let activeTimeouts = [];
                    function clearEffects() { activeTimeouts.forEach(t => clearTimeout(t)); activeTimeouts = []; }
                    function applyObjectEffect(obj, effectDef) {
                        if (!obj || !effectDef) return;
                        const easingMap = { easeOutCubic: fabric.util.ease.easeOutCubic, easeOutBounce: fabric.util.ease.easeOutBounce, easeInOutQuad: fabric.util.ease.easeInOutQuad, linear: fabric.util.ease.linear };
                        const easing = easingMap[effectDef.easing] || easingMap.easeOutCubic;
                        const duration = effectDef.duration, delay = effectDef.delay, effect = effectDef.type, isInfinite = effectDef.infinite === true;
                        function animateOnce(cb) {
                            const origL = obj.left, origT = obj.top, origSX = obj.scaleX, origSY = obj.scaleY, origAng = obj.angle, origOp = obj.opacity || 1;
                            let target = {};
                            if(effect === 'fadeIn') { obj.set('opacity', 0); target = {opacity: origOp}; }
                            else if(effect === 'slideInLeft') { obj.set('left', origL - 300); target = {left: origL}; }
                            else if(effect === 'slideInRight') { obj.set('left', origL + 300); target = {left: origL}; }
                            else if(effect === 'slideInUp') { obj.set('top', origT + 200); target = {top: origT}; }
                            else if(effect === 'slideInDown') { obj.set('top', origT - 200); target = {top: origT}; }
                            else if(effect === 'zoomIn') { obj.set('scaleX', 0.1); obj.set('scaleY', 0.1); target = {scaleX: origSX, scaleY: origSY}; }
                            else if(effect === 'bounce') { obj.set('scaleX', 0.8); obj.set('scaleY', 0.8); target = {scaleX: origSX, scaleY: origSY}; }
                            else if(effect === 'flipX') { obj.set('scaleX', -origSX); target = {scaleX: origSX}; }
                            else if(effect === 'flipY') { obj.set('scaleY', -origSY); target = {scaleY: origSY}; }
                            else if(effect === 'rotateIn') { obj.set('angle', -45); target = {angle: origAng}; }
                            else { if(cb) cb(); return; }
                            canvas.renderAll();
                            obj.animate(target, { duration, easing, onChange: canvas.renderAll.bind(canvas), onComplete: () => { if(effect === 'flipX') obj.set('scaleX', origSX); if(effect === 'flipY') obj.set('scaleY', origSY); canvas.renderAll(); if(cb) cb(); } });
                        }
                        function startLoop() { animateOnce(() => { if(isInfinite) { const t = setTimeout(startLoop, delay + duration + 100); activeTimeouts.push(t); } }); }
                        if(delay > 0) { const t = setTimeout(startLoop, delay); activeTimeouts.push(t); } else startLoop();
                    }
                    function loadSlide(index) {
                        clearEffects();
                        const slide = slidesData[index];
                        if(slide && slide.canvasJSON) {
                            canvas.loadFromJSON(slide.canvasJSON, () => {
                                if(slide.bgColor) canvas.setBackgroundColor(slide.bgColor, () => canvas.renderAll());
                                canvas.renderAll();
                                canvas.getObjects().forEach(obj => { if(obj.effectDef) applyObjectEffect(obj, obj.effectDef); });
                            });
                        } else {
                            canvas.clear();
                            if(slide && slide.bgColor) canvas.setBackgroundColor(slide.bgColor, () => canvas.renderAll());
                            else canvas.setBackgroundColor('#2b2b2b', () => canvas.renderAll());
                            canvas.renderAll();
                        }
                        document.getElementById('slideCounter').innerText = 'Slide ' + (index + 1) + ' / ' + slidesData.length;
                    }
                    function initPreview() {
                        const canvasElem = document.getElementById('previewCanvas');
                        canvas = new fabric.Canvas('previewCanvas', { selection: false, preserveObjectStacking: true });
                        canvas.setWidth(900);
                        canvas.setHeight(600);
                        loadSlide(currentIdx);
                    }
                    function nextSlide() { if(currentIdx < slidesData.length - 1) { currentIdx++; loadSlide(currentIdx); } }
                    function prevSlide() { if(currentIdx > 0) { currentIdx--; loadSlide(currentIdx); } }
                    document.getElementById('prevBtn').addEventListener('click', prevSlide);
                    document.getElementById('nextBtn').addEventListener('click', nextSlide);
                    window.addEventListener('keydown', (e) => { if(e.key === 'ArrowLeft') prevSlide(); else if(e.key === 'ArrowRight') nextSlide(); else if(e.key === 'Escape') window.close(); });
                    initPreview();
                <\/script>
            </body>
            </html>
        `);
        win.document.close();
    }
    
    // ---------- CANVAS INIT & SLIDES ----------
    function initCanvas() {
        if (!container) {
            console.error('Container not found');
            return;
        }
        
        const existingCanvas = document.getElementById('fabric-canvas');
        if (existingCanvas) existingCanvas.remove();
        
        const newCanvasElem = document.createElement('canvas');
        newCanvasElem.id = 'fabric-canvas';
        const containerWidth = container.clientWidth || 900;
        const containerHeight = container.clientHeight || 600;
        newCanvasElem.width = containerWidth;
        newCanvasElem.height = containerHeight;
        
        container.innerHTML = '';
        container.appendChild(newCanvasElem);
        
        canvas = new fabric.Canvas('fabric-canvas', {
            preserveObjectStacking: true,
            selection: true,
            backgroundColor: '#2b2b2b',
            perPixelTargetFind: true,
            targetFindTolerance: 8,
            interactive: true
        });
        
        canvas.setWidth(containerWidth);
        canvas.setHeight(containerHeight);
        canvas.renderAll();
        
        canvas.on('object:added', () => scheduleHistorySave());
        canvas.on('object:modified', () => scheduleHistorySave());
        canvas.on('object:removed', () => scheduleHistorySave());
        canvas.on('selection:created', () => updateStyleButtonsState());
        canvas.on('selection:updated', () => updateStyleButtonsState());
        canvas.on('selection:cleared', () => updateStyleButtonsState());
        
        isInitialized = true;
        console.log('Canvas initialized successfully');
    }
    
    function renameSlide(index) {
        if (!validateArrayAccess(slides, index)) return;
        
        const currentName = slides[index].name;
        const newName = prompt("Rename slide:", currentName);
        
        if (newName && newName.trim() !== "") {
            // تطهير الاسم المدخل
            const sanitizedName = sanitizeText(newName.trim());
            
            // التحقق من صحة الاسم
            if (!isValidText(sanitizedName)) {
                alert("Invalid slide name. Please use a safe name.");
                return;
            }
            
            slides[index].name = sanitizedName;
            renderSlideSidebar();
            markAsChanged();
        }
    }
    
    function renderSlideSidebar() {
        const div = document.getElementById('slidesList');
        if (!div) return;
        
        div.innerHTML = '';
        
        slides.forEach((slide, idx) => {
            if (!validateArrayAccess(slides, idx)) return;
            
            const item = document.createElement('div');
            item.className = `slide-item ${idx === currentSlideIndex ? 'active' : ''}`;
            item.innerHTML = `
                <div class="slide-info">
                    <div class="slide-name">${escapeHtml(slide.name)}</div>
                    <div class="slide-index">Slide ${idx + 1}</div>
                </div>
                <div class="slide-actions">
                    <button class="rename-slide-btn" data-rename-index="${idx}" title="Rename slide"><i class="ti ti-edit"></i></button>
                    <button class="delete-slide-btn" data-delete-index="${idx}" title="Delete slide"><i class="ti ti-trash"></i></button>
                </div>
            `;
            
            const renameBtn = item.querySelector('.rename-slide-btn');
            if (renameBtn) {
                renameBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    renameSlide(idx);
                });
            }
            
            const delBtn = item.querySelector('.delete-slide-btn');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteSlide(idx);
                });
            }
            
            const infoDiv = item.querySelector('.slide-info');
            if (infoDiv) {
                infoDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    loadSlide(idx);
                });
            }
            
            div.appendChild(item);
        });
    }
    
    function deleteSlide(i) {
        if (!validateArrayAccess(slides, i)) return;
        
        if (slides.length <= 1) {
            alert("Cannot delete last slide.");
            return;
        }
        
        if (confirm(`Delete "${slides[i].name}"?`)) {
            slides.splice(i, 1);
            if (currentSlideIndex >= slides.length) {
                currentSlideIndex = slides.length - 1;
            }
            loadSlide(currentSlideIndex);
            renderSlideSidebar();
            markAsChanged();
        }
    }
    
    function addNewSlide() {
        saveCurrentSlideState();
        slides.push({
            id: Date.now(),
            name: `Slide ${slides.length + 1}`,
            canvasJSON: null,
            bgColor: '#2b2b2b',
            zoom: 1
        });
        loadSlide(slides.length - 1);
        renderSlideSidebar();
        markAsChanged();
    }
    
    function initSlides() {
        slides = [{
            id: 'init',
            name: 'Slide 1',
            canvasJSON: null,
            bgColor: '#2b2b2b',
            zoom: 1
        }];
        currentSlideIndex = 0;
        initCanvas();
        resetHistoryFromCurrentCanvas();
        loadSlide(0);
        renderSlideSidebar();
    }
    
    // ---------- STANDARD TOOLS ----------
    function addTextBox() {
        const tb = new fabric.Textbox('New Text', {
            left: 100,
            top: 100,
            width: 200,
            fontSize: 24,
            fill: '#fff',
            selectable: true,
            evented: true,
            hoverCursor: 'pointer',
            moveCursor: 'move',
            perPixelTargetFind: false
        });
        canvas.add(tb);
        canvas.setActiveObject(tb);
        canvas.renderAll();
        scheduleHistorySave();
    }
    
    function addRectangle() {
        const rect = new fabric.Rect({
            left: 150,
            top: 150,
            width: 120,
            height: 80,
            fill: '#3498db',
            stroke: '#fff',
            selectable: true,
            evented: true,
            hoverCursor: 'pointer',
            moveCursor: 'move',
            perPixelTargetFind: false
        });
        canvas.add(rect);
        canvas.setActiveObject(rect);
        canvas.renderAll();
        scheduleHistorySave();
    }
    
    function addCircle() {
        const circle = new fabric.Circle({
            left: 200,
            top: 200,
            radius: 50,
            fill: '#e67e22',
            stroke: '#fff',
            selectable: true,
            evented: true,
            hoverCursor: 'pointer',
            moveCursor: 'move',
            perPixelTargetFind: false
        });
        canvas.add(circle);
        canvas.setActiveObject(circle);
        canvas.renderAll();
        scheduleHistorySave();
    }
    
    function addImageFromFile() {
        const input = document.getElementById('imageFileInput');
        if (input) input.click();
    }
    
    function addQRCode() {
        const t = prompt('Enter text/URL:');
        if (!t) return;
        
        // تطهير النص المدخل
        const sanitizedText = sanitizeText(t);
        
        // التحقق من صحة النص
        if (!isValidText(sanitizedText)) {
            alert("Invalid text. Please enter a valid text or URL.");
            return;
        }
        
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(sanitizedText)}`;
        
        fabric.Image.fromURL(qrUrl, img => {
            img.set({
                left: 100,
                top: 100,
                selectable: true,
                evented: true,
                hoverCursor: 'pointer',
                moveCursor: 'move',
                perPixelTargetFind: false
            });
            canvas.add(img);
            canvas.setActiveObject(img);
            canvas.renderAll();
            scheduleHistorySave();
        }, { crossOrigin: 'anonymous' });
    }
    
    function handleImageFileSelect(e) {
        const f = e.target.files[0];
        if (!f) return;
        
        // التحقق من نوع الملف
        if (!f.type.startsWith('image/')) {
            alert("Please select a valid image file.");
            e.target.value = '';
            return;
        }
        
        // التحقق من حجم الملف
        const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
        if (f.size > MAX_IMAGE_SIZE) {
            alert("Image too large. Maximum size is 10MB.");
            e.target.value = '';
            return;
        }
        
        const r = new FileReader();
        r.onload = ev => {
            fabric.Image.fromURL(ev.target.result, img => {
                img.scaleToWidth(250);
                img.set({
                    left: 100,
                    top: 100,
                    selectable: true,
                    evented: true,
                    hoverCursor: 'pointer',
                    moveCursor: 'move',
                    perPixelTargetFind: false
                });
                canvas.add(img);
                canvas.setActiveObject(img);
                canvas.renderAll();
                scheduleHistorySave();
            }, { crossOrigin: 'anonymous' });
        };
        
        r.onerror = () => {
            alert("Failed to load image.");
        };
        
        r.readAsDataURL(f);
        e.target.value = '';
    }
    
    function deleteSelected() {
        getActiveObjectsSafe().forEach(o => canvas.remove(o));
        canvas.discardActiveObject();
        canvas.renderAll();
        scheduleHistorySave();
    }
    
    function applyToSelected(cb) {
        getActiveObjectsSafe().forEach(cb);
        canvas.renderAll();
        scheduleHistorySave();
        updateStyleButtonsState();
    }
    
    function setBold() {
        applyToSelected(o => {
            if (o.type === 'textbox') {
                o.fontWeight = (o.fontWeight === 'bold') ? 'normal' : 'bold';
            }
        });
    }
    
    function setItalic() {
        applyToSelected(o => {
            if (o.type === 'textbox') {
                o.fontStyle = (o.fontStyle === 'italic') ? 'normal' : 'italic';
            }
        });
    }
    
    function setUnderline() {
        applyToSelected(o => {
            if (o.type === 'textbox') {
                o.underline = !o.underline;
            }
        });
    }
    
    function setFontSize(s) {
        applyToSelected(o => {
            if (o.fontSize) o.fontSize = parseInt(s);
        });
    }
    
    function setLineHeight(h) {
        applyToSelected(o => {
            if (o.lineHeight) o.lineHeight = parseFloat(h);
        });
    }
    
    function setFillColor(c) {
        applyToSelected(o => {
            if (o.type !== 'image') o.set('fill', c);
        });
    }
    
    function setBackgroundColor(c) {
        applyToSelected(o => {
            if (o.type === 'textbox') o.set('backgroundColor', c);
        });
    }
    
    function setTextAlign(a) {
        applyToSelected(o => {
            if (o.textAlign) o.textAlign = a;
        });
    }
    
    function setCanvasBgColor(c) {
        canvas.setBackgroundColor(c, () => canvas.renderAll());
        scheduleHistorySave();
    }
    
    function bringForward() {
        const o = getActiveObjectSafe();
        if (o) {
            canvas.bringForward(o);
            canvas.renderAll();
            scheduleHistorySave();
        }
    }
    
    function sendBackward() {
        const o = getActiveObjectSafe();
        if (o) {
            canvas.sendBackwards(o);
            canvas.renderAll();
            scheduleHistorySave();
        }
    }
    
    function increaseIndent() {
        applyToSelected(o => {
            if (o.type === 'textbox') o.text = '    ' + o.text;
        });
    }
    
    function decreaseIndent() {
        applyToSelected(o => {
            if (o.type === 'textbox') o.text = o.text.replace(/^ {1,4}/, '');
        });
    }
    
    function transformText(t) {
        applyToSelected(o => {
            if (o.type === 'textbox') {
                if (t === 'uppercase') o.text = o.text.toUpperCase();
                else if (t === 'lowercase') o.text = o.text.toLowerCase();
                else if (t === 'capitalize') o.text = o.text.replace(/\b\w/g, c => c.toUpperCase());
            }
        });
    }
    
    function updateStyleButtonsState() {
        const o = getActiveObjectSafe();
        
        if (o && o.type === 'textbox') {
            if (boldBtn) boldBtn.classList.toggle('active', o.fontWeight === 'bold');
            if (italicBtn) italicBtn.classList.toggle('active', o.fontStyle === 'italic');
            if (underlineBtn) underlineBtn.classList.toggle('active', !!o.underline);
            
            const a = o.textAlign || 'left';
            if (alignLeftBtn) alignLeftBtn.classList.toggle('active', a === 'left');
            if (alignCenterBtn) alignCenterBtn.classList.toggle('active', a === 'center');
            if (alignRightBtn) alignRightBtn.classList.toggle('active', a === 'right');
            
            if (fillColorBtn) fillColorBtn.disabled = false;
            if (bgColorBtn) bgColorBtn.disabled = false;
        } else {
            if (boldBtn) boldBtn.classList.remove('active');
            if (italicBtn) italicBtn.classList.remove('active');
            if (underlineBtn) underlineBtn.classList.remove('active');
            if (alignLeftBtn) alignLeftBtn.classList.remove('active');
            if (alignCenterBtn) alignCenterBtn.classList.remove('active');
            if (alignRightBtn) alignRightBtn.classList.remove('active');
            
            if (fillColorBtn) fillColorBtn.disabled = (o && o.type === 'image');
            if (bgColorBtn) bgColorBtn.disabled = true;
        }
    }
    
    function exportCurrentSlide() {
        if (!validateArrayAccess(slides, currentSlideIndex)) return;
        
        saveCurrentSlideState();
        const slide = slides[currentSlideIndex];
        
        const exportObj = {
            version: "1.0",
            slideName: sanitizeText(slide.name),
            canvasJSON: slide.canvasJSON ? JSON.parse(slide.canvasJSON) : canvas.toJSON(['id', 'effectDef']),
            bgColor: canvas.backgroundColor,
            zoom: zoomLevel
        };
        
        const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `slide_${slide.name.replace(/\s/g, '_')}.rept`;
        a.click();
        URL.revokeObjectURL(a.href);
        clearUnsaved();
    }
    
    function importReptFile(file) {
        if (hasUnsavedChanges && !confirm('Replace current slide?')) return;
        
        const reader = new FileReader();
        
        reader.onload = e => {
            try {
                const imported = JSON.parse(e.target.result);
                
                // التحقق من صحة الملف المستورد
                validateREPTFile(imported);
                
                const jsonToLoad = imported.canvasJSON || imported;
                
                canvas.loadFromJSON(jsonToLoad, () => {
                    if (imported.bgColor) {
                        canvas.setBackgroundColor(imported.bgColor, () => {});
                    }
                    canvas.renderAll();
                    
                    zoomLevel = imported.zoom || 1;
                    canvas.setZoom(zoomLevel);
                    updateZoomDisplay();
                    resetHistoryFromCurrentCanvas();
                    
                    if (validateArrayAccess(slides, currentSlideIndex)) {
                        slides[currentSlideIndex].canvasJSON = JSON.stringify(canvas.toJSON(['id', 'effectDef']));
                        slides[currentSlideIndex].bgColor = canvas.backgroundColor;
                        slides[currentSlideIndex].zoom = zoomLevel;
                        
                        if (imported.slideName) {
                            slides[currentSlideIndex].name = sanitizeText(imported.slideName);
                        }
                    }
                    
                    renderSlideSidebar();
                    saveCurrentSlideState();
                    clearUnsaved();
                });
            } catch (err) {
                alert('Invalid .REPT file: ' + err.message);
            }
        };
        
        reader.onerror = () => {
            alert('Error reading file.');
        };
        
        reader.readAsText(file);
    }
    
    // ---------- EVENT BINDINGS ----------
    function setupEventListeners() {
        // Toolbar actions
        const toolbar = document.getElementById('toolbar');
        if (toolbar) {
            toolbar.addEventListener('click', (e) => {
                const btn = e.target.closest('.tool-btn');
                if (!btn || btn.closest('.dropdown-container')) return;
                
                const a = btn.dataset.action;
                
                const actionsMap = {
                    'newDoc': addNewSlide,
                    'undo': undo,
                    'redo': redo,
                    'deleteSelected': deleteSelected,
                    'addText': addTextBox,
                    'addImage': addImageFromFile,
                    'addRectangle': addRectangle,
                    'addCircle': addCircle,
                    'addQR': addQRCode,
                    'bold': setBold,
                    'italic': setItalic,
                    'underline': setUnderline,
                    'alignLeft': () => setTextAlign('left'),
                    'alignCenter': () => setTextAlign('center'),
                    'alignRight': () => setTextAlign('right'),
                    'bringForward': bringForward,
                    'sendBackward': sendBackward,
                    'zoomIn': zoomIn,
                    'zoomOut': zoomOut,
                    'focusMode': () => document.body.classList.toggle('focus-mode'),
                    'exportRept': exportCurrentSlide,
                    'indentInc': increaseIndent,
                    'indentDec': decreaseIndent,
                    'group': groupSelected,
                    'ungroup': ungroupSelected
                };
                
                if (actionsMap[a]) {
                    actionsMap[a]();
                }
            });
        }
        
        // Image file input
        const imageInput = document.getElementById('imageFileInput');
        if (imageInput) {
            imageInput.addEventListener('change', handleImageFileSelect);
        }
        
        // Import buttons
        const importBtn = document.getElementById('importJsonBtn');
        const importInput = document.getElementById('importFileInput');
        if (importBtn && importInput) {
            importBtn.addEventListener('click', () => importInput.click());
            importInput.addEventListener('change', (e) => {
                if (e.target.files[0]) {
                    importReptFile(e.target.files[0]);
                }
                e.target.value = '';
            });
        }
        
        // Slide management
        const addSlideBtn = document.getElementById('addSlideBtn');
        if (addSlideBtn) {
            addSlideBtn.addEventListener('click', addNewSlide);
        }
        
        // Exit focus mode
        const exitFocusBtn = document.getElementById('exitFocusBtn');
        if (exitFocusBtn) {
            exitFocusBtn.addEventListener('click', () => document.body.classList.remove('focus-mode'));
        }
        
        // Effect modal
        const effectBtn = document.getElementById('effectBtn');
        const closeEffectBtn = document.getElementById('closeEffectModal');
        const applyEffectBtn = document.getElementById('applyEffectBtn');
        
        if (effectBtn) effectBtn.addEventListener('click', showEffectModal);
        if (closeEffectBtn) closeEffectBtn.addEventListener('click', closeEffectModal);
        if (applyEffectBtn) applyEffectBtn.addEventListener('click', applyEffectFromUI);
        
        // Preview mode
        const previewModeBtn = document.getElementById('previewModeBtn');
        if (previewModeBtn) {
            previewModeBtn.addEventListener('click', openPreviewMode);
        }
        
        // Keyboard shortcuts
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
                e.preventDefault();
                deleteSelected();
            }
            if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) {
                document.body.classList.remove('focus-mode');
            }
        });
        
        // Before unload
        window.addEventListener('beforeunload', (e) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = 'Unsaved changes';
                return e.returnValue;
            }
        });
        
        // Window resize
        window.addEventListener('resize', () => {
            if (canvas && container && isInitialized) {
                const w = container.clientWidth || 900;
                const h = container.clientHeight || 600;
                canvas.setWidth(w);
                canvas.setHeight(h);
                canvas.renderAll();
            }
        });
    }
    
    // ---------- COLOR PALETTE ----------
    const presetColors = [
        '#ffffff', '#000000', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71',
        '#1abc9c', '#3498db', '#9b59b6', '#ecf0f1', '#c0392b', '#2980b9',
        '#8e44ad', '#2c3e50', '#16a085', '#27ae60', '#f39c12', '#d35400'
    ];
    
    function buildPalette(gridId, customId, cb) {
        const grid = document.getElementById(gridId);
        if (!grid) return;
        
        grid.innerHTML = '';
        
        presetColors.forEach(c => {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch';
            swatch.style.backgroundColor = c;
            swatch.addEventListener('click', () => {
                cb(c);
                const customInput = document.getElementById(customId);
                if (customInput) customInput.value = c;
                const popup = grid.closest('.color-picker-popup');
                if (popup) popup.classList.remove('show');
            });
            grid.appendChild(swatch);
        });
        
        const customInput = document.getElementById(customId);
        if (customInput) {
            customInput.addEventListener('input', e => cb(e.target.value));
        }
    }
    
    function setupColorDrop(contId, pickerId) {
        const cont = document.getElementById(contId);
        const picker = document.getElementById(pickerId);
        if (!cont || !picker) return;
        
        const btn = cont.querySelector('.tool-btn');
        if (!btn) return;
        
        btn.addEventListener('click', e => {
            e.stopPropagation();
            document.querySelectorAll('.color-picker-popup.show').forEach(p => {
                if (p !== picker) p.classList.remove('show');
            });
            document.querySelectorAll('.dropdown-container.open').forEach(d => {
                if (d !== cont) d.classList.remove('open');
            });
            picker.classList.toggle('show');
        });
        
        picker.addEventListener('click', e => e.stopPropagation());
    }
    
    // ---------- DROPDOWN SETUP ----------
    function setupDropdowns() {
        // Color palettes
        buildPalette('fillColorGrid', 'fillColorCustom', setFillColor);
        buildPalette('bgColorGrid', 'bgColorCustom', setBackgroundColor);
        buildPalette('canvasBgGrid', 'canvasBgCustom', setCanvasBgColor);
        
        // Color dropdowns
        setupColorDrop('fillColorContainer', 'fillColorPicker');
        setupColorDrop('bgColorContainer', 'bgColorPicker');
        setupColorDrop('canvasBgContainer', 'canvasBgPicker');
        
        // Regular dropdowns
        document.querySelectorAll('.dropdown-container:not(#fillColorContainer):not(#bgColorContainer):not(#canvasBgContainer)').forEach(cont => {
            const btn = cont.querySelector('.tool-btn');
            if (btn) {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    document.querySelectorAll('.color-picker-popup.show').forEach(p => p.classList.remove('show'));
                    cont.classList.toggle('open');
                });
            }
            cont.addEventListener('click', e => e.stopPropagation());
        });
        
        // Global click to close dropdowns
        document.addEventListener('click', () => {
            document.querySelectorAll('.dropdown-container.open').forEach(c => c.classList.remove('open'));
            document.querySelectorAll('.color-picker-popup.show').forEach(p => p.classList.remove('show'));
        });
        
        // Font size items
        document.querySelectorAll('[data-fontsize]').forEach(el => {
            el.addEventListener('click', () => setFontSize(el.dataset.fontsize));
        });
        
        // Line height items
        document.querySelectorAll('[data-lineheight]').forEach(el => {
            el.addEventListener('click', () => setLineHeight(el.dataset.lineheight));
        });
        
        // Text transform items
        document.querySelectorAll('[data-transform]').forEach(el => {
            el.addEventListener('click', () => transformText(el.dataset.transform));
        });
    }
    
    // ---------- INITIALIZE ----------
    function init() {
        console.log('Initializing Restudio Presentation...');
        
        initCanvas();
        initSlides();
        setupEventListeners();
        setupDropdowns();
        
        updateZoomDisplay();
        updateUndoRedoButtons();
        updateStyleButtonsState();
        
        if (fillColorBtn) fillColorBtn.disabled = true;
        if (bgColorBtn) bgColorBtn.disabled = true;
        
        console.log('Restudio Presentation initialized successfully');
    }
    
    // Start the application
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
