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

// 2. التحقق من صحة الملفات المستوردة (.REPT)
function validateREPTFile(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid file format: Data is not an object');
    }
    
    // التحقق من حجم البيانات (حد أقصى 20 ميجابايت)
    const MAX_FILE_SIZE_MB = 20;
    const jsonString = JSON.stringify(data);
    const sizeInMB = new Blob([jsonString]).size / (1024 * 1024);
    if (sizeInMB > MAX_FILE_SIZE_MB) {
        throw new Error('File too large: ' + sizeInMB.toFixed(2) + 'MB (max ' + MAX_FILE_SIZE_MB + 'MB)');
    }
    
    // التحقق من وجود canvasJSON أو objects
    if (data.canvasJSON) {
        if (typeof data.canvasJSON !== 'object' && typeof data.canvasJSON !== 'string') {
            throw new Error('Invalid canvasJSON format');
        }
        // إذا كان canvasJSON كائنًا، تحقق من وجود objects
        if (typeof data.canvasJSON === 'object' && data.canvasJSON.objects) {
            if (!Array.isArray(data.canvasJSON.objects)) {
                throw new Error('Invalid objects array in canvasJSON');
            }
            // التحقق من صحة كل كائن
            for (let i = 0; i < data.canvasJSON.objects.length; i++) {
                const obj = data.canvasJSON.objects[i];
                if (!obj || typeof obj !== 'object') {
                    throw new Error('Invalid object at index ' + i);
                }
                // تطهير النصوص في الكائنات
                if (obj.type === 'textbox' && obj.text) {
                    if (!isValidText(obj.text)) {
                        throw new Error('Suspicious content detected in text object');
                    }
                    obj.text = sanitizeText(obj.text);
                }
            }
        }
    }
    
    // التحقق من slideName (إذا وجد)
    if (data.slideName && typeof data.slideName === 'string') {
        if (!isValidText(data.slideName)) {
            throw new Error('Suspicious content in slide name');
        }
        data.slideName = sanitizeText(data.slideName);
    }
    
    return true;
}

// 3. التحقق من الحدود (Boundary Checking)
function validateSlideIndex(index, slidesArray) {
    if (!slidesArray || !Array.isArray(slidesArray)) return false;
    if (index < 0 || index >= slidesArray.length) return false;
    return true;
}

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

function getActiveObjectSafe(canvasInstance) {
    if (!validateCanvasAccess(canvasInstance)) return null;
    try {
        return canvasInstance.getActiveObject();
    } catch (err) {
        console.error('Error getting active object:', err);
        return null;
    }
}

function getActiveObjectsSafe(canvasInstance) {
    if (!validateCanvasAccess(canvasInstance)) return [];
    try {
        return canvasInstance.getActiveObjects() || [];
    } catch (err) {
        console.error('Error getting active objects:', err);
        return [];
    }
}

// ========== MAIN APPLICATION ==========

(function() {
    'use strict';
    
    // DOM references
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

    // State
    let slides = [];
    let currentSlideIndex = 0;
    let canvas = null;
    let historyStack = [];
    let historyIndex = -1;
    let zoomLevel = 1;
    let historySaveTimer = null;
    let hasUnsavedChanges = false;
    let isInitialized = false;

    // ============ Slide Management ============
    function markAsChanged() {
        hasUnsavedChanges = true;
    }

    function clearUnsaved() {
        hasUnsavedChanges = false;
    }

    function saveCurrentSlideState() {
        if (!canvas || !isInitialized) return;
        if (slides.length === 0) return;
        try {
            slides[currentSlideIndex].canvasJSON = JSON.stringify(canvas.toJSON(['id', 'effectDef']));
            slides[currentSlideIndex].bgColor = canvas.backgroundColor;
            slides[currentSlideIndex].zoom = zoomLevel;
        } catch (err) {
            console.error('Error saving slide state:', err);
        }
        clearUnsaved();
    }

    function loadSlide(index) {
        if (!validateSlideIndex(index, slides)) return false;
        
        saveCurrentSlideState();
        
        const slide = slides[index];
        currentSlideIndex = index;
        
        try {
            if (slide.canvasJSON) {
                canvas.loadFromJSON(slide.canvasJSON, function() {
                    if (slide.bgColor) {
                        canvas.setBackgroundColor(slide.bgColor, function() {});
                    }
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
        } catch (err) {
            console.error('Error loading slide:', err);
            return false;
        }
        
        renderSlideSidebar();
        updateStyleButtonsState();
        return true;
    }

    function addNewSlide() {
        if (!isInitialized) return;
        saveCurrentSlideState();
        const newSlide = {
            id: Date.now(),
            name: 'Slide ' + (slides.length + 1),
            canvasJSON: null,
            bgColor: '#2b2b2b',
            zoom: 1
        };
        slides.push(newSlide);
        loadSlide(slides.length - 1);
        renderSlideSidebar();
        markAsChanged();
    }

    function deleteSlide(index) {
        if (!validateSlideIndex(index, slides)) return;
        if (slides.length <= 1) {
            alert('Cannot delete last slide.');
            return;
        }
        
        const slideName = slides[index].name || 'Slide ' + (index + 1);
        if (confirm('Delete "' + slideName + '"?')) {
            slides.splice(index, 1);
            if (currentSlideIndex >= slides.length) {
                currentSlideIndex = slides.length - 1;
            }
            loadSlide(currentSlideIndex);
            renderSlideSidebar();
            markAsChanged();
        }
    }

    function renameSlide(index) {
        if (!validateSlideIndex(index, slides)) return;
        const currentName = slides[index].name;
        const newName = prompt('Rename slide:', currentName);
        if (newName && newName.trim() !== '') {
            const sanitized = sanitizeText(newName.trim());
            if (!isValidText(sanitized)) {
                alert('Invalid name detected.');
                return;
            }
            slides[index].name = sanitized;
            renderSlideSidebar();
            markAsChanged();
        }
    }

    function renderSlideSidebar() {
        const div = document.getElementById('slidesList');
        if (!div) return;
        div.innerHTML = '';
        
        slides.forEach(function(slide, idx) {
            const item = document.createElement('div');
            item.className = 'slide-item' + (idx === currentSlideIndex ? ' active' : '');
            
            const infoDiv = document.createElement('div');
            infoDiv.className = 'slide-info';
            const nameSpan = document.createElement('div');
            nameSpan.className = 'slide-name';
            nameSpan.textContent = slide.name || 'Slide ' + (idx + 1);
            const indexSpan = document.createElement('div');
            indexSpan.className = 'slide-index';
            indexSpan.textContent = 'Slide ' + (idx + 1);
            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(indexSpan);
            
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'slide-actions';
            
            const renameBtn = document.createElement('button');
            renameBtn.className = 'rename-slide-btn';
            renameBtn.innerHTML = '<i class="ti ti-edit"></i>';
            renameBtn.title = 'Rename slide';
            renameBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                renameSlide(idx);
            });
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-slide-btn';
            deleteBtn.innerHTML = '<i class="ti ti-trash"></i>';
            deleteBtn.title = 'Delete slide';
            deleteBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                deleteSlide(idx);
            });
            
            actionsDiv.appendChild(renameBtn);
            actionsDiv.appendChild(deleteBtn);
            
            item.appendChild(infoDiv);
            item.appendChild(actionsDiv);
            
            // Click on item loads slide
            item.addEventListener('click', function(e) {
                if (!e.target.closest('.slide-actions')) {
                    loadSlide(idx);
                }
            });
            
            div.appendChild(item);
        });
    }

    // ============ History Management ============
    function resetHistoryFromCurrentCanvas() {
        if (!canvas || !isInitialized) return;
        try {
            const state = JSON.stringify(canvas.toJSON(['id', 'effectDef']));
            historyStack = [state];
            historyIndex = 0;
            updateUndoRedoButtons();
        } catch (err) {
            console.error('Error resetting history:', err);
        }
    }

    function updateUndoRedoButtons() {
        if (undoBtn) undoBtn.disabled = (historyIndex <= 0);
        if (redoBtn) redoBtn.disabled = (historyIndex >= historyStack.length - 1);
    }

    function saveHistoryState() {
        if (!canvas || !isInitialized) return;
        try {
            const state = JSON.stringify(canvas.toJSON(['id', 'effectDef']));
            if (historyStack.length === 0 || historyStack[historyIndex] !== state) {
                historyStack = historyStack.slice(0, historyIndex + 1);
                historyStack.push(state);
                historyIndex++;
                markAsChanged();
                updateUndoRedoButtons();
                saveCurrentSlideState();
            }
        } catch (err) {
            console.error('Error saving history:', err);
        }
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
        } catch (err) {
            console.error('Error loading history state:', err);
        }
    }

    function undo() {
        if (historyIndex > 0 && canvas && isInitialized) {
            historyIndex--;
            loadHistoryState();
        }
    }

    function redo() {
        if (historyIndex < historyStack.length - 1 && canvas && isInitialized) {
            historyIndex++;
            loadHistoryState();
        }
    }

    // ============ Canvas Initialization ============
    function initCanvas() {
        if (!container) {
            console.error('Container not found');
            return;
        }

        const existingCanvas = document.getElementById('fabric-canvas');
        if (existingCanvas) existingCanvas.remove();

        const newCanvasElem = document.createElement('canvas');
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

            // Remove old listeners to prevent memory leaks
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

    // ============ Style Buttons State ============
    function isImage(obj) {
        return obj && obj.type === 'image';
    }

    function updateStyleButtonsState() {
        if (!canvas || !isInitialized) return;
        
        const activeObj = getActiveObjectSafe(canvas);
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

        const img = isImage(activeObj);

        if (activeObj.type === 'textbox') {
            if (boldBtn) boldBtn.classList.toggle('active', activeObj.fontWeight === 'bold');
            if (italicBtn) italicBtn.classList.toggle('active', activeObj.fontStyle === 'italic');
            if (underlineBtn) underlineBtn.classList.toggle('active', !!activeObj.underline);
            
            const align = activeObj.textAlign || 'left';
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
        const items = document.querySelectorAll('#fontSizeMenu .dropdown-item');
        items.forEach(function(item) {
            const check = item.querySelector('.check-icon');
            if (check) {
                const size = parseInt(item.dataset.fontsize);
                check.style.display = (fontSize && size === fontSize) ? 'inline' : 'none';
            }
        });
    }

    function updateLineHeightCheckmark(lineHeight) {
        const items = document.querySelectorAll('#lineHeightMenu .dropdown-item');
        items.forEach(function(item) {
            const check = item.querySelector('.check-icon');
            if (check) {
                const val = parseFloat(item.dataset.lineheight);
                check.style.display = (lineHeight && Math.abs(val - lineHeight) < 0.01) ? 'inline' : 'none';
            }
        });
    }

    // ============ Color Palette ============
    const presetColors = [
        '#ffffff', '#000000', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71',
        '#1abc9c', '#3498db', '#9b59b6', '#ecf0f1', '#c0392b', '#2980b9',
        '#8e44ad', '#2c3e50', '#16a085', '#27ae60', '#f39c12', '#d35400',
        '#7f8c8d', '#bdc3c7', '#34495e', '#95a5a6'
    ];

    function buildColorPalette(gridId, customInputId, callback) {
        const grid = document.getElementById(gridId);
        if (!grid) return;
        
        grid.innerHTML = '';
        
        presetColors.forEach(function(color) {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch';
            swatch.style.backgroundColor = color;
            swatch.addEventListener('click', function(e) {
                e.stopPropagation();
                callback(color);
                const customInput = document.getElementById(customInputId);
                if (customInput) customInput.value = color;
                const popup = grid.closest('.color-picker-popup');
                if (popup) popup.classList.remove('show');
            });
            grid.appendChild(swatch);
        });
        
        const customInput = document.getElementById(customInputId);
        if (customInput) {
            customInput.addEventListener('input', function(e) {
                callback(e.target.value);
            });
        }
    }

    // ============ Canvas Operations ============
    function addTextBox() {
        if (!canvas || !isInitialized) return;
        const textbox = new fabric.Textbox('New Text', {
            left: 100,
            top: 100,
            width: 200,
            fontSize: 24,
            fill: '#ffffff',
            fontFamily: 'Segoe UI',
            hasControls: true,
            hasBorders: true,
            selectable: true,
            evented: true,
            hoverCursor: 'pointer',
            moveCursor: 'move',
            perPixelTargetFind: true
        });
        canvas.add(textbox);
        canvas.setActiveObject(textbox);
        canvas.renderAll();
        scheduleHistorySave();
    }

    function addRectangle() {
        if (!canvas || !isInitialized) return;
        const rect = new fabric.Rect({
            left: 150,
            top: 150,
            width: 120,
            height: 80,
            fill: '#3498db',
            stroke: '#ffffff',
            strokeWidth: 2,
            selectable: true,
            evented: true,
            hoverCursor: 'pointer',
            moveCursor: 'move',
            perPixelTargetFind: true
        });
        canvas.add(rect);
        canvas.setActiveObject(rect);
        canvas.renderAll();
        scheduleHistorySave();
    }

    function addCircle() {
        if (!canvas || !isInitialized) return;
        const circle = new fabric.Circle({
            left: 200,
            top: 200,
            radius: 50,
            fill: '#e67e22',
            stroke: '#fff',
            strokeWidth: 2,
            selectable: true,
            evented: true,
            hoverCursor: 'pointer',
            moveCursor: 'move',
            perPixelTargetFind: true
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
        if (!canvas || !isInitialized) return;
        const text = prompt('Enter text or URL for the QR code:', 'https://restudio.com');
        if (!text || !text.trim()) return;
        
        const sanitizedText = sanitizeText(text.trim());
        if (!isValidText(sanitizedText)) {
            alert('Invalid text detected. Please enter a valid URL or text.');
            return;
        }
        
        const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(sanitizedText);
        fabric.Image.fromURL(qrUrl, function(img) {
            if (!canvas || !isInitialized) return;
            img.set({
                left: (canvas.width - img.width * img.scaleX) / 2,
                top: (canvas.height - img.height * img.scaleY) / 2,
                selectable: true,
                evented: true,
                hoverCursor: 'pointer',
                moveCursor: 'move',
                perPixelTargetFind: true
            });
            canvas.add(img);
            canvas.setActiveObject(img);
            canvas.renderAll();
            scheduleHistorySave();
        }, { crossOrigin: 'anonymous' });
    }

    function handleImageFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        if (!file.type.startsWith('image/')) {
            alert('Please select a valid image file.');
            event.target.value = '';
            return;
        }
        
        const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
        if (file.size > MAX_IMAGE_SIZE) {
            alert('Image file too large: ' + (file.size / 1024 / 1024).toFixed(2) + 'MB (max 10MB)');
            event.target.value = '';
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            if (!canvas || !isInitialized) return;
            fabric.Image.fromURL(e.target.result, function(img) {
                if (!canvas || !isInitialized) return;
                const maxWidth = canvas.width * 0.6;
                const maxHeight = canvas.height * 0.6;
                if (img.width > maxWidth || img.height > maxHeight) {
                    const scale = Math.min(maxWidth / img.width, maxHeight / img.height);
                    img.scale(scale);
                } else {
                    img.scale(1);
                }
                img.set({
                    left: (canvas.width - img.width * img.scaleX) / 2,
                    top: (canvas.height - img.height * img.scaleY) / 2,
                    selectable: true,
                    evented: true,
                    hoverCursor: 'pointer',
                    moveCursor: 'move',
                    perPixelTargetFind: true
                });
                canvas.add(img);
                canvas.setActiveObject(img);
                canvas.renderAll();
                scheduleHistorySave();
            }, { crossOrigin: 'anonymous' });
        };
        reader.onerror = function() {
            alert('Failed to load image file.');
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    }

    function deleteSelected() {
        if (!canvas || !isInitialized) return;
        const active = canvas.getActiveObjects();
        if (active.length > 0) {
            active.forEach(function(obj) {
                canvas.remove(obj);
            });
            canvas.discardActiveObject();
            canvas.renderAll();
            scheduleHistorySave();
        }
    }

    function bringForward() {
        if (!canvas || !isInitialized) return;
        const obj = getActiveObjectSafe(canvas);
        if (obj) {
            canvas.bringForward(obj);
            canvas.renderAll();
            scheduleHistorySave();
        }
    }

    function sendBackward() {
        if (!canvas || !isInitialized) return;
        const obj = getActiveObjectSafe(canvas);
        if (obj) {
            canvas.sendBackwards(obj);
            canvas.renderAll();
            scheduleHistorySave();
        }
    }

    function applyToSelected(callback) {
        if (!canvas || !isInitialized) return;
        const actives = canvas.getActiveObjects();
        if (actives.length > 0) {
            actives.forEach(function(obj) {
                callback(obj);
            });
            canvas.renderAll();
            scheduleHistorySave();
            updateStyleButtonsState();
        }
    }

    function setBold() {
        applyToSelected(function(obj) {
            if (obj.type === 'textbox') {
                obj.fontWeight = (obj.fontWeight === 'bold') ? 'normal' : 'bold';
            }
        });
    }

    function setItalic() {
        applyToSelected(function(obj) {
            if (obj.type === 'textbox') {
                obj.fontStyle = (obj.fontStyle === 'italic') ? 'normal' : 'italic';
            }
        });
    }

    function setUnderline() {
        applyToSelected(function(obj) {
            if (obj.type === 'textbox') {
                obj.underline = !obj.underline;
            }
        });
    }

    function setFontSize(size) {
        applyToSelected(function(obj) {
            if (obj.fontSize !== undefined) {
                obj.fontSize = parseInt(size);
            }
        });
        const container = document.getElementById('fontSizeContainer');
        if (container) container.classList.remove('open');
    }

    function setLineHeight(height) {
        applyToSelected(function(obj) {
            if (obj.lineHeight !== undefined) {
                obj.lineHeight = parseFloat(height);
            }
        });
        const container = document.getElementById('lineHeightContainer');
        if (container) container.classList.remove('open');
    }

    function setFillColor(color) {
        applyToSelected(function(obj) {
            if (obj.type !== 'image') {
                obj.set('fill', color);
            }
        });
    }

    function setBackgroundColor(color) {
        applyToSelected(function(obj) {
            if (obj.type === 'textbox') {
                obj.set('backgroundColor', color);
            }
        });
    }

    function setTextAlign(align) {
        applyToSelected(function(obj) {
            if (obj.textAlign !== undefined) {
                obj.textAlign = align;
            }
        });
    }

    function setCanvasBgColor(color) {
        if (!canvas || !isInitialized) return;
        canvas.setBackgroundColor(color, function() {
            canvas.renderAll();
        });
        scheduleHistorySave();
    }

    function increaseIndent() {
        applyToSelected(function(obj) {
            if (obj.type === 'textbox') {
                obj.text = '    ' + obj.text;
            }
        });
    }

    function decreaseIndent() {
        applyToSelected(function(obj) {
            if (obj.type === 'textbox') {
                const trimmed = obj.text.replace(/^ {1,4}/, '');
                obj.text = trimmed;
            }
        });
    }

    function transformText(type) {
        applyToSelected(function(obj) {
            if (obj.type === 'textbox') {
                switch (type) {
                    case 'uppercase':
                        obj.text = obj.text.toUpperCase();
                        break;
                    case 'lowercase':
                        obj.text = obj.text.toLowerCase();
                        break;
                    case 'capitalize':
                        obj.text = obj.text.replace(/\b\w/g, function(c) {
                            return c.toUpperCase();
                        });
                        break;
                }
            }
        });
        const container = document.getElementById('textTransformContainer');
        if (container) container.classList.remove('open');
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
        if (!canvas || !isInitialized) return;
        const objs = canvas.getActiveObjects();
        if (objs.length < 2) {
            alert('Select at least 2 objects.');
            return;
        }
        canvas.getActiveObject().toGroup();
        canvas.renderAll();
        scheduleHistorySave();
        updateStyleButtonsState();
    }

    function ungroupSelected() {
        if (!canvas || !isInitialized) return;
        const obj = getActiveObjectSafe(canvas);
        if (!obj || obj.type !== 'group') {
            alert('Select a group.');
            return;
        }
        obj.toActiveSelection();
        canvas.renderAll();
        scheduleHistorySave();
        updateStyleButtonsState();
    }

    // ============ Effect Engine ============
    const easingMap = {
        easeOutCubic: fabric.util.ease.easeOutCubic,
        easeOutBounce: fabric.util.ease.easeOutBounce,
        easeInOutQuad: fabric.util.ease.easeInOutQuad,
        linear: fabric.util.ease.linear
    };

    function applyEffectToObject(obj, effect, duration, delay, easingName, isInfinite) {
        if (!obj) return;
        const easingFn = easingMap[easingName] || fabric.util.ease.easeOutCubic;
        let completed = false;
        
        function runAnimation(callback) {
            const originalLeft = obj.left;
            const originalTop = obj.top;
            const originalScaleX = obj.scaleX;
            const originalScaleY = obj.scaleY;
            const originalAngle = obj.angle;
            const originalOpacity = obj.opacity !== undefined ? obj.opacity : 1;
            let targetProps = {};
            
            switch(effect) {
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
        
        if (delay > 0) {
            setTimeout(startLoop, delay);
        } else {
            startLoop();
        }
    }

    function setObjectEffect(obj, effectData) {
        obj.effectDef = { ...effectData };
        applyEffectToObject(obj, effectData.type, effectData.duration, effectData.delay, effectData.easing, effectData.infinite);
        scheduleHistorySave();
    }

    // ============ Export / Import ============
    function exportCurrentSlide() {
        if (!canvas || !isInitialized || slides.length === 0) return;
        saveCurrentSlideState();
        const slide = slides[currentSlideIndex];
        const exportObj = {
            version: '1.0',
            slideName: slide.name,
            canvasJSON: slide.canvasJSON ? JSON.parse(slide.canvasJSON) : canvas.toJSON(['id', 'effectDef']),
            bgColor: canvas.backgroundColor,
            zoom: zoomLevel
        };
        try {
            const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'slide_' + (slide.name || 'slide' + (currentSlideIndex + 1)).replace(/\s/g, '_') + '.rept';
            a.click();
            URL.revokeObjectURL(a.href);
            clearUnsaved();
        } catch (err) {
            alert('Error exporting: ' + err.message);
        }
    }

    function importREPTFile(file) {
        if (!canvas || !isInitialized) return;
        if (hasUnsavedChanges && !confirm('Replace current slide?')) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const imported = JSON.parse(e.target.result);
                
                // Validate imported file
                validateREPTFile(imported);
                
                const jsonToLoad = imported.canvasJSON || imported;
                canvas.loadFromJSON(jsonToLoad, function() {
                    if (imported.bgColor) {
                        canvas.setBackgroundColor(imported.bgColor, function() {});
                    }
                    canvas.renderAll();
                    zoomLevel = imported.zoom || 1;
                    canvas.setZoom(zoomLevel);
                    updateZoomDisplay();
                    resetHistoryFromCurrentCanvas();
                    slides[currentSlideIndex].canvasJSON = JSON.stringify(canvas.toJSON(['id', 'effectDef']));
                    slides[currentSlideIndex].bgColor = canvas.backgroundColor;
                    slides[currentSlideIndex].zoom = zoomLevel;
                    if (imported.slideName) {
                        const sanitizedName = sanitizeText(imported.slideName);
                        if (isValidText(sanitizedName)) {
                            slides[currentSlideIndex].name = sanitizedName;
                        }
                    }
                    renderSlideSidebar();
                    saveCurrentSlideState();
                    clearUnsaved();
                });
            } catch (err) {
                alert('Import failed: ' + err.message);
            }
        };
        reader.onerror = function() {
            alert('Error reading file.');
        };
        reader.readAsText(file);
    }

    // ============ Preview Mode ============
    function openPreviewMode() {
        saveCurrentSlideState();
        const slidesData = slides.map(function(slide) {
            return {
                name: slide.name,
                canvasJSON: slide.canvasJSON ? JSON.parse(slide.canvasJSON) : null,
                bgColor: slide.bgColor
            };
        });
        const currentIdx = currentSlideIndex;
        const win = window.open();
        if (!win) {
            alert('Popup blocked. Please allow popups.');
            return;
        }
        
        win.document.write('<!DOCTYPE html><html><head><title>Presentation Preview</title>');
        win.document.write('<script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js"><\/script>');
        win.document.write('<style>body{margin:0;overflow:hidden;background:#1e1e1e;font-family:"Segoe UI",sans-serif;}');
        win.document.write('.preview-container{position:relative;width:100vw;height:100vh;display:flex;justify-content:center;align-items:center;background:#000;}');
        win.document.write('canvas{box-shadow:0 0 0 1px #3c3c3c;max-width:90vw;max-height:90vh;}');
        win.document.write('.nav-controls{position:fixed;bottom:20px;left:0;right:0;text-align:center;background:rgba(0,0,0,0.7);padding:10px;color:white;z-index:100;}');
        win.document.write('button{background:#007acc;border:none;color:white;padding:8px 16px;margin:0 8px;border-radius:8px;cursor:pointer;font-size:16px;}');
        win.document.write('.slide-counter{margin:0 16px;font-size:16px;}');
        win.document.write('.instruction{position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.5);padding:5px 10px;border-radius:8px;font-size:12px;}');
        win.document.write('<\/style><\/head><body>');
        win.document.write('<div class="preview-container"><canvas id="previewCanvas" width="900" height="600"></canvas></div>');
        win.document.write('<div class="nav-controls"><button id="prevBtn">◀ Previous</button><span class="slide-counter" id="slideCounter">Slide 1 / 1</span><button id="nextBtn">Next ▶</button></div>');
        win.document.write('<div class="instruction">← → keys | ESC to close</div>');
        win.document.write('<script>');
        win.document.write('const slidesData = ' + JSON.stringify(slidesData) + ';');
        win.document.write('let currentIdx = ' + currentIdx + ';');
        win.document.write('let canvas; let activeTimeouts = [];');
        win.document.write('function clearEffects(){ activeTimeouts.forEach(t=>clearTimeout(t)); activeTimeouts=[]; }');
        win.document.write('function applyObjectEffect(obj, effectDef){ if(!obj||!effectDef) return;');
        win.document.write('const easingMap={easeOutCubic:fabric.util.ease.easeOutCubic,easeOutBounce:fabric.util.ease.easeOutBounce,easeInOutQuad:fabric.util.ease.easeInOutQuad,linear:fabric.util.ease.linear};');
        win.document.write('const easing=easingMap[effectDef.easing]||easingMap.easeOutCubic;');
        win.document.write('const duration=effectDef.duration, delay=effectDef.delay, effect=effectDef.type, isInfinite=effectDef.infinite===true;');
        win.document.write('function animateOnce(cb){ const origL=obj.left, origT=obj.top, origSX=obj.scaleX, origSY=obj.scaleY, origAng=obj.angle, origOp=obj.opacity||1; let target={};');
        win.document.write('if(effect==="fadeIn"){ obj.set("opacity",0); target={opacity:origOp}; }');
        win.document.write('else if(effect==="slideInLeft"){ obj.set("left",origL-300); target={left:origL}; }');
        win.document.write('else if(effect==="slideInRight"){ obj.set("left",origL+300); target={left:origL}; }');
        win.document.write('else if(effect==="slideInUp"){ obj.set("top",origT+200); target={top:origT}; }');
        win.document.write('else if(effect==="slideInDown"){ obj.set("top",origT-200); target={top:origT}; }');
        win.document.write('else if(effect==="zoomIn"){ obj.set("scaleX",0.1); obj.set("scaleY",0.1); target={scaleX:origSX, scaleY:origSY}; }');
        win.document.write('else if(effect==="bounce"){ obj.set("scaleX",0.8); obj.set("scaleY",0.8); target={scaleX:origSX, scaleY:origSY}; }');
        win.document.write('else if(effect==="flipX"){ obj.set("scaleX",-origSX); target={scaleX:origSX}; }');
        win.document.write('else if(effect==="flipY"){ obj.set("scaleY",-origSY); target={scaleY:origSY}; }');
        win.document.write('else if(effect==="rotateIn"){ obj.set("angle",-45); target={angle:origAng}; }');
        win.document.write('else { if(cb) cb(); return; } canvas.renderAll(); obj.animate(target,{duration,easing,onChange:canvas.renderAll.bind(canvas),onComplete:function(){ if(effect==="flipX") obj.set("scaleX",origSX); if(effect==="flipY") obj.set("scaleY",origSY); canvas.renderAll(); if(cb) cb(); }}); }');
        win.document.write('function startLoop(){ animateOnce(function(){ if(isInfinite){ const t=setTimeout(startLoop, delay+duration+100); activeTimeouts.push(t); } }); }');
        win.document.write('if(delay>0){ const t=setTimeout(startLoop, delay); activeTimeouts.push(t); } else startLoop(); }');
        win.document.write('function loadSlide(index){ clearEffects(); const slide=slidesData[index]; if(slide&&slide.canvasJSON) canvas.loadFromJSON(slide.canvasJSON,function(){ if(slide.bgColor) canvas.setBackgroundColor(slide.bgColor,function(){canvas.renderAll();}); canvas.renderAll(); canvas.getObjects().forEach(function(obj){ if(obj.effectDef) applyObjectEffect(obj, obj.effectDef); }); }); else { canvas.clear(); if(slide&&slide.bgColor) canvas.setBackgroundColor(slide.bgColor,function(){canvas.renderAll();}); else canvas.setBackgroundColor("#2b2b2b",function(){canvas.renderAll();}); canvas.renderAll(); } document.getElementById("slideCounter").innerText="Slide "+(index+1)+" / "+slidesData.length; }');
        win.document.write('function initPreview(){ const canvasElem=document.getElementById("previewCanvas"); canvas=new fabric.Canvas("previewCanvas",{selection:false,preserveObjectStacking:true}); canvas.setWidth(900); canvas.setHeight(600); loadSlide(currentIdx); }');
        win.document.write('function nextSlide(){ if(currentIdx<slidesData.length-1){ currentIdx++; loadSlide(currentIdx); } }');
        win.document.write('function prevSlide(){ if(currentIdx>0){ currentIdx--; loadSlide(currentIdx); } }');
        win.document.write('document.getElementById("prevBtn").addEventListener("click", prevSlide); document.getElementById("nextBtn").addEventListener("click", nextSlide);');
        win.document.write('window.addEventListener("keydown", function(e){ if(e.key==="ArrowLeft") prevSlide(); else if(e.key==="ArrowRight") nextSlide(); else if(e.key==="Escape") window.close(); });');
        win.document.write('initPreview();<\/script>');
        win.document.write('<\/body><\/html>');
        win.document.close();
    }

    // ============ Dropdown Helpers ============
    function setupColorDropdown(containerId, pickerId) {
        const container = document.getElementById(containerId);
        const picker = document.getElementById(pickerId);
        if (!container || !picker) return;
        const btn = container.querySelector('.tool-btn');
        if (!btn) return;
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            document.querySelectorAll('.color-picker-popup.show').forEach(function(p) {
                if (p !== picker) p.classList.remove('show');
            });
            document.querySelectorAll('.dropdown-container.open').forEach(function(d) {
                if (d !== container) d.classList.remove('open');
            });
            picker.classList.toggle('show');
        });
        picker.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }

    // ============ Event Listeners ============
    function setupEventListeners() {
        // Toolbar actions
        const toolbar = document.getElementById('toolbar');
        if (toolbar) {
            toolbar.addEventListener('click', function(e) {
                const btn = e.target.closest('.tool-btn');
                if (!btn || btn.closest('.dropdown-container')) return;
                const action = btn.dataset.action;
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

        // Image file input
        const imageInput = document.getElementById('imageFileInput');
        if (imageInput) {
            imageInput.addEventListener('change', handleImageFileSelect);
        }

        // Import
        const importBtn = document.getElementById('importJsonBtn');
        const importInput = document.getElementById('importFileInput');
        if (importBtn && importInput) {
            importBtn.addEventListener('click', function() {
                importInput.click();
            });
            importInput.addEventListener('change', function(e) {
                if (e.target.files[0]) {
                    importREPTFile(e.target.files[0]);
                    e.target.value = '';
                }
            });
        }

        // Add slide button
        const addSlideBtn = document.getElementById('addSlideBtn');
        if (addSlideBtn) {
            addSlideBtn.addEventListener('click', addNewSlide);
        }

        // Exit focus
        const exitFocusBtn = document.getElementById('exitFocusBtn');
        if (exitFocusBtn) {
            exitFocusBtn.addEventListener('click', function() {
                document.body.classList.remove('focus-mode');
            });
        }

        // Effect modal
        const effectBtn = document.getElementById('effectBtn');
        const effectModal = document.getElementById('effectModal');
        const closeEffectBtn = document.getElementById('closeEffectModal');
        const applyEffectBtn = document.getElementById('applyEffectBtn');
        
        if (effectBtn && effectModal) {
            effectBtn.addEventListener('click', function() {
                if (!canvas.getActiveObject()) {
                    alert('Please select an object first.');
                    return;
                }
                effectModal.classList.add('active');
            });
        }
        if (closeEffectBtn && effectModal) {
            closeEffectBtn.addEventListener('click', function() {
                effectModal.classList.remove('active');
            });
        }
        if (applyEffectBtn) {
            applyEffectBtn.addEventListener('click', function() {
                const obj = getActiveObjectSafe(canvas);
                if (!obj) {
                    alert('Please select an object.');
                    return;
                }
                const effectType = document.getElementById('effectSelect').value;
                const duration = parseInt(document.getElementById('effectDuration').value, 10) || 800;
                const delay = parseInt(document.getElementById('effectDelay').value, 10) || 0;
                const easing = document.getElementById('effectEasing').value;
                const isInfinite = document.querySelector('input[name="timePeriod"]:checked').value === 'infinite';
                const effectData = { type: effectType, duration: duration, delay: delay, easing: easing, infinite: isInfinite };
                setObjectEffect(obj, effectData);
                effectModal.classList.remove('active');
            });
        }

        // Preview mode
        const previewBtn = document.getElementById('previewModeBtn');
        if (previewBtn) {
            previewBtn.addEventListener('click', openPreviewMode);
        }

        // Font size items
        document.querySelectorAll('[data-fontsize]').forEach(function(item) {
            item.addEventListener('click', function() {
                setFontSize(this.dataset.fontsize);
                updateFontSizeCheckmark(parseInt(this.dataset.fontsize));
                document.getElementById('fontSizeContainer').classList.remove('open');
            });
        });

        // Line height items
        document.querySelectorAll('[data-lineheight]').forEach(function(item) {
            item.addEventListener('click', function() {
                setLineHeight(this.dataset.lineheight);
                updateLineHeightCheckmark(parseFloat(this.dataset.lineheight));
                document.getElementById('lineHeightContainer').classList.remove('open');
            });
        });

        // Text transform items
        document.querySelectorAll('[data-transform]').forEach(function(item) {
            item.addEventListener('click', function() {
                transformText(this.dataset.transform);
                document.getElementById('textTransformContainer').classList.remove('open');
            });
        });

        // Color pickers
        buildColorPalette('fillColorGrid', 'fillColorCustom', setFillColor);
        buildColorPalette('bgColorGrid', 'bgColorCustom', setBackgroundColor);
        buildColorPalette('canvasBgGrid', 'canvasBgCustom', setCanvasBgColor);

        setupColorDropdown('fillColorContainer', 'fillColorPicker');
        setupColorDropdown('bgColorContainer', 'bgColorPicker');
        setupColorDropdown('canvasBgContainer', 'canvasBgPicker');

        // Regular dropdowns
        document.querySelectorAll(
            '.dropdown-container:not(#fillColorContainer):not(#bgColorContainer):not(#canvasBgContainer)'
        ).forEach(function(container) {
            const btn = container.querySelector('.tool-btn');
            if (btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    document.querySelectorAll('.color-picker-popup.show').forEach(function(p) {
                        p.classList.remove('show');
                    });
                    container.classList.toggle('open');
                });
            }
            container.addEventListener('click', function(e) {
                e.stopPropagation();
            });
        });

        // Global click close
        document.addEventListener('click', function() {
            document.querySelectorAll('.dropdown-container.open').forEach(function(c) {
                c.classList.remove('open');
            });
            document.querySelectorAll('.color-picker-popup.show').forEach(function(p) {
                p.classList.remove('show');
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) {
                document.body.classList.remove('focus-mode');
            }
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                undo();
            }
            if (e.ctrlKey && e.key === 'y') {
                e.preventDefault();
                redo();
            }
            if (e.key === 'Delete' && !e.ctrlKey && !e.altKey && document.activeElement === document.body) {
                e.preventDefault();
                deleteSelected();
            }
        });

        // Window resize
        window.addEventListener('resize', function() {
            if (canvas && container && isInitialized) {
                canvas.setWidth(container.clientWidth);
                canvas.setHeight(container.clientHeight);
                canvas.renderAll();
            }
        });

        // Before unload
        window.addEventListener('beforeunload', function(e) {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
                return e.returnValue;
            }
        });
    }

    // ============ Initialize ============
    function init() {
        console.log('Initializing Restudio Presentation...');
        
        // Initialize slides
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
        updateZoomDisplay();
        updateUndoRedoButtons();
        
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
