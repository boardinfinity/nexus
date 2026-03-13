import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Jobs from "@/pages/jobs";
import Companies from "@/pages/companies";
import People from "@/pages/people";
import Pipelines from "@/pages/pipelines";
import Monitoring from "@/pages/monitoring";
import Settings from "@/pages/settings";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/jobs" component={Jobs} />
      <Route path="/companies" component={Companies} />
      <Route path="/people" component={People} />
      <Route path="/pipelines" component={Pipelines} />
      <Route path="/monitoring" component={Monitoring} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <main className="flex-1 overflow-auto p-6">
                <AppRouter />
              </main>
            </SidebarInset>
          </SidebarProvider>
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
