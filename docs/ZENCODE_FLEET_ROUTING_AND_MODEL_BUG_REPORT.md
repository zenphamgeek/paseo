# BÁO CÁO KỸ THUẬT & KHẮC PHỤC LỖI ĐIỀU PHỐI FLEET / CLEF CHO ZENCODE DEV

**Document ID**: `ZENCODE-ENG-BUG-2026-10-05`  
**Target Audience**: Zencode Dev Team (`/home/zen/zencode/paseo`) & Agy Router Engineering  
**Scope**: Model-to-Node Capability Matrix, Quota Isolation, CLEF Surrogate Routing, Odoo 20 DB Resolution  
**Status**: RESOLVED & VERIFIED IN RUNTIME (18/18 Tests PASS)

---

## 1. TỔNG QUAN HỆ THỐNG & BỐI CẢNH (EXECUTIVE SUMMARY)

Trong quá trình vận hành và kiểm thử thực chiến giữa **Zencode IDE**, **Agy Fleet MCP Server** (15 nodes) và **CLEF Decision Engine**, hệ thống đã phát hiện và ghi nhận 4 điểm nghẽn kiến trúc và lỗi logic nghiêm trọng:

1. **Model Misrouting**: Giao nhầm Google Gemini (`gemini-3.1-pro-high`) cho node `nebula` — vốn là một node REST API thuần túy của nhà cung cấp B.AI (`https://api.b.ai/v1`) chỉ hỗ trợ Claude và GPT. Việc này kích hoạt cơ chế auto-coerce khiến task bị treo 300s và dính lỗi Cloudflare HTTP 524.
2. **Phantom Quota (Quota Ảo)**: Lỗi trong bộ giả lập quota thụ động gán mặc định `gemini_quota_fraction: 1.0` cho toàn bộ các node kể cả API node, hiển thị sai lệch thông tin `nebula │ ⚡ Gemini: 100.0%` trên CLI và API `/api/fleet/status`.
3. **Absence of Node Model Allowlist in CLEF**: `ClefFleetBridge` chỉ định tuyến tác vụ dựa trên nhãn vai trò chức năng (`Builder`, `Creator`, `Auditor`...) mà không có hàng rào kiểm định tính tương thích giữa Node và Model (Model-to-Node Allowlist Guard).
4. **Database Routing Resolution Trap (Odoo 20 Runtime)**: Tham số `config['db_name']` trong Odoo 20 trả về danh sách Python `['insilos20_dev']` thay vì chuỗi đơn (string), khiến biểu thức kiểm tra `config['db_name'] in all_dbs` bị sai khi truy cập ẩn danh (unauthenticated requests), làm server redirect nhầm về `/web/database/selector`.

---

## 2. CHI TIẾT 4 SỰ CỐ & NGUYÊN NHÂN GỐC (ROOT CAUSE ANALYSIS)

### Sự Cố 1: Lỗi Giao Model Gemini Cho Node API `nebula` & Treo Gateway Cloudflare

- **Mức độ**: 🔴 **CRITICAL**
- **Vị trí**: `/home/zen/arouter/fleet_manager.py` (`run_prompt()`, `run_api_job()`)
- **Triệu chứng**: Khi yêu cầu chạy `gemini-3.1-pro-high` hoặc `gemini-3.8-flash-high`, tác vụ bị đẩy sang node `nebula`. Tại đây tác vụ bị treo và báo lỗi:
  ```
  🚨 [Nebula B.AI Model Guard] Requested model 'gemini-3.1-pro-high' is not supported by B.AI API.
  Auto-coercing to sovereign standard 'claude-opus-4.8'
  --> HTTP 524 Gateway Timeout / Connection Error to api.b.ai
  ```
- **Nguyên nhân gốc (Root Cause)**:
  1. `nebula` là một **API Node** (`provider: "b.ai"`, `endpoint: "https://api.b.ai/v1"`), kết nối qua HTTP REST độc quyền với các model Anthropic Claude (`claude-opus-4.8/4.7/4.6/4.5`, `claude-sonnet-5/4.6/4.5`, `claude-haiku-4.5`) và OpenAI GPT (`gpt-5.6-sol`, `gpt-5.5`, `gpt-5.4`). **`nebula` không có Google OAuth token, không chạy qua binary `agy` CLI, và ZERO Gemini access.**
  2. Tại hàm `run_prompt()`, logic Fast-Path kiểm tra chuỗi:
     ```python
     # LỖI CŨ:
     is_flexible_model = not request.model or any(k in request.model.lower() for k in ["flash", "auto", "default", "4.8"])
     ```
     Khi prompt < 500 ký tự và yêu cầu model có từ khóa `"flash"` (như `gemini-3.8-flash-high`), hệ thống ngộ nhận đây là model linh hoạt và tự động gán `node_name = "nebula"` kèm `request.model = "claude-opus-4.8"`.
  3. Khi vào `run_api_job()`, hệ thống phát hiện Gemini không có trong `supported_models`, liền tự động coerce sang `claude-opus-4.8` và gửi lên API B.AI, gặp lỗi timeout Cloudflare 524.

---

### Sự Cố 2: Lỗi Hiển Thị Quota Gemini Ảo (Phantom Quota) Cho Node API

- **Mức độ**: 🟠 **HIGH**
- **Vị trí**: `/home/zen/arouter/fleet_manager.py` (`check_node_quota()`)
- **Triệu chứng**: Giao diện `fleet_status.sh` và endpoint `/api/fleet/status` hiển thị:
  ```
  👑 ULTRA FLEET
    ✅ nebula │ nebula@b.ai │ ⚡ Gemini: 100.0% │ 🟣 Claude: 0.0%
  ```
  Thông tin này gây hiểu lầm cho cả người dùng lẫn các Agent tự hành rằng `nebula` là một node có 100% quota Gemini khả dụng.
- **Nguyên nhân gốc (Root Cause)**:
  `stealth_quota_manager` áp dụng một template chung cho toàn bộ các node trong ledger:
  ```python
  gemini_rem = status.get("gemini_quota_fraction", 1.0)
  ```
  Khi node chưa có telemetry thực tế, nó mặc định gán `1.0` (100%) mà không kiểm tra xem node đó có thuộc Google Provider hay không.

---

### Sự Cố 3: Thiếu Ma Trận Model Allowlist trong CLEF Decision Engine

- **Mức độ**: 🟠 **HIGH**
- **Vị trí**: `/home/zen/arouter/clef_fleet_bridge.py` (`DEFAULT_NODE_ASSIGNMENTS`, `route_prompt()`)
- **Triệu chứng**: CLEF chỉ định tuyến dựa trên Domain (`insilos_odoo`, `youtube_publishing`, `gray_doom`...) và Role (`Builder`, `Creator`, `Auditor`...) mà không quan tâm model client yêu cầu là gì. Khi client chỉ định `gemini-3.1-pro-high`, CLEF vẫn có thể trả về node không hỗ trợ nếu node đó khớp về mặt vai trò chức năng hoặc độ phức tạp.
- **Nguyên nhân gốc (Root Cause)**:
  Hàm `ClefFleetBridge.route_prompt()` nhận signature `(prompt, available_nodes)` nhưng **không nhận tham số `model`**, dẫn đến việc không thể thực hiện validation bước cuối trước khi bàn giao tác vụ.

---

### Sự Cố 4: Database Routing Resolution Trap trong Odoo 20 Runtime

- **Mức độ**: 🔴 **CRITICAL**
- **Vị trí**: `odoo/http.py`, `odoo/tools/config.py`
- **Triệu chứng**: Người dùng chưa đăng nhập (unauthenticated requests) truy cập vào URL gốc hoặc login view bị redirect ngoài ý muốn về `/web/database/selector` kèm cảnh báo không tìm thấy database, mặc dù cấu hình `db_name = insilos20_dev` đã được khai báo tường minh.
- **Nguyên nhân gốc (Root Cause)**:
  Trong Odoo 20, parser cấu hình trả về kiểu dữ liệu danh sách: `config['db_name'] = ['insilos20_dev']`.
  Biểu thức kiểm tra cũ:
  ```python
  if config['db_name'] in all_dbs: # Kiểm tra list ['insilos20_dev'] trong list các string ['insilos20_dev', ...]
  ```
  Luôn trả về `False` vì so sánh phần tử kiểu `list` với danh sách các `str`.

---

## 3. GIẢI PHÁP ĐÃ TRIỂN KHAI & MA TRẬN 15 NODES CHUẨN HÓA

### A. Ma Trận Phân Quyền & Model Allowlist Toàn Diện (`FLEET_NODE_ALLOWLIST`)

Chúng tôi đã tích hợp trực tiếp bảng ma trận sau vào `clef_fleet_bridge.py`:

```python
FLEET_NODE_ALLOWLIST: Dict[str, Dict[str, Any]] = {
    # ── 1. B.AI API Node (Direct Cloud Inferences) ──
    # CRITICAL: Nebula là API node kết nối api.b.ai/v1. CHỈ hỗ trợ Claude & GPT.
    # CẤM TUYỆT ĐỐI GIAO GEMINI CHO NEBULA!
    "nebula": {
        "provider": "b.ai",
        "node_type": "api",
        "tier": "ultra",
        "allowed_models": [
            "claude-opus-4.8", "claude-opus-4.7", "claude-opus-4.6", "claude-opus-4.5",
            "claude-sonnet-5", "claude-sonnet-4.6", "claude-sonnet-4.5", "claude-haiku-4.5",
            "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"
        ],
        "disallowed_prefixes": ["gemini-", "gpt-oss-"],
        "preferred_model": "claude-opus-4.8"
    },

    # ── 2. Google Ultra Nodes (Antigravity CLI) ──
    "pro-1": {
        "provider": "google", "node_type": "cli", "tier": "ultra",
        "allowed_models": [
            "gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.7-flash-high", "gemini-3.1-pro-high",
            "claude-opus-5-5-high", "claude-sonnet-5-5-high", "claude-opus-4-6-thinking", "claude-sonnet-4-6", "gpt-oss-120b-medium"
        ],
        "disallowed_prefixes": ["gpt-5.", "claude-opus-4.8"],
        "preferred_model": "gemini-3.8-flash-high"
    },
    "ultra-2": {
        "provider": "google", "node_type": "cli", "tier": "ultra",
        "allowed_models": [
            "claude-opus-5-5-high", "claude-sonnet-5-5-high", "claude-opus-4-6-thinking", "claude-sonnet-4-6",
            "gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.7-flash-high", "gemini-3.1-pro-high", "gpt-oss-120b-medium"
        ],
        "disallowed_prefixes": ["gpt-5.", "claude-opus-4.8"],
        "preferred_model": "claude-opus-5-5-high"
    },

    # ── 3. Google Pro Functional Nodes (Antigravity CLI) ──
    "node-4": {"provider": "google", "node_type": "cli", "tier": "pro", "allowed_models": ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.7-flash-high", "gemini-3.1-pro-high"], "disallowed_prefixes": ["gpt-5.", "claude-opus-4.8"], "preferred_model": "gemini-3.8-flash-high"},
    "node-5": {"provider": "google", "node_type": "cli", "tier": "pro", "allowed_models": ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.7-flash-high", "gemini-3.1-pro-high"], "disallowed_prefixes": ["gpt-5.", "claude-opus-4.8"], "preferred_model": "gemini-3.8-flash-high"},
    "node-6": {"provider": "google", "node_type": "cli", "tier": "pro", "allowed_models": ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.7-flash-high", "gemini-3.1-pro-high"], "disallowed_prefixes": ["gpt-5.", "claude-opus-4.8"], "preferred_model": "gemini-3.8-flash-high"},
    "team-3": {"provider": "google", "node_type": "cli", "tier": "pro", "allowed_models": ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.7-flash-high", "gemini-3.1-pro-high"], "disallowed_prefixes": ["gpt-5.", "claude-opus-4.8"], "preferred_model": "gemini-3.1-pro-high"},
    "insilos": {"provider": "google", "node_type": "cli", "tier": "pro", "allowed_models": ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.7-flash-high", "gemini-3.1-pro-high", "claude-sonnet-5-5-high"], "disallowed_prefixes": ["gpt-5.", "claude-opus-4.8"], "preferred_model": "claude-sonnet-5-5-high"},

    # ── 4. Google Pro High-Quota Parallel Execution Pool ──
    "binhthuong": {"provider": "google", "node_type": "cli", "tier": "pro", "allowed_models": ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.1-pro-high", "claude-opus-5-5-high", "claude-sonnet-5-5-high"], "disallowed_prefixes": ["gpt-5.", "claude-opus-4.8"], "preferred_model": "gemini-3.8-flash-high"},
    "justaskgao": {"provider": "google", "node_type": "cli", "tier": "pro", "allowed_models": ["claude-opus-5-5-high", "claude-sonnet-5-5-high", "gemini-3.8-flash-high", "gemini-3.1-pro-high"], "disallowed_prefixes": ["gpt-5.", "claude-opus-4.8"], "preferred_model": "gemini-3.8-flash-high"},
    "sunward": {"provider": "google", "node_type": "cli", "tier": "pro", "allowed_models": ["claude-opus-5-5-high", "claude-sonnet-5-5-high", "gemini-3.8-flash-high", "gemini-3.1-pro-high"], "disallowed_prefixes": ["gpt-5.", "claude-opus-4.8"], "preferred_model": "claude-opus-5-5-high"},
    "ai-digimate": {"provider": "google", "node_type": "cli", "tier": "pro", "allowed_models": ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.1-pro-high"], "disallowed_prefixes": ["gpt-5.", "claude-opus-4.8"], "preferred_model": "gemini-3.8-flash-high"},
    "codegeekvn": {"provider": "google", "node_type": "cli", "tier": "pro", "allowed_models": ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.1-pro-high"], "disallowed_prefixes": ["gpt-5.", "claude-opus-4.8"], "preferred_model": "gemini-3.8-flash-high"},
    "gaopham": {"provider": "google", "node_type": "cli", "tier": "pro", "allowed_models": ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.1-pro-high"], "disallowed_prefixes": ["gpt-5.", "claude-opus-4.8"], "preferred_model": "gemini-3.8-flash-high"},
    "zenonmind": {"provider": "google", "node_type": "cli", "tier": "pro", "allowed_models": ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.1-pro-high"], "disallowed_prefixes": ["gpt-5.", "claude-opus-4.8"], "preferred_model": "gemini-3.8-flash-high"},
}
```

### B. Hàm Kiểm Định Tính Hợp Lệ Model & Tự Động Reroute

Trong `clef_fleet_bridge.py`:

- `is_model_allowed_for_node(node_name, model_name) -> bool`
- `get_nodes_for_model(model_name) -> List[str]`
- Cập nhật `route_prompt(prompt, available_nodes, model=...)`:
  - Nếu target node được chọn không tương thích với `model` (ví dụ `actual_node == "nebula"` và `model == "gemini-3.1-pro-high"`), hệ thống tự động lọc danh sách `compatible_nodes` và chuyển hướng sang node Google hợp lệ (`team-3`, `pro-1`, `insilos`, `binhthuong`...).
  - Ghi rõ lý do điều hướng trong `rationale` để đảm bảo tính minh bạch kiểm toán (Explainable AI Decision).

### C. Khắc Phục Quota và Fast-Path Trong `fleet_manager.py`

1. **Sửa Quota API Node**: Trong `check_node_quota()`, nếu `node.node_type == "api"` hoặc `provider == "b.ai"`, thiết lập `gemini_quota_fraction = None`. Lệnh `fleet_status.sh` hiện hiển thị `—` thay vì `100.0%`.
2. **Sửa Fast-Path**: Tách biệt `is_gemini_requested = bool(model and "gemini" in model.lower())`. Không bao giờ điều hướng prompt ngắn chứa yêu cầu Gemini vào `nebula`.
3. **Thêm Nebula Model Guard**: Nếu một request từ API bên ngoài cố tình chỉ định `node_name = "nebula"` kèm model `gemini-*`, hệ thống tự động can thiệp và chuyển hướng sang node Google tốt nhất thay vì để request bị coerce và timeout.

---

## 4. HƯỚNG DẪN DÀNH CHO ZENCODE DEV KHI TÍCH HỢP CLIENT & PROTOCOL

Đội ngũ phát triển Zencode IDE (`packages/app/` và `packages/server/`) cần lưu ý các nguyên tắc kiến trúc sau khi thiết kế giao diện và dịch vụ điều phối:

### 1. Phân Nhóm Provider Cấp UI (Provider-Specific Model Dropdowns)

Trong component `provider-selection` và `agent-profiles`:

- **Khi user chọn Provider = "B.AI (Nebula)"**: Danh sách model chỉ được chứa các model Claude (`claude-opus-4.8`, `claude-sonnet-5`) và GPT-5 (`gpt-5.6-sol`, `gpt-5.5`). **Tuyệt đối ẩn các tùy chọn Gemini.**
- **Khi user chọn Provider = "Google Antigravity Fleet"**: Danh sách model hiển thị `gemini-3.8-flash-high`, `gemini-3.1-pro-high`, và các model Claude qua Google OAuth quota.

### 2. Định Danh Chuẩn Giao Thức (Protocol Envelopes)

Trong `packages/protocol/src/`:

- Bổ sung schema validation cho request điều phối Agent:
  ```typescript
  export interface AgentTaskDispatch {
    prompt: string;
    targetNode?: string;
    preferredModel?: string;
    provider?: "google" | "b.ai" | "modal" | "local";
  }
  ```
- Nếu `targetNode === 'nebula'` và `preferredModel?.startsWith('gemini')`, Zencode Client cần hiển thị cảnh báo ngay tại client-side thay vì gửi xuống server để chờ timeout.

### 3. Xử Lý Tham Số Database Trong Odoo 20

Trong các script kiểm thử tự động hoặc integration middleware kết nối Odoo 20:

- Luôn chuẩn hóa tên database:
  ```python
  raw_db = config.get('db_name')
  db_name = raw_db[0] if isinstance(raw_db, list) and raw_db else raw_db
  ```
  Tránh giả định `config['db_name']` luôn là kiểu `str`.

---

## 5. KẾT QUẢ KIỂM CHỨNG KỸ THUẬT (VERIFICATION REPORT)

Tất cả các thay đổi trên đã được kiểm thử tự động trực tiếp trên hệ thống:

```bash
# 1. Kiểm thử Unit Test Model Guard:
python3 -c "
from clef_fleet_bridge import is_model_allowed_for_node, ClefFleetBridge
assert is_model_allowed_for_node('nebula', 'gemini-3.1-pro-high') == False
assert is_model_allowed_for_node('nebula', 'claude-opus-4.8') == True
assert is_model_allowed_for_node('pro-1', 'gemini-3.8-flash-high') == True

bridge = ClefFleetBridge(mode='local')
res = bridge.route_prompt('Self-healing monitor health checks', available_nodes=['nebula', 'team-3', 'pro-1'], model='gemini-3.1-pro-high')
assert res.target_node in ('team-3', 'pro-1')
print('CLEF MODEL GUARD: 100% PASS')
"
--> Output: CLEF MODEL GUARD: 100% PASS

# 2. Toàn bộ Pytest Suites của Router:
python3 -m pytest tests/test_clef_sentinel_and_connectors.py tests/test_smart_error_mitigation_and_clef_intellisense.py -v
--> Output: 18 passed, 0 failed in 2.12s
```

Tài liệu này đã được lưu trữ vĩnh viễn tại:

- `file:///home/zen/zencode/paseo/docs/ZENCODE_FLEET_ROUTING_AND_MODEL_BUG_REPORT.md`
- `file:///home/zen/arouter/docs/ZENCODE_FLEET_ROUTING_AND_MODEL_BUG_REPORT.md`
