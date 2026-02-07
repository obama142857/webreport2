import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as TWEEN from '@tweenjs/tween.js';
import { params, semanticMeshes } from './state.js';

export let scene, camera, renderer, controls;
export let meshGroup, pointCloudGroup, failedGroup;

/**
 * 初始化 3D 场景
 */
export function initViewer() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(params.backgroundColor);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 10000);
    camera.position.set(0, 5, 0);

    renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
        precision: "highp"
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(1);
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 100, 100);
    scene.add(dirLight);

    const gridHelper = new THREE.GridHelper(20, 20, 0x888888, 0xcccccc);
    gridHelper.name = "GridHelper";
    scene.add(gridHelper);

    meshGroup = new THREE.Group();
    pointCloudGroup = new THREE.Group();
    failedGroup = new THREE.Group();
    
    // 让点云先渲染，模型后渲染，以便在模型半透明时能正确透过模型看到点云
    meshGroup.renderOrder = 2;
    pointCloudGroup.renderOrder = 1;
    failedGroup.renderOrder = 1;
    
    scene.add(meshGroup);
    scene.add(pointCloudGroup);
    scene.add(failedGroup);

    window.addEventListener('resize', onWindowResize);
}

/**
 * 循环渲染
 */
export function animate() {
    requestAnimationFrame(animate);
    TWEEN.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

/**
 * 相机聚焦到指定 Box
 */
export function focusOnBox(box) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 2.0;

    camera.position.set(center.x + cameraZ, center.y + cameraZ, center.z + cameraZ);
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
}

/**
 * 更新所有点云材质
 */
export function updateAllPointMaterial() { 
    [pointCloudGroup, failedGroup].forEach(group => {
        group.traverse(child => {
            if (child.isPoints) {
                child.material.size = params.pointSize; 
                child.material.sizeAttenuation = params.sizeAttenuation; 
                child.material.opacity = params.opacity; 
                child.material.transparent = (params.opacity < 1.0);
                child.material.needsUpdate = true;
            }
        });
    });
}

/**
 * 更新网格材质
 */
export function updateMeshMaterial() { 
    meshGroup.traverse((child) => {
        if (child.isMesh) {
            child.material.color.set(params.meshColor);
            child.material.opacity = params.meshOpacity;
            child.material.transparent = (params.meshOpacity < 1.0);
            child.material.depthWrite = (params.meshOpacity === 1.0);
        }
    });
}
