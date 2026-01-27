import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';
import { params, loadStatus, instanceData, semanticMeshes, semanticStates } from './state.js';
import { scene, camera, controls, updateAllPointMaterial, updateMeshMaterial } from './viewer.js';

export function updateStatus(id, type, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    
    const icon = el.querySelector('.status-icon');
    if (icon) {
        icon.className = `status-icon status-${type}`;
    }
    
    const progressContainer = el.querySelector('.progress-container');
    const progressHtml = progressContainer ? progressContainer.outerHTML : '';
    
    el.innerHTML = `<span class="status-icon status-${type}"></span> ${msg} ${progressHtml}`;

    if (type === 'success' || type === 'error') {
        const newProgressContainer = el.querySelector('.progress-container');
        if (newProgressContainer) newProgressContainer.style.display = 'none';
        
        if (id === 'status-obj') loadStatus.obj = true;
        if (id === 'status-ply') loadStatus.ply = true;
        if (id === 'status-failed') loadStatus.failed = true;
        
        checkAllLoaded();
    }
}

export function updateProgress(id, loaded, total) {
    const bar = document.getElementById(`progress-bar-${id}`);
    if (bar && total > 0) {
        const percent = (loaded / total * 100).toFixed(1);
        bar.style.width = percent + '%';
    }
}

export function showNotification(message, type = 'error') {
    console.error(`[${type.toUpperCase()}] ${message}`);
    alert(`${type === 'error' ? '❌ 错误' : '⚠️ 提示'}: ${message}`);
}

export function checkAllLoaded() {
    if (loadStatus.obj && loadStatus.ply && loadStatus.failed) {
        setTimeout(() => {
            const area = document.getElementById('file-status-area');
            if (area) {
                area.style.transition = 'opacity 0.5s';
                area.style.opacity = '0';
                setTimeout(() => {
                    area.parentElement.style.display = 'none';
                }, 500);
            }
        }, 1000);
    }
}

export function setupRightSidebarEvents() {
    document.getElementById('bgColor').addEventListener('input', (e) => scene.background.set(e.target.value));
    
    document.getElementById('showGrid').addEventListener('change', (e) => {
        const grid = scene.getObjectByName("GridHelper");
        if (grid) grid.visible = e.target.checked;
    });
    
    document.getElementById('showFailed').addEventListener('change', (e) => {
        const failedGroup = scene.getObjectByName("FailedPoints");
        if (failedGroup) failedGroup.visible = e.target.checked;
    });
    

    document.getElementById('pointSizeRange').addEventListener('input', (e) => { 
        params.pointSize = parseFloat(e.target.value); 
        document.getElementById('pointSizeVal').innerText = params.pointSize; 
        updateAllPointMaterial(); 
    });
    
    document.getElementById('opacityRange').addEventListener('input', (e) => { 
        params.opacity = parseFloat(e.target.value); 
        document.getElementById('opacityVal').innerText = params.opacity; 
        updateAllPointMaterial(); 
    });
    
    document.getElementById('showMesh').addEventListener('change', (e) => {
        const meshGroup = scene.getObjectByName("meshGroup") || scene.children.find(c => c.type === 'Group' && c.children.some(gc => gc.isMesh));
        if (meshGroup) meshGroup.visible = e.target.checked;
    });
    
    document.getElementById('meshColor').addEventListener('input', (e) => { 
        params.meshColor = e.target.value; 
        updateMeshMaterial(); 
    });
    
    document.getElementById('meshOpacity').addEventListener('input', (e) => { 
        params.meshOpacity = parseFloat(e.target.value); 
        document.getElementById('meshOpacityVal').innerText = params.meshOpacity; 
        updateMeshMaterial(); 
    });
}

export function setupInstanceCalcEvent() {
    const range = document.getElementById('defectRatioRange');
    const num = document.getElementById('defectRatioInput');
    range.addEventListener('input', () => num.value = range.value);
    num.addEventListener('change', () => range.value = num.value);
    document.getElementById('btnCalcInstances').addEventListener('click', calculateDefectiveInstances);
    
    setupFocusMode();
}

function setupFocusMode() {
    const btn = document.getElementById('btnToggleFocus');
    const pGeneral = document.getElementById('panel-general');
    const pModel = document.getElementById('panel-model');
    const pInstance = document.getElementById('instance-panel');
    
    let isFocused = false;

    btn.addEventListener('click', () => {
        isFocused = !isFocused;

        if (isFocused) {
            pGeneral.style.display = 'none';
            pModel.style.display = 'none';
            pInstance.style.maxHeight = 'calc(100vh - 40px)'; 
            pInstance.style.flex = '1'; 
            btn.innerHTML = '✖ 最小化';
            btn.style.background = '#ffebee';
            btn.style.borderColor = '#ffcdd2';
            btn.style.color = '#c62828';
        } else {
            pGeneral.style.display = 'flex'; 
            pModel.style.display = 'flex';
            pInstance.style.maxHeight = '320px';
            pInstance.style.flex = 'unset';
            btn.innerHTML = '⛶ 展开';
            btn.style.background = '#fff';
            btn.style.borderColor = '#ccc';
            btn.style.color = '#333';
        }
    });
}

function calculateDefectiveInstances() {
    const ratioThreshold = parseFloat(document.getElementById('defectRatioInput').value);
    const listDiv = document.getElementById('instance-list');
    listDiv.innerHTML = '';
    const results = [];

    for (const instId in instanceData) {
        const inst = instanceData[instId];
        const semLabel = inst.semanticLabel;
        const thresholds = semanticStates[semLabel];
        if (!thresholds) continue;

        let badCount = 0;
        const total = inst.errors.length;
        for (const err of inst.errors) {
            if (err > thresholds.posLimit || err < thresholds.negLimit) badCount++;
        }
        const ratio = badCount / total;
        if (ratio >= ratioThreshold) {
            results.push({ id: instId, semLabel: semLabel, ratio: ratio, count: total });
        }
    }

    if (results.length === 0) {
        listDiv.innerHTML = `<div style="text-align:center; color:#666; padding:10px;">未发现不合格比例 > ${ratioThreshold} 的实例</div>`;
        return;
    }
    
    results.sort((a, b) => b.ratio - a.ratio);
    results.forEach(res => {
        const item = document.createElement('div');
        item.className = 'defect-item';
        item.innerHTML = `
            <div class="defect-info">
                <strong>Instance ID: ${res.id}</strong>
                <span style="font-size:0.8em; color:#666;">语义: ${res.semLabel} | 点数: ${res.count}</span>
                <span class="defect-ratio">不合格比例: ${(res.ratio * 100).toFixed(1)}%</span>
            </div>
            <button class="btn-focus">定位</button>
        `;
        item.querySelector('.btn-focus').onclick = () => focusOnInstance(res.id);
        listDiv.appendChild(item);
    });
}

function focusOnInstance(instanceId) {
    const inst = instanceData[instanceId];
    if (!inst || inst.positions.length === 0) return;
    TWEEN.removeAll();

    const box = new THREE.Box3();
    for (let i = 0; i < inst.positions.length; i += 3) {
        box.expandByPoint(new THREE.Vector3(inst.positions[i], inst.positions[i + 1], inst.positions[i + 2]));
    }
    const center = box.getCenter(new THREE.Vector3());
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const radius = sphere.radius;
    const dist = Math.max(radius * 3.0, 2.0);

    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const endTarget = center.clone();
    const direction = new THREE.Vector3(1, 1, 1).normalize();
    const endPos = endTarget.clone().add(direction.multiplyScalar(dist));

    new TWEEN.Tween({ t: 0 })
        .to({ t: 1 }, 1200)
        .easing(TWEEN.Easing.Quadratic.InOut)
        .onUpdate(({ t }) => {
            camera.position.lerpVectors(startPos, endPos, t);
            controls.target.lerpVectors(startTarget, endTarget, t);
            controls.update();
        })
        .onComplete(() => controls.update())
        .start();
}

/**
 * 状态与 UI 相关的辅助函数
 */
function computeHistogram(errors, rangeLimit, bins = 60) {
    const histogram = new Array(bins).fill(0); 
    const step = (rangeLimit * 2) / bins; 
    let maxCount = 0;
    for (let err of errors) { 
        if (err < -rangeLimit || err > rangeLimit) continue; 
        let idx = Math.floor((err + rangeLimit) / step); 
        if (idx < 0) idx = 0; if (idx >= bins) idx = bins - 1; 
        histogram[idx]++; 
        if (histogram[idx] > maxCount) maxCount = histogram[idx]; 
    }
    return { histogram, maxCount, step };
}

export function createSemanticUICard(label, data, container) {
    const absMax = Math.max(Math.abs(data.minVal), Math.abs(data.maxVal)); 
    const rangeLimit = absMax > 0 ? absMax * 1.1 : 1.0;
    const histData = computeHistogram(data.errors, rangeLimit, 200);
    const state = { negLimit: parseFloat((-absMax * 0.5).toFixed(3)), negTol: 0, posTol: 0, posLimit: parseFloat((absMax * 0.5).toFixed(3)), isSymmetric: true };
    semanticStates[label] = state;

    const inputsRefs = {}; 
    const card = document.createElement('div'); card.className = 'semantic-card';
    const header = document.createElement('div'); header.className = 'card-header';
    header.innerHTML = `<div class="header-left"><span class="card-title">
            ${+label === 10 ? '管道' : +label === 11 ? '弯头' : +label === 12 ? '储罐' : '类别 ' + label}
        </span><span class="card-stats">点数: ${data.errors.length} | 误差范围: ±${rangeLimit.toFixed(2)}m</span></div>
        <div class="header-controls">
            <label class="symmetry-label"><input type="checkbox" class="sym-check" checked> 对称</label>
            <label class="symmetry-label" style="margin-left:5px;"><input type="checkbox" class="vis-check" checked> 显示</label>
        </div>`;
    
    const symCheck = header.querySelector('.sym-check'); symCheck.onchange = (e) => { state.isSymmetric = e.target.checked; };
    const visCheck = header.querySelector('.vis-check'); visCheck.onchange = (e) => { if (semanticMeshes[label]) semanticMeshes[label].visible = e.target.checked; };
    card.appendChild(header);

    const chartContainer = document.createElement('div'); chartContainer.className = 'chart-container';
    const canvas = document.createElement('canvas'); canvas.className = 'dist-canvas'; canvas.width = 320; canvas.height = 50;
    chartContainer.appendChild(canvas); 
    const zeroLine = document.createElement('div'); zeroLine.className = 'zero-line'; 
    chartContainer.appendChild(zeroLine); card.appendChild(chartContainer);

    const colorBar = document.createElement('div'); colorBar.className = 'color-preview-bar'; 
    const tickNegLimit = document.createElement('div'); tickNegLimit.className = 'preview-tick'; 
    const tickNegTol = document.createElement('div'); tickNegTol.className = 'preview-tick'; 
    const tickPosTol = document.createElement('div'); tickPosTol.className = 'preview-tick'; 
    const tickPosLimit = document.createElement('div'); tickPosLimit.className = 'preview-tick'; 
    colorBar.appendChild(tickNegLimit); colorBar.appendChild(tickNegTol); 
    colorBar.appendChild(tickPosTol); colorBar.appendChild(tickPosLimit); 
    card.appendChild(colorBar);

    const createControl = (text, key, color) => {
        const row = document.createElement('div'); row.className = 'control-row';
        row.innerHTML = `<span class="control-label" style="color:${color}">${text}</span><div class="input-wrapper"><input type="range" class="control-range" min="${-rangeLimit}" max="${rangeLimit}" step="${rangeLimit / 200}" value="${state[key]}"><input type="number" class="control-number" step="0.001" value="${state[key]}"></div>`;
        const rIn = row.querySelector('.control-range'); 
        const nIn = row.querySelector('.control-number'); 
        inputsRefs[key] = { range: rIn, number: nIn };
        
        const handleInput = (val) => {
            state[key] = val;
            if (state.isSymmetric) {
                let tk = null, tv = null; 
                if (key === 'negLimit') { tk = 'posLimit'; tv = -val; } 
                else if (key === 'posLimit') { tk = 'negLimit'; tv = -val; } 
                else if (key === 'negTol') { tk = 'posTol'; tv = -val; } 
                else if (key === 'posTol') { tk = 'negTol'; tv = -val; }
                if (tk) { 
                    state[tk] = tv; 
                    if (inputsRefs[tk]) { 
                        inputsRefs[tk].range.value = tv; 
                        inputsRefs[tk].number.value = parseFloat(tv.toFixed(3)); 
                    } 
                }
            } 
            updateVisuals();
        };
        rIn.oninput = () => { nIn.value = rIn.value; handleInput(parseFloat(rIn.value)); }; 
        nIn.onchange = () => { let v = parseFloat(nIn.value); rIn.value = v; handleInput(v); }; 
        return row;
    };

    const controlsGroup = document.createElement('div'); controlsGroup.className = 'control-group'; 
    controlsGroup.appendChild(createControl('不合格下限', 'negLimit', 'blue')); 
    controlsGroup.appendChild(createControl('合格下限', 'negTol', '#009999'));
    controlsGroup.appendChild(createControl('合格上限', 'posTol', '#009900')); 
    controlsGroup.appendChild(createControl('不合格上限', 'posLimit', 'red'));
    
    card.appendChild(controlsGroup); container.appendChild(card);

    const ctx = canvas.getContext('2d');
    const updateVisuals = () => {
        const toPct = (val) => ((val + rangeLimit) / (2 * rangeLimit)) * 100;
        const p1 = toPct(state.negLimit), p2 = toPct(state.negTol), p3 = toPct(state.posTol), p4 = toPct(state.posLimit);
        colorBar.style.background = `linear-gradient(90deg, #0000ff 0%, #0000ff ${p1}%, #00ffff ${(p1 + p2) / 2}%, #00e600 ${p2}%, #00e600 ${p3}%, #ffff00 ${(p3 + p4) / 2}%, #ff0000 ${p4}%, #ff0000 100%)`;
        tickNegLimit.style.left = `${p1}%`;
        tickNegTol.style.left = `${p2}%`;
        tickPosTol.style.left = `${p3}%`;
        tickPosLimit.style.left = `${p4}%`;
        
        const w = canvas.width, h = canvas.height; 
        ctx.clearRect(0, 0, w, h); 
        const binW = w / histData.histogram.length; 
        const drawW = Math.max(1, binW + 0.5);
        
        const getColor = (val) => {
            const negR = Math.max(1e-5, state.negTol - state.negLimit); 
            const posR = Math.max(1e-5, state.posLimit - state.posTol); 
            let hue;
            if (val < state.negLimit) hue = 240; 
            else if (val < state.negTol) hue = 240 - ((val - state.negLimit) / negR * 120); 
            else if (val <= state.posTol) hue = 120; 
            else if (val < state.posLimit) hue = 120 - ((val - state.posTol) / posR * 120); 
            else hue = 0;
            return `hsl(${hue}, 100%, 45%)`;
        };
        
        histData.histogram.forEach((count, i) => { 
            const binVal = -rangeLimit + (i * histData.step) + (histData.step / 2); 
            ctx.fillStyle = getColor(binVal); 
            const barH = (count / histData.maxCount) * (h * 0.9); 
            ctx.fillRect(i * binW, h - barH, drawW, barH); 
        });
        
        updateSingleLabelColor(label, state);
    };
    updateVisuals();
}

function updateSingleLabelColor(label, state) {
    const points = semanticMeshes[label]; 
    if (!points) return;
    const geo = points.geometry; 
    const errors = geo.attributes.errorVal.array; 
    const colors = geo.attributes.color.array;
    const negR = Math.max(1e-5, state.negTol - state.negLimit); 
    const posR = Math.max(1e-5, state.posLimit - state.posTol);
    
    for (let i = 0; i < errors.length; i++) {
        const val = errors[i]; 
        let hue;
        if (val < state.negLimit) hue = 240.0; 
        else if (val < state.negTol) hue = 240.0 - ((val - state.negLimit) / negR * 120.0); 
        else if (val <= state.posTol) hue = 120.0; 
        else if (val < state.posLimit) hue = 120.0 - ((val - state.posTol) / posR * 120.0); 
        else hue = 0.0;
        
        const col = new THREE.Color().setHSL(hue / 360, 0.8, 0.4); 
        colors[i * 3] = col.r; 
        colors[i * 3 + 1] = col.g; 
        colors[i * 3 + 2] = col.b;
    } 
    geo.attributes.color.needsUpdate = true;
}
