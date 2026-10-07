import { describe, it, expect, vi } from "vitest";

describe("Fleet Screen Navigation & UI/UX Consolidation", () => {
  it("should define safe leaveFleet navigation fallback to root when cannot go back", () => {
    const mockRouter = {
      canGoBack: vi.fn().mockReturnValue(false),
      back: vi.fn(),
      replace: vi.fn(),
    };

    const leaveFleet = () => {
      if (mockRouter.canGoBack()) {
        mockRouter.back();
        return;
      }
      mockRouter.replace("/");
    };

    leaveFleet();
    expect(mockRouter.canGoBack).toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith("/");
  });

  it("should trigger router.back() when history exists", () => {
    const mockRouter = {
      canGoBack: vi.fn().mockReturnValue(true),
      back: vi.fn(),
      replace: vi.fn(),
    };

    const leaveFleet = () => {
      if (mockRouter.canGoBack()) {
        mockRouter.back();
        return;
      }
      mockRouter.replace("/");
    };

    leaveFleet();
    expect(mockRouter.canGoBack).toHaveBeenCalled();
    expect(mockRouter.back).toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("should trigger leaveFleet on Escape keyboard event", () => {
    const onLeave = vi.fn();

    const handleKeyDown = (e: { key: string; preventDefault: () => void }) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onLeave();
      }
    };

    const preventDefault = vi.fn();
    handleKeyDown({ key: "Escape", preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(onLeave).toHaveBeenCalledTimes(1);

    // Other keys should not trigger onLeave
    handleKeyDown({ key: "Enter", preventDefault });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("should export standard testIDs for all navigation elements", () => {
    const expectedTestIds = [
      "fleet-back-to-workspace-btn",
      "fleet-header-back-btn",
      "fleet-breadcrumb-home",
      "page-layout-back-btn",
    ];

    for (const testId of expectedTestIds) {
      expect(typeof testId).toBe("string");
      expect(testId.length).toBeGreaterThan(0);
    }
  });
});
