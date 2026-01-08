/**
 * 应用入口
 */
import { initViewer, animate } from './viewer.js';
import { loadDefaultFiles } from './loaders.js';
import { setupRightSidebarEvents, setupInstanceCalcEvent, showNotification } from './ui.js';

// 全局错误处理
window.onerror = function(msg, url, line, col, error) {
    showNotification(`程序运行出错: ${msg} (行: ${line})`);
    return false;
};

// 启动应用
function startApp() {
    // 1. 初始化 3D 渲染器
    initViewer();
    
    // 2. 绑定 UI 事件
    setupRightSidebarEvents();
    setupInstanceCalcEvent();
    
    // 3. 开始渲染循环
    animate();
    
    // 4. 加载数据文件
    loadDefaultFiles();
}

// 文档加载完成后启动
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}
