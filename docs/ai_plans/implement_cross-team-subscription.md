# Implement: Cross-Team Subscription & In-App Notifications

> **Phase**: 7 — Enhancements & Ecosystem  
> **Priority**: High (only remaining core-platform Phase 7 item)  
> **Created**: 2026-05-13

---

## 1. Feature Description

Cross-team subscription allows users and teams to **watch** specific projects (or individual knowledge nodes) and receive in-app notifications whenever the system performs significant events:

- A new ingest run completes (new commits processed)
- A generate pipeline run completes (new L2/L3 nodes created)
- A cross-project link is detected (high-similarity node match)
- A review task is created that touches a watched entity

Notifications are stored in the database and surfaced in the frontend via a **notification bell** in the top navigation bar. Subscribers can also be referenced by name/email for future email delivery expansion.

This feature leverages all existing infrastructure: the `projectsTable`, `activityLogTable`, all knowledge graph schemas, and the existing ingest/generate pipeline hooks.

---

## 2. Database Schema Changes

### 2.1 New File: `lib/db/src/schema/subscriptions.ts`

```typescript
import { pgTable, text, serial, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const watchEntityTypeEnum = pgEnum("watch_entity_type", [
  "project",
  "l1_tag",
  "l2_node",
  "l3_node",
]);

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  subscriberName: text("subscriber_name").notNull(),
  subscriberEmail: text("subscriber_email"),
  watchEntityType: watchEntityTypeEnum("watch_entity_type").notNull().default("project"),
  watchEntityId: integer("watch_entity_id"),          // null = watch entire project
  notifyOnIngest: boolean("notify_on_ingest").notNull().default(true),
  notifyOnGenerate: boolean("notify_on_generate").notNull().default(true),
  notifyOnReview: boolean("notify_on_review").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
```

### 2.2 New File: `lib/db/src/schema/notifications.ts`

```typescript
import { pgTable, text, serial, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { subscriptionsTable } from "./subscriptions";
import { projectsTable } from "./projects";

export const notificationEventTypeEnum = pgEnum("notification_event_type", [
  "ingest_completed",
  "generate_completed",
  "cross_link_detected",
  "review_created",
]);

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id")
    .notNull()
    .references(() => subscriptionsTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  eventType: notificationEventTypeEnum("event_type").notNull(),
  summary: text("summary").notNull(),
  metadata: text("metadata"),            // JSON string: { commitCount, l2Count, l3Count, ... }
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
```

### 2.3 Update `lib/db/src/schema/index.ts`

Add re-exports for both new schemas:

```typescript
export * from "./subscriptions";
export * from "./notifications";
```

---

## 3. API Endpoints (OpenAPI paths to add to `lib/api-spec/openapi.yaml`)

### Tag to add

```yaml
- name: subscriptions
  description: Cross-team project subscriptions and in-app notifications
```

### New Paths

```
POST   /projects/{id}/subscriptions        # Create a subscription for a project
GET    /projects/{id}/subscriptions        # List all subscriptions for a project
DELETE /subscriptions/{subId}              # Delete (unsubscribe)
GET    /notifications                      # List notifications (query: ?unreadOnly=true&limit=50)
PATCH  /notifications/{id}/read            # Mark single notification as read
PATCH  /notifications/read-all             # Mark all notifications as read
```

### New Schemas to add to `components/schemas`

- `Subscription` (id, projectId, subscriberName, subscriberEmail, watchEntityType, watchEntityId, notifyOnIngest, notifyOnGenerate, notifyOnReview, createdAt)
- `SubscriptionInput` (subscriberName, subscriberEmail?, watchEntityType?, watchEntityId?, notifyOnIngest?, notifyOnGenerate?, notifyOnReview?)
- `Notification` (id, subscriptionId, projectId, eventType, summary, metadata, isRead, createdAt)
- `NotificationList` (items: Notification[], unreadCount: number)

---

## 4. Backend Implementation Steps

### Step 1: Drizzle Schema Files
Create `lib/db/src/schema/subscriptions.ts` and `lib/db/src/schema/notifications.ts` as shown in Section 2. Update `lib/db/src/schema/index.ts` to export both.

### Step 2: Subscription Event Utility
Create `artifacts/api-server/src/lib/subscription-notifier.ts`:

```typescript
import { db } from "@workspace/db";
import { subscriptionsTable, notificationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

type NotifyEvent = "ingest_completed" | "generate_completed" | "cross_link_detected" | "review_created";

export async function fireSubscriptionEvent(
  projectId: number,
  eventType: NotifyEvent,
  summary: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  // Determine which notify flag to check
  const flagMap: Record<NotifyEvent, keyof typeof subscriptionsTable> = {
    ingest_completed: "notifyOnIngest",
    generate_completed: "notifyOnGenerate",
    cross_link_detected: "notifyOnGenerate",
    review_created: "notifyOnReview",
  };

  const flag = flagMap[eventType];

  // Fetch matching subscriptions
  const subs = await db
    .select()
    .from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.projectId, projectId), eq(subscriptionsTable[flag] as any, true)));

  if (subs.length === 0) return;

  // Bulk insert notifications
  await db.insert(notificationsTable).values(
    subs.map((sub) => ({
      subscriptionId: sub.id,
      projectId,
      eventType,
      summary,
      metadata: metadata ? JSON.stringify(metadata) : null,
      isRead: false,
    }))
  );
}
```

### Step 3: Subscription Routes
Create `artifacts/api-server/src/routes/subscriptions.ts`:

- `POST /projects/:id/subscriptions` — validate `SubscriptionInput` with Zod, insert into `subscriptionsTable`, return created row
- `GET /projects/:id/subscriptions` — return all subscriptions for a project (join project to validate exists)
- `DELETE /subscriptions/:subId` — delete by id

### Step 4: Notification Routes
Create `artifacts/api-server/src/routes/notifications.ts`:

- `GET /notifications` — support `?unreadOnly=true&limit=N`; return `{ items: Notification[], unreadCount: number }`
- `PATCH /notifications/:id/read` — set `isRead = true` for one notification
- `PATCH /notifications/read-all` — set `isRead = true` for all

### Step 5: Wire Routes into `artifacts/api-server/src/app.ts`
Register the two new routers:
```typescript
import subscriptionsRouter from "./routes/subscriptions.js";
import notificationsRouter from "./routes/notifications.js";
// ...
app.use("/api", subscriptionsRouter);
app.use("/api", notificationsRouter);
```

### Step 6: Hook into Existing Pipelines
In `artifacts/api-server/src/routes/ingest.ts`, after a successful git or SVN ingest response is built, call:
```typescript
await fireSubscriptionEvent(projectId, "ingest_completed",
  `Ingest completed: ${newCommits} new commits processed`,
  { commitCount: newCommits, mode });
```

In `artifacts/api-server/src/routes/generate.ts`, after the generate pipeline finishes building the response, call:
```typescript
await fireSubscriptionEvent(projectId, "generate_completed",
  `Knowledge graph updated: ${l2Count} modules, ${l3Count} decisions`,
  { l2Count, l3Count, reviewTasksCreated });
```

In `artifacts/api-server/src/routes/generate.ts`, inside `detectCrossProjectLinks()`, when a cross-project review task is created, call:
```typescript
await fireSubscriptionEvent(projectId, "cross_link_detected",
  `Cross-project link detected to project ${targetProjectId} (similarity: ${score.toFixed(2)})`,
  { targetProjectId, similarity: score });
```

---

## 5. OpenAPI Spec Changes (`lib/api-spec/openapi.yaml`)

1. Add `subscriptions` to `tags` array
2. Add the 6 new paths listed in Section 3
3. Add the 4 new schema objects under `components/schemas`
4. Run `pnpm orval` in `lib/api-spec/` to regenerate `lib/api-zod/` and `lib/api-client-react/`

---

## 6. Frontend Implementation Steps

### Step 6.1: Subscriptions Page
Create `artifacts/kg-engine/src/pages/subscriptions.tsx`:

- Two-panel layout:
  - **Left panel**: List of existing subscriptions (grouped by project). Each row shows subscriber name, email (if set), watch scope, and notify flags. "Delete" button per row.
  - **Right panel / Dialog**: "Add Subscription" form. Fields: Project (select), Subscriber Name (text), Email (optional), Watch Scope (project/l2_node), Entity ID (optional number), Notify on Ingest (checkbox), Notify on Generate (checkbox), Notify on Review (checkbox).
- Uses generated `useGetProjectsIdSubscriptions`, `usePostProjectsIdSubscriptions`, `useDeleteSubscriptionsSubId` hooks (after Orval codegen)

### Step 6.2: Notification Panel in Layout Header
Update `artifacts/kg-engine/src/components/layout.tsx` (or wherever the `<Layout>` component lives):

- Import generated `useGetNotifications` hook (polling every 30s with `refetchInterval`)
- Render a `<Bell>` icon (from `lucide-react`) with a badge showing `unreadCount` when > 0
- On click: popover/dropdown showing last 10 notifications with timestamp, summary, event type badge (colored by type: ingest=blue, generate=green, link=amber, review=orange)
- "Mark all as read" button at top of dropdown

### Step 6.3: Subscribe Button on Project Detail
In `artifacts/kg-engine/src/pages/projects/[id].tsx`, add a "Subscribe" button in the project header area that opens a simplified subscription dialog (pre-filled with current project, watch scope = project).

### Step 6.4: Register Route
In `artifacts/kg-engine/src/App.tsx`:
```typescript
import Subscriptions from "@/pages/subscriptions";
// inside <Switch>:
<Route path="/subscriptions" component={Subscriptions} />
```

### Step 6.5: Add Nav Item
In the `<Layout>` sidebar navigation, add a "Subscriptions" nav link with `Bell` icon pointing to `/subscriptions`.

---

## 7. Affected Workspace Packages

| Package | Changes |
|---|---|
| `lib/db` | 2 new schema files, updated `index.ts` |
| `lib/api-spec` | 6 new paths, 4 new schemas in `openapi.yaml` |
| `lib/api-zod` | Re-generated by Orval after spec change |
| `lib/api-client-react` | Re-generated by Orval after spec change |
| `artifacts/api-server` | 2 new route files, 1 utility, hooks in `ingest.ts` + `generate.ts`, `app.ts` registration |
| `artifacts/kg-engine` | 1 new page, notification panel in layout, subscribe button in project detail, new nav item, `App.tsx` route |

---

## 8. Acceptance Criteria

1. **Subscription CRUD**: User can create, list, and delete subscriptions for any project via the `/subscriptions` page.
2. **Ingest trigger**: After a successful git or SVN ingest call, all matching subscriptions with `notifyOnIngest=true` receive a notification record in the database.
3. **Generate trigger**: After a successful generate pipeline run, all matching subscriptions with `notifyOnGenerate=true` receive a notification record.
4. **Cross-link trigger**: When `detectCrossProjectLinks()` creates a cross-project review task, a `cross_link_detected` notification is inserted for all subscriptions of the source project with `notifyOnGenerate=true`.
5. **Notification bell**: The frontend header displays an unread notification count badge that updates automatically (polling interval ≤ 30s).
6. **Notification read state**: User can mark individual or all notifications as read; unread count updates accordingly.
7. **No breaking changes**: All existing routes, schemas, and frontend pages continue to function unchanged.
8. **TypeScript**: All new files pass `tsc --noEmit` without errors.

---

## 9. Recommended Agent Chain

| Step | Agent | Task |
|---|---|---|
| 1 | `Database Schema Expert` | Create `subscriptions.ts`, `notifications.ts`, update `index.ts` |
| 2 | `API Architect` | Update `openapi.yaml` with new paths/schemas, run Orval codegen |
| 3 | `Backend Developer` | Implement `subscription-notifier.ts`, `routes/subscriptions.ts`, `routes/notifications.ts`, register in `app.ts`, hook into `ingest.ts` and `generate.ts` |
| 4 | `Frontend Developer` | Implement `pages/subscriptions.tsx`, notification panel in layout, subscribe button in project detail, nav item, route registration |
