import { createFileRoute } from "@tanstack/react-router";
import { ZencodeLandingPage } from "~/components/zencode-landing-page";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/zencode")({
  head: () =>
    pageMeta(
      "Zencode.vn – Nền tảng AI Coding Tối Thượng Cho Kỹ Sư & Doanh Nghiệp Việt Nam",
      "Khai phóng sức mạnh cụm 22+ Fleet Nodes đa mô hình: Claude Opus 4.8, Sonnet 5, Gemini 2.5 Pro, Codex và Llama Clef. 100% Stealth Mode Isolation, thanh toán VietQR quét mã tức thì.",
      "/zencode",
    ),
  component: ZencodeRouteComponent,
});

function ZencodeRouteComponent() {
  return <ZencodeLandingPage />;
}
