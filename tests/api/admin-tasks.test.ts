import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { GET as tasksGet, POST as tasksPost } from "../../app/api/admin/tasks/route";
import { PUT as taskPut, DELETE as taskDelete } from "../../app/api/admin/tasks/[id]/route";
import { createSignedSessionToken } from "../../lib/admin/session";
import { getRepository, setRepository } from "../../lib/repositories";

describe("Admin Task Management API Suite", () => {
  const superAdmin = {
    id: "admin-s",
    name: "Super Admin",
    email: "admin@cap.example",
    role: "super_admin" as const,
  };

  const reviewer = {
    id: "admin-r",
    name: "R. Verma",
    email: "r.verma@cap.example",
    role: "reviewer" as const,
  };

  const viewer = {
    id: "admin-v",
    name: "Viewer",
    email: "viewer@cap.example",
    role: "viewer" as const,
  };

  const origin = "http://localhost:3000";

  before(async () => {
    process.env.DATA_LAYER = "memory";
    setRepository(null);
    const repo = getRepository();
    await repo.seed?.();
  });

  describe("1. Task Listing & RBAC", () => {
    it("allows reviewer and super admin to list tasks", async () => {
      const token = createSignedSessionToken(reviewer);
      const req = new Request("http://localhost:3000/api/admin/tasks", {
        headers: {
          cookie: `cap_admin_session=${token}`,
        },
      });

      const res = await tasksGet(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.tasks));
      assert.ok(data.tasks.length >= 3);
    });

    it("allows viewer role to list tasks (tasks.view capability)", async () => {
      const token = createSignedSessionToken(viewer);
      const req = new Request("http://localhost:3000/api/admin/tasks", {
        headers: {
          cookie: `cap_admin_session=${token}`,
        },
      });

      const res = await tasksGet(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.tasks));
    });
  });

  describe("2. Task Creation & Validation", () => {
    it("blocks viewer role from creating tasks (403 FORBIDDEN)", async () => {
      const token = createSignedSessionToken(viewer);
      const req = new Request("http://localhost:3000/api/admin/tasks", {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          cookie: `cap_admin_session=${token}`,
        },
        body: JSON.stringify({
          title: "Viewer Unauthorized Task",
          maxPoints: 50,
          deadline: new Date(Date.now() + 86400000).toISOString(),
        }),
      });

      const res = await tasksPost(req);
      assert.equal(res.status, 403);
    });

    it("allows reviewer to create a new task with full policy options", async () => {
      const token = createSignedSessionToken(reviewer);
      const req = new Request("http://localhost:3000/api/admin/tasks", {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          cookie: `cap_admin_session=${token}`,
        },
        body: JSON.stringify({
          id: "task-social-blast",
          title: "Social Media Blast Challenge",
          description: "Post the CAP poster on LinkedIn & Instagram tag @ecell",
          type: "proof_link",
          maxPoints: 120,
          deadline: new Date(Date.now() + 5 * 86400000).toISOString(),
          graceMinutes: 90,
          penaltyRate: 15,
          penaltyCap: 60,
          cutoffDays: 4,
          correctionWindowDays: 2,
          isMandatory: true,
          state: "Live",
        }),
      });

      const res = await tasksPost(req);
      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.task.id, "task-social-blast");
      assert.equal(data.task.title, "Social Media Blast Challenge");
      assert.equal(data.task.maxPoints, 120);
      assert.equal(data.task.graceMinutes, 90);
      assert.equal(data.task.penaltyRate, 15);
      assert.equal(data.task.penaltyCap, 60);
      assert.equal(data.task.cutoffDays, 4);
    });

    it("rejects task creation with missing required fields (422)", async () => {
      const token = createSignedSessionToken(superAdmin);
      const req = new Request("http://localhost:3000/api/admin/tasks", {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          cookie: `cap_admin_session=${token}`,
        },
        body: JSON.stringify({
          title: "", // empty title
          maxPoints: -10, // negative points
          deadline: "not-a-date",
        }),
      });

      const res = await tasksPost(req);
      assert.equal(res.status, 422);
    });
  });

  describe("3. Task Update & Modals", () => {
    it("allows reviewer to update task parameters (deadline, points, title)", async () => {
      const token = createSignedSessionToken(reviewer);
      const updatedDeadline = new Date(Date.now() + 10 * 86400000).toISOString();
      const req = new Request("http://localhost:3000/api/admin/tasks/task-social-blast", {
        method: "PUT",
        headers: {
          origin,
          "content-type": "application/json",
          cookie: `cap_admin_session=${token}`,
        },
        body: JSON.stringify({
          title: "Social Media Blast Challenge (Extended)",
          maxPoints: 150,
          deadline: updatedDeadline,
          state: "Live",
        }),
      });

      const res = await taskPut(req, { params: Promise.resolve({ id: "task-social-blast" }) });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.task.title, "Social Media Blast Challenge (Extended)");
      assert.equal(data.task.maxPoints, 150);
    });

    it("blocks viewer role from updating tasks (403)", async () => {
      const token = createSignedSessionToken(viewer);
      const req = new Request("http://localhost:3000/api/admin/tasks/task-social-blast", {
        method: "PUT",
        headers: {
          origin,
          "content-type": "application/json",
          cookie: `cap_admin_session=${token}`,
        },
        body: JSON.stringify({
          maxPoints: 200,
        }),
      });

      const res = await taskPut(req, { params: Promise.resolve({ id: "task-social-blast" }) });
      assert.equal(res.status, 403);
    });
  });

  describe("4. Task Deletion & Safe Archival", () => {
    it("deletes task cleanly when no submissions exist", async () => {
      const token = createSignedSessionToken(reviewer);
      const req = new Request("http://localhost:3000/api/admin/tasks/task-social-blast", {
        method: "DELETE",
        headers: {
          origin,
          cookie: `cap_admin_session=${token}`,
        },
      });

      const res = await taskDelete(req, { params: Promise.resolve({ id: "task-social-blast" }) });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.id, "task-social-blast");

      // Verify it is no longer returned in listTasks
      const repo = getRepository();
      const tasks = await repo.listTasks();
      assert.equal(tasks.some((t) => t.id === "task-social-blast"), false);
    });

    it("soft-deletes (archives) task if submissions exist to preserve leaderboard integrity", async () => {
      const token = createSignedSessionToken(superAdmin);
      // 'task-poster' already has submissions from seed
      const req = new Request("http://localhost:3000/api/admin/tasks/task-poster", {
        method: "DELETE",
        headers: {
          origin,
          cookie: `cap_admin_session=${token}`,
        },
      });

      const res = await taskDelete(req, { params: Promise.resolve({ id: "task-poster" }) });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);

      // Verify listTasks hides archived task
      const repo = getRepository();
      const tasks = await repo.listTasks();
      assert.equal(tasks.some((t) => t.id === "task-poster"), false);
    });
  });
});
