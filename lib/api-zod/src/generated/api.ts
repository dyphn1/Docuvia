import { z } from "zod";

// Minimal hand-written stubs for missing Orval-generated Zod schemas.
// These are intentionally permissive to unblock typechecking; real generated
// schemas should replace these after fixing codegen.

export const HealthCheckResponse = z.object({ status: z.string() });

export const IngestSvnBody = z.object({
  svnUrl: z.string(),
  username: z.string().optional(),
  password: z.string().optional(),
  startRevision: z.number().optional(),
  endRevision: z.union([z.string(), z.number()]).optional(),
});

export const CreateL1TagBody = z.object({ name: z.string(), category: z.string().optional(), description: z.string().optional(), isAnchored: z.boolean().optional() });
export const UpdateL1TagParams = z.object({ id: z.number().or(z.string()) });
export const UpdateL1TagBody = z.object({ name: z.string().optional(), category: z.string().optional(), description: z.string().optional() });
export const DeleteL1TagParams = z.object({ id: z.number().or(z.string()) });

export const CreateL2NodeBody = z.object({ projectId: z.number(), name: z.string(), type: z.string().optional(), description: z.string().optional(), l1TagIds: z.array(z.number()).optional() });
export const UpdateL2NodeParams = z.object({ id: z.number().or(z.string()) });
export const UpdateL2NodeBody = z.object({ name: z.string().optional(), description: z.string().optional(), type: z.string().optional(), l1TagIds: z.array(z.number()).optional() });
export const DeleteL2NodeParams = z.object({ id: z.number().or(z.string()) });

export const ListL3NodesParams = z.object({ id: z.number().or(z.string()) });
export const CreateL3NodeParams = z.object({ id: z.number().or(z.string()) });
export const CreateL3NodeBody = z.object({ title: z.string(), content: z.string().optional(), nodeType: z.string().optional() });
export const UpdateL3NodeParams = z.object({ id: z.number().or(z.string()) });
export const UpdateL3NodeBody = z.object({ title: z.string().optional(), content: z.string().optional() });
export const DeleteL3NodeParams = z.object({ id: z.number().or(z.string()) });

export const CreateProjectBody = z.object({ name: z.string(), repoUrl: z.string().optional(), description: z.string().optional() });
export const UpdateProjectParams = z.object({ id: z.number().or(z.string()) });
export const UpdateProjectBody = z.object({ name: z.string().optional(), repoUrl: z.string().optional(), description: z.string().optional() });
export const DeleteProjectParams = z.object({ id: z.number().or(z.string()) });
export const GetProjectParams = z.object({ id: z.number().or(z.string()) });
export const GetProjectGraphParams = z.object({ id: z.number().or(z.string()) });
export const ListCommitsParams = z.object({ id: z.number().or(z.string()) });
export const CreateCommitParams = z.object({ id: z.number().or(z.string()) });
export const CreateCommitBody = z.object({ hash: z.string(), message: z.string(), author: z.string().optional(), valid: z.boolean().optional(), l2NodeId: z.number().optional() });
export const ListProjectL2NodesParams = z.object({ id: z.number().or(z.string()) });

export const ListProjectNotificationsParams = z.object({ projectId: z.number().or(z.string()) });
export const ListProjectNotificationsQueryParams = z.object({ unreadOnly: z.boolean().optional() });
export const MarkNotificationReadParams = z.object({ notificationId: z.number().or(z.string()) });
export const MarkAllNotificationsReadBody = z.object({ projectId: z.number() });

export const ResolveReviewTaskParams = z.object({ id: z.number().or(z.string()) });
export const ResolveReviewTaskBody = z.object({ status: z.string(), correctedValue: z.string().optional() });

export const CreateSubscriptionBody = z.object({ subscriberProjectId: z.number(), publisherProjectId: z.number() });
export const DeleteSubscriptionParams = z.object({ subscriptionId: z.number().or(z.string()) });
export const ListProjectSubscriptionsParams = z.object({ projectId: z.number().or(z.string()) });

export const GithubWebhookBody = z.object({}).passthrough();

// Ensure default export not present; consumers import named symbols

