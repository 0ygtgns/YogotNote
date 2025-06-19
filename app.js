document.addEventListener('DOMContentLoaded', () => {

    // ----- HTML ELEMENTLERİ VE STATE ----- //
    const canvas = document.getElementById('canvas');
    const addNodeBtn = document.getElementById('addNodeBtn');
    const connectModeBtn = document.getElementById('connectModeBtn');
    const resetBtn = document.getElementById('resetBtn');
    const themeToggle = document.getElementById('themeToggle');
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const importFile = document.getElementById('importFile');
    const minimap = document.getElementById('minimap');
    const minimapViewport = document.getElementById('minimap-viewport');

    const canvasWrapper = document.createElement('div');
    canvasWrapper.id = 'canvas-wrapper';
    canvas.appendChild(canvasWrapper);

    let state = {
        nodes: [],
        connections: [],
        nodeIdCounter: 0,
        isConnectMode: false,
        firstNodeForConnection: null,
        multiSelectedNodes: new Set(),
        pan: { x: 0, y: 0 },
        zoom: 1,
    };
    
    // Canlı ve modern renk paleti
    const COLORS = ["#f8f9fa", "#ffadad", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#a0c4ff", "#bdb2ff", "#ffc6ff"];
    let isMinimapThrottled = false;

    // ----- OLAY DİNLEYİCİLERİ ----- //
    
    themeToggle.addEventListener('change', () => {
        document.body.classList.toggle('dark-mode', themeToggle.checked);
        saveState();
    });

    addNodeBtn.addEventListener('click', () => {
        const viewCenterX = (window.innerWidth / 2 - state.pan.x) / state.zoom;
        const viewCenterY = (window.innerHeight / 2 - state.pan.y) / state.zoom;
        createNode(viewCenterX, viewCenterY, `Node ${state.nodeIdCounter + 1}`, 'Click to edit...', COLORS[0]);
        saveState();
    });

    connectModeBtn.addEventListener('click', () => {
        state.isConnectMode = !state.isConnectMode;
        connectModeBtn.classList.toggle('active', state.isConnectMode);
        if (!state.isConnectMode && state.firstNodeForConnection) {
            state.firstNodeForConnection.element.classList.remove('selected');
            state.firstNodeForConnection = null;
        }
        clearMultiSelect();
    });

    resetBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset everything? This will delete all your nodes and connections.')) {
            resetCanvas();
        }
    });

    exportBtn.addEventListener('click', exportState);
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', importState);
    
    document.addEventListener('keydown', e => { if (e.key === 'Shift') canvas.classList.add('shift-pressed'); });
    document.addEventListener('keyup', e => { if (e.key === 'Shift') canvas.classList.remove('shift-pressed'); });

    canvas.addEventListener('mousedown', handleCanvasMouseDown);
    canvas.addEventListener('wheel', handleZoom);


    // ----- ANA FONKSİYONLAR ----- //

    function createNode(x, y, title, content, color, id = null) {
        if (!id) {
            state.nodeIdCounter++;
            id = `node-${state.nodeIdCounter}`;
        } else {
             state.nodeIdCounter = Math.max(state.nodeIdCounter, parseInt(id.split('-')[1]));
        }

        const nodeElement = document.createElement('div');
        nodeElement.id = id;
        nodeElement.classList.add('node');
        nodeElement.style.left = `${x}px`;
        nodeElement.style.top = `${y}px`;

        const colorSwatchesHTML = COLORS.map(c => 
            `<div class="color-swatch ${c === color ? 'selected' : ''}" data-color="${c}" style="background-color:${c};"></div>`
        ).join('');

        nodeElement.innerHTML = `
            <div class="node-header" spellcheck="false">${title}</div>
            <div class="node-content" contenteditable="true" spellcheck="false">${content}</div>
            <div class="node-footer">${colorSwatchesHTML}</div>
            <div class="node-delete-btn">×</div>
        `;

        nodeElement.querySelector('.node-header').contentEditable = true;
        canvasWrapper.appendChild(nodeElement);
        const nodeObject = { id, element: nodeElement, connections: [] };
        state.nodes.push(nodeObject);

        // Olay Yönetimi
        nodeElement.addEventListener('mousedown', (e) => handleNodeMouseDown(e, nodeObject));
        nodeElement.querySelector('.node-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteNode(nodeObject);
        });
        nodeElement.querySelectorAll('[contenteditable]').forEach(el => el.addEventListener('blur', saveState));
        nodeElement.querySelectorAll('.color-swatch').forEach(swatch => {
            swatch.addEventListener('click', (e) => {
                e.stopPropagation();
                const newColor = swatch.dataset.color;
                nodeElement.querySelector('.node-header').style.backgroundColor = newColor;
                nodeElement.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
                swatch.classList.add('selected');
                saveState();
            });
        });

        updateMinimap();
        return nodeObject;
    }
    
    function handleNodeMouseDown(e, nodeObject) {
        e.stopPropagation();
        if (e.button !== 0) return;

        if (state.isConnectMode) {
            handleNodeClickForConnection(nodeObject);
            return;
        }

        const isHeader = e.target.closest('.node-header');
        
        if (canvas.classList.contains('shift-pressed')) {
            toggleMultiSelect(nodeObject);
        } else {
            if (!state.multiSelectedNodes.has(nodeObject)) {
                clearMultiSelect();
                state.multiSelectedNodes.add(nodeObject);
                nodeObject.element.classList.add('multi-selected');
            }
        }
        
        if (isHeader) {
            initializeDrag(e);
        }
    }

    function handleCanvasMouseDown(e) {
        // Sol tık alan seçimi, orta/sağ tık kaydırma yapar
        if (e.target === canvas || e.target === canvasWrapper) {
            if (e.button === 0) { // Sol tık
                 startAreaSelection(e);
            } else if (e.button === 1 || e.button === 2) { // Orta veya Sağ tık
                 e.preventDefault();
                 startPan(e);
            }
        }
    }
    
    // ----- SEÇİM VE HAREKET FONKSİYONLARI ----- //
    
    function initializeDrag(initialEvent) {
        let dragStarted = false;
        let lastMouse = { x: initialEvent.clientX, y: initialEvent.clientY };
        
        const selectionPreventer = (e) => e.preventDefault();

        function onMouseMove(e) {
            e.preventDefault();
            if (!dragStarted) {
                const dx = Math.abs(e.clientX - lastMouse.x);
                const dy = Math.abs(e.clientY - lastMouse.y);
                if (dx > 3 || dy > 3) {
                    dragStarted = true;
                    state.multiSelectedNodes.forEach(n => n.element.style.zIndex = 100);
                    document.addEventListener('selectstart', selectionPreventer);
                }
            }
            if (dragStarted) {
                const dx = (e.clientX - lastMouse.x) / state.zoom;
                const dy = (e.clientY - lastMouse.y) / state.zoom;
                state.multiSelectedNodes.forEach(selectedNode => {
                    selectedNode.element.style.left = `${selectedNode.element.offsetLeft + dx}px`;
                    selectedNode.element.style.top = `${selectedNode.element.offsetTop + dy}px`;
                    updateConnections(selectedNode);
                });
            }
            lastMouse = { x: e.clientX, y: e.clientY };
        }
        function onMouseUp() {
            state.multiSelectedNodes.forEach(n => n.element.style.zIndex = 10);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.removeEventListener('selectstart', selectionPreventer);
            if (dragStarted) {
                saveState();
            }
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }
    
    function startPan(e) {
        let lastMousePos = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
        function onMouseMove(e) {
            const dx = e.clientX - lastMousePos.x;
            const dy = e.clientY - lastMousePos.y;
            state.pan.x += dx;
            state.pan.y += dy;
            lastMousePos = { x: e.clientX, y: e.clientY };
            updateCanvasTransform();
        }
        function onMouseUp() {
            canvas.style.cursor = 'grab';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            saveState();
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }
    
    function startAreaSelection(initialEvent) {
        const downPos = { x: initialEvent.clientX, y: initialEvent.clientY };
        let boxDrawn = false;
        let selectionBox = null;

        function onMouseMove(e) {
            const dx = Math.abs(e.clientX - downPos.x);
            const dy = Math.abs(e.clientY - downPos.y);

            if (!boxDrawn && (dx > 3 || dy > 3)) {
                boxDrawn = true;
                selectionBox = document.createElement('div');
                selectionBox.id = 'selection-box';
                document.body.appendChild(selectionBox);
            }

            if (boxDrawn) {
                const { left, top, width, height } = {
                    left: Math.min(downPos.x, e.clientX), top: Math.min(downPos.y, e.clientY),
                    width: Math.abs(downPos.x - e.clientX), height: Math.abs(downPos.y - e.clientY),
                };
                Object.assign(selectionBox.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
            }
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            
            if (boxDrawn && selectionBox) {
                const boxRect = selectionBox.getBoundingClientRect();
                clearMultiSelect();
                state.nodes.forEach(node => {
                    const nodeRect = node.element.getBoundingClientRect();
                    if (boxRect.left < nodeRect.right && boxRect.right > nodeRect.left && boxRect.top < nodeRect.bottom && boxRect.bottom > nodeRect.top) {
                        state.multiSelectedNodes.add(node);
                        node.element.classList.add('multi-selected');
                    }
                });
                document.body.removeChild(selectionBox);
            } else {
                clearMultiSelect();
            }
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function handleZoom(e) {
        e.preventDefault();
        const zoomIntensity = 0.1;
        const scroll = e.deltaY < 0 ? 1 : -1;
        const zoomFactor = Math.exp(scroll * zoomIntensity);
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const mousePointX = (mouseX - state.pan.x) / state.zoom;
        const mousePointY = (mouseY - state.pan.y) / state.zoom;
        state.zoom *= zoomFactor;
        state.pan.x = -mousePointX * state.zoom + mouseX;
        state.pan.y = -mousePointY * state.zoom + mouseY;
        updateCanvasTransform();
        saveState();
    }
    
    function toggleMultiSelect(nodeObject) {
        if (state.multiSelectedNodes.has(nodeObject)) {
            state.multiSelectedNodes.delete(nodeObject);
            nodeObject.element.classList.remove('multi-selected');
        } else {
            state.multiSelectedNodes.add(nodeObject);
            nodeObject.element.classList.add('multi-selected');
        }
    }

    function clearMultiSelect() {
        state.multiSelectedNodes.forEach(n => n.element.classList.remove('multi-selected'));
        state.multiSelectedNodes.clear();
    }


    // ----- YARDIMCI VE ÖZELLİK FONKSİYONLARI ----- //

    function updateCanvasTransform() {
        canvasWrapper.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
        updateMinimap();
    }

    function deleteNode(nodeToDelete) {
        const connectionsToRemove = state.connections.filter(c => c.start.id === nodeToDelete.id || c.end.id === nodeToDelete.id);
        connectionsToRemove.forEach(conn => {
            conn.line.remove();
            const otherNode = conn.start.id === nodeToDelete.id ? conn.end : conn.start;
            otherNode.connections = otherNode.connections.filter(c => c !== conn);
        });
        state.connections = state.connections.filter(c => !connectionsToRemove.includes(c));
        nodeToDelete.element.remove();
        state.nodes = state.nodes.filter(node => node.id !== nodeToDelete.id);
        saveState();
    }

    function handleNodeClickForConnection(nodeObject) {
        if (!state.firstNodeForConnection) {
            state.firstNodeForConnection = nodeObject;
            nodeObject.element.classList.add('selected');
        } else if(state.firstNodeForConnection !== nodeObject) {
            createConnection(state.firstNodeForConnection, nodeObject);
            state.firstNodeForConnection.element.classList.remove('selected');
            state.firstNodeForConnection = null;
            saveState();
        }
    }
    
    function createConnection(startNode, endNode) {
        if (state.connections.some(c => (c.start.id === startNode.id && c.end.id === endNode.id) || (c.start.id === endNode.id && c.end.id === startNode.id))) return;
        const line = new LeaderLine(startNode.element, endNode.element, {
            color: 'var(--t-light)', size: 3, path: 'fluid',
            startPlug: 'disc', endPlug: 'arrow1'
        });
        const connection = { line, start: startNode, end: endNode };
        state.connections.push(connection);
        startNode.connections.push(connection);
        endNode.connections.push(connection);
        return connection;
    }
    
    function updateConnections(nodeObject) {
        nodeObject.connections.forEach(conn => { try { conn.line.position(); } catch (e) {} });
    }

    function updateMinimap() {
        if(isMinimapThrottled) return;
        isMinimapThrottled = true;
        requestAnimationFrame(() => {
            minimap.querySelectorAll('.minimap-node').forEach(n => n.remove());
            if (state.nodes.length === 0) { minimapViewport.style.width = '0'; minimapViewport.style.height = '0'; isMinimapThrottled = false; return; }
            const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
            state.nodes.forEach(node => {
                bounds.minX = Math.min(bounds.minX, node.element.offsetLeft);
                bounds.minY = Math.min(bounds.minY, node.element.offsetTop);
                bounds.maxX = Math.max(bounds.maxX, node.element.offsetLeft + node.element.offsetWidth);
                bounds.maxY = Math.max(bounds.maxY, node.element.offsetTop + node.element.offsetHeight);
            });
            const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
            const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
            const scale = Math.min(minimap.clientWidth / worldWidth, minimap.clientHeight / worldHeight) * 0.9;
            state.nodes.forEach(node => {
                const minimapNode = document.createElement('div');
                minimapNode.className = 'minimap-node';
                Object.assign(minimapNode.style, {
                    left: `${(node.element.offsetLeft - bounds.minX) * scale}px`,
                    top: `${(node.element.offsetTop - bounds.minY) * scale}px`,
                    width: `${node.element.offsetWidth * scale}px`,
                    height: `${node.element.offsetHeight * scale}px`,
                });
                minimap.appendChild(minimapNode);
            });
            Object.assign(minimapViewport.style, {
                transform: `translate(${( -state.pan.x / state.zoom - bounds.minX) * scale}px, ${(-state.pan.y / state.zoom - bounds.minY) * scale}px)`,
                width: `${(canvas.clientWidth / state.zoom) * scale}px`,
                height: `${(canvas.clientHeight / state.zoom) * scale}px`
            });
            isMinimapThrottled = false;
        });
    }

    function resetCanvas(force = false) {
        if (force || confirm('Are you sure you want to reset everything?')) {
            localStorage.removeItem('mindMapState');
            window.location.reload();
        }
    }
    
    // ----- VERİ YÖNETİMİ (localStorage, Import/Export) ----- //
    function exportState() {
        const data = localStorage.getItem('mindMapState');
        if (!data) return alert('Nothing to export!');
        const blob = new Blob([data], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `infinity-nodes-backup-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }
    
    function importState(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                localStorage.setItem('mindMapState', event.target.result);
                resetCanvas(true);
            } catch (err) {
                alert('Failed to import file.');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    function saveState() {
        const serializableState = {
            nodes: state.nodes.map(node => ({
                id: node.id, x: node.element.offsetLeft, y: node.element.offsetTop,
                title: node.element.querySelector('.node-header').innerHTML,
                content: node.element.querySelector('.node-content').innerHTML,
                color: node.element.querySelector('.node-header').style.backgroundColor,
            })),
            connections: state.connections.map(conn => ({ startId: conn.start.id, endId: conn.end.id })),
            nodeIdCounter: state.nodeIdCounter, pan: state.pan, zoom: state.zoom,
            theme: document.body.classList.contains('dark-mode') ? 'dark' : 'light',
        };
        localStorage.setItem('mindMapState', JSON.stringify(serializableState));
        updateMinimap();
    }

    function loadState() {
        const savedState = JSON.parse(localStorage.getItem('mindMapState'));
        if (!savedState) return;
        if (savedState.theme === 'dark') {
            document.body.classList.add('dark-mode');
            themeToggle.checked = true;
        }
        state.pan = savedState.pan || { x: 0, y: 0 };
        state.zoom = savedState.zoom || 1;
        state.nodeIdCounter = savedState.nodeIdCounter || 0;
        updateCanvasTransform();
        const nodeMap = new Map();
        if (savedState.nodes) {
            savedState.nodes.forEach(nodeData => {
                const node = createNode(nodeData.x, nodeData.y, nodeData.title, nodeData.content, nodeData.color || COLORS[0], nodeData.id);
                nodeMap.set(nodeData.id, node);
            });
        }
        if (savedState.connections) {
            savedState.connections.forEach(connData => {
                const startNode = nodeMap.get(connData.startId);
                const endNode = nodeMap.get(connData.endId);
                if (startNode && endNode) createConnection(startNode, endNode);
            });
        }
        updateMinimap();
    }
    
    loadState();
});
