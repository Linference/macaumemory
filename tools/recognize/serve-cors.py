"""供 browser-check.mjs 取用 photos-src/ 的靜態伺服器（附 CORS 標頭）。

為什麼需要它：測試照片放在 photos-src/（public/ 之外，Vite 不提供），
測試腳本從 5173 的頁面 fetch 5180 的圖片，屬於跨來源請求，
因此伺服器必須回 Access-Control-Allow-Origin，否則瀏覽器直接攔掉（ERR_FAILED）。
Python 內建的 http.server 不送這個標頭，所以這裡自己包一層。
"""
import functools
import http.server
import socketserver

PORT = 5180


class CorsHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):                      # 預檢請求
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):              # 安靜模式
        pass


socketserver.TCPServer.allow_reuse_address = True
handler = functools.partial(CorsHandler, directory=r"D:\Users\LINKIT\Desktop\澳门记忆")
with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), handler) as httpd:
    print(f"  CORS 靜態伺服器：http://127.0.0.1:{PORT}/（根目錄＝專案根）", flush=True)
    httpd.serve_forever()
