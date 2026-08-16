// ========== SECURITY UTILITIES ==========

function sanitizeText(text) {
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') return String(text);
    var map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;',
        '=': '&#x3D;',
        '`': '&#x60;'
    };
    return text.replace(/[&<>"'/=`]/g, function(match) { return map[match]; });
}

function isValidText(text) {
    if (typeof text !== 'string') return false;
    var dangerousPatterns = [
        /javascript:/i, /on\w+\s*=/i, /<script/i, /<iframe/i,
        /<object/i, /<embed/i, /data:text\/html/i, /vbscript:/i
    ];
    for (var i = 0; i < dangerousPatterns.length; i++) {
        if (dangerousPatterns[i].test(text)) return false;
    }
    return true;
}

function validateREPTFile(data) {
    if (!data || typeof data !== 'object') throw new Error('Invalid file format');
    var MAX_FILE_SIZE_MB = 20;
    var jsonString = JSON.stringify(data);
    var sizeInMB = new Blob([jsonString]).size / (1024 * 1024);
    if (sizeInMB > MAX_FILE_SIZE_MB) throw new Error('File too large: ' + sizeInMB.toFixed(2) + 'MB (max ' + MAX_FILE_SIZE_MB + 'MB)');
    if (data.canvasJSON) {
        if (typeof data.canvasJSON !== 'object' && typeof data.canvasJSON !== 'string') throw new Error('Invalid canvasJSON format');
        if (typeof data.canvasJSON === 'object' && data.canvasJSON.objects) {
            if (!Array.isArray(data.canvasJSON.objects)) throw new Error('Invalid objects array in canvasJSON');
            for (var i = 0; i < data.canvasJSON.objects.length; i++) {
                var obj = data.canvasJSON.objects[i];
                if (!obj || typeof obj !== 'object') throw new Error('Invalid object at index ' + i);
                if (obj.type === 'textbox' && obj.text) {
                    if (!isValidText(obj.text)) throw new Error('Suspicious content detected in text object');
                    obj.text = sanitizeText(obj.text);
                }
            }
        }
    }
    if (data.slideName && typeof data.slideName === 'string') {
        if (!isValidText(data.slideName)) throw new Error('Suspicious content in slide name');
        data.slideName = sanitizeText(data.slideName);
    }
    return true;
}

function validateSlideIndex(index, slidesArray) {
    if (!slidesArray || !Array.isArray(slidesArray)) return false;
    if (index < 0 || index >= slidesArray.length) return false;
    return true;
}

function validateCanvasAccess(canvasInstance) {
    if (!canvasInstance) { console.warn('Canvas not initialized'); return false; }
    if (typeof canvasInstance.getActiveObject !== 'function') { console.warn('Canvas is not properly initialized'); return false; }
    return true;
}

function getActiveObjectSafe(canvasInstance) {
    if (!validateCanvasAccess(canvasInstance)) return null;
    try { return canvasInstance.getActiveObject(); } catch (err) { console.error('Error getting active object:', err); return null; }
}

function getActiveObjectsSafe(canvasInstance) {
    if (!validateCanvasAccess(canvasInstance)) return [];
    try { return canvasInstance.getActiveObjects() || []; } catch (err) { console.error('Error getting active objects:', err); return []; }
}

// ========== MAIN APPLICATION ==========

(function() {
    'use strict';
    
    var container = document.getElementById('fabric-canvas-container');
    var zoomLevelDisplay = document.getElementById('zoomLevelDisplay');
    var undoBtn = document.querySelector('[data-action="undo"]');
    var redoBtn = document.querySelector('[data-action="redo"]');
    var boldBtn = document.querySelector('[data-action="bold"]');
    var italicBtn = document.querySelector('[data-action="italic"]');
    var underlineBtn = document.querySelector('[data-action="underline"]');
    var alignLeftBtn = document.querySelector('[data-action="alignLeft"]');
    var alignCenterBtn = document.querySelector('[data-action="alignCenter"]');
    var alignRightBtn = document.querySelector('[data-action="alignRight"]');
    var fillColorBtn = document.getElementById('fillColorBtn');
    var bgColorBtn = document.getElementById('bgColorBtn');

    var slides = [];
    var currentSlideIndex = 0;
    var canvas = null;
    var historyStack = [];
    var historyIndex = -1;
    var zoomLevel = 1;
    var historySaveTimer = null;
    var hasUnsavedChanges = false;
    var isInitialized = false;

    function markAsChanged() { hasUnsavedChanges = true; }
    function clearUnsaved() { hasUnsavedChanges = false; }

    function saveCurrentSlideState() {
        if (!canvas || !isInitialized || slides.length === 0) return;
        try {
            slides[currentSlideIndex].canvasJSON = JSON.stringify(canvas.toJSON(['id', 'effectDef']));
            slides[currentSlideIndex].bgColor = canvas.backgroundColor;
            slides[currentSlideIndex].zoom = zoomLevel;
        } catch (err) { console.error('Error saving slide state:', err); }
        clearUnsaved();
    }

    function loadSlide(index) {
        if (!validateSlideIndex(index, slides)) return false;
        saveCurrentSlideState();
        var slide = slides[index];
        currentSlideIndex = index;
        try {
            if (slide.canvasJSON) {
                canvas.loadFromJSON(slide.canvasJSON, function() {
                    if (slide.bgColor) canvas.setBackgroundColor(slide.bgColor, function() {});
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
        } catch (err) { console.error('Error loading slide:', err); return false; }
        renderSlideSidebar();
        updateStyleButtonsState();
        return true;
    }

    function addNewSlide() {
        if (!isInitialized) return;
        saveCurrentSlideState();
        var newSlide = { id: Date.now(), name: 'Slide ' + (slides.length + 1), canvasJSON: null, bgColor: '#2b2b2b', zoom: 1 };
        slides.push(newSlide);
        loadSlide(slides.length - 1);
        renderSlideSidebar();
        markAsChanged();
    }

    function deleteSlide(index) {
        if (!validateSlideIndex(index, slides)) return;
        if (slides.length <= 1) { alert('Cannot delete last slide.'); return; }
        var slideName = slides[index].name || 'Slide ' + (index + 1);
        if (confirm('Delete "' + slideName + '"?')) {
            slides.splice(index, 1);
            if (currentSlideIndex >= slides.length) currentSlideIndex = slides.length - 1;
            loadSlide(currentSlideIndex);
            renderSlideSidebar();
            markAsChanged();
        }
    }

    function renameSlide(index) {
        if (!validateSlideIndex(index, slides)) return;
        var currentName = slides[index].name;
        var newName = prompt('Rename slide:', currentName);
        if (newName && newName.trim() !== '') {
            var sanitized = sanitizeText(newName.trim());
            if (!isValidText(sanitized)) { alert('Invalid name detected.'); return; }
            slides[index].name = sanitized;
            renderSlideSidebar();
            markAsChanged();
        }
    }

    function renderSlideSidebar() {
        var div = document.getElementById('slidesList');
        if (!div) return;
        div.innerHTML = '';
        for (var idx = 0; idx < slides.length; idx++) {
            var slide = slides[idx];
            var item = document.createElement('div');
            item.className = 'slide-item' + (idx === currentSlideIndex ? ' active' : '');
            var infoDiv = document.createElement('div');
            infoDiv.className = 'slide-info';
            var nameSpan = document.createElement('div');
            nameSpan.className = 'slide-name';
            nameSpan.textContent = slide.name || 'Slide ' + (idx + 1);
            var indexSpan = document.createElement('div');
            indexSpan.className = 'slide-index';
            indexSpan.textContent = 'Slide ' + (idx + 1);
            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(indexSpan);
            var actionsDiv = document.createElement('div');
            actionsDiv.className = 'slide-actions';
            var renameBtn = document.createElement('button');
            renameBtn.className = 'rename-slide-btn';
            renameBtn.innerHTML = '<i class="ti ti-edit"></i>';
            renameBtn.title = 'Rename slide';
            renameBtn.addEventListener('click', function(i) {
                return function(e) { e.stopPropagation(); renameSlide(i); };
            }(idx));
            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-slide-btn';
            deleteBtn.innerHTML = '<i class="ti ti-trash"></i>';
            deleteBtn.title = 'Delete slide';
            deleteBtn.addEventListener('click', function(i) {
                return function(e) { e.stopPropagation(); deleteSlide(i); };
            }(idx));
            actionsDiv.appendChild(renameBtn);
            actionsDiv.appendChild(deleteBtn);
            item.appendChild(infoDiv);
            item.appendChild(actionsDiv);
            item.addEventListener('click', function(i) {
                return function(e) {
                    if (!e.target.closest('.slide-actions')) loadSlide(i);
                };
            }(idx));
            div.appendChild(item);
        }
    }

    function resetHistoryFromCurrentCanvas() {
        if (!canvas || !isInitialized) return;
        try {
            var state = JSON.stringify(canvas.toJSON(['id', 'effectDef']));
            historyStack = [state];
            historyIndex = 0;
            updateUndoRedoButtons();
        } catch (err) { console.error('Error resetting history:', err); }
    }

    function updateUndoRedoButtons() {
        if (undoBtn) undoBtn.disabled = (historyIndex <= 0);
        if (redoBtn) redoBtn.disabled = (historyIndex >= historyStack.length - 1);
    }

    function saveHistoryState() {
        if (!canvas || !isInitialized) return;
        try {
            var state = JSON.stringify(canvas.toJSON(['id', 'effectDef']));
            if (historyStack.length === 0 || historyStack[historyIndex] !== state) {
                historyStack = historyStack.slice(0, historyIndex + 1);
                historyStack.push(state);
                historyIndex++;
                markAsChanged();
                updateUndoRedoButtons();
                saveCurrentSlideState();
            }
        } catch (err) { console.error('Error saving history:', err); }
    }

    function scheduleHistorySave() {
        if (historySaveTimer) clearTimeout(historySaveTimer);
        historySaveTimer = setTimeout(saveHistoryState, 150);
    }

    function loadHistoryState() {
        if (!canvas || !isInitialized || historyStack.length === 0) return;
        try {
            canvas.loadFromJSON(historyStack[historyIndex], function() {
                canvas.renderAll();
                updateUndoRedoButtons();
                updateStyleButtonsState();
                markAsChanged();
                saveCurrentSlideState();
            });
        } catch (err) { console.error('Error loading history state:', err); }
    }

    function undo() {
        if (historyIndex > 0 && canvas && isInitialized) { historyIndex--; loadHistoryState(); }
    }

    function redo() {
        if (historyIndex < historyStack.length - 1 && canvas && isInitialized) { historyIndex++; loadHistoryState(); }
    }

    function initCanvas() {
        if (!container) { console.error('Container not found'); return; }
        var existingCanvas = document.getElementById('fabric-canvas');
        if (existingCanvas) existingCanvas.remove();
        var newCanvasElem = document.createElement('canvas');
        newCanvasElem.id = 'fabric-canvas';
        newCanvasElem.width = container.clientWidth || 900;
        newCanvasElem.height = container.clientHeight || 600;
        container.innerHTML = '';
        container.appendChild(newCanvasElem);

        try {
            canvas = new fabric.Canvas('fabric-canvas', {
                preserveObjectStacking: true,
                selection: true,
                backgroundColor: '#2b2b2b',
                renderOnAddRemove: true,
                evented: true,
                perPixelTargetFind: true,
                targetFindTolerance: 3,
                interactive: true
            });
            canvas.setWidth(container.clientWidth);
            canvas.setHeight(container.clientHeight);
            canvas.renderAll();
            canvas.off('object:added');
            canvas.off('object:modified');
            canvas.off('object:removed');
            canvas.off('selection:created');
            canvas.off('selection:updated');
            canvas.off('selection:cleared');
            canvas.on('object:added', function() { scheduleHistorySave(); });
            canvas.on('object:modified', function() { scheduleHistorySave(); });
            canvas.on('object:removed', function() { scheduleHistorySave(); });
            canvas.on('selection:created', function() { updateStyleButtonsState(); });
            canvas.on('selection:updated', function() { updateStyleButtonsState(); });
            canvas.on('selection:cleared', function() {
                if (boldBtn) boldBtn.classList.remove('active');
                if (italicBtn) italicBtn.classList.remove('active');
                if (underlineBtn) underlineBtn.classList.remove('active');
                if (alignLeftBtn) alignLeftBtn.classList.remove('active');
                if (alignCenterBtn) alignCenterBtn.classList.remove('active');
                if (alignRightBtn) alignRightBtn.classList.remove('active');
                updateFontSizeCheckmark(null);
                updateLineHeightCheckmark(null);
                if (fillColorBtn) fillColorBtn.disabled = true;
                if (bgColorBtn) bgColorBtn.disabled = true;
            });
            isInitialized = true;
            resetHistoryFromCurrentCanvas();
            updateZoomDisplay();
            updateUndoRedoButtons();
            if (fillColorBtn) fillColorBtn.disabled = true;
            if (bgColorBtn) bgColorBtn.disabled = true;
            console.log('Canvas initialized successfully');
        } catch (err) {
            console.error('Error initializing canvas:', err);
            isInitialized = false;
        }
    }

    function isImage(obj) { return obj && obj.type === 'image'; }

    function updateStyleButtonsState() {
        if (!canvas || !isInitialized) return;
        var activeObj = getActiveObjectSafe(canvas);
        if (!activeObj) {
            if (boldBtn) boldBtn.classList.remove('active');
            if (italicBtn) italicBtn.classList.remove('active');
            if (underlineBtn) underlineBtn.classList.remove('active');
            if (alignLeftBtn) alignLeftBtn.classList.remove('active');
            if (alignCenterBtn) alignCenterBtn.classList.remove('active');
            if (alignRightBtn) alignRightBtn.classList.remove('active');
            updateFontSizeCheckmark(null);
            updateLineHeightCheckmark(null);
            if (fillColorBtn) fillColorBtn.disabled = true;
            if (bgColorBtn) bgColorBtn.disabled = true;
            return;
        }
        var img = isImage(activeObj);
        if (activeObj.type === 'textbox') {
            if (boldBtn) boldBtn.classList.toggle('active', activeObj.fontWeight === 'bold');
            if (italicBtn) italicBtn.classList.toggle('active', activeObj.fontStyle === 'italic');
            if (underlineBtn) underlineBtn.classList.toggle('active', !!activeObj.underline);
            var align = activeObj.textAlign || 'left';
            if (alignLeftBtn) alignLeftBtn.classList.toggle('active', align === 'left');
            if (alignCenterBtn) alignCenterBtn.classList.toggle('active', align === 'center');
            if (alignRightBtn) alignRightBtn.classList.toggle('active', align === 'right');
            updateFontSizeCheckmark(activeObj.fontSize);
            updateLineHeightCheckmark(activeObj.lineHeight);
            if (fillColorBtn) fillColorBtn.disabled = false;
            if (bgColorBtn) bgColorBtn.disabled = false;
        } else {
            if (boldBtn) boldBtn.classList.remove('active');
            if (italicBtn) italicBtn.classList.remove('active');
            if (underlineBtn) underlineBtn.classList.remove('active');
            if (alignLeftBtn) alignLeftBtn.classList.remove('active');
            if (alignCenterBtn) alignCenterBtn.classList.remove('active');
            if (alignRightBtn) alignRightBtn.classList.remove('active');
            updateFontSizeCheckmark(null);
            updateLineHeightCheckmark(null);
            if (fillColorBtn) fillColorBtn.disabled = img;
            if (bgColorBtn) bgColorBtn.disabled = true;
        }
    }

    function updateFontSizeCheckmark(fontSize) {
        var items = document.querySelectorAll('#fontSizeMenu .dropdown-item');
        for (var i = 0; i < items.length; i++) {
            var check = items[i].querySelector('.check-icon');
            if (check) {
                var size = parseInt(items[i].dataset.fontsize);
                check.style.display = (fontSize && size === fontSize) ? 'inline' : 'none';
            }
        }
    }

    function updateLineHeightCheckmark(lineHeight) {
        var items = document.querySelectorAll('#lineHeightMenu .dropdown-item');
        for (var i = 0; i < items.length; i++) {
            var check = items[i].querySelector('.check-icon');
            if (check) {
                var val = parseFloat(items[i].dataset.lineheight);
                check.style.display = (lineHeight && Math.abs(val - lineHeight) < 0.01) ? 'inline' : 'none';
            }
        }
    }

    var presetColors = [
        '#ffffff', '#000000', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71',
        '#1abc9c', '#3498db', '#9b59b6', '#ecf0f1', '#c0392b', '#2980b9',
        '#8e44ad', '#2c3e50', '#16a085', '#27ae60', '#f39c12', '#d35400',
        '#7f8c8d', '#bdc3c7', '#34495e', '#95a5a6'
    ];

    function buildColorPalette(gridId, customInputId, callback) {
        var grid = document.getElementById(gridId);
        if (!grid) return;
        grid.innerHTML = '';
        for (var i = 0; i < presetColors.length; i++) {
            var color = presetColors[i];
            var swatch = document.createElement('div');
            swatch.className = 'color-swatch';
            swatch.style.backgroundColor = color;
            swatch.addEventListener('click', function(c) {
                return function(e) {
                    e.stopPropagation();
                    callback(c);
                    var customInput = document.getElementById(customInputId);
                    if (customInput) customInput.value = c;
                    var popup = grid.closest('.color-picker-popup');
                    if (popup) popup.classList.remove('show');
                };
            }(color));
            grid.appendChild(swatch);
        }
        var customInput = document.getElementById(customInputId);
        if (customInput) {
            customInput.addEventListener('input', function(e) { callback(e.target.value); });
        }
    }

    function addTextBox() {
        if (!canvas || !isInitialized) return;
        var textbox = new fabric.Textbox('New Text', {
            left: 100, top: 100, width: 200, fontSize: 24, fill: '#ffffff',
            fontFamily: 'Segoe UI', hasControls: true, hasBorders: true,
            selectable: true, evented: true, hoverCursor: 'pointer', moveCursor: 'move', perPixelTargetFind: true
        });
        canvas.add(textbox);
        canvas.setActiveObject(textbox);
        canvas.renderAll();
        scheduleHistorySave();
    }

    function addRectangle() {
        if (!canvas || !isInitialized) return;
        var rect = new fabric.Rect({
            left: 150, top: 150, width: 120, height: 80, fill: '#3498db',
            stroke: '#ffffff', strokeWidth: 2, selectable: true, evented: true,
            hoverCursor: 'pointer', moveCursor: 'move', perPixelTargetFind: true
        });
        canvas.add(rect);
        canvas.setActiveObject(rect);
        canvas.renderAll();
        scheduleHistorySave();
    }

    function addCircle() {
        if (!canvas || !isInitialized) return;
        var circle = new fabric.Circle({
            left: 200, top: 200, radius: 50, fill: '#e67e22', stroke: '#fff',
            strokeWidth: 2, selectable: true, evented: true,
            hoverCursor: 'pointer', moveCursor: 'move', perPixelTargetFind: true
        });
        canvas.add(circle);
        canvas.setActiveObject(circle);
        canvas.renderAll();
        scheduleHistorySave();
    }

    function addImageFromFile() { var input = document.getElementById('imageFileInput'); if (input) input.click(); }

    function addQRCode() {
        if (!canvas || !isInitialized) return;
        var text = prompt('Enter text or URL for the QR code:', 'https://restudio.com');
        if (!text || !text.trim()) return;
        var sanitizedText = sanitizeText(text.trim());
        if (!isValidText(sanitizedText)) { alert('Invalid text detected.'); return; }
        var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(sanitizedText);
        fabric.Image.fromURL(qrUrl, function(img) {
            if (!canvas || !isInitialized) return;
            img.set({
                left: (canvas.width - img.width * img.scaleX) / 2,
                top: (canvas.height - img.height * img.scaleY) / 2,
                selectable: true, evented: true, hoverCursor: 'pointer', moveCursor: 'move', perPixelTargetFind: true
            });
            canvas.add(img);
            canvas.setActiveObject(img);
            canvas.renderAll();
            scheduleHistorySave();
        }, { crossOrigin: 'anonymous' });
    }

    function handleImageFileSelect(event) {
        var file = event.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { alert('Please select a valid image file.'); event.target.value = ''; return; }
        var MAX_IMAGE_SIZE = 10 * 1024 * 1024;
        if (file.size > MAX_IMAGE_SIZE) { alert('Image file too large: ' + (file.size / 1024 / 1024).toFixed(2) + 'MB (max 10MB)'); event.target.value = ''; return; }
        var reader = new FileReader();
        reader.onload = function(e) {
            if (!canvas || !isInitialized) return;
            fabric.Image.fromURL(e.target.result, function(img) {
                if (!canvas || !isInitialized) return;
                var maxWidth = canvas.width * 0.6;
                var maxHeight = canvas.height * 0.6;
                if (img.width > maxWidth || img.height > maxHeight) {
                    var scale = Math.min(maxWidth / img.width, maxHeight / img.height);
                    img.scale(scale);
                } else { img.scale(1); }
                img.set({
                    left: (canvas.width - img.width * img.scaleX) / 2,
                    top: (canvas.height - img.height * img.scaleY) / 2,
                    selectable: true, evented: true, hoverCursor: 'pointer', moveCursor: 'move', perPixelTargetFind: true
                });
                canvas.add(img);
                canvas.setActiveObject(img);
                canvas.renderAll();
                scheduleHistorySave();
            }, { crossOrigin: 'anonymous' });
        };
        reader.onerror = function() { alert('Failed to load image file.'); };
        reader.readAsDataURL(file);
        event.target.value = '';
    }

    function deleteSelected() {
        if (!canvas || !isInitialized) return;
        var active = canvas.getActiveObjects();
        if (active.length > 0) {
            for (var i = 0; i < active.length; i++) { canvas.remove(active[i]); }
            canvas.discardActiveObject();
            canvas.renderAll();
            scheduleHistorySave();
        }
    }

    function bringForward() {
        if (!canvas || !isInitialized) return;
        var obj = getActiveObjectSafe(canvas);
        if (obj) { canvas.bringForward(obj); canvas.renderAll(); scheduleHistorySave(); }
    }

    function sendBackward() {
        if (!canvas || !isInitialized) return;
        var obj = getActiveObjectSafe(canvas);
        if (obj) { canvas.sendBackwards(obj); canvas.renderAll(); scheduleHistorySave(); }
    }

    function applyToSelected(callback) {
        if (!canvas || !isInitialized) return;
        var actives = canvas.getActiveObjects();
        if (actives.length > 0) {
            for (var i = 0; i < actives.length; i++) { callback(actives[i]); }
            canvas.renderAll();
            scheduleHistorySave();
            updateStyleButtonsState();
        }
    }

    function setBold() { applyToSelected(function(obj) { if (obj.type === 'textbox') { obj.fontWeight = (obj.fontWeight === 'bold') ? 'normal' : 'bold'; } }); }
    function setItalic() { applyToSelected(function(obj) { if (obj.type === 'textbox') { obj.fontStyle = (obj.fontStyle === 'italic') ? 'normal' : 'italic'; } }); }
    function setUnderline() { applyToSelected(function(obj) { if (obj.type === 'textbox') { obj.underline = !obj.underline; } }); }
    function setFontSize(size) { applyToSelected(function(obj) { if (obj.fontSize !== undefined) { obj.fontSize = parseInt(size); } }); var container = document.getElementById('fontSizeContainer'); if (container) container.classList.remove('open'); }
    function setLineHeight(height) { applyToSelected(function(obj) { if (obj.lineHeight !== undefined) { obj.lineHeight = parseFloat(height); } }); var container = document.getElementById('lineHeightContainer'); if (container) container.classList.remove('open'); }
    function setFillColor(color) { applyToSelected(function(obj) { if (obj.type !== 'image') { obj.set('fill', color); } }); }
    function setBackgroundColor(color) { applyToSelected(function(obj) { if (obj.type === 'textbox') { obj.set('backgroundColor', color); } }); }
    function setTextAlign(align) { applyToSelected(function(obj) { if (obj.textAlign !== undefined) { obj.textAlign = align; } }); }
    function setCanvasBgColor(color) { if (!canvas || !isInitialized) return; canvas.setBackgroundColor(color, function() { canvas.renderAll(); }); scheduleHistorySave(); }
    function increaseIndent() { applyToSelected(function(obj) { if (obj.type === 'textbox') { obj.text = '    ' + obj.text; } }); }
    function decreaseIndent() { applyToSelected(function(obj) { if (obj.type === 'textbox') { obj.text = obj.text.replace(/^ {1,4}/, ''); } }); }
    function transformText(type) {
        applyToSelected(function(obj) {
            if (obj.type === 'textbox') {
                if (type === 'uppercase') obj.text = obj.text.toUpperCase();
                else if (type === 'lowercase') obj.text = obj.text.toLowerCase();
                else if (type === 'capitalize') obj.text = obj.text.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
            }
        });
        var container = document.getElementById('textTransformContainer');
        if (container) container.classList.remove('open');
    }

    function updateZoomDisplay() { if (zoomLevelDisplay) { zoomLevelDisplay.textContent = Math.round(zoomLevel * 100) + '%'; } }
    function zoomIn() { if (!canvas || !isInitialized) return; zoomLevel = Math.min(2, zoomLevel + 0.1); canvas.setZoom(zoomLevel); canvas.renderAll(); updateZoomDisplay(); scheduleHistorySave(); }
    function zoomOut() { if (!canvas || !isInitialized) return; zoomLevel = Math.max(0.5, zoomLevel - 0.1); canvas.setZoom(zoomLevel); canvas.renderAll(); updateZoomDisplay(); scheduleHistorySave(); }

    function groupSelected() {
        if (!canvas || !isInitialized) return;
        var objs = canvas.getActiveObjects();
        if (objs.length < 2) { alert('Select at least 2 objects.'); return; }
        canvas.getActiveObject().toGroup();
        canvas.renderAll();
        scheduleHistorySave();
        updateStyleButtonsState();
    }

    function ungroupSelected() {
        if (!canvas || !isInitialized) return;
        var obj = getActiveObjectSafe(canvas);
        if (!obj || obj.type !== 'group') { alert('Select a group.'); return; }
        obj.toActiveSelection();
        canvas.renderAll();
        scheduleHistorySave();
        updateStyleButtonsState();
    }

    var easingMap = {
        easeOutCubic: fabric.util.ease.easeOutCubic,
        easeOutBounce: fabric.util.ease.easeOutBounce,
        easeInOutQuad: fabric.util.ease.easeInOutQuad,
        linear: fabric.util.ease.linear
    };

    function applyEffectToObject(obj, effect, duration, delay, easingName, isInfinite) {
        if (!obj) return;
        var easingFn = easingMap[easingName] || easingMap.easeOutCubic;
        var completed = false;
        function runAnimation(callback) {
            var originalLeft = obj.left, originalTop = obj.top, originalScaleX = obj.scaleX, originalScaleY = obj.scaleY, originalAngle = obj.angle, originalOpacity = obj.opacity !== undefined ? obj.opacity : 1;
            var targetProps = {};
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
                default: if (callback) callback(); return;
            }
            canvas.renderAll();
            obj.animate(targetProps, {
                duration: duration,
                easing: easingFn,
                onChange: canvas.renderAll.bind(canvas),
                onComplete: function() {
                    if (effect === 'flipX') obj.set('scaleX', originalScaleX);
                    if (effect === 'flipY') obj.set('scaleY', originalScaleY);
                    canvas.renderAll();
                    if (callback) callback();
                }
            });
        }
        function startLoop() {
            runAnimation(function() {
                if (isInfinite && !completed) {
                    setTimeout(startLoop, delay + duration + 100);
                }
            });
        }
        if (delay > 0) setTimeout(startLoop, delay);
        else startLoop();
    }

    function setObjectEffect(obj, effectData) {
        obj.effectDef = { type: effectData.type, duration: effectData.duration, delay: effectData.delay, easing: effectData.easing, infinite: effectData.infinite };
        applyEffectToObject(obj, effectData.type, effectData.duration, effectData.delay, effectData.easing, effectData.infinite);
        scheduleHistorySave();
    }

    function exportCurrentSlide() {
        if (!canvas || !isInitialized || slides.length === 0) return;
        saveCurrentSlideState();
        var slide = slides[currentSlideIndex];
        var exportObj = {
            version: '1.0',
            slideName: slide.name,
            canvasJSON: slide.canvasJSON ? JSON.parse(slide.canvasJSON) : canvas.toJSON(['id', 'effectDef']),
            bgColor: canvas.backgroundColor,
            zoom: zoomLevel
        };
        try {
            var blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'slide_' + (slide.name || 'slide' + (currentSlideIndex + 1)).replace(/\s/g, '_') + '.rept';
            a.click();
            URL.revokeObjectURL(a.href);
            clearUnsaved();
        } catch (err) { alert('Error exporting: ' + err.message); }
    }

    function importREPTFile(file) {
        if (!canvas || !isInitialized) return;
        if (hasUnsavedChanges && !confirm('Replace current slide?')) return;
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var imported = JSON.parse(e.target.result);
                validateREPTFile(imported);
                var jsonToLoad = imported.canvasJSON || imported;
                canvas.loadFromJSON(jsonToLoad, function() {
                    if (imported.bgColor) canvas.setBackgroundColor(imported.bgColor, function() {});
                    canvas.renderAll();
                    zoomLevel = imported.zoom || 1;
                    canvas.setZoom(zoomLevel);
                    updateZoomDisplay();
                    resetHistoryFromCurrentCanvas();
                    slides[currentSlideIndex].canvasJSON = JSON.stringify(canvas.toJSON(['id', 'effectDef']));
                    slides[currentSlideIndex].bgColor = canvas.backgroundColor;
                    slides[currentSlideIndex].zoom = zoomLevel;
                    if (imported.slideName) {
                        var sanitizedName = sanitizeText(imported.slideName);
                        if (isValidText(sanitizedName)) slides[currentSlideIndex].name = sanitizedName;
                    }
                    renderSlideSidebar();
                    saveCurrentSlideState();
                    clearUnsaved();
                });
            } catch (err) { alert('Import failed: ' + err.message); }
        };
        reader.onerror = function() { alert('Error reading file.'); };
        reader.readAsText(file);
    }

    // ========== PREVIEW MODE (مصلح بالكامل) ==========
    function openPreviewMode() {
        saveCurrentSlideState();

        // تنظيف بيانات الشرائح قبل الإرسال (تجنب المراجع الدائرية)
        var slidesData = [];
        for (var i = 0; i < slides.length; i++) {
            try {
                var slide = slides[i];
                var cleanData = {
                    name: slide.name || 'Slide ' + (i + 1),
                    canvasJSON: slide.canvasJSON ? JSON.parse(JSON.stringify(JSON.parse(slide.canvasJSON))) : null,
                    bgColor: slide.bgColor || '#2b2b2b'
                };
                slidesData.push(cleanData);
            } catch (err) {
                console.warn('Error cleaning slide data:', err);
                // إرسال بيانات فارغة كبديل
                slidesData.push({
                    name: 'Slide ' + (i + 1),
                    canvasJSON: null,
                    bgColor: '#2b2b2b'
                });
            }
        }

        var currentIdx = currentSlideIndex;
        var win = window.open('', '_blank', 'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes');
        if (!win) {
            alert('Popup blocked. Please allow popups for this site.');
            return;
        }

        // كتابة محتوى النافذة المنبثقة مع معالجة الأخطاء
        win.document.write('<!DOCTYPE html>\n');
        win.document.write('<html>\n');
        win.document.write('<head>\n');
        win.document.write('<meta charset="UTF-8">\n');
        win.document.write('<title>Presentation Preview</title>\n');
        win.document.write('<script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js"><\/script>\n');
        win.document.write('<style>\n');
        win.document.write('body{margin:0;overflow:hidden;background:#1e1e1e;font-family:"Segoe UI",sans-serif;}\n');
        win.document.write('.preview-container{position:relative;width:100vw;height:100vh;display:flex;justify-content:center;align-items:center;background:#000;}\n');
        win.document.write('canvas{box-shadow:0 0 0 1px #3c3c3c;max-width:90vw;max-height:90vh;}\n');
        win.document.write('.nav-controls{position:fixed;bottom:20px;left:0;right:0;text-align:center;background:rgba(0,0,0,0.7);padding:10px;color:white;z-index:100;}\n');
        win.document.write('button{background:#007acc;border:none;color:white;padding:8px 16px;margin:0 8px;border-radius:8px;cursor:pointer;font-size:16px;}\n');
        win.document.write('button:hover{background:#005f9e;}\n');
        win.document.write('.slide-counter{margin:0 16px;font-size:16px;}\n');
        win.document.write('.instruction{position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.5);padding:5px 10px;border-radius:8px;font-size:12px;}\n');
        win.document.write('<\/style>\n');
        win.document.write('<\/head>\n');
        win.document.write('<body>\n');
        win.document.write('<div class="preview-container"><canvas id="previewCanvas" width="900" height="600"></canvas></div>\n');
        win.document.write('<div class="nav-controls"><button id="prevBtn">◀ Previous</button><span class="slide-counter" id="slideCounter">Slide 1 / 1</span><button id="nextBtn">Next ▶</button></div>\n');
        win.document.write('<div class="instruction">← → keys | ESC to close</div>\n');

        // كتابة السكربت الرئيسي مع معالجة الأخطاء
        win.document.write('<script>\n');
        win.document.write('(function() {\n');
        win.document.write('  "use strict";\n');
        win.document.write('  try {\n');
        win.document.write('    var slidesData = ' + JSON.stringify(slidesData) + ';\n');
        win.document.write('    var currentIdx = ' + currentIdx + ';\n');
        win.document.write('    var canvas = null;\n');
        win.document.write('    var activeTimeouts = [];\n');
        win.document.write('    var isInitialized = false;\n\n');

        win.document.write('    function clearEffects() {\n');
        win.document.write('      for (var i = 0; i < activeTimeouts.length; i++) {\n');
        win.document.write('        clearTimeout(activeTimeouts[i]);\n');
        win.document.write('      }\n');
        win.document.write('      activeTimeouts = [];\n');
        win.document.write('    }\n\n');

        win.document.write('    function applyObjectEffect(obj, effectDef) {\n');
        win.document.write('      if (!obj || !effectDef) return;\n');
        win.document.write('      var easingMap = {\n');
        win.document.write('        easeOutCubic: fabric.util.ease.easeOutCubic,\n');
        win.document.write('        easeOutBounce: fabric.util.ease.easeOutBounce,\n');
        win.document.write('        easeInOutQuad: fabric.util.ease.easeInOutQuad,\n');
        win.document.write('        linear: fabric.util.ease.linear\n');
        win.document.write('      };\n');
        win.document.write('      var easing = easingMap[effectDef.easing] || easingMap.easeOutCubic;\n');
        win.document.write('      var duration = effectDef.duration || 800;\n');
        win.document.write('      var delay = effectDef.delay || 0;\n');
        win.document.write('      var effect = effectDef.type;\n');
        win.document.write('      var isInfinite = effectDef.infinite === true;\n');
        win.document.write('      var completed = false;\n\n');

        win.document.write('      function animateOnce(cb) {\n');
        win.document.write('        var origL = obj.left, origT = obj.top;\n');
        win.document.write('        var origSX = obj.scaleX, origSY = obj.scaleY;\n');
        win.document.write('        var origAng = obj.angle, origOp = obj.opacity !== undefined ? obj.opacity : 1;\n');
        win.document.write('        var target = {};\n');
        win.document.write('        switch(effect) {\n');
        win.document.write('          case "fadeIn": obj.set("opacity", 0); target = { opacity: origOp }; break;\n');
        win.document.write('          case "slideInLeft": obj.set("left", origL - 300); target = { left: origL }; break;\n');
        win.document.write('          case "slideInRight": obj.set("left", origL + 300); target = { left: origL }; break;\n');
        win.document.write('          case "slideInUp": obj.set("top", origT + 200); target = { top: origT }; break;\n');
        win.document.write('          case "slideInDown": obj.set("top", origT - 200); target = { top: origT }; break;\n');
        win.document.write('          case "zoomIn": obj.set("scaleX", 0.1); obj.set("scaleY", 0.1); target = { scaleX: origSX, scaleY: origSY }; break;\n');
        win.document.write('          case "bounce": obj.set("scaleX", 0.8); obj.set("scaleY", 0.8); target = { scaleX: origSX, scaleY: origSY }; break;\n');
        win.document.write('          case "flipX": obj.set("scaleX", -origSX); target = { scaleX: origSX }; break;\n');
        win.document.write('          case "flipY": obj.set("scaleY", -origSY); target = { scaleY: origSY }; break;\n');
        win.document.write('          case "rotateIn": obj.set("angle", -45); target = { angle: origAng }; break;\n');
        win.document.write('          default: if (cb) cb(); return;\n');
        win.document.write('        }\n');
        win.document.write('        canvas.renderAll();\n');
        win.document.write('        obj.animate(target, {\n');
        win.document.write('          duration: duration,\n');
        win.document.write('          easing: easing,\n');
        win.document.write('          onChange: canvas.renderAll.bind(canvas),\n');
        win.document.write('          onComplete: function() {\n');
        win.document.write('            if (effect === "flipX") obj.set("scaleX", origSX);\n');
        win.document.write('            if (effect === "flipY") obj.set("scaleY", origSY);\n');
        win.document.write('            canvas.renderAll();\n');
        win.document.write('            if (cb) cb();\n');
        win.document.write('          }\n');
        win.document.write('        });\n');
        win.document.write('      }\n\n');

        win.document.write('      function startLoop() {\n');
        win.document.write('        animateOnce(function() {\n');
        win.document.write('          if (isInfinite && !completed) {\n');
        win.document.write('            var t = setTimeout(startLoop, delay + duration + 100);\n');
        win.document.write('            activeTimeouts.push(t);\n');
        win.document.write('          }\n');
        win.document.write('        });\n');
        win.document.write('      }\n\n');

        win.document.write('      if (delay > 0) {\n');
        win.document.write('        var t = setTimeout(startLoop, delay);\n');
        win.document.write('        activeTimeouts.push(t);\n');
        win.document.write('      } else {\n');
        win.document.write('        startLoop();\n');
        win.document.write('      }\n');
        win.document.write('    }\n\n');

        win.document.write('    function loadSlide(index) {\n');
        win.document.write('      clearEffects();\n');
        win.document.write('      if (!canvas || !isInitialized) { console.warn("Canvas not ready"); return; }\n');
        win.document.write('      if (index < 0 || index >= slidesData.length) { console.warn("Invalid slide index"); return; }\n');
        win.document.write('      var slide = slidesData[index];\n');
        win.document.write('      try {\n');
        win.document.write('        if (slide && slide.canvasJSON) {\n');
        win.document.write('          canvas.loadFromJSON(slide.canvasJSON, function() {\n');
        win.document.write('            if (slide.bgColor) canvas.setBackgroundColor(slide.bgColor, function() { canvas.renderAll(); });\n');
        win.document.write('            canvas.renderAll();\n');
        win.document.write('            var objs = canvas.getObjects();\n');
        win.document.write('            for (var i = 0; i < objs.length; i++) {\n');
        win.document.write('              if (objs[i].effectDef) {\n');
        win.document.write('                applyObjectEffect(objs[i], objs[i].effectDef);\n');
        win.document.write('              }\n');
        win.document.write('            }\n');
        win.document.write('          });\n');
        win.document.write('        } else {\n');
        win.document.write('          canvas.clear();\n');
        win.document.write('          var bg = (slide && slide.bgColor) ? slide.bgColor : "#2b2b2b";\n');
        win.document.write('          canvas.setBackgroundColor(bg, function() { canvas.renderAll(); });\n');
        win.document.write('          canvas.renderAll();\n');
        win.document.write('        }\n');
        win.document.write('      } catch (err) {\n');
        win.document.write('        console.error("Error loading slide:", err);\n');
        win.document.write('        canvas.clear();\n');
        win.document.write('        canvas.setBackgroundColor("#2b2b2b", function() { canvas.renderAll(); });\n');
        win.document.write('      }\n');
        win.document.write('      var counter = document.getElementById("slideCounter");\n');
        win.document.write('      if (counter) counter.innerText = "Slide " + (index+1) + " / " + slidesData.length;\n');
        win.document.write('    }\n\n');

        win.document.write('    function initPreview() {\n');
        win.document.write('      var canvasElem = document.getElementById("previewCanvas");\n');
        win.document.write('      if (!canvasElem) { console.error("Canvas element not found"); return; }\n');
        win.document.write('      try {\n');
        win.document.write('        canvas = new fabric.Canvas("previewCanvas", {\n');
        win.document.write('          selection: false,\n');
        win.document.write('          preserveObjectStacking: true,\n');
        win.document.write('          renderOnAddRemove: true\n');
        win.document.write('        });\n');
        win.document.write('        canvas.setWidth(900);\n');
        win.document.write('        canvas.setHeight(600);\n');
        win.document.write('        isInitialized = true;\n');
        win.document.write('        loadSlide(currentIdx);\n');
        win.document.write('        console.log("Preview initialized successfully");\n');
        win.document.write('      } catch (err) {\n');
        win.document.write('        console.error("Failed to initialize preview:", err);\n');
        win.document.write('        document.body.innerHTML = "<pre style=\\"color:red; padding:20px;\\">Error initializing preview: " + err.message + "<\\/pre>";\n');
        win.document.write('      }\n');
        win.document.write('    }\n\n');

        win.document.write('    function nextSlide() {\n');
        win.document.write('      if (currentIdx < slidesData.length - 1) { currentIdx++; loadSlide(currentIdx); }\n');
        win.document.write('    }\n\n');

        win.document.write('    function prevSlide() {\n');
        win.document.write('      if (currentIdx > 0) { currentIdx--; loadSlide(currentIdx); }\n');
        win.document.write('    }\n\n');

        win.document.write('    // ربط الأزرار\n');
        win.document.write('    var prevBtn = document.getElementById("prevBtn");\n');
        win.document.write('    var nextBtn = document.getElementById("nextBtn");\n');
        win.document.write('    if (prevBtn) prevBtn.addEventListener("click", prevSlide);\n');
        win.document.write('    if (nextBtn) nextBtn.addEventListener("click", nextSlide);\n\n');

        win.document.write('    // اختصارات لوحة المفاتيح\n');
        win.document.write('    window.addEventListener("keydown", function(e) {\n');
        win.document.write('      if (e.key === "ArrowLeft") { e.preventDefault(); prevSlide(); }\n');
        win.document.write('      else if (e.key === "ArrowRight") { e.preventDefault(); nextSlide(); }\n');
        win.document.write('      else if (e.key === "Escape") { window.close(); }\n');
        win.document.write('    });\n\n');

        win.document.write('    // بدء التشغيل بعد تحميل الصفحة\n');
        win.document.write('    if (document.readyState === "loading") {\n');
        win.document.write('      document.addEventListener("DOMContentLoaded", initPreview);\n');
        win.document.write('    } else {\n');
        win.document.write('      // تأكد من تحميل Fabric.js\n');
        win.document.write('      if (typeof fabric !== "undefined") {\n');
        win.document.write('        initPreview();\n');
        win.document.write('      } else {\n');
        win.document.write('        var checkFabric = setInterval(function() {\n');
        win.document.write('          if (typeof fabric !== "undefined") {\n');
        win.document.write('            clearInterval(checkFabric);\n');
        win.document.write('            initPreview();\n');
        win.document.write('          }\n');
        win.document.write('        }, 100);\n');
        win.document.write('        // مهلة 5 ثواني\n');
        win.document.write('        setTimeout(function() {\n');
        win.document.write('          clearInterval(checkFabric);\n');
        win.document.write('          if (!isInitialized) {\n');
        win.document.write('            document.body.innerHTML = "<pre style=\\"color:red; padding:20px;\\">Fabric.js failed to load. Please check your internet connection.<\\/pre>";\n');
        win.document.write('          }\n');
        win.document.write('        }, 5000);\n');
        win.document.write('      }\n');
        win.document.write('    }\n');

        win.document.write('  } catch (err) {\n');
        win.document.write('    console.error("Fatal error in preview:", err);\n');
        win.document.write('    document.body.innerHTML = "<pre style=\\"color:red; padding:20px;\\">Fatal error: " + err.stack + "<\\/pre>";\n');
        win.document.write('  }\n');
        win.document.write('})();\n');
        win.document.write('<\/script>\n');
        win.document.write('<\/body>\n');
        win.document.write('<\/html>');
        win.document.close();
    }

    // ========== KEYBOARD SHORTCUTS (المصلحة) ==========
    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', function(e) {
            // تجاهل إذا كان التركيز على حقل إدخال نصي
            var tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            if (tag === 'input' || tag === 'textarea' || tag === 'select') {
                return;
            }

            // Ctrl+Z - Undo
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                undo();
                return;
            }
            // Ctrl+Y - Redo
            if (e.ctrlKey && e.key === 'y') {
                e.preventDefault();
                redo();
                return;
            }
            // Delete - Delete selected
            if (e.key === 'Delete' && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                deleteSelected();
                return;
            }
            // Escape - Exit focus mode
            if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) {
                document.body.classList.remove('focus-mode');
                return;
            }
        });
    }

    // ========== Event Listeners ==========
    function setupEventListeners() {
        var toolbar = document.getElementById('toolbar');
        if (toolbar) {
            toolbar.addEventListener('click', function(e) {
                var btn = e.target.closest('.tool-btn');
                if (!btn || btn.closest('.dropdown-container')) return;
                var action = btn.dataset.action;
                if (action) {
                    switch(action) {
                        case 'newDoc': addNewSlide(); break;
                        case 'undo': undo(); break;
                        case 'redo': redo(); break;
                        case 'deleteSelected': deleteSelected(); break;
                        case 'addText': addTextBox(); break;
                        case 'addImage': addImageFromFile(); break;
                        case 'addRectangle': addRectangle(); break;
                        case 'addCircle': addCircle(); break;
                        case 'addQR': addQRCode(); break;
                        case 'bold': setBold(); break;
                        case 'italic': setItalic(); break;
                        case 'underline': setUnderline(); break;
                        case 'alignLeft': setTextAlign('left'); break;
                        case 'alignCenter': setTextAlign('center'); break;
                        case 'alignRight': setTextAlign('right'); break;
                        case 'bringForward': bringForward(); break;
                        case 'sendBackward': sendBackward(); break;
                        case 'zoomIn': zoomIn(); break;
                        case 'zoomOut': zoomOut(); break;
                        case 'focusMode': document.body.classList.toggle('focus-mode'); break;
                        case 'exportRept': exportCurrentSlide(); break;
                        case 'indentInc': increaseIndent(); break;
                        case 'indentDec': decreaseIndent(); break;
                        case 'group': groupSelected(); break;
                        case 'ungroup': ungroupSelected(); break;
                    }
                }
            });
        }

        var imageInput = document.getElementById('imageFileInput');
        if (imageInput) { imageInput.addEventListener('change', handleImageFileSelect); }

        var importBtn = document.getElementById('importJsonBtn');
        var importInput = document.getElementById('importFileInput');
        if (importBtn && importInput) {
            importBtn.addEventListener('click', function() { importInput.click(); });
            importInput.addEventListener('change', function(e) { if (e.target.files[0]) { importREPTFile(e.target.files[0]); e.target.value = ''; } });
        }

        var addSlideBtn = document.getElementById('addSlideBtn');
        if (addSlideBtn) { addSlideBtn.addEventListener('click', addNewSlide); }

        var exitFocusBtn = document.getElementById('exitFocusBtn');
        if (exitFocusBtn) { exitFocusBtn.addEventListener('click', function() { document.body.classList.remove('focus-mode'); }); }

        var effectBtn = document.getElementById('effectBtn');
        var effectModal = document.getElementById('effectModal');
        var closeEffectBtn = document.getElementById('closeEffectModal');
        var applyEffectBtn = document.getElementById('applyEffectBtn');
        if (effectBtn && effectModal) {
            effectBtn.addEventListener('click', function() {
                var obj = getActiveObjectSafe(canvas);
                if (!obj) { alert('Please select an object first.'); return; }
                effectModal.classList.add('active');
            });
        }
        if (closeEffectBtn && effectModal) {
            closeEffectBtn.addEventListener('click', function() { effectModal.classList.remove('active'); });
        }
        if (applyEffectBtn) {
            applyEffectBtn.addEventListener('click', function() {
                var obj = getActiveObjectSafe(canvas);
                if (!obj) { alert('Please select an object.'); return; }
                var effectType = document.getElementById('effectSelect').value;
                var duration = parseInt(document.getElementById('effectDuration').value, 10) || 800;
                var delay = parseInt(document.getElementById('effectDelay').value, 10) || 0;
                var easing = document.getElementById('effectEasing').value;
                var isInfinite = document.querySelector('input[name="timePeriod"]:checked').value === 'infinite';
                var effectData = { type: effectType, duration: duration, delay: delay, easing: easing, infinite: isInfinite };
                setObjectEffect(obj, effectData);
                effectModal.classList.remove('active');
            });
        }

        var previewBtn = document.getElementById('previewModeBtn');
        if (previewBtn) { previewBtn.addEventListener('click', openPreviewMode); }

        buildColorPalette('fillColorGrid', 'fillColorCustom', setFillColor);
        buildColorPalette('bgColorGrid', 'bgColorCustom', setBackgroundColor);
        buildColorPalette('canvasBgGrid', 'canvasBgCustom', setCanvasBgColor);

        setupColorDropdown('fillColorContainer', 'fillColorPicker');
        setupColorDropdown('bgColorContainer', 'bgColorPicker');
        setupColorDropdown('canvasBgContainer', 'canvasBgPicker');

        var fontSizeItems = document.querySelectorAll('[data-fontsize]');
        for (var fi = 0; fi < fontSizeItems.length; fi++) {
            fontSizeItems[fi].addEventListener('click', function() {
                setFontSize(this.dataset.fontsize);
                updateFontSizeCheckmark(parseInt(this.dataset.fontsize));
                document.getElementById('fontSizeContainer').classList.remove('open');
            });
        }

        var lineHeightItems = document.querySelectorAll('[data-lineheight]');
        for (var lh = 0; lh < lineHeightItems.length; lh++) {
            lineHeightItems[lh].addEventListener('click', function() {
                setLineHeight(this.dataset.lineheight);
                updateLineHeightCheckmark(parseFloat(this.dataset.lineheight));
                document.getElementById('lineHeightContainer').classList.remove('open');
            });
        }

        var transformItems = document.querySelectorAll('[data-transform]');
        for (var tr = 0; tr < transformItems.length; tr++) {
            transformItems[tr].addEventListener('click', function() {
                transformText(this.dataset.transform);
                document.getElementById('textTransformContainer').classList.remove('open');
            });
        }

        var dropdowns = document.querySelectorAll('.dropdown-container:not(#fillColorContainer):not(#bgColorContainer):not(#canvasBgContainer)');
        for (var d = 0; d < dropdowns.length; d++) {
            var container = dropdowns[d];
            var btn = container.querySelector('.tool-btn');
            if (btn) {
                btn.addEventListener('click', function(c) {
                    return function(e) {
                        e.stopPropagation();
                        var popups = document.querySelectorAll('.color-picker-popup.show');
                        for (var p = 0; p < popups.length; p++) { popups[p].classList.remove('show'); }
                        c.classList.toggle('open');
                    };
                }(container));
            }
            container.addEventListener('click', function(e) { e.stopPropagation(); });
        }

        document.addEventListener('click', function() {
            var containers = document.querySelectorAll('.dropdown-container.open');
            for (var c = 0; c < containers.length; c++) { containers[c].classList.remove('open'); }
            var popups = document.querySelectorAll('.color-picker-popup.show');
            for (var p = 0; p < popups.length; p++) { popups[p].classList.remove('show'); }
        });

        window.addEventListener('resize', function() {
            if (canvas && container && isInitialized) {
                canvas.setWidth(container.clientWidth);
                canvas.setHeight(container.clientHeight);
                canvas.renderAll();
            }
        });

        window.addEventListener('beforeunload', function(e) {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
                return e.returnValue;
            }
        });
    }

    function setupColorDropdown(containerId, pickerId) {
        var container = document.getElementById(containerId);
        var picker = document.getElementById(pickerId);
        if (!container || !picker) return;
        var btn = container.querySelector('.tool-btn');
        if (!btn) return;
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var popups = document.querySelectorAll('.color-picker-popup.show');
            for (var p = 0; p < popups.length; p++) { if (popups[p] !== picker) popups[p].classList.remove('show'); }
            var containers = document.querySelectorAll('.dropdown-container.open');
            for (var c = 0; c < containers.length; c++) { if (containers[c] !== container) containers[c].classList.remove('open'); }
            picker.classList.toggle('show');
        });
        picker.addEventListener('click', function(e) { e.stopPropagation(); });
    }

    function init() {
        console.log('Initializing Restudio Presentation...');
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
        setupEventListeners();
        setupKeyboardShortcuts();
        updateZoomDisplay();
        updateUndoRedoButtons();
        if (fillColorBtn) fillColorBtn.disabled = true;
        if (bgColorBtn) bgColorBtn.disabled = true;
        console.log('Restudio Presentation initialized successfully');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
