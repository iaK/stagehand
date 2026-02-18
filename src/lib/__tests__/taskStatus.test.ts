import { describe, it, expect } from "vitest";
import {
  statusUrgency,
  aggregateProjectDotClass,
} from "../taskStatus";

describe("statusUrgency", () => {
  it("returns correct indices for known statuses", () => {
    expect(statusUrgency("completed")).toBe(0);
    expect(statusUrgency("approved")).toBe(1);
    expect(statusUrgency("pending")).toBe(2);
    expect(statusUrgency("in_progress")).toBe(3);
    expect(statusUrgency("running")).toBe(4);
    expect(statusUrgency("failed")).toBe(5);
    expect(statusUrgency("awaiting_user")).toBe(6);
  });

  it("returns -1 for unknown statuses", () => {
    expect(statusUrgency("unknown")).toBe(-1);
  });
});

describe("aggregateProjectDotClass", () => {
  it("returns gray for no tasks", () => {
    expect(aggregateProjectDotClass([], [])).toBe("bg-zinc-400");
  });

  it("returns green for all completed tasks", () => {
    expect(aggregateProjectDotClass(["completed", "completed"], [])).toBe("bg-emerald-500");
  });

  it("returns gray (pending) for mix of completed + pending", () => {
    expect(aggregateProjectDotClass(["completed", "pending"], [])).toBe("bg-zinc-400");
  });

  it("returns blue for in_progress tasks", () => {
    expect(aggregateProjectDotClass(["completed", "in_progress"], [])).toBe("bg-blue-500");
  });

  it("returns amber for awaiting_user execution (most urgent)", () => {
    expect(
      aggregateProjectDotClass(["in_progress"], ["awaiting_user"]),
    ).toBe("bg-amber-500");
  });

  it("returns red for failed execution", () => {
    expect(
      aggregateProjectDotClass(["in_progress"], ["failed"]),
    ).toBe("bg-red-500");
  });

  it("returns amber when awaiting_user beats failed", () => {
    expect(
      aggregateProjectDotClass(["pending"], ["failed", "awaiting_user"]),
    ).toBe("bg-amber-500");
  });

  it("returns pulsing blue for running execution", () => {
    expect(
      aggregateProjectDotClass(["pending"], ["running"]),
    ).toBe("bg-blue-500 animate-pulse");
  });

  it("returns red when failed beats running", () => {
    expect(
      aggregateProjectDotClass(["pending"], ["running", "failed"]),
    ).toBe("bg-red-500");
  });

  it("returns green for all approved executions", () => {
    expect(
      aggregateProjectDotClass(["completed"], ["approved"]),
    ).toBe("bg-emerald-500");
  });
});
