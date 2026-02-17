import { useProcessStore, DEFAULT_STAGE_STATE } from "../processStore";

describe("processStore", () => {
  beforeEach(() => {
    useProcessStore.setState({
      stages: {},
      viewingStageId: null,
      pendingCommit: null,
      committedStages: {},
    });
  });

  describe("appendOutput", () => {
    it("appends a line to stage output", () => {
      useProcessStore.getState().appendOutput("s1", "line 1");
      useProcessStore.getState().appendOutput("s1", "line 2");
      const stage = useProcessStore.getState().stages["s1"];
      expect(stage.streamOutput).toEqual(["line 1", "line 2"]);
      expect(stage.lastOutputAt).toBeTypeOf("number");
    });

    it("creates stage state if it does not exist", () => {
      useProcessStore.getState().appendOutput("new-stage", "hello");
      const stage = useProcessStore.getState().stages["new-stage"];
      expect(stage).toBeDefined();
      expect(stage.streamOutput).toEqual(["hello"]);
    });
  });

  describe("clearOutput", () => {
    it("clears stream output for a stage", () => {
      useProcessStore.getState().appendOutput("s1", "line");
      useProcessStore.getState().clearOutput("s1");
      expect(useProcessStore.getState().stages["s1"].streamOutput).toEqual([]);
    });

    it("resets killed flag for new run", () => {
      useProcessStore.getState().setRunning("s1", "pid-123");
      useProcessStore.getState().markKilled("s1");
      expect(useProcessStore.getState().stages["s1"].killed).toBe(true);
      useProcessStore.getState().clearOutput("s1");
      expect(useProcessStore.getState().stages["s1"].killed).toBe(false);
    });
  });

  describe("setRunning", () => {
    it("sets stage to running with process id", () => {
      useProcessStore.getState().setRunning("s1", "pid-123");
      const stage = useProcessStore.getState().stages["s1"];
      expect(stage.isRunning).toBe(true);
      expect(stage.processId).toBe("pid-123");
      expect(stage.killed).toBe(false);
    });

    it("preserves killed flag when process registers", () => {
      useProcessStore.getState().setRunning("s1", "spawning");
      useProcessStore.getState().markKilled("s1");
      useProcessStore.getState().setRunning("s1", "pid-real");
      const stage = useProcessStore.getState().stages["s1"];
      expect(stage.processId).toBe("pid-real");
      expect(stage.killed).toBe(true);
    });
  });

  describe("setStopped", () => {
    it("sets stage to stopped", () => {
      useProcessStore.getState().setRunning("s1", "pid-123");
      useProcessStore.getState().setStopped("s1");
      const stage = useProcessStore.getState().stages["s1"];
      expect(stage.isRunning).toBe(false);
      expect(stage.processId).toBeNull();
      expect(stage.lastOutputAt).toBeNull();
    });
  });

  describe("markKilled", () => {
    it("marks stage as killed", () => {
      useProcessStore.getState().setRunning("s1", "pid-123");
      useProcessStore.getState().markKilled("s1");
      expect(useProcessStore.getState().stages["s1"].killed).toBe(true);
    });
  });

  describe("setViewingStageId", () => {
    it("sets viewing stage id", () => {
      useProcessStore.getState().setViewingStageId("s1");
      expect(useProcessStore.getState().viewingStageId).toBe("s1");
    });

    it("can set to null", () => {
      useProcessStore.getState().setViewingStageId("s1");
      useProcessStore.getState().setViewingStageId(null);
      expect(useProcessStore.getState().viewingStageId).toBeNull();
    });
  });

  describe("pendingCommit", () => {
    it("sets and clears pending commit", () => {
      const commit = {
        stageId: "s1",
        stageName: "Implementation",
        message: "fix: bug",
        diffStat: "1 file changed",
      };
      useProcessStore.getState().setPendingCommit(commit);
      expect(useProcessStore.getState().pendingCommit).toEqual(commit);

      useProcessStore.getState().clearPendingCommit();
      expect(useProcessStore.getState().pendingCommit).toBeNull();
    });
  });

  describe("setCommitted", () => {
    it("records commit hash for a stage", () => {
      useProcessStore.getState().setCommitted("s1", "abc1234");
      expect(useProcessStore.getState().committedStages["s1"]).toBe("abc1234");
    });

    it("accumulates commits across stages", () => {
      useProcessStore.getState().setCommitted("s1", "abc1234");
      useProcessStore.getState().setCommitted("s2", "def5678");
      expect(useProcessStore.getState().committedStages).toEqual({
        s1: "abc1234",
        s2: "def5678",
      });
    });
  });

  describe("DEFAULT_STAGE_STATE", () => {
    it("has correct defaults", () => {
      expect(DEFAULT_STAGE_STATE).toEqual({
        streamOutput: [],
        isRunning: false,
        processId: null,
        killed: false,
        lastOutputAt: null,
      });
    });
  });
});
