import { useState, useMemo } from "react";
import {
  useListProjectL2Nodes,
  useListL1Tags,
  useConfirmBootstrap,
  getListProjectL2NodesQueryKey,
  getListL1TagsQueryKey,
  type L2Node,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "sonner";
import { CheckCircle2, XCircle, FileCode, Check } from "lucide-react";
import {
  DECISION_APPROVE,
  DECISION_REJECT,
  UNCATEGORIZED_TAG_LABEL,
  L2_EXISTING_MODULE_BADGE_TEXT,
  L2_NO_PATHS_TEXT,
  L2_NEW_MODULE_BADGE_TEXT,
  L2_APPROVED_BADGE_TEXT,
  L2_REJECTED_BADGE_TEXT,
  L2_NO_DESCRIPTION_TEXT,
  L2_APPROVE_BUTTON_TEXT,
  L2_REJECT_BUTTON_TEXT,
  L2_PATH_PATTERNS_LABEL,
  L2_PATH_PATTERNS_PLACEHOLDER,
  L2_BOOTSTRAP_CONFIRMED_TOAST,
  L2_BOOTSTRAP_CONFIRM_ERROR_PREFIX,
  L2_SELECT_DECISION_ERROR_TOAST,
  L2_REVIEW_TITLE,
  L2_REVIEW_DESCRIPTION,
  L2_APPROVE_ALL_BUTTON_TEXT,
  L2_SUBMIT_SAVING_TEXT,
  L2_SUBMIT_BUTTON_TEXT,
  L2_NO_MODULES_TEXT,
} from "@/constants/app";

type Decision = "approve" | "reject";

function isPendingConfirmation(node: L2Node): boolean {
  return node.aiGenerated && !node.isBootstrapConfirmed;
}

function ExistingModuleCard({ node }: { node: L2Node }) {
  return (
    <Card className="opacity-60 bg-muted">
      <CardContent className="p-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <FileCode className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">{node.name}</span>
          <Badge variant="outline" className="text-[10px]">
            {L2_EXISTING_MODULE_BADGE_TEXT}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground truncate max-w-sm">
          {node.pathPatterns?.join(", ") || L2_NO_PATHS_TEXT}
        </div>
      </CardContent>
    </Card>
  );
}

interface NewModuleReviewCardProps {
  node: L2Node;
  decision?: Decision;
  pathValue: string;
  onApprove: () => void;
  onReject: () => void;
  onPathChange: (value: string) => void;
}

function NewModuleReviewCard({
  node,
  decision,
  pathValue,
  onApprove,
  onReject,
  onPathChange,
}: NewModuleReviewCardProps) {
  return (
    <Card
      className={`transition-colors border-l-4 ${
        decision === DECISION_APPROVE
          ? "border-l-green-500 bg-green-500/5"
          : decision === DECISION_REJECT
            ? "border-l-red-500 bg-red-500/5"
            : "border-l-blue-500"
      }`}
    >
      <CardContent className="p-4 flex flex-col gap-3">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold">{node.name}</span>
              <Badge className="bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 text-[10px] border-blue-500/20">
                {L2_NEW_MODULE_BADGE_TEXT}
              </Badge>
              {decision === DECISION_APPROVE && (
                <Badge variant="outline" className="text-green-500 border-green-500/30 text-[10px]">
                  <Check className="h-3 w-3 mr-1" /> {L2_APPROVED_BADGE_TEXT}
                </Badge>
              )}
              {decision === DECISION_REJECT && (
                <Badge variant="outline" className="text-red-500 border-red-500/30 text-[10px]">
                  <XCircle className="h-3 w-3 mr-1" /> {L2_REJECTED_BADGE_TEXT}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {node.description || L2_NO_DESCRIPTION_TEXT}
            </p>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button
              size="sm"
              variant={decision === DECISION_APPROVE ? "default" : "outline"}
              className={
                decision === DECISION_APPROVE
                  ? "bg-green-600 hover:bg-green-700"
                  : "hover:text-green-600 hover:border-green-600"
              }
              onClick={onApprove}
            >
              {L2_APPROVE_BUTTON_TEXT}
            </Button>
            <Button
              size="sm"
              variant={decision === DECISION_REJECT ? "destructive" : "outline"}
              className={
                decision === DECISION_REJECT ? "" : "hover:text-red-600 hover:border-red-600"
              }
              onClick={onReject}
            >
              {L2_REJECT_BUTTON_TEXT}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 mt-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {L2_PATH_PATTERNS_LABEL}
          </span>
          <textarea
            value={pathValue}
            onChange={(e) => onPathChange(e.target.value)}
            placeholder={L2_PATH_PATTERNS_PLACEHOLDER}
            className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function L2BootstrapReview({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();

  const { data: l2Nodes, isLoading: isL2Loading } = useListProjectL2Nodes(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectL2NodesQueryKey(projectId) },
  });

  const { data: l1Tags, isLoading: isL1Loading } = useListL1Tags({
    query: { enabled: true, queryKey: getListL1TagsQueryKey() },
  });

  const { mutate: confirmBootstrap, isPending } = useConfirmBootstrap({
    mutation: {
      onSuccess: () => {
        toast.success(L2_BOOTSTRAP_CONFIRMED_TOAST);
        queryClient.invalidateQueries({ queryKey: getListProjectL2NodesQueryKey(projectId) });
      },
      onError: (error) => {
        toast.error(`${L2_BOOTSTRAP_CONFIRM_ERROR_PREFIX}${error.message}`);
      },
    },
  });

  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [pathEdits, setPathEdits] = useState<Record<number, string>>({});

  const groupedNodes = useMemo(() => {
    if (!l2Nodes || !l1Tags) return {};

    const tagMap = new Map(l1Tags.map((t) => [t.id, t.name]));

    const grouped: Record<string, typeof l2Nodes> = {};
    for (const node of l2Nodes) {
      const tagId = node.l1TagIds?.[0]; // Assuming primarily single L1 tag for simplicity
      const tagName = tagId
        ? (tagMap.get(tagId) ?? UNCATEGORIZED_TAG_LABEL)
        : UNCATEGORIZED_TAG_LABEL;

      if (!grouped[tagName]) {
        grouped[tagName] = [];
      }
      grouped[tagName].push(node);
    }
    return grouped;
  }, [l2Nodes, l1Tags]);

  if (isL2Loading || isL1Loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const unconfirmedNodes = l2Nodes?.filter(isPendingConfirmation) || [];

  if (unconfirmedNodes.length === 0) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <CheckCircle2 className="mx-auto h-12 w-12 text-primary mb-4 opacity-50" />
        <p>{L2_NO_MODULES_TEXT}</p>
      </div>
    );
  }

  const handleApproveAll = () => {
    const newDecisions = { ...decisions };
    unconfirmedNodes.forEach((n) => {
      newDecisions[n.id] = DECISION_APPROVE;
    });
    setDecisions(newDecisions);
  };

  const handleSubmit = () => {
    const approvedModules: { id: number; pathPatterns: string[] }[] = [];
    const rejectedModuleIds: number[] = [];

    for (const node of unconfirmedNodes) {
      const decision = decisions[node.id];
      if (decision === DECISION_APPROVE) {
        const customPath = pathEdits[node.id];
        const patterns = customPath
          ? customPath
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : node.pathPatterns || [];
        approvedModules.push({ id: node.id, pathPatterns: patterns });
      } else if (decision === DECISION_REJECT) {
        rejectedModuleIds.push(node.id);
      }
    }

    if (approvedModules.length === 0 && rejectedModuleIds.length === 0) {
      toast.error(L2_SELECT_DECISION_ERROR_TOAST);
      return;
    }

    confirmBootstrap({
      id: projectId,
      data: {
        approvedModules,
        rejectedModuleIds,
      },
    });
  };

  return (
    <div className="p-6 flex flex-col h-full overflow-hidden">
      <div className="flex justify-between items-center mb-6 shrink-0">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{L2_REVIEW_TITLE}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{L2_REVIEW_DESCRIPTION}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleApproveAll}>
            {L2_APPROVE_ALL_BUTTON_TEXT}
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? L2_SUBMIT_SAVING_TEXT : L2_SUBMIT_BUTTON_TEXT}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 rounded-md border bg-muted/20">
        <div className="p-4 space-y-8">
          {Object.entries(groupedNodes).map(([tagName, nodes]) => {
            const hasUnconfirmed = nodes.some(isPendingConfirmation);
            if (!hasUnconfirmed) return null;

            return (
              <div key={tagName} className="space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b">
                  <Badge variant="secondary">{tagName}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {nodes.length} module{nodes.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="grid gap-3">
                  {nodes.map((node) => {
                    if (!isPendingConfirmation(node)) {
                      return <ExistingModuleCard key={node.id} node={node} />;
                    }

                    const editedPath = pathEdits[node.id];
                    const pathValue =
                      editedPath !== undefined ? editedPath : node.pathPatterns?.join("\n") || "";

                    return (
                      <NewModuleReviewCard
                        key={node.id}
                        node={node}
                        decision={decisions[node.id]}
                        pathValue={pathValue}
                        onApprove={() =>
                          setDecisions((d) => ({ ...d, [node.id]: DECISION_APPROVE }))
                        }
                        onReject={() => setDecisions((d) => ({ ...d, [node.id]: DECISION_REJECT }))}
                        onPathChange={(value) =>
                          setPathEdits((prev) => ({ ...prev, [node.id]: value }))
                        }
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
