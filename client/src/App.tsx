import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthProvider, useAuth } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Jobs from "@/pages/jobs";
import Companies from "@/pages/companies";
import People from "@/pages/people";
import Pipelines from "@/pages/pipelines";
import Schedules from "@/pages/schedules";
import Monitoring from "@/pages/monitoring";
import Settings from "@/pages/settings";
import Taxonomy from "@/pages/taxonomy";
import JDAnalyzer from "@/pages/jd-analyzer";
import UploadPage from "@/pages/upload";
import Analytics from "@/pages/analytics";
import SurveyAdmin from "@/pages/survey-admin";
import Login from "@/pages/login";
import SurveyLanding from "@/pages/survey-landing";
import SurveyForm from "@/pages/survey-form";
import { Loader2 } from "lucide-react";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/jobs" component={Jobs} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/companies" component={Companies} />
      <Route path="/people" component={People} />
      <Route path="/upload" component={UploadPage} />
      <Route path="/pipelines" component={Pipelines} />
      <Route path="/schedules" component={Schedules} />
      <Route path="/monitoring" component={Monitoring} />
      <Route path="/settings" component={Settings} />
      <Route path="/taxonomy" component={Taxonomy} />
      <Route path="/jd-analyzer" component={JDAnalyzer} />
      <Route path="/survey-admin" component={SurveyAdmin} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <main className="flex-1 overflow-auto p-6">
          <AppRouter />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

/** Top-level router: survey pages are standalone (no sidebar/auth), everything else goes through main app. */
function RootRouter() {
  const [location] = useLocation();

  // Survey pages are standalone — no sidebar, no main app auth
  if (location === "/survey" || location.startsWith("/survey/")) {
    return (
      <Switch>
        <Route path="/survey" component={SurveyLanding} />
        <Route path="/survey/form" component={SurveyForm} />
      </Switch>
    );
  }

  return <AuthenticatedApp />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthProvider>
          <Router hook={useHashLocation}>
            <RootRouter />
          </Router>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
