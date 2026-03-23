import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, BookOpen, Code2, Sparkles, MapPin, Calendar,
  GraduationCap, Loader2, Search, ExternalLink, BarChart3,
} from "lucide-react";
import { Link } from "wouter";
import { ResponsiveContainer, Tooltip as RTooltip, Cell, PieChart, Pie, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

const DEGREE_COLORS: Record<string, string> = {
  bachelor: "bg-blue-100 text-blue-700",
  master: "bg-purple-100 text-purple-700",
  phd: "bg-red-100 text-red-700",
  graduate_certificate: "bg-amber-100 text-amber-700",
  diploma: "bg-green-100 text-green-700",
};

const SKILL_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#6366f1"];

interface CollegeDetail {
  id: string;
  name: string;
  short_name: string | null;
  country: string | null;
  city: string | null;
  website: string | null;
  catalog_year: string | null;
  schools: any[];
  programs: any[];
  course_count: number;
}

interface Program {
  id: string;
  name: string;
  degree_type: string;
  abbreviation: string | null;
  major: string | null;
  school_name: string | null;
  course_count: number;
  skill_count: number;
  duration_years: number | null;
  total_credit_points: number | null;
}

interface Course {
  id: string;
  code: string;
  name: string;
  credit_points: number;
  department_prefix: string | null;
  level: number | null;
  skill_count: number;
}

export default function CollegeDetail({ params }: { params: { id: string } }) {
  const collegeId = params.id;
  const [tab, setTab] = useState("programs");
  const [courseSearch, setCourseSearch] = useState("");
  const [prefixFilter, setPrefixFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const { data: college, isLoading } = useQuery<CollegeDetail>({
    queryKey: ["/api/colleges", collegeId],
    queryFn: async () => {
      const res = await authFetch(`/api/colleges/${collegeId}`);
      if (!res.ok) throw new Error("Failed to fetch college");
      return res.json();
    },
  });

  const { data: programs } = useQuery<Program[]>({
    queryKey: ["/api/colleges", collegeId, "programs"],
    queryFn: async () => {
      const res = await authFetch(`/api/colleges/${collegeId}/programs`);
      if (!res.ok) throw new Error("Failed to fetch programs");
      return res.json();
    },
    enabled: !!collegeId,
  });

  const courseParams = new URLSearchParams();
  if (courseSearch) courseParams.set("search", courseSearch);
  if (prefixFilter !== "all") courseParams.set("prefix", prefixFilter);
  if (levelFilter !== "all") courseParams.set("level", levelFilter);

  const { data: courses } = useQuery<Course[]>({
    queryKey: ["/api/colleges", collegeId, "courses", courseParams.toString()],
    queryFn: async () => {
      const res = await authFetch(`/api/colleges/${collegeId}/courses?${courseParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch courses");
      return res.json();
    },
    enabled: !!collegeId && tab === "courses",
  });

  const { data: heatmapData } = useQuery<any[]>({
    queryKey: ["/api/college/program-skill-heatmap", collegeId],
    queryFn: async () => {
      const res = await authFetch(`/api/college/program-skill-heatmap/${collegeId}`);
      if (!res.ok) throw new Error("Failed to fetch heatmap");
      return res.json();
    },
    enabled: !!collegeId && tab === "skills",
  });

  const { data: gapData } = useQuery<{ gaps: Record<string, string[]>; total: number }>({
    queryKey: ["/api/college/skill-gaps", collegeId],
    queryFn: async () => {
      const res = await authFetch(`/api/college/skill-gaps/${collegeId}`);
      if (!res.ok) throw new Error("Failed to fetch gaps");
      return res.json();
    },
    enabled: !!collegeId && tab === "analytics",
  });

  const { data: comparisonData } = useQuery<any>({
    queryKey: ["/api/college/compare-programs", compareIds.join(",")],
    queryFn: async () => {
      const res = await authFetch(`/api/college/compare-programs?program_ids=${compareIds.join(",")}`);
      if (!res.ok) throw new Error("Failed to compare");
      return res.json();
    },
    enabled: compareIds.length >= 2 && tab === "analytics",
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!college) return <div className="text-center py-20 text-muted-foreground">College not found</div>;

  // Build heatmap chart data
  const heatmapChartData = (() => {
    if (!heatmapData) return [];
    const categories = Array.from(new Set(heatmapData.map((h: any) => h.skill_category)));
    const programNames = Array.from(new Set(heatmapData.map((h: any) => h.program_name)));
    return programNames.map((pName) => {
      const row: Record<string, any> = { program: pName.length > 25 ? pName.slice(0, 25) + "..." : pName };
      for (const cat of categories) {
        const match = heatmapData.find((h: any) => h.program_name === pName && h.skill_category === cat);
        row[cat] = match ? Number(match.skill_count) : 0;
      }
      return row;
    });
  })();

  const heatmapCategories = heatmapData ? Array.from(new Set(heatmapData.map((h: any) => h.skill_category))) : [];

  // Unique prefixes for filter
  const prefixes = courses ? Array.from(new Set(courses.map((c) => c.department_prefix).filter(Boolean))) : [];

  // Group programs by school
  const programsBySchool: Record<string, Program[]> = {};
  for (const p of programs || []) {
    const school = p.school_name || "Other";
    if (!programsBySchool[school]) programsBySchool[school] = [];
    programsBySchool[school].push(p);
  }

  const toggleCompare = (id: string) => {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 4 ? [...prev, id] : prev
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/colleges">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{college.name}</h1>
            {college.short_name && <Badge variant="secondary">{college.short_name}</Badge>}
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
            {(college.city || college.country) && (
              <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{[college.city, college.country].filter(Boolean).join(", ")}</span>
            )}
            {college.catalog_year && (
              <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />Catalog {college.catalog_year}</span>
            )}
            {college.website && (
              <a href={college.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground">
                <ExternalLink className="h-3.5 w-3.5" />Website
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <BookOpen className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{college.programs.length}</p>
                <p className="text-sm text-muted-foreground">Programs</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Code2 className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{college.course_count}</p>
                <p className="text-sm text-muted-foreground">Courses</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <GraduationCap className="h-8 w-8 text-purple-500" />
              <div>
                <p className="text-2xl font-bold">{college.schools.length}</p>
                <p className="text-sm text-muted-foreground">Schools</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="programs">Programs</TabsTrigger>
          <TabsTrigger value="courses">Courses</TabsTrigger>
          <TabsTrigger value="skills">Skill Coverage</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Programs Tab */}
        <TabsContent value="programs" className="space-y-6">
          {Object.entries(programsBySchool).map(([school, progs]) => (
            <div key={school}>
              <h3 className="text-lg font-semibold mb-3">{school}</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {progs.map((p) => (
                  <Link key={p.id} href={`/colleges/${collegeId}/programs/${p.id}`}>
                    <Card className="cursor-pointer hover:border-primary/50 transition-colors">
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium">{p.name}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge className={DEGREE_COLORS[p.degree_type] || "bg-gray-100 text-gray-700"}>
                                {p.degree_type?.replace(/_/g, " ")}
                              </Badge>
                              {p.abbreviation && <Badge variant="outline">{p.abbreviation}</Badge>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                          <span>{p.course_count} courses</span>
                          <span>{p.skill_count} skills</span>
                          {p.duration_years && <span>{p.duration_years}yr</span>}
                          {p.total_credit_points && <span>{p.total_credit_points}cp</span>}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </TabsContent>

        {/* Courses Tab */}
        <TabsContent value="courses" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search courses..." value={courseSearch} onChange={(e) => setCourseSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={prefixFilter} onValueChange={setPrefixFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Prefix" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Prefixes</SelectItem>
                {prefixes.map((p) => <SelectItem key={p!} value={p!}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-[120px]"><SelectValue placeholder="Level" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                {[100, 200, 300, 400].map((l) => <SelectItem key={l} value={String(l)}>{l}-level</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Skills</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(courses || []).map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => window.location.hash = `#/colleges/${collegeId}/courses/${c.id}`}>
                    <TableCell className="font-mono font-medium">{c.code}</TableCell>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>{c.credit_points}</TableCell>
                    <TableCell>{c.level}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{c.skill_count}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {(!courses || courses.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No courses found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Skill Coverage Tab */}
        <TabsContent value="skills" className="space-y-4">
          {heatmapChartData.length > 0 ? (
            <Card>
              <CardHeader><CardTitle>Program Skill Heatmap</CardTitle></CardHeader>
              <CardContent>
                <div className="w-full" style={{ height: Math.max(400, heatmapChartData.length * 50) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={heatmapChartData} layout="vertical" margin={{ left: 150, right: 20, top: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="program" width={150} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      {heatmapCategories.map((cat, i) => (
                        <Bar key={cat} dataKey={cat} stackId="a" fill={SKILL_COLORS[i % SKILL_COLORS.length]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-50" />
                No skill data available yet
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          {/* Program Comparison */}
          <Card>
            <CardHeader>
              <CardTitle>Program Comparison</CardTitle>
              <p className="text-sm text-muted-foreground">Select 2-4 programs to compare skill profiles</p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2 mb-4">
                {(programs || []).map((p) => (
                  <Badge
                    key={p.id}
                    variant={compareIds.includes(p.id) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleCompare(p.id)}
                  >
                    {p.name}
                  </Badge>
                ))}
              </div>
              {comparisonData && (
                <div>
                  <div className="mb-4 text-sm text-muted-foreground">
                    {comparisonData.skills?.length || 0} skills compared across {comparisonData.programs?.length || 0} programs
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Skill</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Programs</TableHead>
                        <TableHead>Coverage</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(comparisonData.skills || []).slice(0, 50).map((s: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{s.skill_name}</TableCell>
                          <TableCell><Badge variant="secondary">{s.skill_category}</Badge></TableCell>
                          <TableCell className="text-sm">{(s.program_names || []).join(", ")}</TableCell>
                          <TableCell>
                            <Badge variant={s.program_count === compareIds.length ? "default" : "outline"}>
                              {s.program_count}/{compareIds.length}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Skill Gaps */}
          <Card>
            <CardHeader>
              <CardTitle>Skill Gap Analysis</CardTitle>
              <p className="text-sm text-muted-foreground">Taxonomy skills not covered by any program ({gapData?.total || 0} gaps)</p>
            </CardHeader>
            <CardContent>
              {gapData && Object.keys(gapData.gaps).length > 0 ? (
                <div className="space-y-4">
                  {Object.entries(gapData.gaps).map(([category, skills]) => (
                    <div key={category}>
                      <h4 className="font-medium mb-2">{category} ({skills.length})</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {skills.slice(0, 20).map((s) => (
                          <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                        ))}
                        {skills.length > 20 && <Badge variant="secondary" className="text-xs">+{skills.length - 20} more</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm py-4">No gap data available</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
