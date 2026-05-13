# Implementation Plan: Slack / Teams Bot Integration

> **Status**: Ready for implementation  
> **Priority**: Phase 7 — Final remaining roadmap item  
> **Date**: 2026-05-13  
> **Author**: Requirement Analyzer (AI)

---

## 1. Overview

### What is being built

A per-project webhook-based integration that forwards Docuvia internal notifications (new commits ingested, new L3 decision nodes generated, cross-project links detected) to configured Slack or Microsoft Teams channels. Users configure webhook URLs per project via a new **Integrations** settings page in the frontend.

### Why

This is the only remaining `❌ Not started` item from the Phase 7 roadmap checklist. Completing it brings the project to 100% roadmap completion (42/42 items).

### Approach

- **Slack**: Incoming Webhooks API — POST JSON payloads with optional Block Kit formatting to a user-provided webhook URL.
- **Teams**: Incoming Webhooks via Office 365 connectors — POST legacy MessageCard JSON (still supported as of 2026, widely compatible, simpler than Adaptive Cards v2).
- **Trigger points**: Hook into the three existing notification creation sites in `generate.ts` (lines 232 and 625) and `ingest.ts` (lines 180 and 296) by calling a shared `notifyExternalIntegrations()` utility function after each `db.insert(notificationsTable)`.
- **Config storage**: New `project_integrations` Drizzle table with one row per configured webhook. Follows the same patterns as `subscriptions.ts` and `notifications.ts`.
- **No new dependencies**: Uses native `fetch` (already in Node.js 18+), same pattern as `github-client.ts`.

---

## 2. Architecture

### Files to Create

| File | Purpose |
|------|---------|
| `lib/db/src/schema/project_integrations.ts` | Drizzle ORM schema for the `project_integrations` table |
| `artifacts/api-server/src/lib/slack-teams-client.ts` | HTTP client: `notifyExternalIntegrations()`, `postSlackMessage()`, `postTeamsMessage()` |
| `artifacts/api-server/src/routes/integrations.ts` | Express router: CRUD for integrations + test endpoint |
| `artifacts/kg-engine/src/pages/integrations.tsx` | React settings page: add/edit/delete webhook configs per project |

### Files to Modify

| File | Change |
|------|--------|
| `lib/db/src/schema/index.ts` | Export `project_integrations` schema |
| `artifacts/api-server/src/routes/index.ts` | Import and `router.use(integrationsRouter)` |
| `artifacts/api-server/src/routes/generate.ts` | Call `notifyExternalIntegrations()` after each `db.insert(notificationsTable)` |
| `artifacts/api-server/src/routes/ingest.ts` | Call `notifyExternalIntegrations()` after each `db.insert(notificationsTable)` |
| `lib/api-spec/openapi.yaml` | Add `integrations` tag + 5 endpoints + 3 schemas |
| `artifacts/kg-engine/src/App.tsx` | Add `<Route path="/integrations" component={Integrations} />` |
| `artifacts/kg-engine/src/components/layout.tsx` | Add "Integrations" nav item under "System" section |

---

## 3. Database Changes

### New Table: `project_integrations`

**File**: `lib/db/src/schema/project_integrations.ts`

```typescript
import { pgTable, text, serial, integer, boolean, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const integrationTypeEnum = pgEnum("integration_type", ["slack", "teams"]);

export const projectIntegrationsTable = pgTable("project_integrations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  integrationType: integrationTypeEnum("integration_type").notNull(),
  webhookUrl: text("webhook_url").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  // JSON array of event types to forward, e.g. ["new_commit","new_l3_node","cross_link_detected"]
  // null means forward all supported event types
  notificationTypes: jsonb("notification_types").$type<string[] | null>().default(null),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectIntegrationSchema = createInsertSchema(projectIntegrationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const updateProjectIntegrationSchema = insertProjectIntegrationSchema.partial();
export const selectProjectIntegrationSchema = createSelectSchema(projectIntegrationsTable);
export type InsertProjectIntegration = z.infer<typeof insertProjectIntegrationSchema>;
export type ProjectIntegration = typeof projectIntegrationsTable.$inferSelect;
```

**Migration SQL** (save to `docs/db_migrations/002_add_project_integrations.sql`):

```sql
CREATE TYPE integration_type AS ENUM ('slack', 'teams');

CREATE TABLE project_integrations (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  integration_type integration_type NOT NULL,
  webhook_url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  notification_types JSONB DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_project_integrations_project ON project_integrations(project_id);
```

### `lib/db/src/schema/index.ts` — add export

Append to the existing exports:
```typescript
export * from "./project_integrations";
```

---

## 4. API Changes

### New OpenAPI Tag

```yaml
- name: integrations
  description: Per-project Slack / Teams webhook integrations
```

### New Schemas (add to `components/schemas` in `openapi.yaml`)

```yaml
ProjectIntegration:
  type: object
  required: [id, projectId, integrationType, webhookUrl, enabled, createdAt, updatedAt]
  properties:
    id:          { type: integer }
    projectId:   { type: integer }
    integrationType:
      type: string
      enum: [slack, teams]
    webhookUrl:  { type: string }
    enabled:     { type: boolean }
    notificationTypes:
      type: array
      nullable: true
      items: { type: string }
    createdAt:   { type: string, format: date-time }
    updatedAt:   { type: string, format: date-time }

ProjectIntegrationInput:
  type: object
  required: [integrationType, webhookUrl]
  properties:
    integrationType:
      type: string
      enum: [slack, teams]
    webhookUrl:  { type: string }
    enabled:     { type: boolean, default: true }
    notificationTypes:
      type: array
      nullable: true
      items: { type: string }

ProjectIntegrationUpdate:
  type: object
  properties:
    webhookUrl:  { type: string }
    enabled:     { type: boolean }
    notificationTypes:
      type: array
      nullable: true
      items: { type: string }
```

### New Endpoints

```
GET    /projects/{id}/integrations            → listProjectIntegrations
POST   /projects/{id}/integrations            → createProjectIntegration
PATCH  /integrations/{integrationId}          → updateProjectIntegration
DELETE /integrations/{integrationId}          → deleteProjectIntegration
POST   /integrations/{integrationId}/test     → testProjectIntegration
```

Full OpenAPI path definitions:

```yaml
/projects/{id}/integrations:
  get:
    operationId: listProjectIntegrations
    tags: [integrations]
    summary: List Slack/Teams integrations for a project
    parameters:
      - name: id
        in: path
        required: true
        schema: { type: integer }
    responses:
      "200":
        description: List of integrations
        content:
          application/json:
            schema:
              type: array
              items:
                $ref: "#/components/schemas/ProjectIntegration"
  post:
    operationId: createProjectIntegration
    tags: [integrations]
    summary: Add a Slack or Teams webhook integration
    parameters:
      - name: id
        in: path
        required: true
        schema: { type: integer }
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ProjectIntegrationInput"
    responses:
      "201":
        description: Created integration
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ProjectIntegration"

/integrations/{integrationId}:
  patch:
    operationId: updateProjectIntegration
    tags: [integrations]
    summary: Update a webhook integration
    parameters:
      - name: integrationId
        in: path
        required: true
        schema: { type: integer }
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ProjectIntegrationUpdate"
    responses:
      "200":
        description: Updated integration
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ProjectIntegration"
      "404":
        description: Not found
  delete:
    operationId: deleteProjectIntegration
    tags: [integrations]
    summary: Remove a webhook integration
    parameters:
      - name: integrationId
        in: path
        required: true
        schema: { type: integer }
    responses:
      "204":
        description: Deleted

/integrations/{integrationId}/test:
  post:
    operationId: testProjectIntegration
    tags: [integrations]
    summary: Send a test notification to the configured webhook
    parameters:
      - name: integrationId
        in: path
        required: true
        schema: { type: integer }
    responses:
      "200":
        description: Test sent
        content:
          application/json:
            schema:
              type: object
              required: [success]
              properties:
                success: { type: boolean }
                error:   { type: string }
      "404":
        description: Not found
```

---

## 5. Backend Implementation Steps

### Step 1: Create DB schema

Create `lib/db/src/schema/project_integrations.ts` with the content shown in Section 3.

Then add the export in `lib/db/src/schema/index.ts`:
```typescript
export * from "./project_integrations";
```

### Step 2: Create `slack-teams-client.ts`

Create `artifacts/api-server/src/lib/slack-teams-client.ts`:

```typescript
import { logger } from "./logger.js";
import type { ProjectIntegration } from "@workspace/db";
import { db, projectIntegrationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const SUPPORTED_EVENT_TYPES = ["new_commit", "new_l3_node", "cross_link_detected"] as const;

// ─── Slack ────────────────────────────────────────────────────────────────────

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  fields?: Array<{ type: string; text: string }>;
}

function buildSlackPayload(
  eventType: string,
  payload: Record<string, unknown>,
  projectName: string
): { text: string; blocks: SlackBlock[] } {
  const emojiMap: Record<string, string> = {
    new_commit:           ":git:",
    new_l3_node:          ":bulb:",
    cross_link_detected:  ":link:",
  };
  const titleMap: Record<string, string> = {
    new_commit:           "New commits ingested",
    new_l3_node:          "New L3 decision nodes generated",
    cross_link_detected:  "Cross-project link detected",
  };

  const emoji = emojiMap[eventType] ?? ":bell:";
  const title = titleMap[eventType] ?? eventType;
  const summary = `${emoji} *Docuvia* — ${title} in project *${projectName}*`;

  const fields: SlackBlock[] = [];
  if (typeof payload.l3Count === "number") {
    fields.push({ type: "section", text: { type: "mrkdwn", text: `*L3 Nodes:* ${payload.l3Count}` } });
  }
  if (typeof payload.commitCount === "number") {
    fields.push({ type: "section", text: { type: "mrkdwn", text: `*Commits:* ${payload.commitCount}` } });
  }
  if (typeof payload.similarity === "number") {
    fields.push({ type: "section", text: { type: "mrkdwn", text: `*Similarity:* ${Math.round(payload.similarity * 100)}%` } });
  }

  return {
    text: summary,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: summary } },
      ...fields,
    ],
  };
}

async function postSlackMessage(
  webhookUrl: string,
  eventType: string,
  payload: Record<string, unknown>,
  projectName: string
): Promise<boolean> {
  const body = buildSlackPayload(eventType, payload, projectName);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, webhookUrl }, "Slack webhook returned non-OK status");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err, webhookUrl }, "Failed to post to Slack webhook");
    return false;
  }
}

// ─── Teams ───────────────────────────────────────────────────────────────────

function buildTeamsPayload(
  eventType: string,
  payload: Record<string, unknown>,
  projectName: string
): Record<string, unknown> {
  const colorMap: Record<string, string> = {
    new_commit:           "0078D7",
    new_l3_node:          "107C10",
    cross_link_detected:  "D83B01",
  };
  const titleMap: Record<string, string> = {
    new_commit:           "New Commits Ingested",
    new_l3_node:          "New L3 Decision Nodes Generated",
    cross_link_detected:  "Cross-Project Link Detected",
  };

  const facts: Array<{ name: string; value: string }> = [];
  if (typeof payload.l3Count === "number") facts.push({ name: "L3 Nodes", value: String(payload.l3Count) });
  if (typeof payload.commitCount === "number") facts.push({ name: "Commits", value: String(payload.commitCount) });
  if (typeof payload.similarity === "number") facts.push({ name: "Similarity", value: `${Math.round(payload.similarity * 100)}%` });

  return {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    themeColor: colorMap[eventType] ?? "6264A7",
    summary: `Docuvia: ${titleMap[eventType] ?? eventType}`,
    sections: [
      {
        activityTitle: `Docuvia — ${titleMap[eventType] ?? eventType}`,
        activitySubtitle: `Project: **${projectName}**`,
        facts,
        markdown: true,
      },
    ],
  };
}

async function postTeamsMessage(
  webhookUrl: string,
  eventType: string,
  payload: Record<string, unknown>,
  projectName: string
): Promise<boolean> {
  const body = buildTeamsPayload(eventType, payload, projectName);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, webhookUrl }, "Teams webhook returned non-OK status");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err, webhookUrl }, "Failed to post to Teams webhook");
    return false;
  }
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Looks up enabled integrations for the project and forwards the notification.
 * Called after every db.insert(notificationsTable) in generate.ts and ingest.ts.
 * Non-throwing: errors are logged but never propagate to the caller.
 */
export async function notifyExternalIntegrations(
  projectId: number,
  projectName: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const integrations = await db
      .select()
      .from(projectIntegrationsTable)
      .where(and(eq(projectIntegrationsTable.projectId, projectId), eq(projectIntegrationsTable.enabled, true)));

    for (const integration of integrations) {
      const allowedTypes = integration.notificationTypes as string[] | null;
      if (allowedTypes && !allowedTypes.includes(eventType)) continue;

      if (integration.integrationType === "slack") {
        await postSlackMessage(integration.webhookUrl, eventType, payload, projectName);
      } else if (integration.integrationType === "teams") {
        await postTeamsMessage(integration.webhookUrl, eventType, payload, projectName);
      }
    }
  } catch (err) {
    logger.warn({ err, projectId, eventType }, "notifyExternalIntegrations failed");
  }
}

/**
 * Send a single test message to a specific integration (by row object).
 */
export async function sendTestNotification(
  integration: ProjectIntegration,
  projectName: string
): Promise<boolean> {
  const testPayload = { l3Count: 3, commitCount: 5 };
  if (integration.integrationType === "slack") {
    return postSlackMessage(integration.webhookUrl, "new_l3_node", testPayload, projectName);
  }
  return postTeamsMessage(integration.webhookUrl, "new_l3_node", testPayload, projectName);
}
```

### Step 3: Create `routes/integrations.ts`

Create `artifacts/api-server/src/routes/integrations.ts`:

```typescript
import { Router } from "express";
import { db } from "@workspace/db";
import { projectIntegrationsTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { logger } from "../lib/logger.js";
import { sendTestNotification } from "../lib/slack-teams-client.js";

const router = Router();

const IntegrationInputSchema = z.object({
  integrationType: z.enum(["slack", "teams"]),
  webhookUrl: z.string().url(),
  enabled: z.boolean().optional().default(true),
  notificationTypes: z.array(z.string()).nullable().optional().default(null),
});

const IntegrationUpdateSchema = z.object({
  webhookUrl: z.string().url().optional(),
  enabled: z.boolean().optional(),
  notificationTypes: z.array(z.string()).nullable().optional(),
});

function serializeIntegration(row: typeof projectIntegrationsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /projects/:id/integrations
router.get("/projects/:id/integrations", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project id" });

    const rows = await db
      .select()
      .from(projectIntegrationsTable)
      .where(eq(projectIntegrationsTable.projectId, projectId));

    return res.json(rows.map(serializeIntegration));
  } catch (err) {
    logger.error({ err }, "Failed to list integrations");
    return res.status(500).json({ error: "Failed to list integrations" });
  }
});

// POST /projects/:id/integrations
router.post("/projects/:id/integrations", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project id" });

    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) return res.status(404).json({ error: "Project not found" });

    const body = IntegrationInputSchema.parse(req.body);

    const [created] = await db
      .insert(projectIntegrationsTable)
      .values({ projectId, ...body })
      .returning();

    return res.status(201).json(serializeIntegration(created));
  } catch (err) {
    logger.error({ err }, "Failed to create integration");
    return res.status(500).json({ error: "Failed to create integration" });
  }
});

// PATCH /integrations/:integrationId
router.patch("/integrations/:integrationId", async (req, res) => {
  try {
    const integrationId = parseInt(req.params.integrationId, 10);
    if (isNaN(integrationId)) return res.status(400).json({ error: "Invalid integration id" });

    const body = IntegrationUpdateSchema.parse(req.body);

    const [updated] = await db
      .update(projectIntegrationsTable)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(projectIntegrationsTable.id, integrationId))
      .returning();

    if (!updated) return res.status(404).json({ error: "Integration not found" });

    return res.json(serializeIntegration(updated));
  } catch (err) {
    logger.error({ err }, "Failed to update integration");
    return res.status(500).json({ error: "Failed to update integration" });
  }
});

// DELETE /integrations/:integrationId
router.delete("/integrations/:integrationId", async (req, res) => {
  try {
    const integrationId = parseInt(req.params.integrationId, 10);
    if (isNaN(integrationId)) return res.status(400).json({ error: "Invalid integration id" });

    const [deleted] = await db
      .delete(projectIntegrationsTable)
      .where(eq(projectIntegrationsTable.id, integrationId))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Integration not found" });

    return res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Failed to delete integration");
    return res.status(500).json({ error: "Failed to delete integration" });
  }
});

// POST /integrations/:integrationId/test
router.post("/integrations/:integrationId/test", async (req, res) => {
  try {
    const integrationId = parseInt(req.params.integrationId, 10);
    if (isNaN(integrationId)) return res.status(400).json({ error: "Invalid integration id" });

    const [integration] = await db
      .select()
      .from(projectIntegrationsTable)
      .where(eq(projectIntegrationsTable.id, integrationId));

    if (!integration) return res.status(404).json({ error: "Integration not found" });

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, integration.projectId));

    const projectName = project?.name ?? `Project #${integration.projectId}`;
    const success = await sendTestNotification(integration, projectName);

    return res.json({ success });
  } catch (err) {
    logger.error({ err }, "Failed to send test notification");
    return res.status(500).json({ error: "Failed to send test notification" });
  }
});

export default router;
```

### Step 4: Register the router in `routes/index.ts`

Add the following import and `router.use()` call:

```typescript
// Add import:
import integrationsRouter from "./integrations";

// Add after existing router.use() calls:
router.use(integrationsRouter);
```

### Step 5: Hook `notifyExternalIntegrations` into `generate.ts`

In `artifacts/api-server/src/routes/generate.ts`, after each existing `db.insert(notificationsTable)` block:

**Hook 1** — Around line 232 (cross_link_detected):

```typescript
// After the existing db.insert(notificationsTable) for cross_link_detected
// (inside the detectCrossProjectLinks function or its call site):
import { notifyExternalIntegrations } from "../lib/slack-teams-client.js";

// After db.insert(notificationsTable).values({ type: "cross_link_detected", ... }):
const projectRow = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
await notifyExternalIntegrations(
  projectId,
  projectRow[0]?.name ?? `Project #${projectId}`,
  "cross_link_detected",
  crossLinkPayload
);
```

**Hook 2** — Around line 625 (new_l3_node):

```typescript
// After db.insert(notificationsTable).values({ type: "new_l3_node", ... }):
const [proj] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
await notifyExternalIntegrations(
  projectId,
  proj?.name ?? `Project #${projectId}`,
  "new_l3_node",
  { l3Count: l3NodesCreated, projectId }
);
```

> **Note**: The `projectsTable` import is already present in `generate.ts`. Only the import of `notifyExternalIntegrations` needs to be added.

### Step 6: Hook `notifyExternalIntegrations` into `ingest.ts`

In `artifacts/api-server/src/routes/ingest.ts`, after each existing `db.insert(notificationsTable)` block:

**Hook 1 and Hook 2** — Lines 180 and 296 (new_commit, for Git and SVN ingestion respectively):

```typescript
import { notifyExternalIntegrations } from "../lib/slack-teams-client.js";

// After db.insert(notificationsTable).values({ type: "new_commit", ... }):
const [proj] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
await notifyExternalIntegrations(
  projectId,
  proj?.name ?? `Project #${projectId}`,
  "new_commit",
  { commitCount: newCommits.length, projectId }
);
```

> The `projectsTable` and `projectId` variable are already available at both call sites in `ingest.ts`.

### Step 7: Update OpenAPI spec

In `lib/api-spec/openapi.yaml`:

1. Add `- name: integrations` to the `tags:` list.
2. Add the 5 new path entries (shown in Section 4) to the `paths:` section.
3. Add the 3 new schema entries (`ProjectIntegration`, `ProjectIntegrationInput`, `ProjectIntegrationUpdate`) to `components.schemas`.

### Step 8: Run Orval codegen

After updating the OpenAPI spec:

```bash
pnpm --filter @workspace/api-spec run generate
```

This generates updated Zod validators in `lib/api-zod/src/` and React Query hooks in `lib/api-client-react/src/`.

### Step 9: Create migration file

Create `docs/db_migrations/002_add_project_integrations.sql` with the SQL shown in Section 3.

---

## 6. Frontend Implementation Steps

### Step 1: Create `artifacts/kg-engine/src/pages/integrations.tsx`

This page mirrors the structure of `subscriptions.tsx`. It allows the user to:

1. Select a project from a dropdown.
2. View existing integrations for that project (displayed as cards).
3. Add a new integration (type selector + URL input + optional event type filter).
4. Toggle `enabled` on an existing integration.
5. Delete an integration.
6. Send a test notification.

**Component structure**:

```tsx
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Slack, MessagesSquare, Plus, Trash2, Send, Loader2, Check, X } from "lucide-react";
import {
  useListProjects,
  getListProjectsQueryKey,
  useListProjectIntegrations,
  getListProjectIntegrationsQueryKey,
  useCreateProjectIntegration,
  useUpdateProjectIntegration,
  useDeleteProjectIntegration,
  useTestProjectIntegration,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

// IntegrationCard component renders one integration row:
// - type badge (Slack / Teams), webhook URL (truncated), enabled toggle, test button, delete button

export default function Integrations() {
  // state: selectedProjectId, newType ("slack"|"teams"), newUrl, adding
  // hooks: useListProjects, useListProjectIntegrations, useCreateProjectIntegration,
  //        useUpdateProjectIntegration, useDeleteProjectIntegration, useTestProjectIntegration
  // handlers: handleAdd, handleToggleEnabled, handleDelete, handleTest
}
```

### Step 2: Register the route in `App.tsx`

```tsx
import Integrations from "@/pages/integrations";

// Add inside <Switch>:
<Route path="/integrations" component={Integrations} />
```

### Step 3: Add nav item in `layout.tsx`

In the "System" section `navSections` array, add after the "Pull Requests" entry:

```tsx
import { Webhook } from "lucide-react"; // or use "Plug" icon

// In the System section items:
{ href: "/integrations", label: "Integrations", icon: Webhook },
```

---

## 7. Integration Details

### Slack Incoming Webhook Setup (user-facing instructions to include in the UI)

1. Go to **https://api.slack.com/apps** → Create App → From Scratch.
2. Under "Features", enable **Incoming Webhooks**.
3. Click **Add New Webhook to Workspace**, select the channel.
4. Copy the generated webhook URL (format: `https://hooks.slack.com/services/T.../B.../...`).
5. Paste the URL in the Docuvia Integrations page.

### Slack Message Format

Docuvia uses [Block Kit](https://api.slack.com/block-kit) with a `section` block containing `mrkdwn` text. The minimal API payload is:

```json
{
  "text": ":bulb: *Docuvia* — New L3 decision nodes generated in project *MyProject*",
  "blocks": [
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": ":bulb: *Docuvia* — ..." }
    },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*L3 Nodes:* 5" }
    }
  ]
}
```

### Microsoft Teams Incoming Webhook Setup (user-facing instructions)

1. Open a Teams channel → click **...** → **Connectors** (or **Workflows** for newer Teams).
2. Find **Incoming Webhook** → Configure → name it "Docuvia".
3. Copy the webhook URL (format: `https://<tenant>.webhook.office.com/webhookb2/...`).
4. Paste the URL in the Docuvia Integrations page.

### Teams Message Format (Legacy MessageCard)

```json
{
  "@type": "MessageCard",
  "@context": "https://schema.org/extensions",
  "themeColor": "107C10",
  "summary": "Docuvia: New L3 Decision Nodes Generated",
  "sections": [
    {
      "activityTitle": "Docuvia — New L3 Decision Nodes Generated",
      "activitySubtitle": "Project: **MyProject**",
      "facts": [
        { "name": "L3 Nodes", "value": "5" }
      ],
      "markdown": true
    }
  ]
}
```

### Supported Event Types

| Event Type | Triggered from | Payload fields |
|------------|---------------|----------------|
| `new_commit` | `ingest.ts` after Git or SVN ingestion | `commitCount`, `projectId` |
| `new_l3_node` | `generate.ts` at end of generate pipeline | `l3Count`, `projectId` |
| `cross_link_detected` | `generate.ts` `detectCrossProjectLinks()` | `sourceNodeId`, `targetNodeId`, `similarity`, `projectId` |

---

## 8. Verification Steps

### Build Verification

```bash
# 1. Type-check the monorepo
pnpm -r typecheck

# 2. Lint
pnpm -r lint

# 3. Build backend
pnpm --filter @workspace/api-server build

# 4. Build frontend
pnpm --filter @workspace/kg-engine build

# 5. Regenerate Orval types after openapi.yaml update
pnpm --filter @workspace/api-spec run generate
```

### Manual Test Scenarios

1. **Create Slack integration**:
   - `POST /api/projects/1/integrations` with `{ "integrationType": "slack", "webhookUrl": "https://hooks.slack.com/..." }`
   - Expect `201` response with the new integration row.

2. **Test notification**:
   - `POST /api/integrations/1/test`
   - Expect `{ "success": true }` and a message appearing in Slack/Teams channel.

3. **Toggle enabled**:
   - `PATCH /api/integrations/1` with `{ "enabled": false }`
   - Run an ingest or generate — no message should appear.

4. **Filter event types**:
   - `POST /api/projects/1/integrations` with `{ "integrationType": "slack", "webhookUrl": "...", "notificationTypes": ["new_l3_node"] }`
   - Ingest commits → no Slack message.
   - Run generate → Slack message appears.

5. **Delete integration**:
   - `DELETE /api/integrations/1`
   - Expect `204`. Further notifications not forwarded.

6. **Frontend**:
   - Navigate to `/integrations`, select a project.
   - Add a Slack webhook URL, click "Add".
   - Card appears with type badge and enabled toggle.
   - Click "Test" → toast or checkmark confirms delivery.

### Error Cases

- Invalid webhook URL (non-HTTPS) → `400` from `z.string().url()` validation.
- Unreachable webhook → `notifyExternalIntegrations` catches the error, logs it, and continues — the main pipeline is never interrupted.
- Integration not found → `404`.

---

## 9. Affected pnpm Workspace Packages

| Package | Changes |
|---------|---------|
| `lib/db` | New `project_integrations.ts` schema, updated `index.ts` |
| `lib/api-spec` | New tag, 5 endpoints, 3 schemas in `openapi.yaml` |
| `lib/api-zod` | Auto-generated by Orval after spec update |
| `lib/api-client-react` | Auto-generated React Query hooks after spec update |
| `artifacts/api-server` | New `slack-teams-client.ts`, new `routes/integrations.ts`, updated `routes/index.ts`, `generate.ts`, `ingest.ts` |
| `artifacts/kg-engine` | New `pages/integrations.tsx`, updated `App.tsx`, `components/layout.tsx` |

---

## 10. Architecture Diagram

```
User (kg-engine)
  └── /integrations page
        ├── POST /api/projects/:id/integrations   → create webhook config
        ├── PATCH /api/integrations/:id           → toggle enabled / update URL
        ├── DELETE /api/integrations/:id          → remove
        └── POST /api/integrations/:id/test       → manual test ping

Event Pipeline (api-server)
  ├── ingest.ts  ─► db.insert(notifications) ─► notifyExternalIntegrations()
  │                                                  │
  └── generate.ts ► db.insert(notifications) ─► notifyExternalIntegrations()
                                                     │
                                     ┌───────────────┴───────────────┐
                                     ▼                               ▼
                             postSlackMessage()             postTeamsMessage()
                             (Block Kit JSON)              (MessageCard JSON)
                                     │                               │
                                     ▼                               ▼
                              Slack Webhook URL             Teams Webhook URL
                              (hooks.slack.com)         (webhook.office.com)

DB: project_integrations
  ├── projectId (FK → projects)
  ├── integrationType  (slack | teams)
  ├── webhookUrl
  ├── enabled
  └── notificationTypes (json array | null = all)
```
