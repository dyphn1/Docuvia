import { useState } from "react";
import {
  useListL1Tags,
  getListL1TagsQueryKey,
  useCreateL1Tag,
  useUpdateL1Tag,
  useDeleteL1Tag,
  type L1Tag,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tags, Plus, Search, Trash2 } from "lucide-react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function L1Tags() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const [newTag, setNewTag] = useState({ name: "", category: "domain", description: "" });

  const { data: tagsData, isLoading } = useListL1Tags({
    query: { queryKey: getListL1TagsQueryKey() },
  });

  const createTag = useCreateL1Tag();
  const updateTag = useUpdateL1Tag();
  const deleteTag = useDeleteL1Tag();

  const handleCreate = () => {
    if (!newTag.name || !newTag.category) return;
    createTag.mutate(
      { data: { ...newTag, isAnchored: true } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListL1TagsQueryKey() });
          setIsDialogOpen(false);
          setNewTag({ name: "", category: "domain", description: "" });
        },
      }
    );
  };

  const handleToggleAnchor = (id: number, isAnchored: boolean) => {
    updateTag.mutate(
      { id, data: { isAnchored: !isAnchored } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListL1TagsQueryKey() });
        },
      }
    );
  };

  const handleDelete = (id: number) => {
    deleteTag.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListL1TagsQueryKey() });
        },
      }
    );
  };

  const tags = Array.isArray(tagsData) ? (tagsData as L1Tag[]) : [];

  const filteredTags = tags.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">L1 Tags</h1>
          <p className="text-muted-foreground mt-1 text-sm">Global domain concepts and taxonomy</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> New L1 Tag
            </Button>
          </DialogTrigger>
          <DialogContent className="border-border bg-card">
            <DialogHeader>
              <DialogTitle>Create L1 Tag</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Tag Name</label>
                <Input
                  value={newTag.name}
                  onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
                  placeholder="e.g. Authentication"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Category</label>
                <Input
                  value={newTag.category}
                  onChange={(e) => setNewTag({ ...newTag, category: e.target.value })}
                  placeholder="e.g. domain, infrastructure"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <Input
                  value={newTag.description}
                  onChange={(e) => setNewTag({ ...newTag, description: e.target.value })}
                  placeholder="Optional description"
                />
              </div>
              <Button className="w-full mt-4" onClick={handleCreate} disabled={createTag.isPending}>
                {createTag.isPending ? "Creating..." : "Create Tag"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tags..."
            className="pl-9 bg-card/50"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="border border-border/50 rounded-lg overflow-hidden bg-card/50 backdrop-blur-sm flex-1 flex flex-col">
        <div className="overflow-y-auto flex-1">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 border-b border-border/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>Tag</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-center">Anchored</TableHead>
                <TableHead className="text-right">Usage</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    Loading tags...
                  </TableCell>
                </TableRow>
              ) : filteredTags.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No tags found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredTags.map((tag) => (
                  <TableRow key={tag.id} className="border-border/50 hover:bg-accent/50 group">
                    <TableCell>
                      <div className="flex items-center gap-2 font-mono text-primary font-medium">
                        <Tags className="h-3 w-3 text-muted-foreground" />
                        {tag.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase font-mono bg-background border-border/50"
                      >
                        {tag.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate text-muted-foreground text-sm">
                      {tag.description || "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={tag.isAnchored}
                        onCheckedChange={() => handleToggleAnchor(tag.id, tag.isAnchored || false)}
                        className="data-[state=checked]:bg-primary"
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{tag.usageCount}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {format(new Date(tag.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleDelete(tag.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
