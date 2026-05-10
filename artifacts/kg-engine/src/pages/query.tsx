import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, BrainCircuit, Network, Tag, GitMerge } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Query() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setIsSearching(true);
    // Simulate search delay
    setTimeout(() => {
      setIsSearching(false);
      setHasSearched(true);
    }, 800);
  };

  return (
    <div className="p-6 h-full flex flex-col max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8 text-center space-y-4 pt-12">
        <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-full mb-2">
          <BrainCircuit className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Semantic Graph Query</h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Search across all projects, components, and commits. The engine will traverse the L1→L2→L3 hierarchy to find relevant knowledge.
        </p>
      </div>

      <form onSubmit={handleSearch} className="relative max-w-3xl mx-auto w-full mb-12">
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-primary/30 rounded-xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
          <div className="relative flex items-center bg-card border border-border/80 rounded-xl overflow-hidden shadow-lg">
            <Search className="h-5 w-5 ml-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g., 'How does the authentication module handle token refresh?'"
              className="flex-1 border-0 bg-transparent h-14 text-base focus-visible:ring-0 focus-visible:ring-offset-0 px-4"
            />
            <Button type="submit" size="lg" className="h-full rounded-none px-8 font-semibold bg-primary hover:bg-primary/90 text-primary-foreground" disabled={!query.trim() || isSearching}>
              {isSearching ? "Traversing..." : "Search"}
            </Button>
          </div>
        </div>
      </form>

      {hasSearched && !isSearching && (
        <div className="flex-1 space-y-8 animate-in fade-in duration-500">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Network className="h-5 w-5 text-primary" />
              Graph Results
            </h2>
            <div className="text-sm text-muted-foreground font-mono">Found 3 paths</div>
          </div>

          <div className="space-y-6">
            {/* Stubbed result 1 */}
            <div className="relative pl-6 border-l-2 border-primary/30 space-y-4 pb-6">
              <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-background border-2 border-primary"></div>
              
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="bg-card text-xs font-mono"><Tag className="h-3 w-3 mr-1" /> Authentication</Badge>
                <span className="text-muted-foreground text-sm">→</span>
                <Badge variant="outline" className="bg-card text-xs font-mono"><GitMerge className="h-3 w-3 mr-1" /> auth-service</Badge>
              </div>
              
              <Card className="bg-card border-border/50 hover:border-primary/50 transition-colors">
                <CardHeader className="py-3 px-4 border-b border-border/50 bg-muted/20">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base">Token Refresh Strategy</CardTitle>
                    <Badge className="bg-primary/20 text-primary hover:bg-primary/30">RULE</Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-4 text-sm text-muted-foreground leading-relaxed font-mono">
                  Tokens are refreshed silently 5 minutes before expiration via the /refresh endpoint. If the refresh token is invalid, the user is immediately redirected to login.
                </CardContent>
              </Card>
            </div>

            {/* Stubbed result 2 */}
            <div className="relative pl-6 border-l-2 border-primary/30 space-y-4 pb-6">
              <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-background border-2 border-primary/50"></div>
              
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="bg-card text-xs font-mono"><Tag className="h-3 w-3 mr-1" /> Security</Badge>
                <span className="text-muted-foreground text-sm">→</span>
                <Badge variant="outline" className="bg-card text-xs font-mono"><GitMerge className="h-3 w-3 mr-1" /> api-gateway</Badge>
              </div>
              
              <Card className="bg-card border-border/50 hover:border-primary/50 transition-colors">
                <CardHeader className="py-3 px-4 border-b border-border/50 bg-muted/20">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base">Session Invalidation</CardTitle>
                    <Badge variant="secondary" className="bg-secondary text-secondary-foreground hover:bg-secondary/80">CHANGE</Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-4 text-sm text-muted-foreground leading-relaxed font-mono">
                  Added logic to clear Redis cache on explicit logout to prevent replay attacks with stale tokens.
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}