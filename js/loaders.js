import * as THREE from 'three';
import { params, loadStatus, instanceData, setInstanceData, semanticMeshes } from './state.js';
import { meshGroup, pointCloudGroup, failedGroup, focusOnBox } from './viewer.js';
import { updateStatus, updateProgress, showNotification, checkAllLoaded, createSemanticUICard } from './ui.js';

/**
 * 加载默认文件
 */
export function loadDefaultFiles() {
    // 1. 加载 output.obj
    const objFileLoader = new THREE.FileLoader();
    objFileLoader.setResponseType('arraybuffer');
    updateStatus('status-obj', 'loading', '正在下载大型模型 (output.obj) ...');

    objFileLoader.load(
        './output.obj',
        (buffer) => {
            try {
                console.log('[OBJ] Download complete. Buffer size:', buffer.byteLength);
                updateStatus('status-obj', 'loading', '正在解析大型模型数据...');
                
                setTimeout(() => {
                    streamParseOBJ(buffer, (object, progressMsg, isDone) => {
                        if (!isDone) {
                            updateStatus('status-obj', 'loading', progressMsg);
                            return;
                        }
                        
                        meshGroup.clear();
                        meshGroup.add(object);
                        
                        const box = new THREE.Box3().setFromObject(object);
                        const size = box.getSize(new THREE.Vector3());
                        
                        console.log('[OBJ] Surface Ready. Faces:', object.geometry.index.count / 3);
                        
                        if (size.length() > 0) {
                            focusOnBox(box);
                        }

                        updateStatus('status-obj', 'success', `模型成功载入并生成表面 (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`);
                    });
                }, 100);
            } catch (e) {
                console.error('OBJ Process Error:', e);
                showNotification('处理大型 OBJ 失败: ' + e.message);
                updateStatus('status-obj', 'error', '解析模型失败');
            }
        },
        (xhr) => {
            if (xhr.lengthComputable && xhr.total > 0) {
                updateProgress('obj', xhr.loaded, xhr.total);
                const pct = (xhr.loaded / xhr.total * 100).toFixed(0);
                updateStatus('status-obj', 'loading', `下载 output.obj ... ${pct}% (${(xhr.loaded/1024/1024).toFixed(0)}MB)`);
            }
        },
        (err) => {
            updateStatus('status-obj', 'error', '下载 output.obj 失败');
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

/**
 * 流式解析大型 OBJ
 */
function streamParseOBJ(buffer, callback) {
    const view = new Uint8Array(buffer);
    const decoder = new TextDecoder();
    
    let vCount = 4697458; 
    let fCount = 5307040;
    
    const headerText = decoder.decode(view.slice(0, 2000));
    const vMatch = headerText.match(/number of vertices:\s+(\d+)/);
    if (vMatch) vCount = parseInt(vMatch[1]);
    const fMatch = headerText.match(/number of triangles:\s+(\d+)/);
    if (fMatch) fCount = parseInt(fMatch[1]);

    const positions = new Float32Array(vCount * 3);
    const colors = new Float32Array(vCount * 3);
    const normals = new Float32Array(vCount * 3);
    const indices = new Uint32Array(fCount * 3);
    
    let vIdx = 0, nIdx = 0, fIdx = 0;
    let start = 0;
    let colorFound = false;

    function processChunk(offset) {
        const end = Math.min(offset + 50000000, view.length);
        
        for (let i = offset; i < end; i++) {
            if (view[i] === 10 || view[i] === 13) {
                if (i > start) {
                    const line = decoder.decode(view.slice(start, i)).trim();
                    if (line.startsWith('v ')) {
                        const p = line.split(/\s+/);
                        if (p.length >= 4) {
                            positions[vIdx*3] = parseFloat(p[1]);
                            positions[vIdx*3+1] = parseFloat(p[2]);
                            positions[vIdx*3+2] = parseFloat(p[3]);
                            if (p.length >= 7) {
                                colors[vIdx*3] = parseFloat(p[4]);
                                colors[vIdx*3+1] = parseFloat(p[5]);
                                colors[vIdx*3+2] = parseFloat(p[6]);
                                colorFound = true;
                            }
                            vIdx++;
                        }
                    } else if (line.startsWith('vn ')) {
                        const p = line.split(/\s+/);
                        if (p.length >= 4) {
                            normals[nIdx*3] = parseFloat(p[1]);
                            normals[nIdx*3+1] = parseFloat(p[2]);
                            normals[nIdx*3+2] = parseFloat(p[3]);
                            nIdx++;
                        }
                    } else if (line.startsWith('f ')) {
                        const p = line.split(/\s+/);
                        if (p.length >= 4) {
                            for (let k = 0; k < 3; k++) {
                                const part = p[k+1];
                                const slashIdx = part.indexOf('/');
                                const idxStr = slashIdx === -1 ? part : part.substring(0, slashIdx);
                                indices[fIdx*3 + k] = parseInt(idxStr) - 1;
                            }
                            fIdx++;
                        }
                    }
                }
                start = i + 1;
                if (view[start] === 10 || view[start] === 13) { start++; i++; }
            }
        }

        if (end < view.length) {
            const pct = (end / view.length * 100).toFixed(0);
            callback(null, `正在多线程解析网格与材质: ${pct}%...`, false);
            setTimeout(() => processChunk(end), 0);
        } else {
            callback(null, '正在构建光照与法线数据...', false);
            
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, vIdx * 3), 3));
            
            if (colorFound) {
                geometry.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, vIdx * 3), 3));
            }
            
            if (nIdx > 0) {
                geometry.setAttribute('normal', new THREE.BufferAttribute(normals.subarray(0, nIdx * 3), 3));
            } else if (vIdx > 0 && vIdx < 2000000) {
                geometry.computeVertexNormals();
            }

            geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, fIdx * 3), 1));

            const material = new THREE.MeshLambertMaterial({
                color: colorFound ? 0xffffff : params.meshColor,
                vertexColors: colorFound,
                side: THREE.DoubleSide,
                transparent: params.meshOpacity < 1.0,
                opacity: params.meshOpacity,
                flatShading: false
            });

            callback(new THREE.Mesh(geometry, material), null, true);
        }
    }
    processChunk(0);
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
        result[i * 6 + 1] = y;
        result[i * 6 + 2] = z;
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
