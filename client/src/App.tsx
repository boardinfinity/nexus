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
import JobCollection from "@/pages/pipelines/job-collection";
import JDIntelligence from "@/pages/pipelines/jd-intelligence";
import PeopleAlumni from "@/pages/pipelines/people-alumni";
import DataQualityPipelines from "@/pages/pipelines/data-quality";
import CompanyIntel from "@/pages/pipelines/company-intel";
import Schedules from "@/pages/schedules";
import Monitoring from "@/pages/monitoring";
import Settings from "@/pages/settings";
import Taxonomy from "@/pages/taxonomy";
import JDAnalyzer from "@/pages/jd-analyzer";
import UploadPage from "@/pages/upload";
import { Redirect } from "wouter";
import SurveyAdmin from "@/pages/survey-admin";
import Reports from "@/pages/reports";
import Login from "@/pages/login";
import DataQuality from "@/pages/data-quality";
import Colleges from "@/pages/colleges";
import CollegeDetail from "@/pages/college-detail";
import ProgramDetail from "@/pages/program-detail";
import CourseDetailPage from "@/pages/course-detail";
import SurveyLanding from "@/pages/survey-landing";
import SurveyForm from "@/pages/survey-form";
import PlacementForm from "@/pages/placement-form";
import PlaceIntelAdmin from "@/pages/placeintel-admin";
import UsersPage from "@/pages/users";
import { Loader2 } from "lucide-react";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/jobs" component={Jobs} />
      <Route path="/analytics"><Redirect to="/" /></Route>
      <Route path="/data-quality" component={DataQuality} />
      <Route path="/companies" component={Companies} />
      <Route path="/people" component={People} />
      <Route path="/upload" component={UploadPage} />
      <Route path="/pipelines/jobs" component={JobCollection} />
      <Route path="/pipelines/jd" component={JDIntelligence} />
      <Route path="/pipelines/people" component={PeopleAlumni} />
      <Route path="/pipelines/quality" component={DataQualityPipelines} />
      <Route path="/pipelines/companies" component={CompanyIntel} />
      <Route path="/pipelines" component={Pipelines} />
      <Route path="/schedules" component={Schedules} />
      <Route path="/monitoring" component={Monitoring} />
      <Route path="/settings" component={Settings} />
      <Route path="/taxonomy" component={Taxonomy} />
      <Route path="/jd-analyzer" component={JDAnalyzer} />
      <Route path="/survey-admin" component={SurveyAdmin} />
      <Route path="/colleges" component={Colleges} />
      <Route path="/colleges/:id">{(params) => <CollegeDetail params={params} />}</Route>
      <Route path="/colleges/:id/programs/:pid">{(params) => <ProgramDetail params={params} />}</Route>
      <Route path="/colleges/:id/courses/:cid">{(params) => <CourseDetailPage params={params} />}</Route>
      <Route path="/reports" component={Reports} />
      <Route path="/placeintel-admin" component={PlaceIntelAdmin} />
      <Route path="/users" component={UsersPage} />
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

  // PlaceIntel form is standalone — uses its own OTP auth, no main app auth
  if (location.startsWith("/placement-form/")) {
    return (
      <Switch>
        <Route path="/placement-form/:college_id">{(params) => <PlacementForm params={params} />}</Route>
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
