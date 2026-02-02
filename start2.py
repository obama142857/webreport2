import http.server
import socketserver
import sys
import webbrowser
import os
import socket

def get_free_port():
    """通过绑定 0 端口来获取系统分配的空闲端口"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]
# 确保服务器在正确的目录运行
if getattr(sys, 'frozen', False):
    # 如果是打包后的 exe 运行
    current_dir = os.path.dirname(sys.executable)
else:
    # 如果是直接脚本运行
    current_dir = os.path.dirname(os.path.abspath(__file__))

os.chdir(current_dir)

# 从命令行参数获取端口，默认为 8000
PORT = get_free_port()


class PreciseHandler(http.server.SimpleHTTPRequestHandler):
    def handle(self):
        """处理请求，捕获客户端连接异常"""
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            # 客户端连接中止，通常是因为关闭了浏览器标签页或刷新了页面
            # 这种情况下可以无视该异常
            pass

    def end_headers(self):
        # 允许跨域请求
        self.send_header('Access-Control-Allow-Origin', '*')
        # 必须：支持 SharedArrayBuffer (跨域隔离)
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        # 禁用缓存，方便调试
        self.send_header(
            'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        super().end_headers()


# 强制修复 Windows 注册表可能导致的 MIME 类型解析错误
# 尤其是 .js 文件被识别为 text/plain 的情况
PreciseHandler.extensions_map.update({
    '': 'application/octet-stream', 
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.json': 'application/json',
    '.wasm': 'application/wasm',       # 必须：许多 Three.js 插件需要
    '.obj': 'text/plain',
    '.ply': 'application/octet-stream',
    '.json': 'application/json',
})

print(f"========================================")
print(f"  Web 报告本地服务器启动成功")
print(f"  地址: http://localhost:{PORT}")
print(f"  目录: {current_dir}")
print(f"========================================")

webbrowser.open(f"http://localhost:{PORT}/index.html")

try:
    with socketserver.TCPServer(("", PORT), PreciseHandler) as httpd:
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\n服务器已手动停止。")
    sys.exit(0)
except Exception as e:
    print(f"\n服务器启动失败: {e}")
    sys.exit(1)
