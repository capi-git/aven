import { expect, it, vi } from "vitest";
import { submitManagedTurn } from "./managedSubmission";
import type { ControlOutcome } from "./orchestration";

it("settles a rejected dispatch instead of leaving the scheduler waiting", () => {
  const done = vi.fn();
  submitManagedTurn(() => false, done);
  expect(done).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ status: "failed" }),
  );
});
it("preserves a specific failure and does not settle it twice", () => {
  const done = vi.fn();
  const failure: ControlOutcome = { status: "failed", text: "", error: "Busy" };
  submitManagedTurn((settle) => {
    settle(failure);
    return false;
  }, done);
  expect(done).toHaveBeenCalledExactlyOnceWith(failure);
});
it("waits for accepted asynchronous work and reports thrown failures", () => {
  const done = vi.fn();
  let finish!: (outcome: ControlOutcome) => void;
  submitManagedTurn((settle) => {
    finish = settle;
  }, done);
  expect(done).not.toHaveBeenCalled();
  finish({ status: "completed", text: "Done" });
  expect(done).toHaveBeenCalledExactlyOnceWith({
    status: "completed",
    text: "Done",
  });
  const failure = vi.fn();
  submitManagedTurn(() => {
    throw new Error("Transport failed");
  }, failure);
  expect(failure).toHaveBeenCalledExactlyOnceWith({
    status: "failed",
    text: "",
    error: "Transport failed",
  });
});
