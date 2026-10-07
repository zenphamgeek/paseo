# Zencode Release Notes & Test Verification Hub

Tài liệu quản lý Release Notes chính thức của **Zencode**, tích hợp ma trận kiểm thử (Test Matrix) đi kèm cho từng chức năng đã được xây dựng, xác minh tự động và bảo đảm chất lượng Enterprise-Grade.

---

## 📋 Release Index

| Phiên bản         | Trạng thái          | Ngày phát hành | Trọng tâm chính                                                                                                | Kết quả Unit Test              |
| :---------------- | :------------------ | :------------- | :------------------------------------------------------------------------------------------------------------- | :----------------------------- |
| **0.11.0-beta.4** | **Current Release** | 2026-10-06     | Autonomous Fleet, Clef Dual ONNX, Cloudflare Free Pool, Fleet UI/UX Navigation Consolidation, Stealth Anti-Bot | **18/18 Suites (100% Passed)** |
| 0.11.0-beta.3     | Stable Track        | 2026-10-02     | Usage window pinning, account usage plugins discovery & fetch                                                  | Passed                         |
| 0.11.0-beta.2     | Legacy Track        | 2026-10-01     | Account discovery from Codex/OpenCode/Claude CLI                                                               | Passed                         |

---

## 🚀 Release v0.11.0-beta.4 — Chi Tiết Tính Năng

### 1. Browser Automation, RPA & Stealth Anti-Bot

- **Cơ chế Side Panel Browser (Split Pane Right)**:
  - Hỗ trợ cờ `sidePanel: true` trong `browser_new_tab` và công cụ mới `browser_reveal_tab`.
  - Tự động chia đôi layout bên phải (`ensureSidePane`) để người dùng và agent có thể theo dõi trực tiếp RPA live mà không làm gián đoạn cửa sổ code editor.
  - Tương thích ngược: Khi không yêu cầu `sidePanel`, tab mở ngầm trong background mà không chiếm focus.
- **Stealth Anti-Bot & Fingerprint Sanitization Engine**:
  - Gỡ bỏ triệt để dấu vết `navigator.webdriver` (gán `undefined` và xóa trên `Navigator.prototype`).
  - Làm sạch Header HTTP và `navigator.userAgent`: Loại bỏ hoàn toàn các chuỗi `Electron/*`, `zencode/*`, `paseo/*`.
  - Giả lập chuẩn xác `window.chrome` (`runtime`, `csi()`, `loadTimes()`), mảng `navigator.plugins` (`Chrome PDF Plugin`, `Chrome PDF Viewer`, `Native Client`), và `navigator.languages`.
  - Quét và dọn sạch các biến định danh CDP Automation nội bộ (`cdc_*`, `selenium`, `webdriver`).
- **Humanized Precision Timing trong RPA**:
  - Thêm thời gian giữ chuột tự nhiên **35ms – 70ms** giữa sự kiện `mousePressed` và `mouseReleased`.
  - Khoảng nghỉ **60ms – 100ms** giữa 2 lần click liên tiếp (double click) nhằm triệt tiêu các thuật toán nhận diện bot theo hành vi chuột.

### 2. Autonomous Swarm & OpenCode Fleet

- **OpenCode Fleet Manager**:
  - Tự động phát hiện (auto-discovery) và quản lý các node trong swarm.
  - Đồng bộ hóa quy chuẩn đặt tên node theo email/tên người dùng trực quan.
  - Cơ chế cân bằng tải thông minh (Smart Load Balancing) giữa các node bình thường và node chịu tải cao.
- **Stealth Mode & Quota Randomization**:
  - Tuyệt đối tuân thủ Stealth Mode đối với Quota: rải ngẫu nhiên thời gian truy vấn (random jitter), phân bổ mỗi node một Egress Proxy riêng biệt nhằm chống bị chặn hạn ngạch.
- **Modal Serverless GPU Swarm**:
  - Điều phối cụm GPU serverless qua Modal (H100, A100, T4, L4).
  - Hỗ trợ inference vLLM và SGLang với tính năng tự động scale-up / scale-to-zero.
- **Fleet Analytics Time-Series DB**:
  - Lưu trữ viễn trắc vận hành trên SQLite (`fleet-analytics-db.ts`), theo dõi token throughput, node utilization, độ trễ và sự cố.
- **Fleet Mode Conversation Label & Orchestrator/Worker Dispatcher**:
  - Tự động nhận diện chế độ thực thi Fleet Mode từ mode selector, slash commands (`/fleet`, `/fleet_run`, `fleet_run`, `#fleet`), hoặc metadata gửi tới agent.
  - Tự động phân tích và gán **Label / Badge Notification** ngay lập tức vào Conversation timeline khi yêu cầu được khởi tạo.
  - Hiển thị minh bạch:
    - **Orchestrator Node & Model**: Node đóng vai trò chỉ huy/điều phối (ví dụ: `zenpham@gmail.com (gemini-2.5-pro)`).
    - **Delegated Worker Node & Model**: Node và mô hình swarm được phân bổ thực thi (ví dụ: `binhthuong@gmail.com (claude-opus-5-5-high)`).
    - **Tier Badge**: Phân hạng năng lực `[ULTRA]` / `[PRO]` kèm pulsing visual indicator xanh lá và task ID tracking.

### 3. Self-Healing & Reliability Engine

- **Self-Healing Supervisor**:
  - Tự động phát hiện lỗi hook hoặc runtime.
  - Tạo bản vá đề xuất (proposal synthesis), kích hoạt chạy bộ Unit Test trong worktree riêng biệt.
  - **Auto-Merge**: Tự động merge vào branch chính khi toàn bộ unit test thành công.
  - **Auto-Revert**: Tự động revert và khôi phục workspace nguyên vẹn nếu unit test thất bại.
- **Circuit Breaker**:
  - Cách ly hook lỗi sau 2 lần thất bại liên tiếp để chống tình trạng treo/deadlock agent.

### 4. Telemetry, Human-in-the-Loop & Vibe Coding

- **Telegram Notification Alerter**:
  - Gửi thông báo sự cố, báo cáo tiến độ và yêu cầu can thiệp tới Telegram với bộ đệm chống spam (cooldown 300s).
  - Công tắc bật/tắt thông báo Telegram độc lập cho từng cuộc trò chuyện (mặc định tắt - default OFF).
- **Vibe Audio Feedback**:
  - Phát âm thanh thông báo cho các sự kiện Vibe coding: hoàn thành tác vụ (task completed), cần chú ý (human attention required), và cảnh báo lỗi (error chime).
- **Zencode Rebranding & UI/UX Enterprise**:
  - Thay thế toàn bộ biểu tượng Paseo bằng nhận diện thương hiệu Zencode.
  - Các card node trên màn hình Fleet trang bị hiệu ứng trạng thái thời gian thực (pulsing indicators).

### 5. Clef Substrate & Dual ONNX Architecture

- **Vai trò Substrate Gatekeeper (Zero-Token Pre-Flight Admission)**:
  - Clef hoạt động tự động ở tầng in-pipeline middleware trước khi request được chuyển tới bất kỳ LLM Agent nào.
  - Phân tích ngữ cảnh, độ phức tạp (complexity score 0.0 - 4.0), phân loại task và rà soát rủi ro quota/stealth trong <2ms.
  - Phê duyệt nhập viện trực tiếp (**Zero-Token Pass**) mà không gây tốn token, không loãng context, và tiết kiệm hàng trăm ngàn tokens mỗi ngày.
- **Cơ chế DUAL ONNX Hai Cực (Bipolar Local & Cloud)**:
  - **Cực 1 (Local Substrate)**: ThinkPad P15 Quadro RTX 5000 / CPU In-Process. Chạy `LocalSurrogateScorer` (Clef-Flash 9B emulation), AST Policy, L2-Embedding, VAD, và Zero-Token Admission. Đảm bảo 92% request được duyệt trong <2ms với $0 token cost.
  - **Cực 2 (Upstream Cloud Clef)**: Cloudflare Workers AI / Modal Serverless GPU Swarm chạy Clef 27B để xử lý 8% tác vụ thẩm định đối kháng, kiến trúc phân tán cấp cao.
  - **Circuit Breaker 3 Trạng Thái**: `CLOSED`, `OPEN`, `HALF_OPEN` tự động fail-fast về Local trong <15ms nếu Cloudflare lag hoặc mất mạng.
- **Cloudflare Free Multi-Account Pool & Local 9B Fallback**:
  - Khai thác chính sách Cloudflare Free Tier cấp **10.000 Neurons/ngày** trên mỗi tài khoản.
  - Hỗ trợ gom nhiều email (`zenpham@gmail.com`, `binhthuong@gmail.com`, `sunward@gmail.com`,...) thành **Cloudflare Free Account Pool**, nâng tổng hạn ngạch miễn phí lên $N \times 10.000$ Neurons/ngày.
  - Router tự động cân bằng tải stealth (ưu tiên tài khoản có tỷ lệ sử dụng thấp nhất, chèn random jitter, phân tách proxy/header).
  - Tự động phát hiện lỗi HTTP 429 hoặc chạm mốc 10.000 neurons để chuyển tài khoản tiếp theo.
  - **Fallback mượt mà về Local 9B (Clef-Flash ONNX)**: Khi toàn bộ tài khoản trong pool đã cạn kiệt 10.000 neurons, hệ thống tự động rơi về model 9B nội bộ trên máy (<2ms, $0 token, không downtime).
- **Clef Hit Logger & Chống "Dead Concept / Over-Tools"**:
  - Lưu trữ viễn trắc minh bạch tại `data/clef_hits.jsonl` và ring buffer 1,000 hits thời gian thực.
  - Không triển khai dưới dạng Tool Call (loại bỏ triệt để nguy cơ LLM hallucination / over-tools loop).
  - Hiển thị trực tiếp trên giao diện Conversation Badge với dòng `CLEF GATE: <model> (<lat>ms • complexity: <score>/4.0) [ZERO-TOKEN PASS]`.

### 6. Fleet UI/UX Navigation Consolidation & Visual Design Standard

- **Nút Quay lại Không gian làm việc (Back to Workspace Action)**:
  - Khắc phục triệt để tình trạng "mắc kẹt" tại `/fleet` do thiếu nút Back về Workspace/Landing view.
  - Tích hợp nút Back nổi bật tại Navigation Ribbon và Header Actions: `<ArrowLeft /> Quay lại Không gian làm việc` kèm badge phím tắt `[ESC]`.
  - Hỗ trợ phím tắt toàn cầu `Escape` trên desktop và web để lập tức quay về Workspace hoặc trang chính (`/`).
- **Breadcrumbs Điều Hướng Đồng Bộ**:
  - Hiển thị dải Breadcrumbs trực quan: `Zencode (Home) ➔ Autonomous Fleet Hub`, cho phép người dùng click 1 chạm quay về giao diện chính.
- **Chuẩn Hóa Nhận Diện Visual Design Standard**:
  - Đồng bộ ngôn ngữ thiết kế Glassmorphism & Cybernetic Dark Palette giữa Workspace chính, Landing view và Fleet Hub.
  - Bổ sung huy hiệu bảo vệ Stealth Mode thời gian thực: `[🛡️ STEALTH MODE ACTIVE]`.
  - Nâng cấp `PageLayout` hỗ trợ nút Back chuẩn mực trên cả Desktop lẫn Mobile (`testID="page-layout-back-btn"`).

---

## 🧪 Ma Trận Kiểm Thử Đi Kèm (Accompanying Test Matrix)

Tất cả các chức năng trong bản release đều được bảo đảm bằng các bộ Unit Test chuyên biệt:

| Nhóm chức năng     | Tên chức năng                                        | Package             | File Unit Test                                                           | Mục tiêu kiểm thử                                                                           |     Trạng thái     |
| :----------------- | :--------------------------------------------------- | :------------------ | :----------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :----------------: |
| **Browser & RPA**  | Stealth Anti-Bot & Fingerprint Cloak                 | `@getpaseo/desktop` | `packages/desktop/src/features/browser-webviews/stealth-antibot.test.ts` | Ẩn `webdriver`, lọc User-Agent/Sec-Ch-Ua, mock `window.chrome`, plugins, dọn `cdc_*`        |  **PASSED** (7/7)  |
| **Browser & RPA**  | Humanized Precision Input & Timing                   | `@getpaseo/desktop` | `packages/desktop/src/features/browser-automation/trusted-input.test.ts` | Hold delay chuột (35-70ms), khoảng nghỉ double-click, phím cô lập                           |  **PASSED** (4/4)  |
| **Browser & RPA**  | Side Panel Browser & Tab Placement                   | `@getpaseo/app`     | `packages/app/src/desktop/browser/automation/handler.test.ts`            | Mở tab vào Side Panel qua `ensureSidePane`, lệnh `browser_reveal_tab`                       | **PASSED** (14/14) |
| **Browser & RPA**  | Browser Tools Broker & RPC Schema                    | `@getpaseo/server`  | `packages/server/src/server/browser-tools/tools.test.ts`                 | Đăng ký `browser_reveal_tab`, cờ `sidePanel`, định tuyến broker                             | **PASSED** (44/44) |
| **Fleet & Swarm**  | OpenCode Fleet Manager & Quota                       | `@getpaseo/server`  | `packages/server/src/server/fleet/opencode-fleet-manager.test.ts`        | Khám phá node, đồng nhất tên, rải jitter stealth, proxy cách ly                             |  **PASSED** (6/6)  |
| **Fleet & Swarm**  | Modal Serverless GPU Swarm                           | `@getpaseo/server`  | `packages/server/src/server/fleet/modal-gpu-swarm.test.ts`               | Điều phối pool GPU, cấu hình worker động, theo dõi sức khỏe                                 |  **PASSED** (7/7)  |
| **Fleet & Swarm**  | Fleet Analytics Time-Series DB                       | `@getpaseo/server`  | `packages/server/src/server/fleet/fleet-analytics-db.test.ts`            | Lưu trữ SQLite, ghi nhận token, độ trễ và truy vấn viễn trắc                                |  **PASSED** (7/7)  |
| **Fleet & Swarm**  | Fleet Mode Conversation Dispatcher                   | `@getpaseo/server`  | `packages/server/src/server/fleet/fleet-conversation-dispatcher.test.ts` | Tự động nhận diện lệnh Fleet, định tuyến Orchestrator và Worker, ghi log timeline item      | **PASSED** (12/12) |
| **Self-Healing**   | Supervisor & Automerge / Revert                      | `@getpaseo/server`  | `packages/server/src/server/self-healing/self-healing.test.ts`           | Khắc phục lỗi hook, chạy test, auto-merge khi pass, revert khi fail                         |  **PASSED** (4/4)  |
| **Telemetry**      | Telegram Alerter & Cooldown                          | `@getpaseo/server`  | `packages/server/src/server/telemetry/telemetry.test.ts`                 | Gửi cảnh báo Telegram, cooldown 300s, chụp snapshot viễn trắc                               | **PASSED** (12/12) |
| **Telemetry**      | Per-Conversation Telegram Toggle                     | `@getpaseo/app`     | `packages/app/src/stores/conversation-telegram-store.test.ts`            | Lưu trữ trạng thái bật/tắt thông báo Telegram theo từng conversation                        |  **PASSED** (5/5)  |
| **UI/UX & Vibe**   | Vibe Audio Notification System                       | `@getpaseo/app`     | `packages/app/src/utils/vibe-audio.test.ts`                              | Tổng hợp âm thanh khi hoàn thành task, cần chú ý và khi gặp lỗi                             |  **PASSED** (5/5)  |
| **UI/UX & Vibe**   | Zencode Branding & Node Badges                       | `@getpaseo/app`     | `packages/app/src/screens/fleet/service-app-icon.test.ts`                | Biểu tượng thương hiệu Zencode, huy hiệu trạng thái nhà cung cấp                            |  **PASSED** (7/7)  |
| **UI/UX & Vibe**   | Modal GPU Swarm Real-Time UI                         | `@getpaseo/app`     | `packages/app/src/screens/fleet/modal-gpu-swarm-ui.test.ts`              | Card hiển thị sức khỏe cụm GPU, trạng thái vLLM thời gian thực                              |  **PASSED** (5/5)  |
| **UI/UX & Vibe**   | Fleet Mode Conversation Badge UI                     | `@getpaseo/app`     | `packages/app/src/components/fleet-execution-label.test.ts`              | Parse nhãn, tách Orchestrator/Worker, render badge chuyên biệt                              |  **PASSED** (8/8)  |
| **Clef Substrate** | Clef Gatekeeper & Hit Telemetry Logger               | `@getpaseo/server`  | `packages/server/src/server/onnx/clef-hit-logger.test.ts`                | Đánh giá độ phức tạp pre-flight, Zero-Token admission, ghi log viễn trắc không over-tools   |  **PASSED** (5/5)  |
| **Clef Substrate** | Cloudflare Free Multi-Account Pool & 9B Fallback     | `@getpaseo/server`  | `packages/server/src/server/onnx/cloudflare-free-pool-router.test.ts`    | Cân bằng tải pool 10.000 neurons/ngày theo email, stealth jitter, tự động fallback 9B local |  **PASSED** (6/6)  |
| **UI/UX & Vibe**   | Fleet UI/UX Navigation & Visual Design Consolidation | `@getpaseo/app`     | `packages/app/src/screens/fleet/fleet-screen-navigation.test.ts`         | Nút Back to workspace, phím tắt Esc, breadcrumbs, stealth pill, desktop PageLayout back     |  **PASSED** (4/4)  |

---

## 🛠️ Quy Trình Quản Lý & Chạy Bộ Test (SOP)

### 1. Chạy song song toàn bộ Unit Test (Vibe Coding Parallel Runner)

Để kiểm tra siêu tốc toàn bộ hệ thống bằng luồng song song:

```bash
./scripts/run-all-unit-tests.sh
# Hoặc qua npm:
npm run test:all-features
```

_Thời gian thực thi trung bình: ~16 giây trên toàn bộ 4 workspace._

### 2. Xác minh Ma Trận Kiểm Thử Tự Động (Matrix Verification)

Để kiểm tra từng thành phần và tạo báo cáo ma trận:

```bash
node scripts/verify-release-test-matrix.mjs
# Hoặc qua npm:
npm run test:verify-matrix
```

### 3. Nguyên tắc khi thêm tính năng mới

1. Mọi tính năng (Feature/Epic) mới bắt buộc phải có file Unit Test tương ứng (`*.test.ts` hoặc `*.test.tsx`).
2. Cập nhật file test vào danh sách `FEATURE_TEST_MATRIX` trong `scripts/verify-release-test-matrix.mjs`.
3. Bổ sung mục tương ứng vào bảng Test Matrix trong `RELEASE_NOTES.md`.
4. Đảm bảo `./scripts/run-all-unit-tests.sh` đạt 100% tỷ lệ đỗ trước khi merge vào nhánh chính.
