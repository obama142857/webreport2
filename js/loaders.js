import * as THREE from 'three';
import { params, loadStatus, instanceData, setInstanceData, semanticMeshes } from './state.js';
import { meshGroup, pointCloudGroup, failedGroup, focusOnBox, updateMeshMaterial } from './viewer.js';
import { updateStatus, updateProgress, showNotification, checkAllLoaded, createSemanticUICard } from './ui.js';

/**
 * 加载默认文件
 */
export function loadDefaultFiles() {
    // 1. 加载 output.obj
    updateStatus('status-obj', 'loading', '准备下载并流式解析 output.obj ...');

    loadObjStream(
        './output.obj',
        (loaded, total) => {
            updateProgress('obj', loaded, total);
            let msg = `加载中... ${(loaded / 1024 / 1024).toFixed(0)} MB`;
            if (total > 0) {
                const pct = (loaded / total * 100).toFixed(0);
                msg = `下载并解析... ${pct}% (${(loaded / 1024 / 1024).toFixed(0)}MB)`;
            }
            updateStatus('status-obj', 'loading', msg);
        },
        (object) => {
            meshGroup.clear();
            meshGroup.add(object);
            updateMeshMaterial();

            const box = new THREE.Box3().setFromObject(object);
            const size = box.getSize(new THREE.Vector3());

            console.log('[OBJ] Surface Ready. Faces:', object.geometry.index.count / 3);

            if (size.length() > 0) {
                focusOnBox(box);
            }

            updateStatus('status-obj', 'success', `模型成功载入并生成表面`);
        },
        (err) => {
            console.error('OBJ Process Error:', err);
            showNotification('处理大型 OBJ 失败: ' + err.message);
            updateStatus('status-obj', 'error', '解析模型失败');
        }
    );

    // 2. 加载 output.ply
    const plyFileLoader = new THREE.FileLoader();
    plyFileLoader.setResponseType('arraybuffer');
    plyFileLoader.load(
        './output.ply',
        (buffer) => {
            try {
                const data = parsePly(buffer);
                processPointCloudData(data);
                document.getElementById('instance-panel').style.display = 'flex';
                updateStatus('status-ply', 'success', '点云 (output.ply) 解析完成');
            } catch (err) {
                console.error(err);
                updateStatus('status-ply', 'error', 'PLY 解析错误');
            }
        },
        (xhr) => {
            if (xhr.lengthComputable && xhr.total > 0) {
                updateProgress('ply', xhr.loaded, xhr.total);
                const pct = (xhr.loaded / xhr.total * 100).toFixed(1);
                updateStatus('status-ply', 'loading', `读取 output.ply ... ${pct}%`);
            }
        },
        (err) => {
            console.error('PLY Load Error:', err);
            updateStatus('status-ply', 'error', 'output.ply 加载失败');
        }
    );

    // 3. 加载 failed.ply
    loadFailedPly();
}

class ResizableBuffer {
    constructor(type, chunkSize = 5000000) {
        this.Type = type;
        this.chunkSize = chunkSize;
        this.buffers = [new type(chunkSize)];
        this.currentIdx = 0;
        this.currentBuffer = this.buffers[0];
    }
    
    push(v) {
        if (this.currentIdx >= this.chunkSize) {
            this.buffers.push(new this.Type(this.chunkSize));
            this.currentBuffer = this.buffers[this.buffers.length - 1];
            this.currentIdx = 0;
        }
        this.currentBuffer[this.currentIdx++] = v;
    }
    
    push3(v1, v2, v3) {
        if (this.currentIdx + 3 > this.chunkSize) {
            this.push(v1); this.push(v2); this.push(v3);
            return;
        }
        this.currentBuffer[this.currentIdx++] = v1;
        this.currentBuffer[this.currentIdx++] = v2;
        this.currentBuffer[this.currentIdx++] = v3;
    }
    
    merge() {
        if (this.buffers.length === 1) {
            return this.buffers[0].subarray(0, this.currentIdx);
        }
        const totalSize = (this.buffers.length - 1) * this.chunkSize + this.currentIdx;
        const merged = new this.Type(totalSize);
        let offset = 0;
        for (let i = 0; i < this.buffers.length - 1; i++) {
            merged.set(this.buffers[i], offset);
            offset += this.chunkSize;
        }
        merged.set(this.buffers[this.buffers.length - 1].subarray(0, this.currentIdx), offset);
        return merged;
    }
}

/**
 * 流式加载 OBJ 文件
 */
async function loadObjStream(url, onProgress, onMeshReady, onError) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        let loaded = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';

        // 分块大小: 5M elements
        const vBuf = new ResizableBuffer(Float32Array, 5000000);
        const cBuf = new ResizableBuffer(Float32Array, 5000000);
        const nBuf = new ResizableBuffer(Float32Array, 5000000);
        const iBuf = new ResizableBuffer(Uint32Array, 5000000);
        
        let hasColors = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            loaded += value.byteLength;
            if (total > 0 && onProgress) {
                onProgress(loaded, total);
            }

            const chunkText = decoder.decode(value, { stream: true });
            const parseText = pending + chunkText;
            
            let lastLineBreak = parseText.lastIndexOf('\n');
            if (lastLineBreak === -1) {
                pending = parseText;
                continue;
            }
            
            const linesToProcess = parseText.substring(0, lastLineBreak);
            pending = parseText.substring(lastLineBreak + 1);
            
            const lines = linesToProcess.split('\n');
            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                if (line.length === 0 || line.startsWith('#')) continue;
                
                if (line.startsWith('v ')) {
                    const parts = line.split(/\s+/);
                    vBuf.push3(parseFloat(parts[1]), parseFloat(parts[3]), parseFloat(parts[2]));
                    if (parts.length >= 7) {
                        cBuf.push3(parseFloat(parts[4]), parseFloat(parts[5]), parseFloat(parts[6]));
                        hasColors = true;
                    }
                } else if (line.startsWith('vn ')) {
                    const parts = line.split(/\s+/);
                    nBuf.push3(parseFloat(parts[1]), parseFloat(parts[3]), parseFloat(parts[2]));
                } else if (line.startsWith('f ')) {
                    const parts = line.split(/\s+/);
                    const faceIndices = [];
                    for (let j = 1; j < parts.length; j++) {
                        const part = parts[j];
                        let slashIdx = part.indexOf('/');
                        let val = parseInt(slashIdx === -1 ? part : part.substring(0, slashIdx));
                        faceIndices.push(val - 1);
                    }
                    if (faceIndices.length === 3) {
                        iBuf.push3(faceIndices[0], faceIndices[1], faceIndices[2]);
                    } else if (faceIndices.length === 4) {
                        iBuf.push3(faceIndices[0], faceIndices[1], faceIndices[2]);
                        iBuf.push3(faceIndices[0], faceIndices[2], faceIndices[3]);
                    }
                }
            }
            
            await new Promise(r => setTimeout(r, 0));
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(vBuf.merge(), 3));
        
        if (hasColors) {
            geometry.setAttribute('color', new THREE.BufferAttribute(cBuf.merge(), 3));
        }
        
        const normals = nBuf.merge();
        if (normals.length > 0) {
            geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        } else {
             geometry.computeVertexNormals();
        }
        
        geometry.setIndex(new THREE.BufferAttribute(iBuf.merge(), 1));

        const material = new THREE.MeshLambertMaterial({
            color: hasColors ? 0xffffff : params.meshColor,
            vertexColors: hasColors,
            side: THREE.DoubleSide,
            transparent: params.meshOpacity < 1.0,
            opacity: params.meshOpacity,
            flatShading: false
        });
        
        onMeshReady(new THREE.Mesh(geometry, material));

    } catch (e) {
        if (onError) onError(e);
    }
}

function loadFailedPly() {
    const fileLoader = new THREE.FileLoader();
    fileLoader.setResponseType('arraybuffer');
    fileLoader.load(
        './failed.ply',
        (buffer) => {
            try {
                const data = parsePly(buffer);
                renderFailedPoints(data);
                updateStatus('status-failed', 'success', '点云 (failed.ply) 加载成功');
            } catch (err) {
                console.error(err);
                updateStatus('status-failed', 'error', 'failed.ply 解析错误');
                showNotification('解析 failed.ply 时出错: ' + err.message);
            }
        },
        (xhr) => {
            if (xhr.lengthComputable && xhr.total > 0) {
                updateProgress('failed', xhr.loaded, xhr.total);
                const pct = (xhr.loaded / xhr.total * 100).toFixed(0);
                updateStatus('status-failed', 'loading', `读取 failed.ply ... ${pct}%`);
            }
        },
        (err) => {
            updateStatus('status-failed', 'error', 'failed.ply 加载失败 (可选文件)');
        }
    );
}

function renderFailedPoints(flatData) {
    failedGroup.clear();
    const numColumns = 6;
    const numPoints = flatData.length / numColumns;
    const positions = new Float32Array(numPoints * 3);
    
    for (let i = 0; i < numPoints; i++) {
        positions[i * 3] = flatData[i * numColumns];
        positions[i * 3 + 1] = flatData[i * numColumns + 1];
        positions[i * 3 + 2] = flatData[i * numColumns + 2];
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    
    const mat = new THREE.PointsMaterial({ 
        size: params.pointSize, 
        sizeAttenuation: params.sizeAttenuation, 
        color: 0x000000, 
        transparent: true, 
        opacity: params.opacity, 
        depthWrite: true, 
        depthTest: true 
    });
    
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.name = "FailedPoints";
    failedGroup.add(pts);
}

function parsePly(buffer) {
    const textDecoder = new TextDecoder();
    const headerLimit = Math.min(buffer.byteLength, 4096);
    const headerString = textDecoder.decode(new Uint8Array(buffer.slice(0, headerLimit)));
    const headerEndMarker = 'end_header';
    const headerEndIndex = headerString.indexOf(headerEndMarker);
    if (headerEndIndex === -1) throw new Error('Invalid PLY header');
    
    const actualHeaderEnd = headerEndIndex + headerEndMarker.length;
    let dataOffset = actualHeaderEnd;
    const uint8View = new Uint8Array(buffer);
    if (uint8View[dataOffset] === 13) dataOffset++; 
    if (uint8View[dataOffset] === 10) dataOffset++; 

    const header = headerString.substring(0, headerEndIndex);
    const lines = header.split(/\r?\n/);
    let vertexCount = 0;
    const properties = [];
    let inVertexElement = false;
    
    const typeToSize = {
        'char': 1, 'uchar': 1, 'int8': 1, 'uint8': 1,
        'short': 2, 'ushort': 2, 'int16': 2, 'uint16': 2,
        'int': 4, 'uint': 4, 'int32': 4, 'uint32': 4, 'float': 4, 'float32': 4,
        'double': 8, 'float64': 8
    };

    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('element vertex')) {
            vertexCount = parseInt(line.split(/\s+/)[2]);
            inVertexElement = true;
        } else if (line.startsWith('element')) {
            inVertexElement = false;
        } else if (inVertexElement && line.startsWith('property')) {
            const parts = line.split(/\s+/);
            const type = parts[1];
            const name = parts[2];
            properties.push({ type, name, size: typeToSize[type] || 4 });
        }
    }
    
    const dataView = new DataView(buffer, dataOffset);
    let offset = 0;
    const result = new Float32Array(vertexCount * 6); 
    
    for (let i = 0; i < vertexCount; i++) {
        let x = 0, y = 0, z = 0, error = 0, sem = 0, inst = 0;
        for (const prop of properties) {
            let val = 0;
            if (prop.type === 'float' || prop.type === 'float32') {
                val = dataView.getFloat32(offset, true);
            } else if (prop.type === 'double' || prop.type === 'float64') {
                val = dataView.getFloat64(offset, true);
            } else if (prop.type === 'int' || prop.type === 'int32') {
                val = dataView.getInt32(offset, true);
            } else if (prop.type === 'uint' || prop.type === 'uint32') {
                val = dataView.getUint32(offset, true);
            } else if (prop.type === 'short' || prop.type === 'int16') {
                val = dataView.getInt16(offset, true);
            } else if (prop.type === 'ushort' || prop.type === 'uint16') {
                val = dataView.getUint16(offset, true);
            } else if (prop.type === 'char' || prop.type === 'int8') {
                val = dataView.getInt8(offset);
            } else if (prop.type === 'uchar' || prop.type === 'uint8') {
                val = dataView.getUint8(offset);
            }
            
            if (prop.name === 'x') x = val;
            else if (prop.name === 'y') y = val;
            else if (prop.name === 'z') z = val;
            else if (prop.name === 'distance') error = val;
            else if (prop.name === 'semantic') sem = val;
            else if (prop.name === 'instance') inst = val;
            
            offset += prop.size;
        }
        result[i * 6] = x;
        result[i * 6 + 1] = z;
        result[i * 6 + 2] = y;
        result[i * 6 + 3] = error;
        result[i * 6 + 4] = sem;
        result[i * 6 + 5] = inst;
    }
    return result;
}

function processPointCloudData(flatData) {
    pointCloudGroup.clear();
    const listContainer = document.getElementById('semantic-list'); 
    listContainer.innerHTML = '';
    
    const newInstanceData = {};
    const numColumns = 6; 
    const numPoints = flatData.length / numColumns; 
    const groupedData = {};

    for (let i = 0; i < numPoints; i++) {
        const base = i * numColumns;
        const x = flatData[base]; 
        const y = flatData[base + 1]; 
        const z = flatData[base + 2];
        const error = flatData[base + 3]; 
        const semLabel = Math.floor(flatData[base + 4]); 
        const instLabel = Math.floor(flatData[base + 5]);

        if (!groupedData[semLabel]) groupedData[semLabel] = { positions: [], errors: [], minVal: Infinity, maxVal: -Infinity };
        groupedData[semLabel].positions.push(x, y, z); groupedData[semLabel].errors.push(error);
        
        if (error < groupedData[semLabel].minVal) groupedData[semLabel].minVal = error;
        if (error > groupedData[semLabel].maxVal) groupedData[semLabel].maxVal = error;
        
        if (!newInstanceData[instLabel]) newInstanceData[instLabel] = { semanticLabel: semLabel, positions: [], errors: [] };
        newInstanceData[instLabel].positions.push(x, y, z); newInstanceData[instLabel].errors.push(error);
    }

    setInstanceData(newInstanceData);

    Object.keys(groupedData).sort().forEach(label => { 
        createSemanticMesh(label, groupedData[label]); 
        createSemanticUICard(label, groupedData[label], listContainer); 
    });
}

function createSemanticMesh(label, data) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geo.setAttribute('errorVal', new THREE.Float32BufferAttribute(data.errors, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(data.positions.length * 3), 3));
    
    const mat = new THREE.PointsMaterial({ 
        size: params.pointSize, 
        sizeAttenuation: params.sizeAttenuation, 
        vertexColors: true, 
        transparent: true, 
        opacity: params.opacity, 
        depthWrite: true, 
        depthTest: true 
    });
    
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = 999;
    pts.frustumCulled = false;  
    pts.name = `Label_${label}`; 
    semanticMeshes[label] = pts; 
    pointCloudGroup.add(pts);
}
