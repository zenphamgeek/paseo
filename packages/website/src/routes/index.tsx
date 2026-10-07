import { createFileRoute } from "@tanstack/react-router";
import { ZencodeLandingPage } from "~/components/zencode-landing-page";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/")({
  head: () =>
    pageMeta(
      "Zencode.vn – Hệ Điều Hành Lập Trình Tự Trị Đa Tác Nhân",
      "Khai phóng sức mạnh AI Swarm với Sovereign Stealth Mode, 100% Zero Outbound Telemetry và thanh toán VietQR quét mã tức thì.",
      "/",
    ),
  component: Home,
});

function Home() {
  return <ZencodeLandingPage />;
}
