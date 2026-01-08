/**
 * 全局状态与配置参数
 */
export const params = {
    pointSize: 3,
    sizeAttenuation: false,
    opacity: 1.0,
    meshColor: '#9aa0a6',
    meshOpacity: 0.4,
    showMesh: true,
    showGrid: true,
    backgroundColor: '#f0f2f5'
};

export const loadStatus = {
    obj: false,
    ply: false,
    failed: false
};

// 存储各个语义类别的点云 Mesh
export const semanticMeshes = {};

// 存储各个语义类别的显示状态（公差、范围等）
export const semanticStates = {};

// 存储各个实例的详细数据
export let instanceData = {};

/**
 * 更新实例数据的工具函数
 * @param {Object} newData 
 */
export function setInstanceData(newData) {
    instanceData = newData;
}
