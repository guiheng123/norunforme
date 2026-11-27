"""
从 mitmproxy flows 中提取步道乐跑 token / uid / school_id

用法：
    mitmdump -nr flows.mitm -s scripts/extract_token.py
"""

import json
import base64
import urllib.parse
# 

try:
# 
    from mitmproxy import http
    from Crypto.Cipher import AES
# 
    from Crypto.Util.Padding import unpad
except ImportError as e:
    raise SystemExit(
        f"缺少依赖：{e}\n请先 pip install mitmproxy pycryptodome"
    )
# 
# 

# ⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
# 
# 
# 
KEY = b"Wet2C8d34f62ndi3"
IV = b"K6iv85jBD8jgf32D"

seen = set()

def decrypt(b64: str) -> dict | None:
    try:
        raw = base64.b64decode(urllib.parse.unquote(b64))
# 
        plain = unpad(AES.new(KEY, AES.MODE_CBC, IV).decrypt(raw), 16)
        return json.loads(plain)
    except Exception:
        return None

# 
# 
def response(flow: "http.HTTPFlow") -> None:
    url = flow.request.pretty_url
# 
    if "lptiyu" not in url and "/v3/api.php/" not in url:
        return

# 
    body = flow.request.get_text(strict=False) or ""
    if "data=" not in body:
        return

    raw_data = body.split("data=", 1)[1].split("&", 1)[0]
    payload = decrypt(raw_data)
    if not payload:
# 
        return

    token = payload.get("token")
    uid = payload.get("uid")
# 
    school_id = payload.get("school_id")
    student_num = payload.get("student_num")

    if not token or token in seen:
        return
# 
    seen.add(token)

# 
# 
# 
    print("\n" + "=" * 60)
    print(f"端点      : {url}")
    print(f"时间戳    : {payload.get('timestamp')}")
    print(f"token     : {token}")
    print(f"uid       : {uid}")
    print(f"school_id : {school_id}")
    print(f"student_num: {student_num}")
    print("=" * 60)
    print("\n把以上值填入 Web 登录页即可。")
    print("注意：token 是单会话的，手机端重新登录会让它立即失效。\n")
