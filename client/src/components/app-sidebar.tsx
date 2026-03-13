import { useLocation, Link } from "wouter";
import {
  LayoutDashboard, Briefcase, Building2, Users,
  GitBranch, Activity, Settings, Database, LogOut,
  BookOpen, Sparkles,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupContent, SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useQuery } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

const navItems = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Jobs", href: "/jobs", icon: Briefcase },
  { title: "Companies", href: "/companies", icon: Building2 },
  { title: "People", href: "/people", icon: Users },
  { title: "Pipelines", href: "/pipelines", icon: GitBranch },
  { title: "Taxonomy", href: "/taxonomy", icon: BookOpen },
  { title: "JD Analyzer", href: "/jd-analyzer", icon: Sparkles },
  { title: "Monitoring", href: "/monitoring", icon: Activity },
  { title: "Settings", href: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, signOut } = useAuth();

  const { data: credits } = useQuery<Array<{
    provider: string;
    credits_used: number;
    credits_allocated: number;
    usage_pct: number;
  }>>({
    queryKey: ["/api/providers/credits"],
    refetchInterval: 60000,
  });

  const totalUsed = credits?.reduce((s, c) => s + (c.credits_used || 0), 0) ?? 0;
  const totalAllocated = credits?.reduce((s, c) => s + (c.credits_allocated || 0), 0) ?? 1;
  const usagePct = Math.round((totalUsed / totalAllocated) * 100);

  return (
    <Sidebar data-testid="app-sidebar">
      <SidebarHeader className="px-4 py-5">
        <div className="flex items-center gap-2">
          <Database className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-lg font-bold tracking-tight text-foreground">NEXUS</h1>
            <p className="text-[10px] text-muted-foreground leading-none">Board Infinity Data Intelligence</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.href ||
                  (item.href !== "/" && location.startsWith(item.href));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive} data-testid={`nav-${item.title.toLowerCase()}`}>
                      <Link href={item.href}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-4 pb-4 space-y-3">
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Credits Used</span>
            <span>{usagePct}%</span>
          </div>
          <Progress value={usagePct} className="h-1.5" />
          <p className="text-[10px] text-muted-foreground">
            {totalUsed.toLocaleString()} / {totalAllocated.toLocaleString()} this month
          </p>
        </div>
        {user && (
          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-[11px] text-muted-foreground truncate max-w-[140px]" title={user.email || ""}>
              {user.email}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={signOut}
              data-testid="btn-signout"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
